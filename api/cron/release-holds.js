// GET /api/cron/release-holds
// Runs on a schedule (configured in vercel.json) to free up slots where a client
// started checkout but never finished paying within the 10-minute hold window.
const { supabase } = require('../../lib/supabase');

module.exports = async (req, res) => {
  // Vercel Cron sends a special header — reject anyone else calling this directly.
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date().toISOString();

    const { data: expiredSlots, error } = await supabase
      .from('slots')
      .update({ status: 'open', held_until: null })
      .eq('status', 'held')
      .lt('held_until', now)
      .select();

    if (error) throw error;

    // Mark the matching pending bookings as failed so they don't linger as 'pending' forever.
    if (expiredSlots && expiredSlots.length > 0) {
      const slotIds = expiredSlots.map((s) => s.id);
      await supabase
        .from('bookings')
        .update({ payment_status: 'failed' })
        .in('slot_id', slotIds)
        .eq('payment_status', 'pending');
    }

    return res.status(200).json({ released: expiredSlots?.length || 0 });
  } catch (err) {
    console.error('Cron release-holds error:', err);
    return res.status(500).json({ error: 'Failed to release expired holds.' });
  }
};
