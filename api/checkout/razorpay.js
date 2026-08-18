// POST /api/checkout/razorpay
// body: { booking_id }
// Creates a Razorpay order and returns what the frontend needs to open
// Razorpay's Checkout widget (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/)
const Razorpay = require('razorpay');
const { supabase } = require('../../lib/supabase');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { booking_id } = req.body || {};
  if (!booking_id) return res.status(400).json({ error: 'Missing booking_id.' });

  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', booking_id)
      .eq('payment_status', 'pending')
      .eq('gateway', 'razorpay')
      .single();

    if (error || !booking) {
      return res.status(404).json({ error: 'Booking not found or already processed.' });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(booking.amount * 100), // paise
      currency: 'INR',
      receipt: booking.id,
      notes: { booking_id: booking.id },
    });

    await supabase.from('bookings').update({ payment_ref: order.id }).eq('id', booking.id);

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID, // public key, safe to expose to frontend
      client_name: booking.client_name,
      client_email: booking.client_email,
      client_phone: booking.client_phone,
    });
  } catch (err) {
    console.error('POST /api/checkout/razorpay error:', err);
    return res.status(500).json({ error: 'Could not start payment. Please try again.' });
  }
};
