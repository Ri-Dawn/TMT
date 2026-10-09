// POST /api/quick   (written readings: Angel Number Decode and Express Verdict)
// body: { offer: 'angel'|'verdict', name, email, tz, currency, number, context, question, marketing_ok, source }
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { createOrder } = require('../lib/pay');

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
const code = () => 'WR-' + Array.from(crypto.randomBytes(4), (n) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[n % 31]).join('');
const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  const name = clean(b.name, 80), currency = String(b.currency || '').toUpperCase();
  const mode = ['email', 'instagram', 'whatsapp'].includes(b.delivery_mode) ? b.delivery_mode : 'email';
  let email = clean(b.email, 160).toLowerCase(), contact = clean(b.delivery_contact, 80);
  if (!name) return res.status(400).json({ error: 'Please add your name.' });
  if (mode === 'email') { email = contact.toLowerCase() || email; contact = email; if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please check your email address. Your reading is sent there.' }); }
  else if (mode === 'instagram') { contact = contact.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[\/?].*$/, ''); if (!/^[A-Za-z0-9._]{1,30}$/.test(contact)) return res.status(400).json({ error: 'Please type your Instagram name, so we know where to send your reading.' }); }
  else { const dg = contact.replace(/\D/g, ''); if (dg.length < 7 || dg.length > 15) return res.status(400).json({ error: 'Please check your WhatsApp number, including the country code.' }); contact = '+' + dg; }
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please check your email address.' });
  if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Invalid currency.' });

  let number_text = null, context_text = null, question_text = null;
  if (b.offer === 'angel') {
    number_text = clean(b.number, 30); context_text = clean(b.context, 200);
    if (!number_text) return res.status(400).json({ error: 'Please tell us the number you keep seeing.' });
  } else if (b.offer === 'verdict') {
    question_text = String(b.question || '').trim().replace(/[ \t]+/g, ' ').slice(0, 400);
    if (question_text.length < 8) return res.status(400).json({ error: 'Please type your question, so the cards have something to answer.' });
  } else return res.status(400).json({ error: 'Unknown reading.' });

  try {
    const { data: rt } = await supabase.from('reading_types').select('*').eq('slug', b.offer).eq('kind', 'written').eq('is_active', true).single();
    if (!rt) return res.status(404).json({ error: 'This reading is resting for now. Please return soon.' });
    const amount = rt['price_' + currency.toLowerCase()];
    if (amount == null) return res.status(400).json({ error: 'That currency is not available for this reading.' });

    if (rt.daily_cap != null) {
      const t0 = new Date(Date.now() + 330 * 60000); t0.setUTCHours(0, 0, 0, 0);
      const since = new Date(t0.getTime() - 330 * 60000).toISOString(), fresh = new Date(Date.now() - 15 * 60000).toISOString();
      const { data: ords } = await supabase.from('written_orders').select('payment_status,created_at').eq('reading_type_id', rt.id).gte('created_at', since);
      const used = (ords || []).filter((o) => o.payment_status === 'paid' || (o.payment_status === 'pending' && o.created_at > fresh)).length;
      if (used >= rt.daily_cap) return res.status(409).json({ error: "Today's written readings are fully held. They open again tomorrow." });
    }

    const { data: order, error } = await supabase.from('written_orders').insert({
      reading_type_id: rt.id, order_code: code(), client_name: name, client_email: email || '', delivery_mode: mode, delivery_contact: contact, client_tz: clean(b.tz, 60) || null,
      currency, amount, gateway: 'razorpay', payment_status: 'pending', number_text, context_text, question_text,
      marketing_ok: !!b.marketing_ok, source: clean(b.source, 60) || null, due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }).select().single();
    if (error) throw error;

    let checkout;
    try { checkout = await createOrder({ amount, currency, receipt: order.order_code, notes: { written_order_id: order.id, order_code: order.order_code } }); }
    catch (e) { console.error('Razorpay order error:', e); await supabase.from('written_orders').update({ payment_status: 'failed' }).eq('id', order.id); return res.status(502).json({ error: 'We could not open secure checkout just now. Please try once more.' }); }
    await supabase.from('written_orders').update({ payment_ref: checkout.order_id }).eq('id', order.id);
    return res.status(200).json({ order_id: order.id, order_code: order.order_code, checkout: { ...checkout, client_name: name, client_email: email || '', client_phone: mode === 'whatsapp' ? contact : '' } });
  } catch (err) {
    console.error('POST /api/quick error:', err);
    return res.status(500).json({ error: 'We could not receive that just now. Please try again.' });
  }
};
