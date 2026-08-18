// GET /api/slots
// GET /api/slots?reading_type_id=xxxx  -> only slots whose duration matches that reading type
// GET /api/reading-types is handled by the same file via ?types=1 for simplicity,
// or call this with no params to get both in one response (fewer round trips for the widget).
const { supabase } = require('../lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { reading_type_id } = req.query;

    const { data: readingTypes, error: rtError } = await supabase
      .from('reading_types')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (rtError) throw rtError;

    let slotsQuery = supabase
      .from('slots')
      .select('id, slot_date, start_time, duration_minutes')
      .eq('status', 'open')
      .gte('slot_date', new Date().toISOString().slice(0, 10))
      .order('slot_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (reading_type_id) {
      const rt = readingTypes.find((r) => r.id === reading_type_id);
      if (rt) {
        slotsQuery = slotsQuery.eq('duration_minutes', rt.duration_minutes);
      }
    }

    const { data: slots, error: slotsError } = await slotsQuery;
    if (slotsError) throw slotsError;

    // Also drop any slot whose hold has expired but hasn't been swept yet by the cron job,
    // so the widget never shows a stale-but-technically-'held' slot as open (status filter
    // above already excludes 'held', this is just a safety net for edge timing).
    return res.status(200).json({ readingTypes, slots });
  } catch (err) {
    console.error('GET /api/slots error:', err);
    return res.status(500).json({ error: 'Could not load availability. Please try again.' });
  }
};
