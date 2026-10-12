// The Midnight Truth — booking widget
// Include this after your existing site JS, and drop the matching HTML block
// (see booking-widget.html) wherever you want the widget to appear (e.g. right
// after your reading-options section).
//
// Loads Razorpay's checkout script lazily only when an Indian client actually
// clicks "Pay", so it never slows down the rest of the site.

(function () {
  const state = {
    readingTypes: [],
    slots: [],
    selectedReadingType: null,
    selectedSlot: null,
    cur: siteCurrency(),
    dayKey: null,
    loaded: false,
    mode: 'live',
    writtenType: null,
    writtenTypes: [],
    deliveryMode: 'email',
  };
  let pendingWritten = null;

  // Holds a duration (minutes) requested via mtSelectReadingType() before the
  // reading types have finished loading from the API, so the selection can be
  // applied as soon as they arrive.
  let pendingDurationSelect = null;

  const SYM = { inr: '₹', usd: '$', eur: '€', gbp: '£' };
  // Known readings are drawn at once, so the panel never waits on the network. Real data replaces them a moment later.
  const DEFAULT_LIVE = [
    { id: 'd15', label: 'One Question', question_range: '1 question', duration_minutes: 15, price_inr: 999, price_usd: 12.12, price_eur: 9.99, price_gbp: 8.88, placeholder: true },
    { id: 'd25', label: 'Two Questions', question_range: '2 questions', duration_minutes: 25, price_inr: 1555, price_usd: 18.18, price_eur: 15.15, price_gbp: 13.33, placeholder: true },
    { id: 'd40', label: 'Three to Five Questions', question_range: '3-5 questions', duration_minutes: 40, price_inr: 3111, price_usd: 35.35, price_eur: 30.3, price_gbp: 26.26, placeholder: true }];
  const DEFAULT_WRITTEN = [
    { slug: 'angel', label: 'Angel Number Decode', price_inr: 399, price_usd: 5.55, price_eur: 4.44, price_gbp: 3.33, available: true },
    { slug: 'verdict', label: 'Express Verdict', price_inr: 499, price_usd: 7.77, price_eur: 5.55, price_gbp: 4.44, available: true }];
  const BLURB = { angel: 'Your number, decoded in writing', verdict: 'One question, answered in writing' };
  const DAYS_FIRST = 3, DAYS_ALL = 7;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DIAL = [['India', '+91'], ['United States', '+1'], ['Canada', '+1'], ['United Kingdom', '+44'], ['UAE', '+971'], ['Australia', '+61'], ['Singapore', '+65'], ['Germany', '+49'], ['France', '+33'], ['Netherlands', '+31'], ['Ireland', '+353'], ['Spain', '+34'], ['Italy', '+39'], ['Switzerland', '+41'], ['Sweden', '+46'], ['Norway', '+47'], ['Denmark', '+45'], ['New Zealand', '+64'], ['Malaysia', '+60'], ['Hong Kong', '+852'], ['Japan', '+81'], ['Saudi Arabia', '+966'], ['Qatar', '+974'], ['Kuwait', '+965'], ['Oman', '+968'], ['Bahrain', '+973'], ['South Africa', '+27'], ['Nigeria', '+234'], ['Pakistan', '+92'], ['Bangladesh', '+880'], ['Nepal', '+977'], ['Sri Lanka', '+94']];
  const DIAL_BY_TZ = [[/Calcutta|Kolkata/, '+91'], [/^Europe\/(London|Belfast|Jersey|Guernsey|Isle_of_Man)$/, '+44'], [/^Australia\//, '+61'], [/^America\/(?!Sao_Paulo|Mexico|Argentina|Bogota|Lima|Santiago|Caracas|Montevideo)/, '+1'], [/Honolulu/, '+1'], [/Dubai/, '+971'], [/Singapore/, '+65'], [/Berlin/, '+49'], [/Paris/, '+33'], [/Amsterdam/, '+31'], [/Dublin/, '+353'], [/Madrid/, '+34'], [/Rome/, '+39'], [/Zurich/, '+41'], [/Stockholm/, '+46'], [/Oslo/, '+47'], [/Copenhagen/, '+45'], [/Auckland/, '+64'], [/Kuala_Lumpur/, '+60'], [/Hong_Kong/, '+852'], [/Tokyo/, '+81'], [/Riyadh/, '+966'], [/Qatar/, '+974'], [/Kuwait/, '+965'], [/Muscat/, '+968'], [/Bahrain/, '+973'], [/Johannesburg/, '+27'], [/Lagos/, '+234'], [/Karachi/, '+92'], [/Dhaka/, '+880'], [/Kathmandu/, '+977'], [/Colombo/, '+94']];
  const TYPO = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'yahho.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'iclod.com': 'icloud.com' };
  const isIndia = /Calcutta|Kolkata/.test((Intl.DateTimeFormat().resolvedOptions().timeZone || ''));
  const istText = (s) => { const p = s.start_time.split(':'); const hh = +p[0]; return (hh % 12 || 12) + ':' + p[1] + ' ' + (hh < 12 ? 'AM' : 'PM') + ' IST'; };
  const TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your timezone'; } catch (e) { return 'your timezone'; } })();

  const TZ_NAME = /Calcutta|Kolkata/.test(TZ) ? 'India Standard Time' : TZ.replace(/_/g, ' ');

  function siteCurrency() {
    const a = document.querySelector('.cur-btn.active');
    return (a && a.dataset.cur) || 'inr';
  }
  const billedCur = () => state.cur.toUpperCase();
  const fmtNum = (n) => { const v = Number(n); return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const money = (rt, cur) => SYM[cur] + fmtNum(rt['price_' + cur]);
  // The exact amount that will be charged, in the visitor's chosen currency.
  const billedText = (rt) => (state.cur === 'inr' ? money(rt, 'inr') : money(rt, state.cur) + ' ' + state.cur.toUpperCase());
  const payLabel = () => 'Reserve my hour';
  // Slots are stored in India time; turn them into the visitor's own clock.
  const slotDate = (s) => new Date(s.slot_date + 'T' + s.start_time + '+05:30');
  const dayKey = (d) => d.toLocaleDateString('en-CA');
  const timeLabel = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function dayLabel(d) {
    const k = dayKey(d), now = new Date(), tom = new Date(now.getTime() + 864e5);
    if (k === dayKey(now)) return 'Tonight';
    if (k === dayKey(tom)) return 'Tomorrow';
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function guessCurrency() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      return tz.includes('Calcutta') || tz.includes('Kolkata') ? 'INR' : 'USD';
    } catch (e) {
      return 'USD';
    }
  }

  // Homepage prices follow the database, so changing a price in your desk updates the whole site.
  function syncHomePrices() {
    document.querySelectorAll('.cur-amt[data-rt]').forEach((node) => {
      const rt = state.readingTypes.find((r) => String(r.duration_minutes) === node.dataset.rt);
      if (!rt) return;
      ['inr', 'usd', 'eur', 'gbp'].forEach((c) => { if (rt['price_' + c] != null) node.dataset[c] = fmtNum(rt['price_' + c]); });
    });
    document.querySelectorAll('.cur-amt[data-slug]').forEach((node) => {
      const wt = (state.writtenTypes || []).find((r) => r.slug === node.dataset.slug);
      if (!wt) return;
      ['inr', 'usd', 'eur', 'gbp'].forEach((c) => { if (wt['price_' + c] != null) node.dataset[c] = fmtNum(wt['price_' + c]); });
    });
    const on = document.querySelector('.cur-btn.active');
    if (on) on.click();
  }

  // ---------- written readings live inside the same panel: no page to find, nothing to 404 ----------
  function renderWrittenCards() {
    const types = el('mt-reading-types');
    if (!types) return;
    let box = el('mt-written-cards');
    if (!box) {
      box = document.createElement('div'); box.id = 'mt-written-cards'; box.className = 'mt-written';
      types.parentNode.insertBefore(box, types.nextSibling);
      const wrap = document.createElement('div'); wrap.id = 'mt-written-form-wrap';
      types.parentNode.insertBefore(wrap, box.nextSibling);
    }
    const list = state.writtenTypes && state.writtenTypes.length ? state.writtenTypes : DEFAULT_WRITTEN;
    box.innerHTML = '<p class="mt-wr-head">Or receive it in writing<span>Reply within 24 hours</span></p><div class="mt-wr-row">' + list.map((t) =>
      '<button type="button" class="mt-reading-type-btn mt-wr' + (state.mode === 'written' && state.writtenType && state.writtenType.slug === t.slug ? ' active' : '') + '" data-slug="' + esc(t.slug) + '"' + (t.available === false ? ' disabled' : '') + '>' +
      '<span class="mt-rt-label">' + esc(t.label) + '</span><span class="mt-rt-meta">' + esc(BLURB[t.slug] || '') + '</span><span class="mt-rt-price">' + (t.available === false ? 'Opens again tomorrow' : money(t, state.cur)) + '</span></button>').join('') + '</div>';
    box.querySelectorAll('.mt-wr').forEach((b) => b.addEventListener('click', () => enterWritten(b.dataset.slug)));
  }
  function exitWritten() {
    if (state.mode !== 'written') return;
    state.mode = 'live'; state.writtenType = null;
    const wrap = el('mt-written-form-wrap'); if (wrap) wrap.innerHTML = '';
    renderWrittenCards();
  }
  function enterWritten(slug) {
    const t = (state.writtenTypes || []).find((x) => x.slug === slug) || DEFAULT_WRITTEN.find((x) => x.slug === slug);
    if (!t) return;
    state.mode = 'written'; state.writtenType = t; state.selectedReadingType = null; state.selectedSlot = null; state.deliveryMode = 'email';
    const f = el('mt-details-form'); if (f) f.style.display = 'none';
    const s = el('mt-slots'); if (s) s.innerHTML = '';
    document.querySelectorAll('#mt-reading-types .mt-reading-type-btn').forEach((b) => b.classList.remove('active'));
    renderWrittenCards();
    renderWrittenForm();
    preloadCheckout();
    const wrap = el('mt-written-form-wrap'); if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function writtenSummary() {
    const t = state.writtenType; if (!t) return '';
    return '<b>' + esc(t.label) + '</b><br>' + (t.available === false ? 'Today\'s written readings are fully held. They open again tomorrow.' : money(t, state.cur) + (state.cur === 'inr' ? '' : ' ' + state.cur.toUpperCase()) + '<br><small>Written for you, delivered within 24 hours.</small>');
  }
  function refreshWritten() {
    const s = el('mt-w-sum'); if (s) s.innerHTML = writtenSummary();
    const b = el('mt-w-btn'); if (b && state.writtenType) b.disabled = state.writtenType.available === false;
  }
  function writtenDelivery() {
    const L = { email: 'Email', instagram: 'Instagram', whatsapp: 'WhatsApp' };
    el('mt-w-dlv').innerHTML = Object.keys(L).map((k) => '<button type="button" class="mt-dl' + (k === state.deliveryMode ? ' on' : '') + '" data-m="' + k + '">' + L[k] + '</button>').join('');
    el('mt-w-dlv').querySelectorAll('.mt-dl').forEach((b) => b.addEventListener('click', () => { state.deliveryMode = b.dataset.m; writtenDelivery(); }));
    const m = state.deliveryMode; let f = '';
    if (m === 'email') f = '<input type="email" id="mt-w-dc" autocomplete="email" placeholder="Your email" maxlength="160"><p class="mt-note">Your reading arrives in your inbox. Please check spam if you do not see it.</p>';
    else if (m === 'instagram') f = '<input type="text" id="mt-w-dc" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="@yourname" maxlength="60"><p class="mt-note">We send your reading as a message on Instagram, from @midnighttruthco.</p>';
    else { const hit = DIAL_BY_TZ.find((r) => r[0].test(TZ)); f = '<div class="mt-phone-row"><select id="mt-w-cc" aria-label="Country code">' + DIAL.map((c) => '<option value="' + c[1] + '"' + (hit && hit[1] === c[1] ? ' selected' : '') + '>' + c[0] + ' ' + c[1] + '</option>').join('') + '</select><input type="tel" id="mt-w-dc" placeholder="WhatsApp number" maxlength="20"></div><p class="mt-note">We send your reading on WhatsApp.</p>'; }
    el('mt-w-field').innerHTML = f;
    el('mt-w-opt').innerHTML = m === 'email' ? '' : '<input type="email" id="mt-w-oe" autocomplete="email" placeholder="Email for your receipt (optional)" maxlength="160">';
  }
  function renderWrittenForm() {
    const t = state.writtenType, wrap = el('mt-written-form-wrap');
    if (!t || !wrap) return;
    const angel = t.slug === 'angel';
    wrap.innerHTML = '<form id="mt-written-form" class="mt-details-form" novalidate>' +
      '<h3>' + esc(t.label) + '</h3>' +
      '<p class="mt-w-lead">' + (angel ? 'Send us the number, and one line about what is happening in your life. We will write back with what it is asking of you.' : 'Type the one question that will not rest. We draw three cards for it, and you receive a clear, honest verdict in writing.') + '</p>' +
      (angel ? '<input type="text" id="mt-w-num" maxlength="30" autocomplete="off" placeholder="The number you keep seeing (for example 1111)"><textarea id="mt-w-ctx" rows="3" maxlength="200" placeholder="One line about what is happening"></textarea>'
             : '<textarea id="mt-w-q" rows="5" maxlength="400" placeholder="Your question, asked as honestly as you can"></textarea><div class="mt-cnt"><span id="mt-w-c">0</span> / 400</div>') +
      '<input type="text" id="mt-w-name" autocomplete="name" placeholder="Your name" maxlength="80">' +
      '<p class="mt-q">Where shall we send your reading? <em>Choose one</em></p><div class="mt-dlv" id="mt-w-dlv"></div><div id="mt-w-field"></div><div id="mt-w-opt"></div>' +
      '<label class="mt-mkt"><input type="checkbox" id="mt-w-mkt"><span>Keep me posted when new readings open (optional)</span></label>' +
      '<p class="mt-summary" id="mt-w-sum"></p><p id="mt-w-error" class="mt-form-error"></p>' +
      '<button type="submit" id="mt-w-btn" class="btn blood">' + (angel ? 'Send my number' : 'Ask my question') + '</button><p class="mt-trust">Secure checkout by Razorpay · UPI, cards and more</p></form>';
    writtenDelivery(); refreshWritten();
    const q = el('mt-w-q'); if (q) q.addEventListener('input', () => { el('mt-w-c').textContent = q.value.length; });
    el('mt-written-form').addEventListener('submit', submitWritten);
  }
  async function submitWritten(e) {
    e.preventDefault();
    const t = state.writtenType; if (!t) return;
    const errEl = el('mt-w-error'); errEl.textContent = '';
    const bad = (m) => { errEl.textContent = m; };
    const m = state.deliveryMode, dc = el('mt-w-dc').value.trim();
    const contact = m === 'whatsapp' ? el('mt-w-cc').value + dc.replace(/\D/g, '').replace(/^0+/, '') : dc;
    const body = { offer: t.slug, name: el('mt-w-name').value.trim(), delivery_mode: m, delivery_contact: contact, email: m === 'email' ? '' : (el('mt-w-oe') ? el('mt-w-oe').value.trim() : ''), tz: TZ, currency: billedCur(), marketing_ok: !!el('mt-w-mkt').checked,
      source: (function () { try { return sessionStorage.getItem('mtSrc'); } catch (x) { return null; } })() };
    if (t.slug === 'angel') { body.number = el('mt-w-num').value.trim(); body.context = el('mt-w-ctx').value.trim(); if (!body.number) return bad('Please tell us the number you keep seeing.'); }
    else { body.question = el('mt-w-q').value.trim(); if (body.question.length < 8) return bad('Please type your question, so the cards have something to answer.'); }
    if (!body.name) return bad('Please add your name.');
    if (m === 'email' && !/^\S+@\S+\.\S+$/.test(dc)) return bad('Please check your email. Your reading is sent there.');
    if (m === 'instagram' && !/^@?[A-Za-z0-9._]{1,30}$/.test(dc)) return bad('Please type your Instagram name, so we know where to send your reading.');
    if (m === 'whatsapp' && (contact.replace(/\D/g, '').length < 8 || contact.replace(/\D/g, '').length > 15)) return bad('Please check your WhatsApp number, including the country code.');
    if (body.email && !/^\S+@\S+\.\S+$/.test(body.email)) return bad('Please check your email address.');
    const btn = el('mt-w-btn'); btn.disabled = true; btn.textContent = 'Opening secure checkout…';
    overlay(true, 'Opening secure checkout…'); preloadCheckout();
    const label = t.slug === 'angel' ? 'Send my number' : 'Ask my question';
    const back = () => { overlay(false); btn.disabled = false; btn.textContent = label; };
    try {
      const r = await fetch('/api/quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.checkout) { back(); bad(j.error || 'Something went wrong. Please try again.'); return; }
      openRazorpay(j.checkout, '/booking-confirmed.html?order_id=' + j.order_id, { description: t.label, btn: 'mt-w-btn', label: label, err: 'mt-w-error' });
    } catch (x) { back(); bad('Something went wrong. Please try again.'); }
  }
  window.mtSelectWritten = function (slug) {
    const w = el('mt-booking-widget');
    if (!w) { pendingWritten = slug; return; }
    enterWritten(slug);
  };

  async function loadAvailability() {
    try {
      let data = null;
      if (window.__mtSlots) { data = await window.__mtSlots; window.__mtSlots = null; }
      if (!data || !data.readingTypes) {
        const res = await fetch('/api/slots');
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'load');
      }
      state.readingTypes = (data.readingTypes || []).filter((t) => (t.kind || 'live') === 'live' && Number(t.duration_minutes) > 0);
      state.slots = data.slots || [];
      state.writtenTypes = data.writtenTypes || [];
      state.loaded = true;
      try { localStorage.setItem('mtCache', JSON.stringify({ t: Date.now(), readingTypes: state.readingTypes, writtenTypes: state.writtenTypes })); } catch (x) {}
    } catch (e) {
      const box = el('mt-reading-types');
      if (box) box.innerHTML = '<p class="mt-empty">The hours could not be loaded just now. Please refresh in a moment, or message us on Instagram.</p>';
      return;
    }
    renderReadingTypes();
    renderWrittenCards();
    syncHomePrices();
    if (state.mode === 'written' && state.writtenType) {
      state.writtenType = state.writtenTypes.find((x) => x.slug === state.writtenType.slug) || state.writtenType;
      refreshWritten();
    }
    if (pendingDurationSelect !== null) {
      const d = pendingDurationSelect; pendingDurationSelect = null;
      const m = state.readingTypes.find((r) => r.duration_minutes === d);
      if (m) selectReadingTypeById(m.id);
    } else if (state.selectedReadingType) {
      state.selectedReadingType = state.readingTypes.find((r) => r.id === state.selectedReadingType.id) || state.selectedReadingType;
      renderSlots();
    }
    if (pendingWritten) { const p = pendingWritten; pendingWritten = null; enterWritten(p); }
  }

  function el(id) {
    return document.getElementById(id);
  }

  function renderReadingTypes() {
    const container = el('mt-reading-types');
    if (!container) return;
    container.innerHTML = state.readingTypes
      .map(
        (rt) => `
        <button type="button" class="mt-reading-type-btn${state.mode === 'live' && state.selectedReadingType && (state.selectedReadingType.id === rt.id || (state.selectedReadingType.placeholder && state.selectedReadingType.duration_minutes === rt.duration_minutes)) ? ' active' : ''}" data-id="${rt.id}">
          <span class="mt-rt-label">${rt.label}</span>
          <span class="mt-rt-meta">${rt.question_range} · ${rt.duration_minutes} min</span>
          <span class="mt-rt-price">${money(rt, state.cur)}</span>
        </button>`
      )
      .join('');

    container.querySelectorAll('.mt-reading-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectReadingTypeById(btn.dataset.id);
      });
    });
  }

  // Switching the reading type (even after a slot or the form was already
  // showing) always clears the previously chosen slot — a slot's duration is
  // tied to one reading type, so an old pick can't carry over to a new one.
  function selectReadingTypeById(id) {
    const container = el('mt-reading-types');
    if (!container) return;
    const btn = container.querySelector(`.mt-reading-type-btn[data-id="${id}"]`);
    if (!btn) return;
    exitWritten();

    container.querySelectorAll('.mt-reading-type-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedReadingType = state.readingTypes.find((r) => r.id === id);
    if (state.selectedReadingType && state.selectedReadingType.placeholder) pendingDurationSelect = state.selectedReadingType.duration_minutes;
    state.selectedSlot = null;

    const form = el('mt-details-form');
    if (form) form.style.display = 'none';
    const errorEl = el('mt-form-error');
    if (errorEl) errorEl.textContent = '';

    renderSlots();
    refreshNote();
  }

  // Called from anywhere on the site (a "Reserve This Reading" button, a
  // signature-question card, etc.) to jump straight to a specific reading
  // length and scroll the widget into view. durationMinutes must match a
  // reading_type's duration_minutes in Supabase (15 / 25 / 40 by default).
  function selectReadingTypeByDuration(durationMinutes) {
    if (!state.readingTypes.length) {
      // Data not loaded yet — remember the request and apply it once it is.
      pendingDurationSelect = durationMinutes;
      const widget = el('mt-booking-widget');
      if (widget) widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const match = state.readingTypes.find((r) => r.duration_minutes === durationMinutes);
    if (!match) return;
    selectReadingTypeById(match.id);
    const widget = el('mt-booking-widget');
    if (widget) widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSlots() {
    const container = el('mt-slots');
    if (!container || !state.selectedReadingType) return;
    if (!state.loaded) { container.innerHTML = '<p class="mt-prompt">Finding open hours…</p>'; return; }
    const rt = state.selectedReadingType;
    const items = state.slots
      .filter((s) => s.duration_minutes === rt.duration_minutes)
      .map((s) => ({ s, d: slotDate(s) }))
      .filter((x) => x.d.getTime() > Date.now())
      .sort((x, y) => x.d - y.d);

    if (!items.length) {
      container.innerHTML = '<p class="mt-empty">All of this week\'s sessions are held. New nights open every day: check back soon, or message us on Instagram.</p>';
      return;
    }
    const byDay = {};
    items.forEach((x) => { (byDay[dayKey(x.d)] = byDay[dayKey(x.d)] || []).push(x); });
    const allDays = Object.keys(byDay);
    const days = allDays.slice(0, state.moreDays ? DAYS_ALL : DAYS_FIRST);
    if (!state.dayKey || !byDay[state.dayKey] || !days.includes(state.dayKey)) state.dayKey = days[0];
    const first = items[0];

    container.innerHTML =
      '<button type="button" class="mt-next" data-id="' + first.s.id + '">Next available <b>' + dayLabel(first.d) + ' · ' + timeLabel(first.d) + '</b></button>' +
      '<div class="mt-days">' + days.map((k) => '<button type="button" class="mt-day' + (k === state.dayKey ? ' active' : '') + '" data-k="' + k + '">' + dayLabel(byDay[k][0].d) + '</button>').join('') + (!state.moreDays && allDays.length > DAYS_FIRST ? '<button type="button" class="mt-day mt-more">More nights</button>' : '') + '</div>' +
      '<div class="mt-slot-times">' + byDay[state.dayKey].map((x) => '<button type="button" class="mt-slot-btn' + (state.selectedSlot && state.selectedSlot.id === x.s.id ? ' active' : '') + '" data-id="' + x.s.id + '">' + timeLabel(x.d) + (isIndia ? '' : '<small>' + istText(x.s) + '</small>') + '</button>').join('') + '</div>' +
      '<p class="mt-tz">' + (isIndia ? 'Times shown in India Standard Time' : 'Times shown in your timezone (' + TZ_NAME + '). India time is shown beneath each hour.') + '</p>';

    const pick = (id) => {
      state.selectedSlot = items.find((x) => x.s.id === id).s;
      state.dayKey = dayKey(slotDate(state.selectedSlot));
      renderSlots();
      showForm();
    };
    container.querySelector('.mt-next').addEventListener('click', () => pick(first.s.id));
    const more = container.querySelector('.mt-more');
    if (more) more.addEventListener('click', () => { state.moreDays = true; renderSlots(); });
    container.querySelectorAll('.mt-day:not(.mt-more)').forEach((b) => b.addEventListener('click', () => { state.dayKey = b.dataset.k; renderSlots(); }));
    container.querySelectorAll('.mt-slot-btn').forEach((b) => b.addEventListener('click', () => pick(b.dataset.id)));
  }

  function updateSummary() {
    const form = el('mt-details-form');
    if (!form || !state.selectedSlot) return;
    let sum = el('mt-summary');
    if (!sum) {
      sum = document.createElement('p');
      sum.id = 'mt-summary';
      sum.className = 'mt-summary';
      form.insertBefore(sum, el('mt-form-error'));
    }
    const rt = state.selectedReadingType, d = slotDate(state.selectedSlot);
    const indiaLine = isIndia ? '' : '<br><small>India time: ' + new Date(state.selectedSlot.slot_date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) + ', ' + istText(state.selectedSlot) + '</small>';
    const em = el('mt-email') ? el('mt-email').value.trim() : '';
    sum.innerHTML = '<b>' + esc(rt.label) + '</b><br>' + dayLabel(d) + ', ' + timeLabel(d) + (isIndia ? '' : ' your time') + indiaLine + '<br>' + billedText(rt) + (em ? '<br><small>Your confirmation goes to ' + esc(em) + '</small>' : '') + '<br><small>Your hour is held for you for 10 minutes while you complete your reservation.</small>';
    const btn = el('mt-submit-btn');
    if (btn && !btn.disabled) btn.textContent = payLabel();
  }
  function showForm() {
    const form = el('mt-details-form');
    if (!form || !state.selectedSlot) return;
    updateSummary();
    preloadCheckout();
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function overlay(on, msg) {
    let o = document.getElementById('mt-overlay');
    if (!on) { if (o) o.classList.remove('on'); return; }
    if (!o) {
      o = document.createElement('div');
      o.id = 'mt-overlay';
      o.innerHTML = '<div><img src="/mt-ring.png" alt=""><p></p></div>';
      document.body.appendChild(o);
    }
    o.querySelector('p').textContent = msg || 'Opening secure checkout…';
    o.classList.add('on');
  }
  let warmed = false;
  function preloadCheckout() {
    if (!warmed) { warmed = true; try { fetch('/api/book').catch(() => {}); } catch (e) {} }
    if (window.Razorpay || document.getElementById('mt-rzp')) return;
    const s = document.createElement('script');
    s.id = 'mt-rzp'; s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
    document.head.appendChild(s);
  }

  // Keep the widget in step with the site's currency buttons (and let visitors switch right here).
  function setCurrency(cur) {
    state.cur = cur;
    document.querySelectorAll('.mt-cur').forEach((b) => b.classList.toggle('active', b.dataset.cur === cur));
    renderReadingTypes();
    const active = el('mt-reading-types') && el('mt-reading-types').querySelector('.mt-reading-type-btn[data-id="' + (state.selectedReadingType && state.selectedReadingType.id) + '"]');
    if (active) active.classList.add('active');
    if (state.selectedSlot) updateSummary();
    renderWrittenCards();
    if (state.mode === 'written') refreshWritten();
    refreshNote();
  }
  function refreshNote() {
    const n = document.getElementById('selectionNote'), rt = state.selectedReadingType;
    if (!n || !n.dataset.q || !rt) return;
    if (n.classList.contains('show') && Number(n.dataset.dur) === rt.duration_minutes) {
      n.textContent = 'Selected: ' + n.dataset.q + ' — ' + billedText(rt) + '. Choose your time below.';
    } else {
      n.classList.remove('show');
      if (n.dataset.def) n.textContent = n.dataset.def;
    }
  }
  function injectUi() {
    const note = document.getElementById('selectionNote');
    if (note && !note.dataset.def) note.dataset.def = note.textContent;
    const css = document.createElement('style');
    css.textContent = '.mt-cur-row{display:flex;gap:8px;justify-content:center;margin:0 0 18px}.mt-cur{font:inherit;font-size:11px;letter-spacing:.08em;padding:7px 14px;border-radius:100px;border:1px solid rgba(176,141,87,.3);background:transparent;color:var(--bone-dim,#a9a191);cursor:pointer}.mt-cur.active{background:linear-gradient(155deg,var(--gold-soft,#d9bb85),var(--gold,#b08d57));color:var(--ink,#0d0d12);font-weight:500}' +
      '.mt-next{display:block;margin:0 auto 18px;padding:12px 22px;border-radius:100px;border:1px solid var(--gold,#b08d57);background:rgba(176,141,87,.12);color:var(--bone,#ece6d8);font:inherit;cursor:pointer}.mt-next b{color:var(--gold-soft,#d9bb85);font-weight:500;margin-left:6px}' +
      '.mt-days{display:flex;gap:6px;overflow-x:auto;padding:4px 2px 12px;justify-content:center;flex-wrap:wrap}.mt-day{font:inherit;font-size:11.5px;letter-spacing:.03em;padding:8px 12px;border-radius:100px;border:1px solid rgba(176,141,87,.25);background:transparent;color:var(--bone-dim,#a9a191);cursor:pointer;white-space:nowrap}.mt-day.active{border-color:var(--gold,#b08d57);color:var(--bone,#ece6d8);background:rgba(176,141,87,.12)}' +
      '.mt-tz{font-size:12px;opacity:.65;margin:14px 0 0}.mt-summary{font-size:14px;line-height:1.7;margin:0 0 14px;color:var(--bone,#ece6d8)}.mt-summary small{opacity:.7}';
    css.textContent += '#mt-details-form{max-width:380px!important;margin-left:auto!important;margin-right:auto!important}#mt-details-form input[type=text],#mt-details-form input[type=email],#mt-details-form input[type=tel]{width:100%!important;box-sizing:border-box;min-height:44px!important;padding:10px 14px!important;font-size:16px!important;border-radius:12px!important}.mt-phone-row{display:flex;gap:8px}.mt-phone-row select{flex:0 0 40%;max-width:160px;font:inherit;font-size:16px;color:inherit;background:rgba(255,255,255,.04);border:1px solid rgba(243,237,228,.16);border-radius:12px;padding:0 8px;min-height:44px}.mt-phone-row select option{color:#111}' +
      '.mt-why{text-align:left;font-size:12.5px;opacity:.85;margin:6px 2px 12px}.mt-why-btn{background:none;border:0;color:var(--gold-soft,#d9bb85);font:inherit;font-size:12.5px;text-decoration:underline;cursor:pointer;padding:0}.mt-why-note{margin-top:8px;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(243,237,228,.14);line-height:1.6}' +
      '.mt-mkt{display:flex;gap:10px;align-items:flex-start;margin-top:10px;cursor:pointer}.mt-mkt input{width:auto!important;margin:3px 0 0!important;accent-color:#b08d57}.mt-hint{font-size:12.5px;text-align:left;margin:-4px 2px 8px;color:var(--gold-soft,#d9bb85)}.mt-hint a{color:inherit}' +
      '.mt-mode{text-align:left;margin:10px 0 16px;padding:2px;border-radius:16px}.mt-mode.mt-need{outline:1px solid var(--gold,#b08d57);box-shadow:0 0 0 4px rgba(176,141,87,.15)}.mt-q{margin:0 0 10px;font-size:15px}.mt-q em{font-style:normal;font-size:12px;opacity:.6;margin-left:6px}' +
      '.mt-opt{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;margin:0 0 10px;border-radius:14px;border:1px solid rgba(243,237,228,.16);background:rgba(255,255,255,.035);cursor:pointer;transition:border-color .25s,background .25s}.mt-opt.sel{border-color:var(--gold,#b08d57);background:rgba(176,141,87,.12)}.mt-opt input{width:auto!important;margin:4px 0 0!important;accent-color:#b08d57}.mt-opt strong{display:block;font-weight:500;font-size:15px}.mt-opt small{display:block;margin-top:4px;font-size:12.5px;line-height:1.55;opacity:.78}.mt-opt small b{font-weight:500;color:var(--gold-soft,#e8cc9c)}.mt-sub{margin:-4px 0 12px;font-size:12.5px;opacity:.72}.mt-opt input[type=radio],.mt-mkt input[type=checkbox]{-webkit-appearance:none;appearance:none;flex:none;width:18px!important;height:18px!important;min-height:0!important;padding:0!important;margin:3px 0 0!important;border:1.5px solid rgba(243,237,228,.42)!important;background:transparent!important;border-radius:50%!important;cursor:pointer;box-shadow:none!important}.mt-mkt input[type=checkbox]{border-radius:5px!important}.mt-opt input[type=radio]:checked{border-color:#c69a5c!important;background:radial-gradient(circle,#e8cc9c 0 36%,transparent 40%)!important}.mt-mkt input[type=checkbox]:checked{border-color:#c69a5c!important;background:#c69a5c url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2012%2012%27%3E%3Cpath%20d=%27M2.5%206.4l2.3%202.3%204.7-5%27%20fill=%27none%27%20stroke=%27%230b0b0e%27%20stroke-width=%271.8%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E) no-repeat center/12px!important}.mt-written{margin:0 0 22px;text-align:center}.mt-wr-head{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--gold,#b08d57);margin:0 0 12px}.mt-wr-head span{display:block;margin-top:5px;opacity:.75;letter-spacing:.08em;text-transform:none;font-size:12px}.mt-wr-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:440px;margin:0 auto;padding:0 6px;box-sizing:border-box}.mt-reading-type-btn.mt-wr{width:auto!important;max-width:none!important;min-width:0;padding:13px 13px!important;gap:3px;text-align:left}.mt-wr .mt-rt-label{font-size:15.5px!important;line-height:1.2}.mt-wr .mt-rt-meta{font-size:11px!important;line-height:1.4}.mt-wr .mt-rt-price{font-size:17px!important;margin-top:2px}.mt-reading-type-btn.mt-wr[disabled]{opacity:.55;cursor:default}#mt-written-form{max-width:380px;margin:18px auto 0}#mt-written-form>input,#mt-written-form #mt-w-field>input,#mt-written-form #mt-w-opt>input,#mt-written-form textarea{width:100%!important;box-sizing:border-box;min-height:44px;padding:10px 14px!important;font-size:16px!important;border-radius:12px!important}#mt-written-form textarea{min-height:0}#mt-written-form .mt-phone-row input{flex:1;min-width:0;width:auto!important}#mt-submit-btn,#mt-w-btn{align-self:stretch;width:100%;justify-content:center}.mt-details-form textarea{padding:12px 14px;border-radius:12px;border:1px solid var(--glass-border,rgba(243,237,228,.16));background:rgba(255,255,255,.04);color:var(--bone,#f3ede4);font-family:var(--sans,inherit);font-size:16px;line-height:1.55;resize:none;width:100%;box-sizing:border-box}.mt-details-form textarea::placeholder{color:var(--bone-dim,#c9bfb0)}.mt-details-form textarea:focus{outline:none;border-color:var(--gold,#b08d57)}.mt-w-lead{font-size:13.5px;line-height:1.7;color:var(--bone-dim,#c9bfb0);text-align:center;margin:0 0 4px}.mt-cnt{margin:-8px 4px 0 0;text-align:right;font-size:11.5px;opacity:.65}.mt-note{margin:-6px 2px 0;font-size:12px;line-height:1.6;opacity:.75}.mt-dlv{display:flex;gap:8px;margin:0 0 4px}.mt-dl{flex:1;font:inherit;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:11px 6px;border-radius:12px;border:1px solid rgba(243,237,228,.16);background:transparent;color:var(--bone-dim,#c9bfb0);cursor:pointer}.mt-dl.on{border-color:var(--gold,#b08d57);color:var(--bone,#f3ede4);background:rgba(176,141,87,.14)}.mt-skel{height:96px;border-radius:18px;background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 70%);background-size:200% 100%;animation:mtShim 1.4s linear infinite;flex:1;min-width:120px}@keyframes mtShim{to{background-position:-200% 0}}' +
      '.mt-trust{font-size:12px;opacity:.6;text-align:center;margin:12px 0 0}#mt-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(11,11,14,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:0;pointer-events:none;transition:opacity .35s}#mt-overlay.on{opacity:1;pointer-events:auto}#mt-overlay div{text-align:center}#mt-overlay img{width:84px;height:84px;animation:mtBreath 2.4s ease-in-out infinite}#mt-overlay p{margin-top:14px;font:300 13px Inter,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#e8cc9c}@keyframes mtBreath{0%,100%{opacity:.55;transform:scale(.96)}50%{opacity:1;transform:scale(1.04)}}';
    css.textContent += '.mt-slot-btn small{display:block;font-size:10px;opacity:.65;margin-top:2px}.mt-prompt{opacity:.7;text-align:center;margin:8px 0 0}';
    document.head.appendChild(css);
    const sl = el('mt-slots');
    if (sl && !state.selectedReadingType) sl.innerHTML = '<p class="mt-prompt">Choose a reading above to see open hours.</p>';
    const formEl = el('mt-details-form');
    if (formEl && !document.querySelector('.mt-mode')) {
      const phone = el('mt-phone');
      if (phone && !el('mt-cc')) {
        const row = document.createElement('div');
        row.className = 'mt-phone-row';
        const sel = document.createElement('select');
        sel.id = 'mt-cc';
        sel.setAttribute('aria-label', 'Country code');
        sel.innerHTML = DIAL.map((c) => '<option value="' + c[1] + '">' + c[0] + ' ' + c[1] + '</option>').join('') + '<option value="other">Other (type + and code)</option>';
        const hit = DIAL_BY_TZ.find((r) => r[0].test(TZ));
        sel.value = hit ? hit[1] : 'other';
        phone.parentNode.insertBefore(row, phone);
        row.appendChild(sel);
        row.appendChild(phone);
        phone.placeholder = 'WhatsApp number';
        const why = document.createElement('div');
        why.className = 'mt-why';
        why.innerHTML = '<span>Used only to reach you about your reading.</span> <button type="button" class="mt-why-btn">Why we ask</button><div class="mt-why-note" style="display:none">We use your number to remind you of your hour, or to reach you quickly if it needs to move. From time to time we may also share new readings with you. It is never sold or shared, and you can say stop at any time.</div>' +
          '<label class="mt-mkt"><input type="checkbox" id="mt-mkt"><span>Keep me posted when new readings open (optional)</span></label>';
        row.parentNode.insertBefore(why, row.nextSibling);
        why.querySelector('.mt-why-btn').addEventListener('click', () => { const n = why.querySelector('.mt-why-note'); n.style.display = n.style.display === 'none' ? 'block' : 'none'; });
      }
      const emailEl = el('mt-email');
      if (emailEl) {
        const hint = document.createElement('div');
        hint.id = 'mt-email-hint';
        hint.className = 'mt-hint';
        emailEl.parentNode.insertBefore(hint, emailEl.nextSibling);
        emailEl.addEventListener('blur', () => {
          const v = emailEl.value.trim(), at = v.lastIndexOf('@'), dom = at > 0 ? v.slice(at + 1).toLowerCase() : '';
          hint.innerHTML = TYPO[dom] ? 'Did you mean <a href="#" id="mt-fix">' + esc(v.slice(0, at) + '@' + TYPO[dom]) + '</a>?' : '';
          const fix = el('mt-fix');
          if (fix) fix.addEventListener('click', (ev) => { ev.preventDefault(); emailEl.value = v.slice(0, at) + '@' + TYPO[dom]; hint.innerHTML = ''; updateSummary(); });
        });
        emailEl.addEventListener('input', updateSummary);
      }
      const box = document.createElement('div');
      box.className = 'mt-mode';
      box.innerHTML = '<p class="mt-q">How would you like to speak? <em>Please choose one</em></p><p class="mt-sub">Both are private audio calls. No camera needed.</p>' +
        '<label class="mt-opt"><input type="radio" name="mt-mode" value="instagram"><span><strong>Instagram audio call</strong><small>We call you on Instagram, from <b>@midnighttruthco</b>. After you reserve, send us your reference code there so we know you are on your way.</small></span></label>' +
        '<label class="mt-opt"><input type="radio" name="mt-mode" value="meet"><span><strong>Google Meet, audio only</strong><small>You join our private room at your hour: <b>meet.google.com/bct-sjzt-kov</b>. The link appears as soon as you reserve.</small></span></label>';
      formEl.insertBefore(box, el('mt-form-error'));
      box.querySelectorAll('input[name="mt-mode"]').forEach((r) => r.addEventListener('change', () => {
        box.classList.remove('mt-need');
        box.querySelectorAll('.mt-opt').forEach((o) => o.classList.toggle('sel', o.querySelector('input').checked));
      }));
      const sb = el('mt-submit-btn');
      if (sb) sb.insertAdjacentHTML('afterend', '<p class="mt-trust">Secure checkout by Razorpay · UPI, cards and more</p>');
    }
    const types = el('mt-reading-types');
    if (types && !types.innerHTML.trim()) types.innerHTML = '<div class="mt-skel"></div><div class="mt-skel"></div><div class="mt-skel"></div>';
    if (types && !document.querySelector('.mt-cur-row')) {
      const row = document.createElement('div');
      row.className = 'mt-cur-row';
      row.innerHTML = ['inr', 'usd', 'eur', 'gbp'].map((c) => '<button type="button" class="mt-cur' + (c === state.cur ? ' active' : '') + '" data-cur="' + c + '">' + SYM[c] + ' ' + c.toUpperCase() + '</button>').join('');
      types.parentNode.insertBefore(row, types);
      row.querySelectorAll('.mt-cur').forEach((b) => b.addEventListener('click', () => {
        const siteBtn = document.querySelector('.cur-btn[data-cur="' + b.dataset.cur + '"]');
        if (siteBtn) siteBtn.click(); // moves the whole site to this currency
        setCurrency(b.dataset.cur);
      }));
    }
    document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.cur-btn'); if (b) setCurrency(b.dataset.cur); });
    document.addEventListener('change', (e) => { if (e.target.classList && e.target.classList.contains('cur-select-mobile')) setCurrency(e.target.value); });
    // First visit: open in the currency that suits where the visitor is (rupees in India, pounds in the UK, euros in the euro area, otherwise dollars).
    if (state.cur === 'inr' && !isIndia) {
      const euro = ['Amsterdam', 'Athens', 'Berlin', 'Brussels', 'Dublin', 'Helsinki', 'Lisbon', 'Luxembourg', 'Madrid', 'Paris', 'Rome', 'Vienna', 'Tallinn', 'Riga', 'Vilnius', 'Bratislava', 'Ljubljana', 'Malta', 'Nicosia', 'Zagreb', 'Monaco', 'Andorra', 'San_Marino', 'Vatican'];
      const city = TZ.split('/')[1] || '';
      const want = /^Europe\/(London|Belfast|Jersey|Guernsey|Isle_of_Man)$/.test(TZ) ? 'gbp' : (TZ.indexOf('Europe/') === 0 && euro.indexOf(city) > -1 ? 'eur' : 'usd');
      const site = document.querySelector('.cur-btn[data-cur="' + want + '"]');
      if (site) site.click();
      setCurrency(want);
    }
  }

  function fullPhone() {
    const sel = el('mt-cc'), raw = (el('mt-phone').value || '').trim();
    if (sel && sel.value && sel.value !== 'other') return sel.value + raw.replace(/\D/g, '').replace(/^0+/, '');
    return raw.replace(/[^\d+]/g, '');
  }
  async function submitBooking(e) {
    e.preventDefault();
    if (!state.selectedReadingType || !state.selectedSlot) return;
    const errorEl = el('mt-form-error');
    errorEl.textContent = '';
    const bad = (m, needMode) => { errorEl.textContent = m; if (needMode) { const bx = document.querySelector('.mt-mode'); if (bx) { bx.classList.add('mt-need'); bx.scrollIntoView({ behavior: 'smooth', block: 'center' }); } } };

    const mode = (document.querySelector('input[name="mt-mode"]:checked') || {}).value;
    const phone = fullPhone(), digits = phone.replace(/\D/g, ''), cc = el('mt-cc');
    const payload = {
      slot_id: state.selectedSlot.id,
      reading_type_id: state.selectedReadingType.id,
      client_name: el('mt-name').value.trim(),
      client_email: el('mt-email').value.trim(),
      client_phone: phone,
      currency: billedCur(),
      contact_mode: mode,
      topic: window.mtTopic || null,
      tz: TZ,
      marketing_ok: !!(el('mt-mkt') && el('mt-mkt').checked),
      source: (function () { try { return sessionStorage.getItem('mtSrc'); } catch (x) { return null; } })(),
    };
    if (!payload.client_name) return bad('Please add your name.');
    if (payload.client_email && !/^\S+@\S+\.\S+$/.test(payload.client_email)) return bad('Please check your email address.');
    if (digits.length < 7 || digits.length > 15 || (cc && cc.value === 'other' && phone.charAt(0) !== '+')) return bad('Please check your phone number, including the country code.');
    if (!mode) return bad('Please choose how you would like to speak.', true);

    const submitBtn = el('mt-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Opening secure checkout…';
    overlay(true, 'Holding your hour…');
    preloadCheckout();

    try {
      const bookRes = await fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const booking = await bookRes.json();
      if (!bookRes.ok || !booking.checkout) {
        overlay(false);
        errorEl.textContent = booking.error || 'Something went wrong. Please try another hour.';
        submitBtn.disabled = false;
        submitBtn.textContent = payLabel();
        loadAvailability(); // refresh in case the hour was taken
        return;
      }
      openRazorpay(booking.checkout, '/booking-confirmed.html?booking_id=' + booking.booking_id);
    } catch (err) {
      console.error(err);
      overlay(false);
      errorEl.textContent = 'Something went wrong. Please try again.';
      submitBtn.disabled = false;
      submitBtn.textContent = payLabel();
    }
  }

  function openRazorpay(checkout, redirectUrl, opts) {
    opts = opts || {};
    const reset = () => { overlay(false); const b = el(opts.btn || 'mt-submit-btn'); if (b) { b.disabled = false; b.textContent = opts.label || payLabel(); } };
    const say = (m) => { const e = el(opts.err || 'mt-form-error'); if (e) e.textContent = m; };
    const go = () => {
      const rzp = new window.Razorpay({
        key: checkout.key_id,
        amount: checkout.amount,
        currency: checkout.currency,
        order_id: checkout.order_id,
        name: 'The Midnight Truth',
        image: location.origin + '/desk-icon-512.png',
        description: opts.description || ((state.selectedReadingType ? state.selectedReadingType.label + ' · ' : '') + (state.selectedSlot ? dayLabel(slotDate(state.selectedSlot)) + ', ' + timeLabel(slotDate(state.selectedSlot)) + (isIndia ? '' : ' your time') : 'Private reading')),
        theme: { color: '#8f6f3a', backdrop_color: '#0b0b0e' },
        prefill: { name: checkout.client_name, email: checkout.client_email, contact: checkout.client_phone },
        handler: function () { window.location.href = redirectUrl; },
        modal: { ondismiss: function () { reset(); say('Whenever you are ready, press the button again.'); } },
      });
      rzp.open();
      setTimeout(() => overlay(false), 700);
    };
    if (window.Razorpay) { go(); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = go;
    script.onerror = () => { reset(); say('Secure checkout could not load. Please check your connection and try again.'); };
    document.body.appendChild(script);
  }

  // Public API — other scripts on the page (CTA click handlers) call this to
  // preselect a reading length and scroll to the widget. Safe to call before
  // DOMContentLoaded or before availability has finished loading.
  window.mtSelectReadingType = selectReadingTypeByDuration;

  document.addEventListener('DOMContentLoaded', () => {
    if (!el('mt-booking-widget')) return; // widget not on this page
    try { const c = JSON.parse(localStorage.getItem('mtCache') || 'null'); if (c && c.readingTypes && c.readingTypes.length && Date.now() - c.t < 864e5) { state.readingTypes = c.readingTypes; state.writtenTypes = c.writtenTypes || []; } } catch (x) {}
    if (!state.readingTypes.length) { state.readingTypes = DEFAULT_LIVE; state.writtenTypes = DEFAULT_WRITTEN; }
    injectUi();
    renderReadingTypes();
    renderWrittenCards();
    loadAvailability();
    const dl = location.pathname.match(/^\/(angel|verdict)\/?$/) || (location.search.match(/[?&]offer=(angel|verdict)/));
    if (dl) setTimeout(() => { enterWritten(dl[1]); const wd = el('mt-booking-widget'); if (wd) wd.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 350);
    const form = el('mt-details-form');
    if (form) form.addEventListener('submit', submitBooking);
  });
})();
