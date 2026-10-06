// The Midnight Desk: private API for managing readings and open times.
// Protected by DESK_KEY (set it in Vercel). One endpoint, many actions: /api/desk?action=...
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');

const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const MEET = process.env.MEETING_LINK || 'https://meet.google.com/bct-sjzt-kov';

function authed(req) {
  const key = process.env.DESK_KEY || '';
  const given = String(req.headers['x-desk-key'] || '');
  return key.length > 0 && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}
const newCode = () => 'MT-' + Array.from(crypto.randomBytes(4), (n) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[n % 31]).join('');
const fail = (msg) => Object.assign(new Error(msg), { user: true });

// Older tables may only allow open / held / booked, so 'blocked' falls back to 'booked'.
async function setSlots(ids, status, from) {
  if (!ids.length) return;
  const run = (st) => { let q = supabase.from('slots').update({ status: st, held_until: null }).in('id', ids); if (from) q = q.in('status', from); return q; };
  let r = await run(status);
  if (r.error && status === 'blocked') r = await run('booked');
  if (r.error) throw r.error;
}
async function activeBookingSlots(ids) {
  const { data } = await supabase.from('bookings').select('slot_id,payment_status').in('slot_id', ids).in('payment_status', ['paid', 'pending']);
  return new Set((data || []).map((b) => b.slot_id));
}

