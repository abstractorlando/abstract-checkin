/* Abstract Orlando booking form: step-by-step funnel tracking.
 *
 * Loaded by book.html with one line, placed just before </body>:
 *     <script src="funnel-tracking.js"></script>
 *
 * It only watches the page: which card the guest reached, which field they touched, which error message
 * they were shown, and where they left. It never reads names, phone numbers, emails or card details.
 *
 * GA4 event names are numbered so they sort in funnel order in any report:
 *   bk_10_form_loaded        form opened and open days were shown
 *   bk_20_day_picked         picked a day (bk_21_day_changed = picked a different day afterwards)
 *   bk_30_time_picked        picked a time (bk_31_time_changed = picked a different time afterwards)
 *   bk_35_size_changed       used the + or - on party size
 *   bk_40_details_started    touched any field in "Your details"
 *   bk_41_first_name  bk_42_last_name  bk_43_phone  bk_44_email  bk_45_artist_names  bk_46_addon  bk_47_note
 *   bk_50_continue_tapped    tapped Continue
 *   bk_55_payment_shown      card form was shown (hold placed)
 *   payment_card_complete    card fields filled in           (existing event name)
 *   bk_60_agree_checked      ticked the cancellation policy box
 *   add_payment_info         tapped Confirm / Book            (existing event name)
 *   bk_65_back_to_details    tapped Back from the card step
 *   bk_99_booked_screen      saw the "You're booked" screen
 *   bk_err_*                 an error the guest was shown (no_day_time, name, phone, email, artist_names,
 *                            slot_filled, hold_failed, agree_missing, no_open_days, availability)
 *   payment_error            card problem, with a "reason" parameter  (existing event name)
 *   hold_expired             the 10-minute hold ran out               (existing event name)
 *   bk_exit_after_<step>     the guest left or switched away after reaching <step> (a guest who comes back
 *                            and finishes is still counted here, so compare with purchases)
 */
