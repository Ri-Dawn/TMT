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
    currency: guessCurrency(),
  };

  // Holds a duration (minutes) requested via mtSelectReadingType() before the
  // reading types have finished loading from the API, so the selection can be
  // applied as soon as they arrive.
  let pendingDurationSelect = null;

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
          <span class="mt-rt-price">${state.currency === 'INR' ? '₹' + rt.price_inr : '$' + rt.price_usd}</span>
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

    const matching = state.slots.filter((s) => s.duration_minutes === state.selectedReadingType.duration_minutes);

    if (matching.length === 0) {
      container.innerHTML = `<p class="mt-empty">No open slots for this reading length right now — check back soon or message us on Instagram.</p>`;
      return;
    }

    // Group by date for a cleaner picker
    const byDate = {};
    matching.forEach((s) => {
      byDate[s.slot_date] = byDate[s.slot_date] || [];
      byDate[s.slot_date].push(s);
    });

    container.innerHTML = Object.entries(byDate)
      .map(
        ([date, slots]) => `
        <div class="mt-slot-day">
          <div class="mt-slot-date">${new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          <div class="mt-slot-times">
            ${slots
              .map((s) => `<button type="button" class="mt-slot-btn" data-id="${s.id}">${formatTime(s.start_time)}</button>`)
              .join('')}
          </div>
        </div>`
      )
      .join('');

    container.querySelectorAll('.mt-slot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.mt-slot-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedSlot = matching.find((s) => s.id === btn.dataset.id);
        el('mt-details-form').style.display = 'block';
        el('mt-details-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }

  function formatTime(t) {
    const [h, m] = t.split(':');
    const date = new Date();
    date.setHours(parseInt(h, 10), parseInt(m, 10));
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
      currency: state.currency,
    };

    if (!payload.client_name || !payload.client_email || !payload.client_phone) {
      errorEl.textContent = 'Please fill in your name, email, and phone number.';
      return;
    }

    const submitBtn = el('mt-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Reserving your slot…';

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
        submitBtn.textContent = 'Reserve & Pay';
        loadAvailability(); // refresh in case the slot was taken
        return;
      }

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
          errorEl.textContent = 'Could not start payment. Please try again.';
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
      submitBtn.textContent = 'Reserve & Pay';
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
            submitBtn.textContent = 'Reserve & Pay';
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
    loadAvailability();
    const form = el('mt-details-form');
    if (form) form.addEventListener('submit', submitBooking);
  });
})();
