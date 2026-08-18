// POST /api/book
// body: { slot_id, reading_type_id, client_name, client_email, client_phone, currency }
// currency: 'INR' | 'USD' — this is what decides the gateway (INR -> razorpay, USD -> stripe)
//
// Soft-locks the slot for 10 minutes and creates a 'pending' booking row.
// The frontend then calls /api/checkout/razorpay or /api/checkout/stripe with the
// returned booking_id to actually start payment.
const { supabase } = require('../lib/supabase');

const HOLD_MINUTES = 10;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slot_id, reading_type_id, client_name, client_email, client_phone, currency } = req.body || {};

  if (!slot_id || !reading_type_id || !client_name || !client_email || !client_phone || !currency) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!['INR', 'USD'].includes(currency)) {
    return res.status(400).json({ error: 'Invalid currency.' });
  }

  try {
    const { data: readingType, error: rtError } = await supabase
      .from('reading_types')
      .select('*')
      .eq('id', reading_type_id)
      .eq('is_active', true)
      .single();
    if (rtError || !readingType) {
      return res.status(400).json({ error: 'Reading type not found.' });
    }

    // Optimistic lock: only succeeds if the slot is currently 'open'.
    // Prevents two clients from both grabbing the same slot at once.
    const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
    const { data: heldSlot, error: holdError } = await supabase
      .from('slots')
      .update({ status: 'held', held_until: heldUntil })
      .eq('id', slot_id)
      .eq('status', 'open')
      .select()
      .single();

    if (holdError || !heldSlot) {
      return res.status(409).json({ error: 'That slot was just taken. Please pick another.' });
    }

    if (heldSlot.duration_minutes !== readingType.duration_minutes) {
      // Roll back the hold — this slot wasn't meant for this reading type.
      await supabase.from('slots').update({ status: 'open', held_until: null }).eq('id', slot_id);
      return res.status(400).json({ error: 'This slot does not match the selected reading length.' });
    }

    const amount = currency === 'INR' ? readingType.price_inr : readingType.price_usd;
    const gateway = currency === 'INR' ? 'razorpay' : 'stripe';

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        slot_id,
        reading_type_id,
        client_name,
        client_email,
        client_phone,
        currency,
        gateway,
        amount,
        payment_status: 'pending',
      })
      .select()
      .single();

    if (bookingError) {
      // Roll back the hold if we couldn't create the booking.
      await supabase.from('slots').update({ status: 'open', held_until: null }).eq('id', slot_id);
      throw bookingError;
    }

    return res.status(200).json({
      booking_id: booking.id,
      amount,
      currency,
      gateway,
      hold_expires_at: heldUntil,
    });
  } catch (err) {
    console.error('POST /api/book error:', err);
    return res.status(500).json({ error: 'Could not reserve the slot. Please try again.' });
  }
};
