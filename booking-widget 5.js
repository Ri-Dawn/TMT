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
  };

  // Holds a duration (minutes) requested via mtSelectReadingType() before the
  // reading types have finished loading from the API, so the selection can be
  // applied as soon as they arrive.
  let pendingDurationSelect = null;

  const SYM = { inr: '₹', usd: '$', eur: '€', gbp: '£' };
  const PRICES = { 15: { inr: 999, usd: 12, eur: 10, gbp: 9 }, 25: { inr: 1555, usd: 18, eur: 16, gbp: 14 }, 40: { inr: 3111, usd: 36, eur: 31, gbp: 27 } };
  const DAYS_FIRST = 3, DAYS_ALL = 7;
  const isIndia = /Calcutta|Kolkata/.test((Intl.DateTimeFormat().resolvedOptions().timeZone || ''));
  const istText = (s) => { const p = s.start_time.split(':'); const hh = +p[0]; return (hh % 12 || 12) + ':' + p[1] + ' ' + (hh < 12 ? 'AM' : 'PM') + ' IST'; };
  const TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your timezone'; } catch (e) { return 'your timezone'; } })();

  const TZ_NAME = /Calcutta|Kolkata/.test(TZ) ? 'India Standard Time' : TZ.replace(/_/g, ' ');

  function siteCurrency() {
    const a = document.querySelector('.cur-btn.active');
    return (a && a.dataset.cur) || 'inr';
  }
  const billedCur = () => (state.cur === 'inr' ? 'INR' : 'USD');
  function priceFor(rt, cur) {
    const p = PRICES[rt.duration_minutes];
    if (p && p[cur] != null) return p[cur];
    return cur === 'inr' ? rt.price_inr : rt.price_usd;
  }
  const money = (rt, cur) => SYM[cur] + Number(priceFor(rt, cur)).toLocaleString('en-US');
  // What the visitor will really be charged (the checkout only bills in INR or USD).
  const billedText = (rt) => (state.cur === 'inr' ? money(rt, 'inr') : money(rt, 'usd') + ' USD');
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

  async function loadAvailability() {
    const res = await fetch('/api/slots');
    const data = await res.json();
    state.readingTypes = data.readingTypes || [];
    state.slots = data.slots || [];
    renderReadingTypes();
    if (pendingDurationSelect !== null) {
      selectReadingTypeByDuration(pendingDurationSelect);
      pendingDurationSelect = null;
    }
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
        <button type="button" class="mt-reading-type-btn" data-id="${rt.id}">
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

    container.querySelectorAll('.mt-reading-type-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedReadingType = state.readingTypes.find((r) => r.id === id);
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

  function showForm() {
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
    const approx = state.cur === 'eur' || state.cur === 'gbp' ? '<br><small>' + money(rt, state.cur) + ' shown for reference · final amount ' + billedText(rt) + '</small>' : '';
    sum.innerHTML = '<b>' + rt.label + '</b> · ' + dayLabel(d) + ', ' + timeLabel(d) + '<br>' + billedText(rt) + approx + '<br><small>Your hour is held for you for 10 minutes while you complete your reservation.</small>';
    const btn = el('mt-submit-btn');
    if (btn && !btn.disabled) btn.textContent = payLabel();
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Keep the widget in step with the site's currency buttons (and let visitors switch right here).
  function setCurrency(cur) {
    state.cur = cur;
    document.querySelectorAll('.mt-cur').forEach((b) => b.classList.toggle('active', b.dataset.cur === cur));
    renderReadingTypes();
    const active = el('mt-reading-types') && el('mt-reading-types').querySelector('.mt-reading-type-btn[data-id="' + (state.selectedReadingType && state.selectedReadingType.id) + '"]');
    if (active) active.classList.add('active');
    if (state.selectedSlot) showForm();
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
    css.textContent += '.mt-mode{text-align:left;margin:6px 0 14px}.mt-mode p{margin:0 0 6px;font-size:14px;opacity:.85}.mt-mode label{display:flex;align-items:center;padding:7px 0;cursor:pointer;font-size:14px}.mt-mode input[type=radio]{width:auto!important;margin:0 10px 0 0!important;padding:0!important;accent-color:#b08d57}';
    css.textContent += '.mt-slot-btn small{display:block;font-size:10px;opacity:.65;margin-top:2px}.mt-prompt{opacity:.7;text-align:center;margin:8px 0 0}';
    document.head.appendChild(css);
    const sl = el('mt-slots');
    if (sl && !state.selectedReadingType) sl.innerHTML = '<p class="mt-prompt">Choose a reading above to see open hours.</p>';
    const formEl = el('mt-details-form');
    if (formEl && !document.querySelector('.mt-mode')) {
      const box = document.createElement('div');
      box.className = 'mt-mode';
      box.innerHTML = '<p>How would you like to speak?</p>' +
        '<label><input type="radio" name="mt-mode" value="instagram" checked>Instagram audio call</label>' +
        '<label><input type="radio" name="mt-mode" value="meet">Google Meet, audio only</label>' +
        '<small style="opacity:.65;display:block;margin-top:4px">On Instagram, a quick message after you reserve lets us call you there.</small>';
      formEl.insertBefore(box, el('mt-form-error'));
    }
    const types = el('mt-reading-types');
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
    // First visit from outside India: open in dollars so nothing shows in rupees by surprise.
    if (!/Calcutta|Kolkata/.test(TZ) && state.cur === 'inr') { const u = document.querySelector('.cur-btn[data-cur="usd"]'); if (u) u.click(); setCurrency('usd'); }
  }

  async function submitBooking(e) {
    e.preventDefault();
    if (!state.selectedReadingType || !state.selectedSlot) return;

    const errorEl = el('mt-form-error');
    errorEl.textContent = '';

    const payload = {
      slot_id: state.selectedSlot.id,
      reading_type_id: state.selectedReadingType.id,
      client_name: el('mt-name').value.trim(),
      client_email: el('mt-email').value.trim(),
      client_phone: el('mt-phone').value.trim(),
      currency: billedCur(),
      contact_mode: (document.querySelector('input[name="mt-mode"]:checked') || {}).value || 'instagram',
      topic: window.mtTopic || null,
    };

    if (!payload.client_name || !payload.client_email || !payload.client_phone) {
      errorEl.textContent = 'Please fill in your name, email, and phone number.';
      return;
    }

    const submitBtn = el('mt-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Holding your hour…';

    try {
      const bookRes = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const booking = await bookRes.json();

      if (!bookRes.ok) {
        errorEl.textContent = booking.error || 'Something went wrong. Please try another slot.';
        submitBtn.disabled = false;
        submitBtn.textContent = payLabel();
        loadAvailability(); // refresh in case the slot was taken
        return;
      }

      try { localStorage.setItem('mtLast', JSON.stringify({ code: booking.booking_code, mode: booking.contact_mode })); } catch (e) {}

      if (booking.gateway === 'stripe') {
        const checkoutRes = await fetch('/api/checkout/stripe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: booking.booking_id }),
        });
        const checkout = await checkoutRes.json();
        if (checkout.checkout_url) {
          window.location.href = checkout.checkout_url;
        } else {
          errorEl.textContent = 'We could not complete that just now. Please try once more.';
        }
      } else {
        const checkoutRes = await fetch('/api/checkout/razorpay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: booking.booking_id }),
        });
        const checkout = await checkoutRes.json();
        openRazorpay(checkout, booking.booking_id);
      }
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'Something went wrong. Please try again.';
      submitBtn.disabled = false;
      submitBtn.textContent = payLabel();
    }
  }

  function openRazorpay(checkout, bookingId) {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => {
      const rzp = new Razorpay({
        key: checkout.key_id,
        amount: checkout.amount,
        currency: checkout.currency,
        order_id: checkout.order_id,
        name: 'The Midnight Truth',
        description: 'Tarot Reading Session',
        prefill: {
          name: checkout.client_name,
          email: checkout.client_email,
          contact: checkout.client_phone,
        },
        handler: function () {
          window.location.href = `/booking-confirmed.html?booking_id=${bookingId}`;
        },
        modal: {
          ondismiss: function () {
            const submitBtn = el('mt-submit-btn');
            submitBtn.disabled = false;
            submitBtn.textContent = payLabel();
          },
        },
      });
      rzp.open();
    };
    document.body.appendChild(script);
  }

  // Public API — other scripts on the page (CTA click handlers) call this to
  // preselect a reading length and scroll to the widget. Safe to call before
  // DOMContentLoaded or before availability has finished loading.
  window.mtSelectReadingType = selectReadingTypeByDuration;

  document.addEventListener('DOMContentLoaded', () => {
    if (!el('mt-booking-widget')) return; // widget not on this page
    injectUi();
    loadAvailability();
    const form = el('mt-details-form');
    if (form) form.addEventListener('submit', submitBooking);
  });
})();
