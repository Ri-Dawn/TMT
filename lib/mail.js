// Emails in the voice of The Midnight Truth. Sends through Resend when RESEND_API_KEY and
// EMAIL_FROM are set in Vercel; if they are not set, nothing is sent and nothing breaks.
const SITE = process.env.SITE_URL || 'https://www.midnighttruth.com';
const MEET = process.env.MEETING_LINK || 'https://meet.google.com/bct-sjzt-kov';
const IG = 'https://ig.me/m/midnighttruthco';
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const first = (n) => esc(String(n || '').trim().split(/\s+/)[0] || 'friend');
const slotISO = (s) => new Date(`${s.slot_date}T${s.start_time}+05:30`).toISOString();

function whenIn(iso, tz) {
  const o = { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true };
  try { return new Date(iso).toLocaleString('en-GB', { ...o, timeZone: tz || 'Asia/Kolkata' }); } catch (e) { return new Date(iso).toLocaleString('en-GB', { ...o, timeZone: 'Asia/Kolkata' }); }
}
const isIST = (tz) => !tz || /Calcutta|Kolkata/.test(tz);

function shell(inner) {
  return `<div style="background:#0d0d12;padding:28px 12px;font-family:Georgia,'Times New Roman',serif;color:#ece6d8">
<div style="max-width:560px;margin:0 auto;background:#15151d;border:1px solid #3a3226;border-radius:16px;padding:36px 30px;line-height:1.7;font-size:16px">
<div style="text-align:center;color:#d9bb85;letter-spacing:.3em;font-size:12px;text-transform:uppercase;margin-bottom:22px">The Midnight Truth</div>${inner}
<div style="border-top:1px solid #3a3226;margin-top:30px;padding-top:16px;font-size:12px;color:#a9a191;text-align:center">
<a href="${SITE}/terms.html" style="color:#a9a191">Terms</a> · <a href="${SITE}/privacy.html" style="color:#a9a191">Privacy</a> · <a href="${SITE}/cancellations.html" style="color:#a9a191">Cancellations &amp; Refunds</a><br>Readings are for reflection and guidance, not medical, legal or financial advice.</div></div></div>`;
}
const btn = (href, label) => `<p style="text-align:center;margin:22px 0"><a href="${href}" style="background:#b08d57;color:#0d0d12;text-decoration:none;padding:13px 26px;border-radius:100px;font-family:Arial,sans-serif;font-size:13px;letter-spacing:.12em;text-transform:uppercase">${label}</a></p>`;
const gold = (t) => `<span style="color:#d9bb85">${t}</span>`;

async function sendMail({ to, subject, html, text, replyTo }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, text, reply_to: replyTo || process.env.EMAIL_REPLY_TO || undefined }),
    });
    if (!r.ok) console.error('Resend error:', r.status, await r.text());
    return r.ok;
  } catch (e) { console.error('Resend failed:', e); return false; }
}

