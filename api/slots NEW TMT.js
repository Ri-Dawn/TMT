// GET /api/slots -> { readingTypes, slots }
// Offers only hours that are really free: open, not within 45 minutes, and not overlapping
// any hour that someone is holding or has booked (whatever reading length they chose).
const { supabase } = require('../lib/supabase');

const BUFFER = 5, MIN_NOTICE_MIN = 45;
const toMin = (t) => { const p = String(t).split(':'); return +p[0] * 60 + +p[1]; };
const overlaps = (a, b) => a.slot_date === b.slot_date && toMin(a.start_time) < toMin(b.start_time) + b.duration_minutes + BUFFER && toMin(b.start_time) < toMin(a.start_time) + a.duration_minutes + BUFFER;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data: readingTypes, error: rtError } = await supabase.from('reading_types').select('*').eq('is_active', true).order('sort_order', { ascending: true });
    if (rtError) throw rtError;

    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const { data: all, error: slotsError } = await supabase.from('slots')
      .select('id, slot_date, start_time, duration_minutes, status, held_until').gte('slot_date', today)
      .order('slot_date', { ascending: true }).order('start_time', { ascending: true }).limit(2000);
    if (slotsError) throw slotsError;

    const rows = all || [], now = Date.now();
    const booked = rows.filter((s) => s.status === 'booked');
    let active = new Set();
    if (booked.length) {
      const { data: b } = await supabase.from('bookings').select('slot_id').in('slot_id', booked.map((s) => s.id)).in('payment_status', ['paid', 'pending']);
      active = new Set((b || []).map((x) => x.slot_id));
    }
    const busy = rows.filter((s) => (s.status === 'held' && new Date(s.held_until).getTime() > now) || (s.status === 'booked' && active.has(s.id)));
    const free = rows.filter((s) => s.status === 'open' || (s.status === 'held' && new Date(s.held_until).getTime() <= now));
    const slots = free
      .filter((s) => new Date(`${s.slot_date}T${s.start_time}+05:30`).getTime() > now + MIN_NOTICE_MIN * 60000)
      .filter((s) => !busy.some((b) => b.id !== s.id && overlaps(s, b)))
      .map((s) => ({ id: s.id, slot_date: s.slot_date, start_time: s.start_time, duration_minutes: s.duration_minutes }));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ readingTypes, slots });
  } catch (err) {
    console.error('GET /api/slots error:', err);
    return res.status(500).json({ error: 'Could not load availability. Please try again.' });
  }
};
