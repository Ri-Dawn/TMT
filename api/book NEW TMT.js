// POST /api/book
// body: { slot_id, reading_type_id, client_name, client_email, client_phone, currency, contact_mode, topic }
// currency: INR | USD | EUR | GBP. Indian rupees use Razorpay; other currencies use Razorpay or PayPal.
// Holds the hour for 10 minutes and creates a 'pending' booking with a short reference code.
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');

const HOLD_MINUTES = 10, BUFFER = 5;
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
const newCode = () => 'MT-' + Array.from(crypto.randomBytes(4), (n) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[n % 31]).join('');
const toMin = (t) => { const p = String(t).split(':'); return +p[0] * 60 + +p[1]; };
const overlaps = (a, b) => a.slot_date === b.slot_date && toMin(a.start_time) < toMin(b.start_time) + b.duration_minutes + BUFFER && toMin(b.start_time) < toMin(a.start_time) + a.duration_minutes + BUFFER;

// Hours someone else is holding or has booked (any reading length)
async function busySlots(fromDate) {
  const { data: s } = await supabase.from('slots').select('id,slot_date,start_time,duration_minutes,status,held_until').gte('slot_date', fromDate).in('status', ['held', 'booked']);
  const list = s || [], booked = list.filter((x) => x.status === 'booked');
  let active = new Set();
  if (booked.length) {
    const { data: b } = await supabase.from('bookings').select('slot_id').in('slot_id', booked.map((x) => x.id)).in('payment_status', ['paid', 'pending']);
    active = new Set((b || []).map((x) => x.slot_id));
  }
  return list.filter((x) => (x.status === 'held' && new Date(x.held_until) > new Date()) || (x.status === 'booked' && active.has(x.id)));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { slot_id, reading_type_id, client_name, client_email, client_phone, currency, contact_mode, topic, pay_with } = req.body || {};

  if (!slot_id || !reading_type_id || !client_name || !client_email || !client_phone || !currency) return res.status(400).json({ error: 'Please fill in every detail.' });
  if (!['instagram', 'meet'].includes(contact_mode)) return res.status(400).json({ error: 'Please choose how you would like to speak.' });
  if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Invalid currency.' });

  try {
    const { data: readingType, error: rtError } = await supabase.from('reading_types').select('*').eq('id', reading_type_id).eq('is_active', true).single();
    if (rtError || !readingType) return res.status(400).json({ error: 'Reading not found.' });
    const amount = readingType['price_' + currency.toLowerCase()];
    if (amount == null) return res.status(400).json({ error: 'That currency is not available for this reading.' });

    const gateway = currency !== 'INR' && pay_with === 'paypal' ? 'paypal' : 'razorpay';
    const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
    const { data: heldSlot, error: holdError } = await supabase.from('slots').update({ status: 'held', held_until: heldUntil })
      .eq('id', slot_id).or(`status.eq.open,and(status.eq.held,held_until.lt.${new Date().toISOString()})`).select().single();
    if (holdError || !heldSlot) return res.status(409).json({ error: 'That hour was just taken. Please choose another.' });

    const release = () => supabase.from('slots').update({ status: 'open', held_until: null }).eq('id', slot_id);
    if (heldSlot.duration_minutes !== readingType.duration_minutes) { await release(); return res.status(400).json({ error: 'This hour does not match the selected reading.' }); }

    // One reader: a different-length reading that overlaps this hour must not be taken at the same time.
    const clash = (await busySlots(heldSlot.slot_date)).filter((b) => b.id !== slot_id).some((b) => overlaps(heldSlot, b));
    if (clash) { await release(); return res.status(409).json({ error: 'That hour was just taken. Please choose another.' }); }

    const { data: booking, error: bookingError } = await supabase.from('bookings').insert({
      slot_id, reading_type_id, client_name, client_email, client_phone, contact_mode,
      booking_code: newCode(), topic: (topic || '').slice(0, 80) || null,
      currency, gateway, amount, payment_status: 'pending',
    }).select().single();
    if (bookingError) { await release(); throw bookingError; }

    return res.status(200).json({ booking_id: booking.id, amount, currency, gateway, hold_expires_at: heldUntil, booking_code: booking.booking_code, contact_mode });
  } catch (err) {
    console.error('POST /api/book error:', err);
    return res.status(500).json({ error: 'We could not hold that hour. Please try again.' });
  }
};
