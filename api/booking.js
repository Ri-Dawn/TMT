// GET /api/booking?id=<booking id>   or   /api/booking?order=<written order id>
// Safe details for the confirmation page (no email or phone number is returned).
const { supabase } = require('../lib/supabase');
const IST_OFFSET = '+05:30';
const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id, order } = req.query || {};
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (order) {
      const { data: o } = await supabase.from('written_orders').select('*').eq('id', order).single();
      if (!o) return res.status(404).json({ error: 'Not found' });
      const { data: rt } = await supabase.from('reading_types').select('label').eq('id', o.reading_type_id).single();
      return res.json({ kind: 'written', status: o.payment_status, code: o.order_code, label: rt ? rt.label : 'Written reading', due: o.due_at, name: first(o.client_name), emailed: !!o.email_sent, delivery: o.delivery_mode || 'email' });
    }
    const { data: b } = await supabase.from('bookings').select('*').eq('id', id).single();
    if (!b) return res.status(404).json({ error: 'Not found' });
    const { data: s } = await supabase.from('slots').select('*').eq('id', b.slot_id).single();
    const { data: rt } = await supabase.from('reading_types').select('label,duration_minutes').eq('id', b.reading_type_id).single();
    return res.json({
      kind: 'live', status: b.payment_status, code: b.booking_code, mode: b.contact_mode, name: first(b.client_name), emailed: !!b.email_sent,
      label: rt ? rt.label : 'Private reading', minutes: rt ? rt.duration_minutes : null,
      start: s ? new Date(`${s.slot_date}T${s.start_time}${IST_OFFSET}`).toISOString() : null,
    });
  } catch (err) {
    console.error('GET /api/booking error:', err);
    return res.status(500).json({ error: 'Could not load this reservation.' });
  }
};
