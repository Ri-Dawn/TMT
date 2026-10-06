// POST /api/checkout/razorpay   body: { booking_id }
// Creates a Razorpay order in the booking's own currency (INR, USD, EUR or GBP).
// International currencies need "International Payments" switched on in your Razorpay dashboard.
const Razorpay = require('razorpay');
const { supabase } = require('../../lib/supabase');

const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { booking_id } = req.body || {};
  if (!booking_id) return res.status(400).json({ error: 'Missing booking.' });
  try {
    const { data: booking, error } = await supabase.from('bookings').select('*').eq('id', booking_id).eq('payment_status', 'pending').single();
    if (error || !booking) return res.status(404).json({ error: 'This reservation is no longer waiting.' });

    const order = await razorpay.orders.create({
      amount: Math.round(Number(booking.amount) * 100), // paise / cents / pence
      currency: booking.currency,
      receipt: String(booking.booking_code || booking.id).slice(0, 40),
      notes: { booking_id: booking.id, booking_code: booking.booking_code || '' },
    });
    await supabase.from('bookings').update({ payment_ref: order.id }).eq('id', booking.id);

    return res.status(200).json({
      order_id: order.id, amount: order.amount, currency: order.currency, key_id: process.env.RAZORPAY_KEY_ID,
      client_name: booking.client_name, client_email: booking.client_email, client_phone: booking.client_phone,
    });
  } catch (err) {
    console.error('POST /api/checkout/razorpay error:', err);
    return res.status(500).json({ error: 'We could not open checkout just now. Please try again.' });
  }
};