module.exports = async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'Locked' });
  const action = req.query.action, b = req.body || {};
  try {
    if (action === 'overview') {
      const [t, s, k] = await Promise.all([
        supabase.from('reading_types').select('*').order('sort_order'),
        supabase.from('slots').select('*').gte('slot_date', today()).order('slot_date').order('start_time'),
        supabase.from('bookings').select('*').order('created_at', { ascending: false }).limit(300),
      ]);
      for (const r of [t, s, k]) if (r.error) throw r.error;
      return res.json({ types: t.data, slots: s.data, bookings: k.data, today: today(), meet: MEET });
    }
    if (req.method !== 'POST') return res.status(405).end();

    if (action === 'closeSlots') { await setSlots(b.ids || [], 'blocked', ['open']); return res.json({ ok: true }); }
    if (action === 'openSlots') {
      const busy = await activeBookingSlots(b.ids || []);
      await setSlots((b.ids || []).filter((id) => !busy.has(id)), 'open', ['blocked', 'booked']);
      return res.json({ ok: true });
    }
    if (action === 'closeDay' || action === 'openDay') {
      const { data } = await supabase.from('slots').select('id,status').eq('slot_date', b.date);
      const ids = (data || []).map((s) => s.id);
      if (action === 'closeDay') await setSlots(ids, 'blocked', ['open']);
      else { const busy = await activeBookingSlots(ids); await setSlots(ids.filter((i) => !busy.has(i)), 'open', ['blocked', 'booked']); }
      return res.json({ ok: true });
    }
    if (action === 'addSlot') {
      if (!b.date || !b.time || !b.duration) throw fail('Please choose a date, time and length.');
      const { error } = await supabase.from('slots').insert({ slot_date: b.date, start_time: b.time, duration_minutes: Number(b.duration), status: 'open' });
      if (error) throw error;
      return res.json({ ok: true });
    }
    if (action === 'savePrices') {
      for (const p of b.prices || []) {
        const patch = {};
        for (const c of ['inr', 'usd', 'eur', 'gbp']) {
          const v = Number(p['price_' + c]);
          if (!(v > 0) || v > 100000) throw fail('Every price must be a positive number.');
          patch['price_' + c] = Math.round(v * 100) / 100;
        }
        const { error } = await supabase.from('reading_types').update(patch).eq('id', p.id);
        if (error) throw error;
      }
      return res.json({ ok: true });
    }
    if (action === 'igConfirmed') {
      await supabase.from('bookings').update({ ig_confirmed: !!b.value }).eq('id', b.booking_id);
      return res.json({ ok: true });
    }
    if (action === 'openHours') {
      const days = Math.min(Math.max(Number(b.days) || 14, 1), 60), step = Math.max(10, Number(b.step) || 30);
      const [sh, sm] = String(b.start || '').split(':').map(Number), [eh, em] = String(b.end || '').split(':').map(Number);
      const startMin = sh * 60 + sm, endMin = eh * 60 + em;
      if (!(endMin > startMin)) throw fail('Please choose a start time that comes before the end time.');
      const durs = (b.durations || []).map(Number).filter(Boolean);
      if (!durs.length) throw fail('Please choose at least one reading length.');
      const wd = new Set((b.weekdays || []).map(Number));
      if (!wd.size) throw fail('Please choose at least one night.');
      const fmt = (t) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + ':00';
      const nowIst = new Date(Date.now() + IST), nowMin = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
      const dates = [], rows = [];
      for (let i = 0; i <= days; i++) {
        const d = new Date(Date.now() + IST + i * 864e5), ds = d.toISOString().slice(0, 10);
        if (!wd.has(d.getUTCDay())) continue;
        dates.push(ds);
        for (let t = startMin; t < endMin; t += step) {
          if (i === 0 && t < nowMin + 45) continue;
          for (const dur of durs) if (t + dur <= endMin) rows.push({ slot_date: ds, start_time: fmt(t), duration_minutes: dur, status: 'open' });
        }
      }
      if (!dates.length) throw fail('None of those nights fall in the next few weeks.');
      const { data: ex } = await supabase.from('slots').select('id,slot_date,start_time,duration_minutes,status').in('slot_date', dates);
      if (b.replace) {
        const open = (ex || []).filter((s) => s.status === 'open').map((s) => s.id);
        const { data: used } = open.length ? await supabase.from('bookings').select('slot_id').in('slot_id', open) : { data: [] };
        const usedSet = new Set((used || []).map((u) => u.slot_id)), del = open.filter((id) => !usedSet.has(id));
        if (del.length) await supabase.from('slots').delete().in('id', del);
      }
      const { data: ex2 } = await supabase.from('slots').select('slot_date,start_time,duration_minutes').in('slot_date', dates);
      const have = new Set((ex2 || []).map((s) => s.slot_date + '|' + String(s.start_time).slice(0, 8) + '|' + s.duration_minutes));
      const fresh = rows.filter((r) => !have.has(r.slot_date + '|' + r.start_time + '|' + r.duration_minutes));
      for (let i = 0; i < fresh.length; i += 500) { const { error } = await supabase.from('slots').insert(fresh.slice(i, i + 500)); if (error) throw error; }
      return res.json({ ok: true, added: fresh.length, nights: dates.length });
    }
    if (action === 'markPaid') {
      const { data: bk } = await supabase.from('bookings').select('slot_id').eq('id', b.booking_id).single();
      await supabase.from('bookings').update({ payment_status: 'paid' }).eq('id', b.booking_id);
      if (bk) await supabase.from('slots').update({ status: 'booked', held_until: null }).eq('id', bk.slot_id);
      return res.json({ ok: true });
    }
    if (action === 'cancelBooking') {
      const { data: bk } = await supabase.from('bookings').select('slot_id').eq('id', b.booking_id).single();
      let r = await supabase.from('bookings').update({ payment_status: 'cancelled' }).eq('id', b.booking_id);
      if (r.error) r = await supabase.from('bookings').update({ payment_status: 'failed' }).eq('id', b.booking_id);
      if (r.error) throw r.error;
      if (bk) await supabase.from('slots').update({ status: 'open', held_until: null }).eq('id', bk.slot_id);
      return res.json({ ok: true });
    }
    if (action === 'moveBooking') {
      const { data: bk } = await supabase.from('bookings').select('slot_id').eq('id', b.booking_id).single();
      const { data: oldS } = await supabase.from('slots').select('duration_minutes').eq('id', bk.slot_id).single();
      const { data: ns } = await supabase.from('slots').select('*').eq('id', b.new_slot_id).single();
      if (!ns || !['open', 'blocked'].includes(ns.status)) throw fail('That time is no longer open.');
      if (oldS && ns.duration_minutes !== oldS.duration_minutes) throw fail('Please choose a time of the same length.');
      await supabase.from('slots').update({ status: 'booked', held_until: null }).eq('id', ns.id);
      await supabase.from('bookings').update({ slot_id: ns.id }).eq('id', b.booking_id);
      await supabase.from('slots').update({ status: 'open', held_until: null }).eq('id', bk.slot_id);
      return res.json({ ok: true });
    }
    if (action === 'addBooking') {
      const { data: rt } = await supabase.from('reading_types').select('*').eq('id', b.reading_type_id).single();
      const { data: sl } = await supabase.from('slots').select('*').eq('id', b.slot_id).single();
      if (!rt || !sl) throw fail('Please choose a reading and a time.');
      if (sl.status !== 'open') throw fail('That time is no longer open.');
      if (!b.client_name) throw fail('Please add a name.');
      const { error } = await supabase.from('bookings').insert({
        slot_id: sl.id, reading_type_id: rt.id, client_name: b.client_name, client_email: b.client_email || '', client_phone: b.client_phone || '',
        currency: 'INR', gateway: 'upi', amount: rt.price_inr, payment_status: b.paid ? 'paid' : 'pending',
        booking_code: newCode(),
        contact_mode: b.contact_mode === 'meet' ? 'meet' : 'instagram', instagram_handle: (b.instagram_handle || '').replace(/^@/, '') || null,
      });
      if (error) throw error;
      await supabase.from('slots').update({ status: 'booked', held_until: null }).eq('id', sl.id);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('desk error:', action, e);
    return res.status(e.user ? 400 : 500).json({ error: e.user ? e.message : 'Something went wrong. Please try again.' });
  }
};