(function () {
  'use strict';
  try {
    var q = new URLSearchParams(location.search);
    // "manage my booking" and "lock in your spot" pages are not part of this funnel
    if (q.get('b') && q.get('t')) return;

    var EMB = window.parent !== window;
    var g = function (id) { return document.getElementById(id); };
    var closest = function (el, sel) { return el && el.closest ? el.closest(sel) : null; };

    function partySize() {
      try { return typeof size === 'number' ? size : undefined; } catch (e) { return undefined; }
    }

    /* Send one GA4 event. Inside the website the page above forwards it; opened on its own, GA4 is called here. */
    function send(event, params) {
      try {
        params = Object.assign({ party_size: partySize() }, params || {});
        Object.keys(params).forEach(function (k) { if (params[k] === undefined) delete params[k]; });
        if (EMB) parent.postMessage({ ao: 'track', name: 'ga', d: { event: event, params: params } }, '*');
        else if (window.gtag) window.gtag('event', event, params);
      } catch (e) {}
    }

    var seen = {};      // steps already reported once
    var last = null;    // the furthest-moving step the guest most recently reached
    var done = false;   // reached the confirmed screen

    /* Report a step. key looks like '20_day_picked'. Each step is reported once unless opts.repeat is set. */
    function step(key, opts) {
      opts = opts || {};
      if (!opts.repeat && seen[key]) return;
      seen[key] = 1;
      if (!opts.noLast) last = key;
      send(opts.event || ('bk_' + key), opts.params);
    }

    /* Report an error the guest was shown (at most 3 of each kind per visit). */
    var errCount = {};
    function err(what) {
      errCount[what] = (errCount[what] || 0) + 1;
      if (errCount[what] <= 3) send('bk_err_' + what);
    }

    /* ---------- days and times ---------- */
    var days = g('days'), times = g('times');

    if (days) {
      var checkDays = function () {
        if (days.querySelector('.day')) step('10_form_loaded');
        var c = days.querySelector('.closed');
        if (c) err(/No open times/i.test(c.textContent) ? 'no_open_days' : 'availability');
      };
      new MutationObserver(checkDays).observe(days, { childList: true });
      checkDays();
      days.addEventListener('click', function (e) {
        if (!closest(e.target, '.day')) return;
        if (seen['20_day_picked']) { var n = (errCount._dc = (errCount._dc || 0) + 1); if (n <= 5) { send('bk_21_day_changed'); } }
        else step('20_day_picked');
      });
    }

    if (times) {
      times.addEventListener('click', function (e) {
        var b = closest(e.target, '.time');
        if (!b || b.disabled) return;
        if (seen['30_time_picked']) { var n = (errCount._tc = (errCount._tc || 0) + 1); if (n <= 5) { send('bk_31_time_changed'); } }
        else step('30_time_picked');
      });
    }

    /* ---------- clicks (capture phase, so we see the button before the page's own handler disables it) ---------- */
    document.addEventListener('click', function (e) {
      var b = closest(e.target, 'button');
      if (!b || b.disabled) return;

      if (b.id === 'plus' || b.id === 'minus') {
        setTimeout(function () { step('35_size_changed'); }, 0);   // wait so party_size shows the new number
      }
      if (b.id === 'toPay') { sweepFields(); step('50_continue_tapped', { repeat: true }); }
      if (b.id === 'back') step('65_back_to_details', { repeat: true });
      if (b.id === 'book') {
        var a = g('agree');
        if (a && !a.checked) { err('agree_missing'); return; }
        var guests = partySize() || 1;
        var per = (typeof AVG_SPEND_PER_GUEST === 'number') ? AVG_SPEND_PER_GUEST : 100;
        step('70_book_tapped', { event: 'add_payment_info', repeat: true, params: { currency: 'USD', value: guests * per } });
      }
    }, true);

    /* ---------- details fields: first touch of each ---------- */
    var FIELD = { first: '41_first_name', last: '42_last_name', cc: '43_phone', phone: '43_phone', email: '44_email', note: '47_note' };
    function touched(t) {
      if (!t) return;
      var k = t.id ? FIELD[t.id] : null;
      if (!k && closest(t, '#guestNames')) k = '45_artist_names';
      if (!k) return;
      step('40_details_started');
      step(k);
    }
    // a tap into the field, typing, or the browser's autofill filling it in (autofill never taps the other fields)
    document.addEventListener('focusin', function (e) { touched(e.target); });
    document.addEventListener('input', function (e) { touched(e.target); });
    document.addEventListener('change', function (e) { touched(e.target); });
    // safety net: when Continue is tapped, count every field that has something in it
    function sweepFields() {
      Object.keys(FIELD).forEach(function (id) {
        var el = g(id);
        if (el && id !== 'cc' && String(el.value || '').trim()) touched(el);
      });
      var gn = document.querySelectorAll('#guestNames input');
      for (var i = 0; i < gn.length; i++) { if (String(gn[i].value || '').trim()) { touched(gn[i]); break; } }
    }

    var addons = g('addons');
    if (addons) addons.addEventListener('change', function (e) {
      if (e.target && e.target.type === 'checkbox') step('46_addon', { repeat: true, params: { checked: e.target.checked ? 1 : 0 } });
    });

    /* ---------- errors on the details card ---------- */
    var e1 = g('err1');
    if (e1) new MutationObserver(function () {
      var t = (e1.textContent || '').trim();
      if (!t) return;
      err(/pick a day and time/i.test(t) ? 'no_day_time'
        : /first and last name/i.test(t) ? 'name'
        : /mobile number/i.test(t) ? 'phone'
        : /check your email/i.test(t) ? 'email'
        : /first name of everyone/i.test(t) ? 'artist_names'
        : /filled|left|full/i.test(t) ? 'slot_filled'
        : 'hold_failed');
    }).observe(e1, { childList: true, characterData: true, subtree: true });

    /* ---------- card step ---------- */
    var pc = g('payCard');
    if (pc) new MutationObserver(function () {
      if (!pc.classList.contains('hide')) step('55_payment_shown');
    }).observe(pc, { attributes: true, attributeFilter: ['class'] });

    var agree = g('agree');
    if (agree) agree.addEventListener('change', function () { if (agree.checked) step('60_agree_checked'); });

    var tm = g('timer'), wasOut = false;
    if (tm) new MutationObserver(function () {
      var out = tm.classList.contains('out');
      if (out && !wasOut) step('57_hold_expired', { event: 'hold_expired', repeat: true });
      wasOut = out;
    }).observe(tm, { attributes: true, attributeFilter: ['class'] });

    var e2 = g('err2');
    if (e2) new MutationObserver(function () {
      var t = (e2.textContent || '').trim();
      // ignore blanks, progress text, instructions, and the "tick the box" nudge (counted as bk_err_agree_missing)
      if (!t || /^Booking/i.test(t) || /^Enter a different/i.test(t) || /check the box/i.test(t)) return;
      var why = /sparkling wine/i.test(t) ? 'wine_declined'
        : /can.?t be used to hold/i.test(t) ? 'prepaid_card'
        : /hold (has )?(ended|expired)|HOLD_EXPIRED/i.test(t) ? 'hold_expired'
        : /insufficient/i.test(t) ? 'insufficient_funds'
        : /declined/i.test(t) ? 'card_declined'
        : /has expired/i.test(t) ? 'expired_card'
        : /incomplete|invalid|in the past|security code|postal|zip/i.test(t) ? 'incomplete_card'
        : 'other';
      send('payment_error', { reason: why });
    }).observe(e2, { childList: true, characterData: true, subtree: true });

    /* "card fields filled in": the card form lives inside Stripe, so listen on Stripe's own change event. */
    if (window.Stripe && !window.Stripe.__aoTracked) {
      var OrigStripe = window.Stripe;
      var Wrapped = function () {
        var s = OrigStripe.apply(this, arguments);
        try {
          var origElements = s.elements;
          s.elements = function () {
            var els = origElements.apply(s, arguments);
            var origCreate = els.create;
            els.create = function (type) {
              var p = origCreate.apply(els, arguments);
              if (type === 'payment' && p && p.on) {
                var sent = false;   // once per card form
                p.on('change', function (ev) {
                  if (ev && ev.complete && !sent) { sent = true; step('56_card_complete', { event: 'payment_card_complete', repeat: true }); }
                });
              }
              return p;
            };
            return els;
          };
        } catch (e) {}
        return s;
      };
      try { Object.assign(Wrapped, OrigStripe); } catch (e) {}
      Wrapped.__aoTracked = true;
      window.Stripe = Wrapped;
    }

    /* ---------- finished, and leaving ---------- */
    var cf = g('confirmed');
    if (cf) new MutationObserver(function () {
      if (!cf.classList.contains('hide')) { done = true; step('99_booked_screen'); }
    }).observe(cf, { attributes: true, attributeFilter: ['class'] });

    var exitFor = null;
    function leaving() {
      if (done || !last || exitFor === last) return;
      exitFor = last;
      send('bk_exit_after_' + last);
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leaving(); });
    window.addEventListener('pagehide', leaving);
  } catch (e) { /* tracking must never get in the way of booking */ }
})();