function liveEmail({ booking, slot, rt }) {
  const iso = slotISO(slot), tz = booking.client_tz, mins = rt.duration_minutes;
  const local = whenIn(iso, tz), ist = whenIn(iso, 'Asia/Kolkata');
  const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const cal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('The Midnight Truth · ' + rt.label) + '&dates=' + z(new Date(iso)) + '/' + z(new Date(new Date(iso).getTime() + mins * 60000)) + '&details=' + encodeURIComponent('Your private reading. Reference ' + booking.booking_code);
  const how = booking.contact_mode === 'meet'
    ? `<p>At your hour, step into our private room. It is audio only, and you may wait a moment while we let you in.</p>${btn(MEET, 'Join at your hour')}<p style="text-align:center;font-size:13px;color:#a9a191">${esc(MEET)}</p>`
    : `<p><b>One quiet last step.</b> Message our Instagram and send us this reference, so we know you are on your way: ${gold('<b>' + esc(booking.booking_code) + '</b>')}. At your hour, we will call you there.</p>${btn(IG, 'Message @midnighttruthco')}`;
  const html = shell(`<h1 style="font-weight:400;font-size:26px;text-align:center;margin:0 0 6px">Your hour is yours</h1>
<p style="text-align:center;font-style:italic;color:#d9bb85;margin:0 0 22px">The cards are waiting. So is the truth.</p>
<p>Dear ${first(booking.client_name)},</p>
<p>Your hour is set aside for you alone. Come as you are, with whatever is weighing on you, and we will sit with it together.</p>
<p style="border-left:2px solid #b08d57;padding-left:14px"><b>${esc(rt.label)}</b> · ${mins} minutes<br>${esc(local)}${isIST(tz) ? '' : '<br><span style="color:#a9a191;font-size:14px">India time: ' + esc(ist) + '</span>'}<br><span style="color:#a9a191;font-size:14px">Your reference: ${esc(booking.booking_code)}</span></p>
${how}<p style="text-align:center"><a href="${cal}" style="color:#d9bb85;font-size:14px">Add this hour to my calendar</a></p>
<p style="font-size:14px;color:#a9a191">If this hour stops working, simply reply to this email and we will find you another.</p>`);
  const text = `Your hour is yours.\n\n${rt.label} · ${mins} minutes\n${local}${isIST(tz) ? '' : '\nIndia time: ' + ist}\nReference: ${booking.booking_code}\n\n` + (booking.contact_mode === 'meet' ? `Join our private room at your hour: ${MEET}\n` : `One last step: message @midnighttruthco on Instagram (${IG}) with your reference ${booking.booking_code}. At your hour, we will call you there.\n`) + `\nIf this hour stops working, reply to this email and we will find you another.`;
  return { to: booking.client_email, subject: `Your hour is held · ${local}`, html, text };
}

function writtenEmail({ order, rt }) {
  const tz = order.client_tz, due = whenIn(order.due_at, tz);
  const said = order.question_text ? `<p style="font-style:italic;color:#d9bb85">“${esc(order.question_text)}”</p>` : `<p style="font-style:italic;color:#d9bb85">${esc(order.number_text)}${order.context_text ? ' · ' + esc(order.context_text) : ''}</p>`;
  const html = shell(`<h1 style="font-weight:400;font-size:26px;text-align:center;margin:0 0 22px">We have your question</h1>
<p>Dear ${first(order.client_name)},</p><p>Thank you for trusting us with this. We have it, and we will sit with it carefully.</p>${said}
<p style="border-left:2px solid #b08d57;padding-left:14px"><b>${esc(rt.label)}</b><br>Your written reading arrives in this inbox by <b>${esc(due)}</b>${isIST(tz) ? '' : ' (your time)'}.<br><span style="color:#a9a191;font-size:14px">Your reference: ${esc(order.order_code)}</span></p>
<p style="font-size:14px;color:#a9a191">If you do not see it, please look in your spam or promotions folder, or reply to this email.</p>`);
  const text = `We have your question.\n\n${order.question_text || order.number_text + (order.context_text ? ' · ' + order.context_text : '')}\n\n${rt.label}\nYour written reading arrives in this inbox by ${due}.\nReference: ${order.order_code}`;
  return { to: order.client_email, subject: `We have your question · reading by ${due}`, html, text };
}

function replyEmail({ order, rt, reply }) {
  const body = String(reply).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = shell(`<h1 style="font-weight:400;font-size:26px;text-align:center;margin:0 0 22px">${esc(rt.label)}</h1><p>Dear ${first(order.client_name)},</p>${body}
<p style="border-top:1px solid #3a3226;padding-top:16px;font-size:14px;color:#a9a191">If you would like to sit with this live, an hour can be held for you here.</p>${btn(SITE + '/reserve', 'Reserve an hour')}`);
  const text = `Dear ${String(order.client_name || '').split(/\s+/)[0] || 'friend'},\n\n${reply}\n\nIf you would like to sit with this live: ${SITE}/reserve`;
  return { to: order.client_email, subject: `Your reading from The Midnight Truth · ${rt.label}`, html, text };
}

module.exports = { sendMail, liveEmail, writtenEmail, replyEmail, whenIn, slotISO };
