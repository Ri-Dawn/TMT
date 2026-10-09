// GET /api/slots -> { readingTypes, writtenTypes, slots }
// Offers only hours that are really free: open, not within 45 minutes, and not overlapping
// any hour that someone is holding or has booked (whatever reading length they chose).
// Fast on purpose: every database question is asked at the same moment, and answers are
// shared for a few seconds so most visitors get them instantly.
const { supabase } = require('../lib/supabase');

const BUFFER = 5, MIN_NOTICE_MIN = 45;
const toMin = (t) => { const p = String(t).split(':'); return +p[0] * 60 + +p[1]; };
const overlaps = (a, b) => a.slot_date === b.slot_date && toMin(a.start_time) < toMin(b.start_time) + b.duration_minutes + BUFFER && toMin(b.start_time) < toMin(a.start_time) + a.duration_minutes + BUFFER;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const now = Date.now();
    const today = new Date(now + 330 * 60000).toISOString().slice(0, 10);
    const t0 = new Date(now + 330 * 60000); t0.setUTCHours(0, 0, 0, 0);
    const since = new Date(t0.getTime() - 330 * 60000).toISOString(), fresh = new Date(now - 15 * 60000).toISOString();

    const [typesR, slotsR, bookingsR, ordersR] = await Promise.all([
      supabase.from('reading_types').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('slots').select('id, slot_date, start_time, duration_minutes, status, held_until').gte('slot_date', today).order('slot_date', { ascending: true }).order('start_time', { ascending: true }).limit(2000),
      supabase.from('bookings').select('slot_id').in('payment_status', ['paid', 'pending']),
      Promise.resolve(supabase.from('written_orders').select('reading_type_id,payment_status,created_at').gte('created_at', since)).catch(() => ({ data: [] })),
    ]);
    if (typesR.error) throw typesR.error;
    if (slotsR.error) throw slotsR.error;

    const allTypes = typesR.data || [];
    const readingTypes = allTypes.filter((t) => (t.kind || 'live') === 'live' && Number(t.duration_minutes) > 0);

    const used = {};
    ((ordersR && ordersR.data) || []).forEach((o) => { if (o.payment_status === 'paid' || (o.payment_status === 'pending' && o.created_at > fresh)) used[o.reading_type_id] = (used[o.reading_type_id] || 0) + 1; });
    const writtenTypes = allTypes.filter((t) => t.kind === 'written').map((t) => ({ id: t.id, slug: t.slug, label: t.label, question_range: t.question_range,
      price_inr: t.price_inr, price_usd: t.price_usd, price_eur: t.price_eur, price_gbp: t.price_gbp, available: t.daily_cap == null || (used[t.id] || 0) < t.daily_cap }));

    const rows = slotsR.data || [];
    const active = new Set(((bookingsR && bookingsR.data) || []).map((b) => b.slot_id));
    const busy = rows.filter((s) => (s.status === 'held' && new Date(s.held_until).getTime() > now) || (s.status === 'booked' && active.has(s.id)));
    const free = rows.filter((s) => s.status === 'open' || (s.status === 'held' && new Date(s.held_until).getTime() <= now));
    const slots = free
      .filter((s) => new Date(`${s.slot_date}T${s.start_time}+05:30`).getTime() > now + MIN_NOTICE_MIN * 60000)
      .filter((s) => !busy.some((b) => b.id !== s.id && overlaps(s, b)))
      .map((s) => ({ id: s.id, slot_date: s.slot_date, start_time: s.start_time, duration_minutes: s.duration_minutes }));

    // A few seconds of sharing makes the panel appear almost instantly; booking itself always re-checks.
    res.setHeader('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=60');
    return res.status(200).json({ readingTypes, writtenTypes, slots });
  } catch (err) {
    console.error('GET /api/slots error:', err);
    return res.status(500).json({ error: 'Could not load availability. Please try again.' });
  }
};
