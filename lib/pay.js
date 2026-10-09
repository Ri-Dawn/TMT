// Razorpay order helper (INR, USD, EUR, GBP). International currencies need
// "International Payments" switched on in your Razorpay dashboard.
const Razorpay = require('razorpay');
let client;
const rz = () => client || (client = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }));

async function createOrder({ amount, currency, receipt, notes }) {
  const o = await rz().orders.create({ amount: Math.round(Number(amount) * 100), currency, receipt: String(receipt).slice(0, 40), notes: notes || {} });
  return { order_id: o.id, amount: o.amount, currency: o.currency, key_id: process.env.RAZORPAY_KEY_ID };
}
module.exports = { createOrder };
