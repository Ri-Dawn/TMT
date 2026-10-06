// POST /api/subscribe  { email, name }  -> saves a weekly-card subscriber
const { supabase } = require('../lib/supabase');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, name } = req.body || {};
  const clean = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(clean) || clean.length > 200) return res.status(400).json({ error: 'Please enter a valid email.' });
  const { error } = await supabase.from('subscribers').upsert({ email: clean, name: String(name || '').trim().slice(0, 80) || null }, { onConflict: 'email', ignoreDuplicates: true });
  if (error) { console.error('subscribe error:', error); return res.status(500).json({ error: 'Could not save that just now.' }); }
  return res.status(200).json({ ok: true });
};
