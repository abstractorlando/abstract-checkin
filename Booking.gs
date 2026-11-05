/**
 * Abstract Orlando — Online Booking (holds a card with Stripe, no charge at booking)
 * Add this as a second script file named "Booking" next to Code.gs.
 *
 * Script Properties (Project Settings > Script Properties):
 *   STRIPE_SECRET = sk_test_...   (use the TEST key until you go live, then sk_live_...)
 * Run setupReminders() once to send reminder emails the day before each class.
 */

const BOOK = {
  capacity: 8,                    // fallback seats per class
  capacityByDay: { 0: 12, 3: 8, 4: 8, 5: 12, 6: 12 },  // Sun=0 … Sat=6 → Wed/Thu 8, Fri–Sun 12 (Schedule screen overrides)
  feePerGuest: 50,                // late cancel / no-show fee, per guest, in dollars
  lateHours: 24,                  // inside this many hours = late cancel
  openDays: [0, 3, 4, 5, 6],      // Sun=0 … Sat=6  → Wed–Sun
  times: ['11:00 AM', '12:30 PM', '2:00 PM', '3:30 PM', '5:00 PM'],   // current hours (through Dec 31, 2026)
  // New hours from Jan 1, 2027. Sun=0 … Sat=6; days not listed are closed.
  newHoursFrom: '2027-01-01',
  newCapacity: 8,                 // seats per class from Jan 1, 2027 (adjust per class on the Schedule screen)
  newTimes: {
    3: ['3:00 PM', '4:30 PM', '6:00 PM', '7:30 PM'],                         // Wed
    4: ['3:00 PM', '4:30 PM', '6:00 PM', '7:30 PM'],                         // Thu
    5: ['3:00 PM', '4:30 PM', '6:00 PM', '7:30 PM'],                         // Fri
    6: ['12:00 PM', '1:30 PM', '3:00 PM', '4:30 PM', '6:00 PM'],             // Sat
    0: ['12:00 PM', '1:30 PM', '3:00 PM', '4:30 PM']                          // Sun
  },
  daysAhead: 60,                  // how far ahead people can book
  cutoffMinutes: 30,              // online booking closes this long before class
  holdMinutes: 10,                // seats held (with a countdown) while someone enters their card
  // Optional extras on the booking page, charged to the card when they book.
  // Refunded automatically if the booking is cancelled more than 24 hours ahead.
  addOns: [{ id: 'wine', label: 'Add a chilled bottle of sparkling wine', price: 30,
    blurb: 'Chilled and waiting for you when you arrive.' }],
  pageUrl: 'https://abstractorlando.github.io/abstract-checkin/book.html'
};

/* Bookings tab columns used by online booking (added after the Toast columns) */
const BK = { date: 0, time: 1, name: 2, size: 3, phone: 4, email: 5, imported: 6, partyId: 7, note: 8,
  source: 9, id: 10, status: 11, guests: 12, customer: 13, pm: 14, fee: 15, token: 16, created: 17,
  deposit: 18, fhId: 19, addons: 20, staffNote: 21, guestFee: 22 };
/* (column names live in BOOKING_HEADERS in Code.gs) */

/* Functions the public booking page may call (no staff PIN). */
const PUBLIC_API = {
  availability: availability, startBooking: startBooking, finishBooking: finishBooking,
  newCardFor: newCardFor, changeMySize: changeMySize, cardSetup: cardSetup, saveCard: saveCard, getMyBooking: getMyBooking, cancelMyBooking: cancelMyBooking, rescheduleMyBooking: rescheduleMyBooking,
  partyInquiry: partyInquiry
};

/* ---------------- kids party requests (Kids Party page form) ---------------- */
const PARTY_HEADERS = ['Received', 'Parent', 'Phone', 'Email', 'Birthday Kid', 'Turning', 'Preferred Date', 'Backup Date',
  'Kids', 'Notes', 'Status'];

/** Public: the Kids Party page form. Saves to "Party Requests", emails info@, texts the parent when Quo is on. */
function partyInquiry(d) {
  d = d || {};
  if (d.website) return { ok: true };                       // hidden spam trap: people never fill it
  const s = (v, n) => String(v || '').trim().slice(0, n || 120);
  const parent = s(d.parent), phone = s(d.phone, 30), email = s(d.email).toLowerCase();
  if (!parent) throw new Error('Please add your name.');
  if (String(phone).replace(/\D/g, '').length < 10) throw new Error('Please add a phone number we can text.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email doesn\'t look right.');
  const cache = CacheService.getScriptCache(), key = 'party-' + phone.replace(/\D/g, '').slice(-10);
  if (cache.get(key)) return { ok: true, again: true };      // double tap / resend within 10 minutes
  cache.put(key, '1', 600);

  const row = [new Date(), parent, phone, email, s(d.kid), s(d.age, 10), s(d.date, 20), s(d.backup, 20),
    s(d.kids, 20), s(d.notes, 1000), 'New'];
  sh_('Party Requests', PARTY_HEADERS).appendRow(row);
  try { logActivity_('party', parent, s(d.date, 20), '', s(d.kids, 20), '', [phone, s(d.kid), d.age ? 'turning ' + s(d.age, 10) : ''].filter(Boolean).join(' · ')); } catch (e) {}

  const first = parent.split(/\s+/)[0];
  const nice = v => v ? niceDate_(v) : '';
  try {
    const to = teamTo_();
    if (to) {
      const lines = [['Parent', parent], ['Phone', phone], ['Email', email], ['Birthday kid', [s(d.kid), d.age ? 'turning ' + s(d.age, 10) : ''].filter(Boolean).join(', ')],
        ['Date', nice(d.date)], ['Backup date', nice(d.backup)], ['Kids', s(d.kids, 20)], ['Notes', s(d.notes, 1000)]].filter(l => l[1]);
      const subject = TEAM_TAG + ' Party request: ' + parent + (d.date ? ' · ' + nice(d.date) : '') + (d.kids ? ' · ' + s(d.kids, 20) + ' kids' : '');
      const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d1b26"><h2 style="margin:0 0 12px;color:#c40056">New kids party request</h2>' +
        '<table cellpadding="5">' + lines.map(l => '<tr><td style="color:#6b6878">' + esc_(l[0]) + '</td><td><b>' + esc_(String(l[1])) + '</b></td></tr>').join('') +
        '</table><p style="color:#6b6878">Text them back from Quo to plan it.</p></div>';
      const opts = { htmlBody: html, name: 'Abstract Booking' };
      if (email) opts.replyTo = email;
      if (GmailApp.getAliases().indexOf(STUDIO.email) >= 0) opts.from = STUDIO.email;
      sendMail_(to, subject, subject, opts);
    }
  } catch (e) {}
  try {
    const to = e164_(phone);
    if (to && quoOn_()) quoSend_(to, 'Hi ' + first + '! This is Abstract Orlando. We got your party request' +
      (d.date ? ' for ' + nice(d.date) : '') + '. We\'ll text you here to plan it together.');
  } catch (e) {}
  return { ok: true, first: first };
}

/* ---------------- availability ---------------- */
function bkSheet_() { return bookings_(); }

function bkRows_() {
  const sh = bkSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, BOOKING_HEADERS.length).getValues().map((r, i) => {
    r[BK.date] = d_(r[BK.date]); r[BK.time] = t_(r[BK.time]);
    return { row: i + 2, r: r };
  });
}

/* ---------------- private (unlisted) classes ----------------
 * A class only people with its link can see and book. Can be one of the regular times
 * (it disappears from the public page) or any other time. Sheet tab: "Private". */
const PRIVATE_HEADERS = ['Code', 'Class Date', 'Class Time', 'Seats', 'Group', 'Created'];
const privSheet_ = () => sh_('Private', PRIVATE_HEADERS);
function privateSlots_() {
  const sh = privSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 5).getValues().filter(r => r[0])
    .map(r => ({ code: String(r[0]), date: d_(r[1]), time: t_(r[2]), seats: Number(r[3]) || 0, name: String(r[4] || '') }));
}
function privateMap_() { const m = {}; privateSlots_().forEach(p => m[p.date + '|' + p.time] = p); return m; }
/* Where guest links point. Before launch: the GitHub page. On launch day add Script Property
 * BOOKING_URL = https://www.abstractorlando.com  and every link opens the homepage booking section. */
function bookBase_() {
  const u = (PropertiesService.getScriptProperties().getProperty('BOOKING_URL') || '').trim().replace(/\/$/, '');
  return u || BOOK.pageUrl;
}
function bookLink_(q) { const base = bookBase_(); return base.indexOf('github.io') > 0 ? base + (q ? '?' + q : '') : base + '/' + (q ? '?' + q : '') + '#book'; }
function privateLink_(code) { return bookLink_('p=' + code); }
/** Staff: make a private class. Returns its link. */
function createPrivate_(date, time, seats, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a day');
  time = String(time || '').trim().toUpperCase().replace(/^(\d{1,2})(:\d{2})?\s*(AM|PM)$/, (m, h, mm, ap) => h + (mm || ':00') + ' ' + ap);
  if (!/^\d{1,2}:\d{2} (AM|PM)$/.test(time)) throw new Error('Time looks like 7:00 PM');
  seats = Math.floor(Number(seats));
  if (!(seats >= 1 && seats <= 200)) throw new Error('Spots must be 1 or more');
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    if (privateMap_()[date + '|' + time]) throw new Error('There is already a private class at that time');
    const code = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    privSheet_().appendRow([code, date, time, seats, String(name || '').slice(0, 60), new Date().toISOString()]);
    bumpAvail_();
    return { code: code, link: privateLink_(code) };
  } finally { lock.releaseLock(); }
}
/** Staff: remove a private class (bookings already made stay). */
function removePrivate_(code) {
  const sh = privSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return true;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(code)) sh.deleteRow(i + 2);
  bumpAvail_();
  return true;
}

function capacityOverrides_() {
  const sh = sh_('Capacity', ['Class Date', 'Class Time (blank = whole day)', 'Guests']);
  const n = sh.getLastRow() - 1, m = {};
  privateSlots_().forEach(p => m[p.date + '|' + p.time] = p.seats);   // private seats (Schedule edits below still win)
  if (n < 1) return m;
  sh.getRange(2, 1, n, 3).getValues().forEach(r => {
    const d = d_(r[0]); if (!d) return;
    m[d + '|' + (r[1] ? t_(r[1]) : '*')] = Number(r[2]) || 0;
  });
  return m;
}

function capFor_(ov, date, time) {
  if ((date + '|' + time) in ov) return ov[date + '|' + time];
  if ((date + '|*') in ov) return ov[date + '|*'];
  return defaultCap_(date);
}

/** Class times for that date (current hours, or the new hours from BOOK.newHoursFrom). */
/** Day of week for 'yyyy-MM-dd' (Sun=0), plain math, no Google calls. */
function dow_(date) { const p = date.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
function timesFor_(date) {
  if (date < BOOK.newHoursFrom) return BOOK.times;
  return BOOK.newTimes[dow_(date)] || [];
}

/** Normal seats per class for that weekday. */
function defaultCap_(date) {
  const dow = dow_(date);
  if (date >= BOOK.newHoursFrom) return BOOK.newCapacity;   // 2027+: same seats every class until you change it
  return dow in BOOK.capacityByDay ? BOOK.capacityByDay[dow] : BOOK.capacity;
}

function holding_(r, now) {
  const st = String(r[BK.status] || 'Confirmed');
  if (st === 'Confirmed') return true;
  if (st === 'Pending') return now - new Date(r[BK.created]).getTime() < BOOK.holdMinutes * 60000;
  if (st === 'Needs card') return now < cardDue_(r);
  return false; // Cancelled, Late cancel, No-show
}

function usedMap_(rows, excludeId) {
  const now = Date.now(), m = {};
  rows.forEach(x => {
    const r = x.r;
    if (excludeId && r[BK.id] === excludeId) return;
    if (!holding_(r, now)) return;
    const k = r[BK.date] + '|' + r[BK.time];
    m[k] = (m[k] || 0) + (Number(r[BK.size]) || 0);
  });
  return m;
}

/* Class start as a real moment in time. One Google date lookup per day (cached), the rest is math. */
const NOON_ = {};
function classStart_(date, time) {
  if (!(date in NOON_)) NOON_[date] = Utilities.parseDate(date + ' 12:00 PM', Session.getScriptTimeZone(), 'yyyy-MM-dd h:mm a').getTime();
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(time).trim());
  if (!m) return Utilities.parseDate(date + ' ' + time, Session.getScriptTimeZone(), 'yyyy-MM-dd h:mm a');
  const mins = (Number(m[1]) % 12 + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]);
  return new Date(NOON_[date] + (mins - 720) * 60000);
}

/* ---------- speed: remember the public calendar for a short time ---------- */
const AV_CACHE_SECONDS = 45;
function bumpAvail_() { try { CacheService.getScriptCache().remove('avail'); } catch (e) {} }

/** Public: open dates and seats left for the next BOOK.daysAhead days. */
function availability(code) {
  if (!code) {
    try { const hit = CacheService.getScriptCache().get('avail'); if (hit) return JSON.parse(hit); } catch (e) {}
    const fresh = availability_(code);
    try { CacheService.getScriptCache().put('avail', JSON.stringify(fresh), AV_CACHE_SECONDS); } catch (e) {}
    return fresh;
  }
  return availability_(code);
}
function availability_(code) {
  const tz = Session.getScriptTimeZone();
  const rows = bkRows_(), used = usedMap_(rows), ov = capacityOverrides_(), priv = privateMap_();
  const now = Date.now(), out = [];
  const extra = { feePerGuest: BOOK.feePerGuest, lateHours: BOOK.lateHours,
    holdMinutes: BOOK.holdMinutes, addOns: BOOK.addOns,
    publishable: PropertiesService.getScriptProperties().getProperty('STRIPE_PUBLISHABLE') || '' };
  if (code) {   // private link: show only that class
    const p = Object.keys(priv).map(k => priv[k]).filter(x => x.code === String(code))[0];
    if (!p) throw new Error('This private booking link is no longer active. Text us at ' + STUDIO.phone + ' and we\'ll help.');
    const start = classStart_(p.date, p.time).getTime();
    const left = start - now < BOOK.cutoffMinutes * 60000 ? 0 : Math.max(0, capFor_(ov, p.date, p.time) - (used[p.date + '|' + p.time] || 0));
    return Object.assign({ days: [{ date: p.date, times: [{ time: p.time, left: left }] }], private: { code: p.code, name: p.name } }, extra);
  }
  for (let i = 0; i < BOOK.daysAhead; i++) {
    const d = new Date(now + i * 86400000);
    const date = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const dow = dow_(date);
    if (BOOK.openDays.indexOf(dow) < 0 && !(date + '|*' in ov && ov[date + '|*'] > 0)) continue;
    const times = timesFor_(date).filter(t => !priv[date + '|' + t] && classStart_(date, t).getTime() - now >= BOOK.cutoffMinutes * 60000)
      .map(t => ({ time: t, left: Math.max(0, capFor_(ov, date, t) - (used[date + '|' + t] || 0)) }));
    if (times.some(t => t.left > 0)) out.push({ date: date, times: times });
  }
  return Object.assign({ days: out }, extra);
}

/* ---------------- booking ---------------- */
function clean_(v, n) { return String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n); }
function titleCase_(s) { return s.toLowerCase().replace(/(^|\s|-)\S/g, c => c.toUpperCase()); }

/** Public: hold the seats and start Stripe's card form. */
function startBooking(d) {
  const date = clean_(d.date, 10), time = clean_(d.time, 8);
  const name = titleCase_(clean_(d.name, 60)), email = clean_(d.email, 80).toLowerCase(), phone = clean_(d.phone, 25);
  const size = Math.floor(Number(d.size));
  const pv = privateMap_()[date + '|' + time];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (pv ? String(d.code || '') !== pv.code : timesFor_(date).indexOf(time) < 0)) throw new Error('Please pick a day and time.');
  if (!name || name.split(' ').length < 2) throw new Error('Please enter your first and last name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please check your email.');
  const pd = phone.replace(/\D/g, '');
  if (phone.charAt(0) === '+' ? (pd.length < 8 || pd.length > 15) : pd.length < 10) throw new Error('Please check your mobile number.');
  if (!(size >= 1)) throw new Error('Please choose how many artists.');   // no cap: only the spots left at that time
  if (!d.policy) throw new Error('Please accept the cancellation policy.');
  if (owedBy_(phone, email) > 0) throw new Error('It looks like there\'s an open balance from a previous visit. Please text us at ' + STUDIO.phone + ' and we\'ll get you booked right away.');
  const guests = (d.guests || []).slice(0, 200).map(g => titleCase_(clean_(g, 30))).filter(Boolean);
  const addons = (d.addons || []).filter(a => BOOK.addOns.some(o => o.id === a)).join(',');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rows = bkRows_(), used = usedMap_(rows), ov = capacityOverrides_();
    const start = classStart_(date, time).getTime();
    const left = start - Date.now() < BOOK.cutoffMinutes * 60000 ? 0
      : capFor_(ov, date, time) - (used[date + '|' + time] || 0);
    if (left < size) throw new Error(left > 0 ? 'Only ' + left + ' spot' + (left > 1 ? 's' : '') + ' left at that time.' : 'That time just filled up. Please pick another.');

    const id = 'AO' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
    const cust = stripe_('post', 'customers', { name: name, email: email, phone: phone, metadata: { booking: id } });
    const si = stripe_('post', 'setup_intents', {
      customer: cust.id, usage: 'off_session',
      // cards (incl. Apple Pay / Google Pay) and Stripe Link only
      'payment_method_types[0]': 'card', 'payment_method_types[1]': 'link',
      metadata: { booking: id, class: date + ' ' + time, guests: String(size) }
    });
    const r = new Array(BOOKING_HEADERS.length).fill('');
    r[BK.date] = date; r[BK.time] = time; r[BK.name] = name; r[BK.size] = size; r[BK.phone] = phone;
    r[BK.email] = email; r[BK.note] = clean_(d.note, 300); r[BK.source] = 'Website'; r[BK.id] = id;
    r[BK.status] = 'Pending'; r[BK.guests] = guests.join(', '); r[BK.customer] = cust.id;
    r[BK.token] = Utilities.getUuid().replace(/-/g, ''); r[BK.created] = new Date().toISOString();
    r[BK.addons] = addons;
    const sh = bkSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, 1, r.length).setValues([r]);
    bumpAvail_();
    return { bookingId: id, clientSecret: si.client_secret, holdUntil: Date.now() + BOOK.holdMinutes * 60000 };
  } finally {
    lock.releaseLock();
  }
}

/** Public: called after Stripe saved the card. Confirms the booking and emails the guest. */
/** opts.skipAddons = guest chose to book without the add-ons after a decline */
function finishBooking(bookingId, setupIntentId, opts) {
  opts = opts || {};
  const x = findBooking_(bookingId);
  if (!x) throw new Error('Booking not found.');
  const r = x.r;
  if (r[BK.status] === 'Confirmed') return summary_(r);
  const si = stripe_('get', 'setup_intents/' + encodeURIComponent(setupIntentId));
  if (si.status !== 'succeeded' || !si.metadata || si.metadata.booking !== bookingId) throw new Error('Your card was not saved. Please try again.');
  // hold ran out? only confirm if the spots are still free
  if (Date.now() - new Date(r[BK.created]).getTime() > (BOOK.holdMinutes + 2) * 60000) {
    const used = usedMap_(bkRows_(), bookingId), ov = capacityOverrides_();
    if (capFor_(ov, r[BK.date], r[BK.time]) - (used[r[BK.date] + '|' + r[BK.time]] || 0) < Number(r[BK.size]))
      throw new Error('Sorry, your hold ran out and that time filled up. Please pick another time.');
  }
  try {
    const pm = stripe_('get', 'payment_methods/' + encodeURIComponent(si.payment_method));
    if (pm.card && pm.card.funding === 'prepaid') throw new Error('PREPAID');
  } catch (e) { if (e.message === 'PREPAID') { r[BK.created] = new Date().toISOString(); writeRow_(x.row, r); throw e; } }
  stripe_('post', 'customers/' + r[BK.customer], { 'invoice_settings[default_payment_method]': si.payment_method });
  r[BK.pm] = si.payment_method;
  if (opts.skipAddons) r[BK.addons] = '';
  if (addOnTotal_(r)) {
    chargeAddOns_(r);
    if (!/\|paid\|/.test(String(r[BK.addons]))) {   // declined: don't confirm, let them try another card or drop the wine
      r[BK.created] = new Date().toISOString();          // keep their spots held a little longer
      writeRow_(x.row, r);
      throw new Error('ADDON_DECLINED');
    }
  }
  r[BK.status] = 'Confirmed';
  writeRow_(x.row, r);
  hist_(r, 'Booked online · party of ' + r[BK.size] + (/wine/.test(String(r[BK.addons])) ? ' · sparkling wine paid' : ''), 'Guest');
  sendBookingEmail_(r, 'confirmed'); notifyTeam_(r, 'confirmed');
  return summary_(r);
}

/* ---------------- staff: add a booking ----------------
 * Walk-in (here now, today): confirmed right away, no card.
 * Anyone booking ahead (phone call, next visit at checkout): seats are held for CARD_MINUTES while the guest
 * saves a card through a secure link we text/email them. No card by then = seats open up again. */
const CARD_MINUTES = 15;
function cardDue_(r) { return new Date(r[BK.created]).getTime() + CARD_MINUTES * 60000; }
function staffBook_(d) {
  const date = clean_(d.date, 10), time = clean_(d.time, 8).toUpperCase();
  const name = titleCase_(clean_(d.name, 60)), size = Math.floor(Number(d.size));
  const phone = clean_(d.phone, 25), email = clean_(d.email, 80).toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2} (AM|PM)$/.test(time)) throw new Error('Pick a day and time');
  if (!name || name.split(' ').length < 2) throw new Error('Add their first and last name');
  const pd = phone.replace(/\D/g, '');
  if (phone.charAt(0) === '+' ? (pd.length < 8 || pd.length > 15) : pd.length < 10) throw new Error('Check their mobile number');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Add their email');
  if (!(size >= 1)) throw new Error('How many artists?');
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const walkIn = date === today && d.walkIn !== false;
  // returning guest: use a card they saved on an earlier booking (only if it really is theirs)
  let onFile = null;
  if (!walkIn && d.pm) {
    const k = guestKey_(phone, email);
    const src = bkRows_().filter(x => x.r[BK.pm] === d.pm && x.r[BK.customer])[0];
    if (!src || guestKey_(src.r[BK.phone], src.r[BK.email]) !== k) throw new Error('That card is not on file for this guest. Send a card link instead.');
    onFile = { pm: src.r[BK.pm], customer: src.r[BK.customer] };
  }
  if (!d.force && owedBy_(phone, email) > 0) return { owes: owedBy_(phone, email) };
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const used = usedMap_(bkRows_()), ov = capacityOverrides_();
    const left = capFor_(ov, date, time) - (used[date + '|' + time] || 0);
    if (left < size && !d.force) return { needsForce: true, left: left };
    const r = new Array(BOOKING_HEADERS.length).fill('');
    const id = 'AO' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
    r[BK.date] = date; r[BK.time] = time; r[BK.name] = name; r[BK.size] = size;
    r[BK.phone] = phone; r[BK.email] = email;
    r[BK.note] = clean_(d.note, 300); r[BK.source] = 'Staff'; r[BK.id] = id; r[BK.status] = walkIn || onFile ? 'Confirmed' : 'Needs card';
    if (onFile) { r[BK.customer] = onFile.customer; r[BK.pm] = onFile.pm; }
    r[BK.token] = Utilities.getUuid().replace(/-/g, ''); r[BK.created] = new Date().toISOString();
    r[BK.addons] = ''; r[BK.staffNote] = clean_(d.staffNote, 500);
    const sh = bkSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, 1, r.length).setValues([r]);
    bumpAvail_();
    hist_(r, (walkIn ? 'Walk-in added' : onFile ? 'Booked with card on file' : 'Booked by staff · waiting for card (link sent)') + ' · party of ' + size, 'Staff');
    let sent = '';
    if (walkIn || onFile) { if (d.notify) { try { sent = sendBookingEmail_(r, 'confirmed'); } catch (e) {} } }
    else { try { sent = sendCardRequest_(r); } catch (e) { sent = 'error'; } }
    if (onFile) try { notifyTeam_(r, 'confirmed'); } catch (e) {}
    return { id: id, needsCard: !walkIn && !onFile, onFile: !!onFile, sent: sent, link: walkIn || onFile ? '' : manageUrl_(r) };
  } finally { lock.releaseLock(); }
}

/* ---------------- paid add-ons (wine) ----------------
 * Add-ons column holds e.g. "wine" (not paid yet), "wine|paid|pi_123", "wine|unpaid", "wine|refunded|re_123". */
function addOnTotal_(r) {
  return String(r[BK.addons] || '').split('|')[0].split(',').filter(Boolean)
    .reduce((s, id) => s + ((BOOK.addOns.find(o => o.id === id) || {}).price || 0), 0);
}
function chargeAddOns_(r) {
  const amt = addOnTotal_(r);
  if (!amt || /\|paid\|/.test(String(r[BK.addons]))) return;
  const ids = String(r[BK.addons]).split('|')[0];
  try {
    const pi = stripe_('post', 'payment_intents', {
      amount: String(amt * 100), currency: 'usd', customer: r[BK.customer], payment_method: r[BK.pm],
      off_session: 'true', confirm: 'true', 'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never', description: 'Add-ons (' + ids + ') · ' + r[BK.name] + ' · ' + r[BK.date] + ' ' + r[BK.time],
      metadata: { booking: r[BK.id], kind: 'addons' }
    }, 'addons-' + r[BK.id] + '-' + r[BK.pm]);
    r[BK.addons] = ids + (pi.status === 'succeeded' ? '|paid|' + pi.id : '|unpaid');
  } catch (e) { r[BK.addons] = ids + '|unpaid'; }
}
/** Cancelled in time → give the add-on money back. */
function refundAddOns_(r) {
  const m = /^([^|]*)\|paid\|(pi_\w+)/.exec(String(r[BK.addons] || ''));
  if (!m) return;
  try { const re = stripe_('post', 'refunds', { payment_intent: m[2] }, 'refund-' + m[2]); r[BK.addons] = m[1] + '|refunded|' + (re.id || ''); }
  catch (e) {}
}

/** Public: a fresh card form for a pending booking (after a decline). */
function newCardFor(bookingId) {
  const x = findBooking_(bookingId);
  if (!x || x.r[BK.status] !== 'Pending') throw new Error('Please start your booking again.');
  const si = stripe_('post', 'setup_intents', { customer: x.r[BK.customer], usage: 'off_session',
    'payment_method_types[0]': 'card', 'payment_method_types[1]': 'link', metadata: { booking: bookingId } });
  return { clientSecret: si.client_secret };
}

function findBooking_(id) {
  if (!id) return null;
  return bkRows_().filter(x => x.r[BK.id] === id)[0] || null;
}
function findMine_(id, token) {
  const x = findBooking_(id);
  if (!x || !token || x.r[BK.token] !== token) throw new Error('We could not find that booking.');
  return x;
}
function writeRow_(row, r) { bkSheet_().getRange(row, 1, 1, r.length).setValues([r]); bumpAvail_(); }

function isLate_(r) { return classStart_(r[BK.date], r[BK.time]).getTime() - Date.now() < BOOK.lateHours * 3600000; }
function manageUrl_(r) { return bookLink_('b=' + r[BK.id] + '&t=' + r[BK.token]); }

function summary_(r) {
  return { id: r[BK.id], date: r[BK.date], time: r[BK.time], name: r[BK.name], size: Number(r[BK.size]),
    deadline: new Date(classStart_(r[BK.date], r[BK.time]).getTime() - BOOK.lateHours * 3600000).toISOString(), feePerGuest: BOOK.feePerGuest,
    status: r[BK.status], cardDue: r[BK.status] === 'Needs card' ? new Date(cardDue_(r)).toISOString() : '', late: isLate_(r), fee: BOOK.feePerGuest * Number(r[BK.size]), manageUrl: manageUrl_(r),
    past: classStart_(r[BK.date], r[BK.time]).getTime() < Date.now(), phone: String(r[BK.phone]), addons: String(r[BK.addons] || ''), paid: addOnTotal_(r) && /\|paid\|/.test(String(r[BK.addons])) ? addOnTotal_(r) : 0 };
}

/** Public: booking details for the guest's "manage my booking" link. */
function getMyBooking(id, token) { return summary_(findMine_(id, token).r); }

/** Public: guest cancels. Inside 24 hours it's marked "Late cancel" so the team can charge the fee. */
function cancelMyBooking(id, token, accept) {
  const x = findMine_(id, token), r = x.r;
  if (r[BK.status] !== 'Confirmed') return summary_(r);
  const late = isLate_(r);
  if (late && !accept) throw new Error('LATE_FEE_REQUIRED');
  r[BK.status] = late ? 'Late cancel' : 'Cancelled';
  if (!late) refundAddOns_(r);
  writeRow_(x.row, r);
  hist_(r, late ? 'Cancelled within 24 hours (late cancel) · guest agreed to the fee' : 'Cancelled', 'Guest');
  if (late && r[BK.pm]) { try { chargeFee_(id, 'late', null, 0, 'Guest'); } catch (e) {} }
  const y = findBooking_(id);
  sendBookingEmail_(y.r, 'cancelled'); notifyTeam_(y.r, 'cancelled');
  return summary_(y.r);
}

/** Public: guest changes the number of artists. Fewer guests inside 24 hours = late-change fee for those guests. */
function changeMySize(id, token, size, accept) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const x = findMine_(id, token), r = x.r;
    if (r[BK.status] !== 'Confirmed') throw new Error('This booking is no longer active.');
    size = Math.floor(Number(size)); const was = Number(r[BK.size]) || 1;
    if (!(size >= 1)) throw new Error('At least 1 artist.');
    if (size === was) return summary_(r);
    if (size > was) {
      const used = usedMap_(bkRows_()), ov = capacityOverrides_();
      const left = capFor_(ov, r[BK.date], r[BK.time]) - (used[r[BK.date] + '|' + r[BK.time]] || 0);
      if (left < size - was) throw new Error(left > 0 ? 'Only ' + left + ' more spot' + (left > 1 ? 's' : '') + ' left in your class.' : 'Your class is full, so we can\'t add more artists to it.');
    }
    const late = size < was && isLate_(r);
    if (late && !accept) throw new Error('LATE_FEE_REQUIRED');
    r[BK.size] = size;
    r[BK.guests] = String(r[BK.guests] || '').split(/,\s*/).filter(Boolean).slice(0, size).join(', ');
    writeRow_(x.row, r);
    hist_(r, (size > was ? 'Added ' + (size - was) : 'Removed ' + (was - size)) + ' guest' + (Math.abs(size - was) > 1 ? 's' : '') + ' (party of ' + was + ' to ' + size + ')' + (late ? ' · guest agreed to the fee' : ''), 'Guest');
    if (late) { try { chargeGuestFee_(x, was - size, null, (was - size) + ' guest' + (was - size > 1 ? 's' : '') + ' removed', 'Guest'); } catch (e) {} }
    const y = findBooking_(id);
    sendBookingEmail_(y.r, 'moved'); notifyTeam_(y.r, 'changed', was + ' guests');
    return summary_(y.r);
  } finally { lock.releaseLock(); }
}

/** Public: guest moves to another day/time. Inside 24 hours they agree to the late-change fee, charged right away. */
function rescheduleMyBooking(id, token, date, time, accept) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const x = findMine_(id, token), r = x.r;
    if (r[BK.status] !== 'Confirmed') throw new Error('This booking is no longer active.');
    const late = isLate_(r);
    if (late && !accept) throw new Error('LATE_FEE_REQUIRED');
    if (timesFor_(date).indexOf(time) < 0 || privateMap_()[date + '|' + time]) throw new Error('Please pick a time.');
    const used = usedMap_(bkRows_(), id), ov = capacityOverrides_();
    const left = capFor_(ov, date, time) - (used[date + '|' + time] || 0);
    if (classStart_(date, time).getTime() - Date.now() < BOOK.cutoffMinutes * 60000 || left < Number(r[BK.size]))
      throw new Error('That time does not have room for your party. Please pick another.');
    const oldWhen = niceDate_(r[BK.date]) + ' · ' + r[BK.time];
    r[BK.date] = date; r[BK.time] = time;
    writeRow_(x.row, r);
    hist_(r, 'Rescheduled from ' + oldWhen + ' to ' + niceDate_(date) + ' · ' + time + (late ? ' · within 24 hours, guest agreed to the fee' : ''), 'Guest');
    if (late) { try { chargeGuestFee_(x, Number(r[BK.size]), null, 'late reschedule', 'Guest'); } catch (e) {} }
    sendBookingEmail_(r, 'moved'); notifyTeam_(r, 'moved', oldWhen);
    return summary_(r);
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- staff: charge the cancellation / no-show fee ---------------- */
/** amount: leave out = full fee, a smaller number = partial, 0 = waive (nothing charged). */
/* Fee column: "$50 · 11/7 3:00 PM · pi_x" paid · "Waived · …" · "DUE|100|1|<iso>|noshow" declined, retrying */
const FEE_RETRY_HOURS = [24, 72, 168];   // after a decline, try again 1, 3 and 7 days later
function feeDue_(r) { const m = /^DUE\|([\d.]+)\|(\d+)\|([^|]*)\|?(\w*)/.exec(String(r[BK.fee] || '')); return m ? { amount: Number(m[1]), tries: Number(m[2]), last: m[3], kind: m[4] || 'noshow' } : null; }
function tryFeeCharge_(r, kind, amount) {
  try {
    const pi = stripe_('post', 'payment_intents', {
      amount: String(Math.round(amount * 100)), currency: 'usd', customer: r[BK.customer], payment_method: r[BK.pm],
      off_session: 'true', confirm: 'true', 'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
      description: (kind === 'noshow' ? 'No-show' : 'Late cancellation') + ' fee · ' + r[BK.name] + ' · ' + r[BK.date] + ' ' + r[BK.time],
      metadata: { booking: r[BK.id], kind: kind }
    }, 'fee-' + r[BK.id] + '-' + amount + '-' + Date.now());
    return pi.status === 'succeeded' ? pi.id : '';
  } catch (e) { return ''; }
}
/** Timer: retry declined fees on their schedule. */
function retryFees_() {
  const now = Date.now(), stamp = () => Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d h:mm a');
  bkRows_().forEach(x => {
    const r = x.r, d = feeDue_(r);
    if (!d || !r[BK.pm] || d.tries > FEE_RETRY_HOURS.length) return;
    if (now - new Date(d.last).getTime() < FEE_RETRY_HOURS[d.tries - 1] * 3600000) return;
    const id = tryFeeCharge_(r, d.kind, d.amount);
    r[BK.fee] = id ? '$' + d.amount + ' · ' + stamp() + ' · ' + id + ' (retry)' : 'DUE|' + d.amount + '|' + (d.tries + 1) + '|' + new Date().toISOString() + '|' + d.kind;
    writeRow_(x.row, r);
  });
}
/** Open balance this guest still owes from an earlier booking (0 = none). */
function owedBy_(phone, email) {
  const k = guestKey_(phone, email); if (!k) return 0;
  return bkRows_().reduce((s, x) => { const d = feeDue_(x.r); return d && guestKey_(x.r[BK.phone], x.r[BK.email]) === k ? s + d.amount : s; }, 0);
}

function chargeFee_(bookingId, kind, amount, guests, by) {
  by = by || 'Staff';
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const x = findBooking_(bookingId);
    if (!x) throw new Error('Booking not found');
    const r = x.r;
    if (Number(guests) > 0) return chargeGuestFee_(x, Number(guests), amount);   // guests removed late: its own fee
    if (r[BK.fee] && !feeDue_(r)) throw new Error('Fee already handled: ' + r[BK.fee]);
    if (r[BK.status] === 'Cancelled') throw new Error('This guest cancelled in time, so no fee applies');
    if (kind === 'noshow' && classStart_(r[BK.date], r[BK.time]).getTime() > Date.now()) throw new Error('Class has not started yet');
    const full = BOOK.feePerGuest * Number(r[BK.size]);
    amount = (amount === undefined || amount === null || amount === '') ? full : Math.round(Number(amount) * 100) / 100;
    if (!(amount >= 0) || amount > full) throw new Error('Amount must be between $0 and $' + full);
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d h:mm a');
    if (amount === 0) {
      r[BK.fee] = 'Waived · ' + stamp;
      if (kind === 'noshow') r[BK.status] = 'No-show';
      writeRow_(x.row, r);
      hist_(r, (kind === 'noshow' ? 'No-show' : 'Late-change') + ' fee waived', by);
      return { charged: 0, waived: true };
    }
    if (!r[BK.pm]) throw new Error('No card on file for this booking');
    if (kind === 'noshow') r[BK.status] = 'No-show';
    const piId = tryFeeCharge_(r, kind, amount);
    if (!piId) {   // declined: keep it as owed and retry automatically
      r[BK.fee] = 'DUE|' + amount + '|1|' + new Date().toISOString() + '|' + kind;
      writeRow_(x.row, r);
      hist_(r, '$' + amount + ' ' + (kind === 'noshow' ? 'no-show' : 'late-cancel') + ' fee declined · retrying automatically', by);
      return { charged: 0, declined: true, amount: amount };
    }
    r[BK.fee] = '$' + amount + (amount < full ? ' (partial)' : '') + ' · ' + stamp + ' · ' + piId;
    writeRow_(x.row, r);
    hist_(r, '$' + amount + ' ' + (kind === 'noshow' ? 'no-show' : 'late-cancel') + ' fee charged' + (amount < full ? ' (partial)' : ''), by);
    return { charged: amount, ref: piId };
  } finally {
    lock.releaseLock();
  }
}

/* Fee for guests removed within 24 hours. Kept in its own column ("Removed Guest Fee") so the booking can
 * still get a no-show or late-cancel fee later. Each column only ever charges once. */
let JUST_CHARGED_ = '';   // late-change fee charged in this request (for the guest's email)
function chargeGuestFee_(x, guests, amount, what, by) {
  const r = x.r, who = guests + ' guest' + (guests > 1 ? 's' : '');
  what = what || who + ' removed'; by = by || 'Staff';
  const prev = String(r[BK.guestFee] || '').split(' | ').filter(Boolean), n = prev.length;
  const full = BOOK.feePerGuest * guests;
  amount = (amount === undefined || amount === null || amount === '') ? full : Math.round(Number(amount) * 100) / 100;
  if (!(amount >= 0) || amount > full) throw new Error('Amount must be between $0 and $' + full);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d h:mm a');
  const save = e => { r[BK.guestFee] = prev.concat(e).join(' | '); writeRow_(x.row, r); };
  if (amount === 0) { save('Waived (' + what + ') · ' + stamp); hist_(r, 'Late-change fee (' + what + ') waived', by); return { charged: 0, waived: true }; }
  if (!r[BK.pm]) throw new Error('No card on file for this booking');
  let piId = '';
  try {
    const pi = stripe_('post', 'payment_intents', {
      amount: String(Math.round(amount * 100)), currency: 'usd', customer: r[BK.customer], payment_method: r[BK.pm],
      off_session: 'true', confirm: 'true', 'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
      description: 'Late change fee (' + what + ') · ' + r[BK.name] + ' · ' + r[BK.date] + ' ' + r[BK.time],
      metadata: { booking: r[BK.id], kind: 'change' }
    }, 'cfee-' + r[BK.id] + '-' + n + '-' + amount);   // same change tapped twice = one charge
    if (pi.status === 'succeeded') piId = pi.id;
  } catch (e) {}
  if (piId && prev.some(p => p.indexOf(piId) >= 0)) return { charged: amount, ref: piId };
  if (!piId) { save('Declined $' + amount + ' (' + what + ') · ' + stamp); hist_(r, '$' + amount + ' late-change fee (' + what + '): card declined', by); return { charged: 0, declined: true, noRetry: true, amount: amount }; }
  save('$' + amount + ' (' + what + ') · ' + stamp + ' · ' + piId);
  hist_(r, '$' + amount + ' late-change fee charged (' + what + ')', by);
  JUST_CHARGED_ = '$' + amount;
  return { charged: amount, ref: piId };
}

/* ---------------- Stripe ---------------- */
function stripe_(method, path, params, idem) {
  const key = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET');
  if (!key) throw new Error('Online booking is not set up yet (missing STRIPE_SECRET).');
  const flat = [];
  (function walk(o, pre) {
    Object.keys(o || {}).forEach(k => {
      const name = pre ? pre + '[' + k + ']' : k, v = o[k];
      if (v && typeof v === 'object') walk(v, name);
      else flat.push(encodeURIComponent(name) + '=' + encodeURIComponent(v));
    });
  })(params, '');
  const opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + key } };
  if (idem) opts.headers['Idempotency-Key'] = idem;
  let url = 'https://api.stripe.com/v1/' + path;
  if (method === 'get') { if (flat.length) url += '?' + flat.join('&'); }
  else { opts.payload = flat.join('&'); opts.contentType = 'application/x-www-form-urlencoded'; }
  const res = UrlFetchApp.fetch(url, opts);
  const j = JSON.parse(res.getContentText());
  if (j.error) throw new Error(j.error.message || 'Stripe error');
  return j;
}

/* ---------------- emails ---------------- */
function niceDate_(date) {
  return Utilities.formatDate(classStart_(date, '12:00 PM'), Session.getScriptTimeZone(), 'EEEE, MMMM d');
}

/** Guests hear from us by text when Quo is on and they gave a mobile number; email only as a fallback. */
const MENU_URL = 'https://www.abstractorlando.com/#Radio-2';
/** The "Know before you come" page (know.html, next to book.html on GitHub). */
const GUIDE_URL = 'https://abstractorlando.github.io/abstract-checkin/know.html';
const PALETTE_URL = 'https://cdn.filestackcontent.com/qJfAUAlSoaEH9fnEKEgA';

/** The free-change deadline, e.g. "Friday, November 6 at 2:00 PM". */
function deadlineText_(r) {
  const tz = Session.getScriptTimeZone(), d = new Date(classStart_(r[BK.date], r[BK.time]).getTime() - BOOK.lateHours * 3600000);
  return Utilities.formatDate(d, tz, 'EEEE, MMMM d') + ' at ' + Utilities.formatDate(d, tz, 'h:mm a');
}
const mBtn_ = (txt, url) => '<a href="' + url + '" style="display:inline-block;background:#ff009d;color:#fff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px">' + txt + '</a>';
const mH_ = t => '<p style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4e3aa2;margin:24px 0 8px">' + t + '</p>';
const mLi_ = items => '<ul style="margin:0 0 4px;padding-left:20px">' + items.map(i => '<li style="margin:0 0 8px">' + i + '</li>').join('') + '</ul>';
const mA_ = (t, u) => '<a href="' + u + '" style="color:#ff009d;font-weight:700;text-decoration:none">' + t + '</a>';
function mailShell_(kicker, title, body, token) {
  return '<div style="font-family:Poppins,Arial,sans-serif;max-width:560px;margin:auto;color:#1d1b26">' +
    '<div style="background:#4e3aa2;color:#fff;padding:24px 26px;border-radius:14px 14px 0 0">' +
    '<div style="font-size:14px;opacity:.85">' + kicker + '</div>' +
    '<div style="font-size:26px;font-weight:700;margin-top:4px;line-height:1.2">' + title + '</div></div>' +
    '<div style="border:1px solid #e6e3ee;border-top:0;padding:22px 26px;border-radius:0 0 14px 14px;font-size:16px;line-height:1.55">' + body +
    '<p style="font-size:14px;color:#6b6878;margin:26px 0 0">Abstract Orlando<br>' + STUDIO.address + '<br>Questions? Text us at ' + STUDIO.phone + '</p></div></div>' +
    (token ? openPixel_(token) : '');
}
function mailSend_(r, kind, subject, html, plain, ref) {
  let token = '';
  try { token = logEmail_(String(r[BK.email]), r[BK.name], kind, subject, ref || r[BK.id]); } catch (e) {}
  try {
    const opts = { htmlBody: html(token), name: STUDIO.name, replyTo: STUDIO.email };
    if (GmailApp.getAliases().indexOf(STUDIO.email) >= 0) opts.from = STUDIO.email;
    sendMail_(r[BK.email], subject, plain, opts);
    return 'email';
  } catch (e) { try { markEmailFailed_(token, e.message); } catch (x) {} return 'error: ' + e.message; }
}
/** What the booking looks like, for the top of each email. */
function mBooking_(r) {
  const wine = /wine/.test(String(r[BK.addons] || '')) && !/refunded/.test(String(r[BK.addons])) ? '<p style="margin:0 0 4px">Sparkling wine: paid, chilled and waiting for you</p>' : '';
  return '<div style="background:#f6f4fb;border-radius:12px;padding:16px 18px;margin:0 0 6px">' +
    '<p style="font-size:19px;font-weight:700;margin:0 0 4px">' + esc_(niceDate_(r[BK.date]) + ' at ' + r[BK.time]) + '</p>' +
    '<p style="margin:0 0 4px">Party of ' + Number(r[BK.size]) + (r[BK.guests] ? ': ' + esc_(r[BK.guests]) : '') + '</p>' + wine +
    '<p style="margin:0;color:#6b6878;font-size:14px">Confirmation ' + esc_(r[BK.id]) + '</p></div>';
}
function mPolicy_(r) {
  const fee = '$' + BOOK.feePerGuest + ' per guest';
  return mH_('Need to make a change?') +
    '<p style="margin:0 0 14px">You can reschedule, change your party size or cancel <b>for free until ' + esc_(deadlineText_(r)) + '</b>. ' +
    'After that, changes and cancellations have a ' + fee + ' late-change fee, and so does not showing up. It goes on the card you saved.</p>' +
    mBtn_('Reschedule or cancel', manageUrl_(r));
}

/** Guests hear from us by text when Quo is on and they gave a mobile number; email only as a fallback. */
function sendBookingEmail_(r, kind, emailOnly) {
  if (!emailOnly && quoOn_() && e164_(r[BK.phone])) {
    let t = 'error';
    try { t = quoBookingText_(r, kind); } catch (e) {}
    if (t === 'sent') return 'text';
  }
  if (!r[BK.email]) return 'none';
  const first = esc_(String(r[BK.name]).split(' ')[0]), when = niceDate_(r[BK.date]) + ' at ' + r[BK.time];
  let subject, kicker, title, body;
  if (kind === 'confirmed') {
    subject = 'Your reservation is confirmed! ' + when;
    kicker = 'Your reservation is confirmed'; title = 'We can\'t wait to see you, ' + first + '!';
    body = mBooking_(r) +
      mH_('What happens next') + mLi_([
        'Please arrive <b>10 minutes early</b> to settle in and pick your piece. We\'re in a plaza with plenty of free parking.',
        'You\'ll choose your project at the studio, from $50 per guest. ' + mA_('See the experience menu', MENU_URL),
        'Want a head start on colors? ' + mA_('Color and palette guide', PALETTE_URL),
        'About two days before your class, we\'ll send everything you need to know before you come. ' + mA_('Take a look now', GUIDE_URL)]) +
      mPolicy_(r);
  } else if (kind === 'moved') {
    subject = 'Your booking is updated: ' + when;
    kicker = 'Your booking is updated'; title = 'You\'re all set, ' + first + '!';
    body = '<p style="margin:0 0 14px">Here are your updated booking details.</p>' + mBooking_(r) +
      (JUST_CHARGED_ ? '<p style="margin:14px 0 0">As agreed, the late-change fee of ' + esc_(JUST_CHARGED_) + ' went on the card you saved.</p>' : '') +
      mPolicy_(r);
  } else {
    const charged = r[BK.status] === 'Late cancel' && /^\$/.test(String(r[BK.fee] || ''));
    subject = 'Your booking is cancelled';
    kicker = 'Abstract Orlando'; title = 'Your booking is cancelled';
    body = '<p style="margin:0 0 14px">Your class on <b>' + esc_(when) + '</b> is cancelled.</p>' +
      (charged ? '<p style="margin:0 0 14px">Since it was within ' + BOOK.lateHours + ' hours of class, the late-cancel fee of ' + esc_(String(r[BK.fee]).split(' · ')[0]) + ' went on the card you saved, as agreed.</p>'
        : r[BK.status] === 'Late cancel' ? '<p style="margin:0 0 14px">Since it was within ' + BOOK.lateHours + ' hours of class, a late-cancel fee may apply.</p>' : '') +
      '<p style="margin:0 0 20px">We\'d love to create with you another time.</p>' + mBtn_('Book a new time', bookLink_(''));
  }
  return mailSend_(r, kind, subject, t => mailShell_(kicker, title, body, t), subject);
}

/** About two days before class: everything they need for the visit (email version of the know-before-you-come page). */
function sendGuideEmail_(r, tag) {
  const first = esc_(String(r[BK.name]).split(' ')[0]), subject = 'Know before you come: your visit is almost here!';
  const body = '<p style="margin:0 0 16px">We\'re almost ready for your one-of-a-kind experience at Abstract Orlando, and we can\'t wait to have you in the studio!</p>' +
    mBooking_(r) +
    mH_('Start planning your visit') +
    '<p style="margin:0 0 10px">Take a look at the full menu and start dreaming up what you\'ll create. From canvases to sculptures, there\'s something for everyone.</p>' +
    '<p style="margin:0 0 6px">' + mA_('See the experience menu', MENU_URL) + '</p>' +
    '<p style="margin:0 0 4px">Need a hand picking colors? ' + mA_('Color and palette guide', PALETTE_URL) + '</p>' +
    mH_('Good to know') + mLi_([
      'Please arrive <b>10 minutes early</b> to settle in and pick your piece. We\'re in a plaza with plenty of free parking, so getting here is easy.',
      'Our experience is perfect for ages <b>4 and up</b>.',
      'Come in something comfortable. Aprons are provided, but we\'d skip long sleeves.',
      'You pick and pay for your project at the studio, from <b>$50 per guest</b>. We\'re a cashless studio, so please bring a card or contactless payment.',
      'It\'s one project per guest. So everyone gets the full experience and our team can give the best service, two guests can\'t work on one project together.',
      'Each table has room for up to four guests, so larger groups may be split across a couple of tables. You\'ll still be right next to each other.',
      'Our studio is reserved for guests who are creating. This keeps it comfortable for everyone and gives our team room to guide you, so friends and family coming along are welcome to wait in our lobby. Kids who are creating can have one adult with them if needed.',
      'For everyone\'s comfort and safety, we\'re not able to accommodate infants or strollers in the studio.',
      'We have a menu of wines by the glass or bottle, beer and soft drinks you can enjoy during your experience. You\'re welcome to bring your own bottle of wine for a <b>$30 corkage fee per bottle</b>. Liquor isn\'t allowed.',
      'Due to the hands-on nature of the experience and to protect your finished artwork, food isn\'t allowed in the studio.',
      'Groups of six or more have an 18% gratuity added automatically, even if booked separately.',
      'Your finished piece is ready in about <b>7 days</b>. Pick it up at the studio (Wed to Sun, 11 AM to 6 PM), or we\'ll ship it anywhere in the contiguous U.S. for <b>$25 per piece</b>.']) +
    mPolicy_(r) +
    '<p style="margin:22px 0 0">We can\'t wait to create with you!<br>The Abstract Orlando Team</p>';
  return mailSend_(r, 'guide', subject, t => mailShell_('See you soon, ' + first, 'Your experience is almost here!', body, t), subject, tag);
}

/** Last chance to change for free (email version, when we can't text). */
function sendLastChanceEmail_(r, tag) {
  const first = esc_(String(r[BK.name]).split(' ')[0]), subject = 'Last chance to change your booking for free';
  const body = '<p style="margin:0 0 14px">Just a heads-up before your class. If your plans have changed, you can still reschedule, change your party size or cancel <b>for free until ' + esc_(deadlineText_(r)) + '</b>.</p>' +
    mBooking_(r) +
    '<p style="margin:14px 0 18px">After that, a $' + BOOK.feePerGuest + ' per guest late-change fee applies to any change, cancellation or no-show. If everything\'s still good, there\'s nothing to do. We\'ll see you soon!</p>' +
    mBtn_('Manage my booking', manageUrl_(r));
  return mailSend_(r, 'lastChance', subject, t => mailShell_('Hi ' + first, 'Last chance for free changes', body, t), subject, tag);
}

function markEmailFailed_(token, why) {
  if (!token) return;
  const sh = textLog_(), n = sh.getLastRow() - 1, ids = sh.getRange(2, 10, n, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (ids[i][0] === token) { sh.getRange(i + 2, 6, 1, 3).setValues([['Failed', new Date().toISOString(), String(why || '').slice(0, 200)]]); return; }
}

/** Run once from the editor: reminder emails go out every morning for tomorrow's classes. */
function setupReminders() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendReminders')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(9).create();
}

function sendReminders() { try { remindersTick_(); } catch (e) {} }   // old daily timer: now just runs the reminder check

/* ---------------- team notices to info@ ---------------- */
const TEAM_TAG = '[Abstract Booking]';

/* Who gets booking notices: info@ always, plus anyone added in the app (Settings ⚙). */
const NOTIFY_DEFAULT = [];   // extra inboxes cost Gmail sends; forwarding from info@ is free
function notifyExtras_() {
  const v = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS');
  if (v === null) return NOTIFY_DEFAULT.slice();
  return String(v).split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}
function getNotify_() { return { always: STUDIO.email, extra: notifyExtras_() }; }
function setNotify_(list) {
  const clean = [...new Set((list || []).map(x => String(x).trim().toLowerCase()).filter(Boolean))];
  clean.forEach(x => { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) throw new Error('"' + x + '" is not an email address'); });
  if (clean.length > 5) throw new Error('Up to 5 extra people');
  PropertiesService.getScriptProperties().setProperty('NOTIFY_EMAILS', clean.filter(x => x !== STUDIO.email.toLowerCase()).join(','));
  return getNotify_();
}
/** Recipients for a team notice. Gmail allows about 100 recipients a day, so when it runs low
 *  only info@ gets them, and the last 10 are kept for guests who can't get a text. */
function teamTo_() {
  let left = 100;
  try { left = MailApp.getRemainingDailyQuota(); } catch (e) {}
  if (left < 10) return '';
  const extra = notifyExtras_().filter(x => x !== STUDIO.email.toLowerCase());
  return (left < 25 + extra.length ? [STUDIO.email] : [STUDIO.email].concat(extra)).join(',');
}

function notifyTeam_(r, kind, oldWhen) {
  try { logActivity_(kind === 'cancelled' && r[BK.status] === 'Late cancel' ? 'late' : kind, r[BK.name], r[BK.date], r[BK.time], r[BK.size], bkKey_(r), oldWhen || ''); } catch (e) {}
  const to = teamTo_();
  if (!to) return;
  const when = niceDate_(r[BK.date]) + ' · ' + r[BK.time];
  const head = { confirmed: 'New booking', cancelled: r[BK.status] === 'Late cancel' ? 'LATE cancel (fee may apply)' : 'Cancelled', moved: 'Rescheduled', changed: 'Party size changed' }[kind];
  const subject = TEAM_TAG + ' ' + head + ': ' + r[BK.name] + ' · party of ' + r[BK.size] + ' · ' + when;
  const lines = [
    ['Guest', r[BK.name]], ['Party', r[BK.size] + ' guest' + (Number(r[BK.size]) > 1 ? 's' : '')],
    [kind === 'moved' ? 'New time' : 'Class', when]
  ];
  if (kind === 'moved') lines.push(['Was', oldWhen]);
  if (kind === 'changed') lines.push(['Was', oldWhen]);
  if (r[BK.status] === 'Late cancel' && r[BK.fee]) lines.push(['Late-cancel fee', /^DUE/.test(r[BK.fee]) ? 'Card declined, retrying' : String(r[BK.fee]).split(' · pi_')[0]]);
  if (r[BK.guestFee]) lines.push(['Late-change fees', String(r[BK.guestFee]).replace(/ · pi_\w+/g, '')]);
  if (r[BK.guests]) lines.push(['Guest names', r[BK.guests]]);
  if (r[BK.note]) lines.push(['Note', r[BK.note]]);
  if (/wine/.test(String(r[BK.addons] || ''))) lines.push(['Add-on', 'Sparkling wine - ' + (/\|paid\|/.test(r[BK.addons]) ? 'PAID online ($30)' : /refunded/.test(r[BK.addons]) ? 'refunded' : 'NOT paid, collect $30 at the studio')]);
  lines.push(['Phone', r[BK.phone]], ['Email', r[BK.email]], ['Confirmation', r[BK.id]]);
  if (r[BK.status] === 'Late cancel' && !r[BK.fee]) lines.push(['Fee', 'Decide the $' + BOOK.feePerGuest * Number(r[BK.size]) + ' fee in the check-in app']);
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d1b26"><h2 style="margin:0 0 12px;color:' +
    (kind === 'confirmed' ? '#0093ad' : kind === 'moved' ? '#4e3aa2' : '#c40056') + '">' + esc_(head) + '</h2><table cellpadding="5">' +
    lines.map(l => '<tr><td style="color:#6b6878">' + esc_(l[0]) + '</td><td><b>' + esc_(String(l[1])) + '</b></td></tr>').join('') + '</table></div>';
  try {
    const opts = { htmlBody: html, name: 'Abstract Booking' };
    if (GmailApp.getAliases().indexOf(STUDIO.email) >= 0) opts.from = STUDIO.email;
    sendMail_(to, subject, subject, opts);
    Utilities.sleep(1500);
    archiveTeamCopies_();
  } catch (e) {}
}

/** Gmail also drops a copy of team notices in this account's inbox; keep them out of it. */
function archiveTeamCopies_() {
  GmailApp.search('in:inbox subject:"' + TEAM_TAG + '"', 0, 50).forEach(t => t.moveToArchive());
}

/* ---------------- staff: no-show / cancel / move / undo ---------------- */
/** Same key for website bookings (Booking ID) and Toast rows (day + name). */
function bkKey_(r) {
  return r[10] ? String(r[10]) : 'T|' + d_(r[0]) + '|' + String(r[2]).trim().toLowerCase();
}

/** action: 'noshow' | 'cancel' | 'restore' | 'move'   opts: {date, time, email:true|false} */
function staffUpdate_(key, action, opts) {
  opts = opts || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const x = bkRows_().filter(y => bkKey_(y.r) === key)[0];
    if (!x) throw new Error('Booking not found (refresh and try again)');
    const r = x.r, web = r[BK.source] === 'Website' && r[BK.email];
    if (action === 'noshow') r[BK.status] = 'No-show';
    else if (action === 'cancel') { r[BK.status] = opts.late ? 'Late cancel' : 'Cancelled'; if (opts.refund !== false) refundAddOns_(r); }
    else if (action === 'restore') r[BK.status] = r[BK.pm] || r[BK.source] !== 'Staff' || r[BK.date] <= Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') ? 'Confirmed' : 'Needs card';
    else if (action === 'move') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date) || !opts.time) throw new Error('Pick a day and time');
      const used = usedMap_(bkRows_(), r[BK.id] || '__none__'), ov = capacityOverrides_();
      if (r[BK.id] === '') used[r[BK.date] + '|' + r[BK.time]] -= Number(r[BK.size]) || 0;
      const left = capFor_(ov, opts.date, opts.time) - (used[opts.date + '|' + opts.time] || 0);
      if (left < Number(r[BK.size]) && !opts.force) return { needsForce: true, left: left };
      var oldWhen = niceDate_(r[BK.date]) + ' · ' + r[BK.time];
      r[BK.date] = opts.date; r[BK.time] = opts.time; if (r[BK.status] !== 'Needs card') r[BK.status] = 'Confirmed';
    } else throw new Error('Unknown action');
    writeRow_(x.row, r);
    hist_(r, action === 'noshow' ? 'Marked no-show' : action === 'cancel' ? (r[BK.status] === 'Late cancel' ? 'Cancelled within 24 hours (late cancel)' : 'Cancelled') + (opts.email ? ' · guest notified' : '')
      : action === 'restore' ? 'Put back on the list' : 'Rescheduled from ' + oldWhen + ' to ' + niceDate_(r[BK.date]) + ' · ' + r[BK.time] + (opts.force ? ' (over capacity)' : '') + (opts.email ? ' · guest notified' : ''), 'Staff');
    if (web && opts.email) {
      if (action === 'cancel') sendBookingEmail_(r, 'cancelled');
      if (action === 'move') sendBookingEmail_(r, 'moved');
    }
    if (action === 'move' && web) notifyTeam_(r, 'moved', oldWhen);
    return { status: r[BK.status], date: r[BK.date], time: r[BK.time] };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- staff: Schedule screen (seats per class) ---------------- */
function capSheet_() { return sh_('Capacity', ['Class Date', 'Class Time (blank = whole day)', 'Guests']); }

/** One day's classes: booked seats, seat limit, open/closed. */
function getSchedule_(date) {
  const tz = Session.getScriptTimeZone();
  const ov = capacityOverrides_(), used = usedMap_(bkRows_()), pmap = privateMap_();
  const dow = Number(Utilities.formatDate(classStart_(date, '12:00 PM'), tz, 'u')) % 7;
  const regular = BOOK.openDays.indexOf(dow) >= 0;
  const dayOv = (date + '|*') in ov ? ov[date + '|*'] : null;
  const dayOpen = dayOv === null ? regular : dayOv > 0;
  return {
    date: date, regular: regular, dayOpen: dayOpen, defaultCap: defaultCap_(date),
    classes: (timesFor_(date).length ? timesFor_(date) : BOOK.newTimes[6]).filter(t => !pmap[date + '|' + t]).map(t => {
      const cap = !dayOpen ? 0 : ((date + '|' + t) in ov ? ov[date + '|' + t] : (dayOv > 0 ? dayOv : defaultCap_(date)));
      return { time: t, booked: used[date + '|' + t] || 0, cap: cap, custom: (date + '|' + t) in ov, link: bookLink_('d=' + date + '&t=' + encodeURIComponent(t)) };
    }),
    bookUrl: bookLink_(''),
    notes: classNotes_(date),
    privates: privateSlots_().filter(p => p.date === date).map(p => ({ code: p.code, time: p.time, name: p.name,
      cap: capFor_(ov, date, p.time), booked: used[date + '|' + p.time] || 0, link: privateLink_(p.code), regular: timesFor_(date).indexOf(p.time) >= 0 }))
      .sort((a, b) => classStart_(date, a.time) - classStart_(date, b.time))
  };
}

/** time = '9:00 AM' style for one class, or '*' for the whole day. guests = number, or null to go back to normal. */
/** Staff: 7 days at a glance starting from `start` (yyyy-MM-dd). One read of each sheet. */
function getWeek_(start) {
  const ov = capacityOverrides_(), used = usedMap_(bkRows_()), pmap = privateMap_();
  const p = start.split('-').map(Number), out = [];
  let noteRows = [];
  try { const ns = notesSheet_(), n = ns.getLastRow() - 1; if (n > 0) noteRows = ns.getRange(2, 1, n, 3).getValues(); } catch (e) {}
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + i));
    const date = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
    const regular = BOOK.openDays.indexOf(dow_(date)) >= 0;
    const dayOv = (date + '|*') in ov ? ov[date + '|*'] : null;
    const dayOpen = dayOv === null ? regular : dayOv > 0;
    const notes = {};
    noteRows.forEach(r => { if (d_(r[0]) === date && r[2]) notes[r[1] ? t_(r[1]) : '*'] = String(r[2]); });
    const classes = (dayOpen ? timesFor_(date).filter(t => !pmap[date + '|' + t]) : []).map(t => {
      const cap = (date + '|' + t) in ov ? ov[date + '|' + t] : (dayOv > 0 ? dayOv : defaultCap_(date));
      return { time: t, booked: used[date + '|' + t] || 0, cap: cap, note: notes[t] || '' };
    });
    Object.keys(pmap).filter(k => k.indexOf(date + '|') === 0).forEach(k => {
      const pv = pmap[k];
      classes.push({ time: pv.time, booked: used[k] || 0, cap: capFor_(ov, date, pv.time), private: pv.name || 'Private', note: notes[pv.time] || '' });
    });
    classes.sort((a, b) => classStart_(date, a.time) - classStart_(date, b.time));
    out.push({ date: date, open: dayOpen, regular: regular, dayNote: notes['*'] || '', classes: classes });
  }
  return out;
}

function setCapacity_(date, time, guests) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = capSheet_(), n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, 3).getValues() : [];
    const want = time === '*' ? '' : time;
    let found = 0;
    rows.forEach((r, i) => { if (!found && d_(r[0]) === date && (r[1] ? t_(r[1]) : '') === want) found = i + 2; });
    if (guests === null) { if (found) sh.deleteRow(found); }
    else if (found) sh.getRange(found, 3).setValue(Number(guests));
    else sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[date, want, Number(guests)]]);
    // opening/closing a whole day resets that day's single-class changes
    if (time === '*') {
      const m = sh.getLastRow() - 1;
      if (m > 0) sh.getRange(2, 1, m, 3).getValues().map((r, i) => ({ r: r, row: i + 2 }))
        .filter(x => d_(x.r[0]) === date && x.r[1]).reverse().forEach(x => sh.deleteRow(x.row));
    }
    bumpAvail_();
    return getSchedule_(date);
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- staff: look at one booking ---------------- */
function bkByKey_(key) {
  const x = bkRows_().filter(y => bkKey_(y.r) === key)[0];
  if (!x) throw new Error('Booking not found (refresh and try again)');
  return x;
}
/** Details for the booking sheet in the app: when it was made + every text/email we sent. */
function getBookingDetail_(key) {
  const r = bkByKey_(key).r;
  return { created: String(r[BK.created] || r[BK.imported] || ''), manage: r[BK.token] ? manageUrl_(r) : '',
    messages: bookingMessages_(r[BK.id]), textsOn: quoOn_(), history: histFor_(r) };
}
/** Staff: send the confirmation again. how = 'text' | 'email' */
function resendConfirmation_(key, how) {
  const r = bkByKey_(key).r;
  if (r[BK.status] !== 'Confirmed') throw new Error('This booking is not active');
  if (!r[BK.id]) throw new Error('Only bookings made in the new system can be re-sent');
  if (how === 'text') {
    if (!quoOn_()) throw new Error('Texts turn on once the phone number finishes moving to Quo. Send it by email for now.');
    if (!e164_(r[BK.phone])) throw new Error('No mobile number on this booking');
    const res = quoBookingText_(r, 'confirmed');
    if (res !== 'sent') throw new Error('Text not sent: ' + res);
  } else {
    if (!r[BK.email]) throw new Error('No email on this booking');
    const res = sendBookingEmail_(r, 'confirmed', true);
    if (res !== 'email') throw new Error('Email not sent: ' + res);
  }
  return getBookingDetail_(key);
}

/* ---------------- 🔔 activity for the bell in the staff app ---------------- */
const ACTIVITY_HEADERS = ['At', 'Kind', 'Name', 'Class Date', 'Class Time', 'Size', 'Booking Key', 'Detail'];
const activitySheet_ = () => sh_('Activity', ACTIVITY_HEADERS);
/** kind: confirmed | moved | cancelled | late | party */
function logActivity_(kind, name, date, time, size, key, detail) {
  activitySheet_().appendRow([new Date().toISOString(), kind, String(name || ''), String(date || ''), String(time || ''),
    String(size || ''), String(key || ''), String(detail || '')]);
}
/** Staff: the latest 30 things that happened (newest first). */
function getActivity_() {
  const sh = activitySheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const from = Math.max(2, n - 28);
  return sh.getRange(from, 1, n + 2 - from, ACTIVITY_HEADERS.length).getValues().reverse().map(r => ({
    at: String(r[0]), kind: String(r[1]), name: String(r[2]), date: d_(r[3]) || String(r[3]), time: r[4] ? t_(r[4]) : '',
    size: String(r[5]), key: String(r[6]), detail: String(r[7]) }));
}

/* ---------------- guest saves a card for a booking the team made ---------------- */
/** Text (or email) the guest a secure link to save their card. Returns 'text' | 'email' | 'error: …' */
function sendCardRequest_(r) {
  const v = bookingVars_(r);
  if (quoOn_() && e164_(r[BK.phone])) {
    const msg = fillVars_(TEXTS.cardRequest, v), to = e164_(r[BK.phone]), res = quoSend_(to, msg), now = new Date().toISOString();
    textLog_().appendRow([now, to, r[BK.name], 'cardRequest', msg, res === 'sent' ? 'Sent' : 'Failed', now, res === 'sent' ? '' : res, String(r[BK.id]), LAST_QUO_ID, '']);
    if (res === 'sent') return 'text';
  }
  if (!r[BK.email]) return 'error: no email';
  const subject = 'Thank you for reserving! Please confirm your spot';
  let token = '';
  try { token = logEmail_(String(r[BK.email]), r[BK.name], 'cardRequest', subject, r[BK.id]); } catch (e) {}
  const html = '<div style="font-family:Poppins,Arial,sans-serif;max-width:520px;margin:auto;color:#1d1b26">' +
    '<div style="background:#4e3aa2;color:#fff;padding:22px 24px;border-radius:14px 14px 0 0"><div style="font-size:14px;opacity:.85">' + STUDIO.name + '</div>' +
    '<div style="font-size:26px;font-weight:700;margin-top:4px">Thank you for reserving, ' + esc_(v.first) + '!</div></div>' +
    '<div style="border:1px solid #e6e3ee;border-top:0;padding:22px 24px;border-radius:0 0 14px 14px;font-size:16px;line-height:1.5">' +
    '<p style="font-size:18px;font-weight:700;margin:0 0 4px">' + esc_(v.when) + '</p><p style="margin:0 0 16px">Party of ' + v.size + '</p>' +
    '<p style="margin:0 0 20px">We\'re holding your spot for the next ' + CARD_MINUTES + ' minutes. To confirm your booking, please add a card. It only holds your spot. Nothing is charged today.</p>' +
    '<a href="' + manageUrl_(r) + '" style="display:inline-block;background:#ff009d;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Confirm my booking</a>' +
    '<p style="font-size:14px;color:#6b6878;margin:22px 0 0">' + STUDIO.address + '<br>Text us: ' + STUDIO.phone + '</p></div></div>' + (token ? openPixel_(token) : '');
  try {
    const opts = { htmlBody: html, name: STUDIO.name, replyTo: STUDIO.email };
    if (GmailApp.getAliases().indexOf(STUDIO.email) >= 0) opts.from = STUDIO.email;
    sendMail_(r[BK.email], subject, subject + ': ' + manageUrl_(r), opts);
    return 'email';
  } catch (e) { try { markEmailFailed_(token, e.message); } catch (x) {} return 'error: ' + e.message; }
}

/** Public: start the card form for a booking that's waiting for a card. */
function cardSetup(id, token) {
  const x = findMine_(id, token), r = x.r;
  if (r[BK.status] !== 'Needs card') throw new Error(r[BK.status] === 'Confirmed' ? 'Your card is already saved. You\'re all set!' : 'This booking is no longer active. Text us at ' + STUDIO.phone + '.');
  if (Date.now() > cardDue_(r)) {   // hold ran out: still fine if there's room
    const used = usedMap_(bkRows_(), id), ov = capacityOverrides_();
    if (capFor_(ov, r[BK.date], r[BK.time]) - (used[r[BK.date] + '|' + r[BK.time]] || 0) < Number(r[BK.size])) throw new Error('HOLD_EXPIRED');
  }
  if (!r[BK.customer]) {
    const cust = stripe_('post', 'customers', { name: r[BK.name], email: r[BK.email], phone: r[BK.phone], metadata: { booking: id } });
    r[BK.customer] = cust.id; writeRow_(x.row, r);
  }
  const si = stripe_('post', 'setup_intents', { customer: r[BK.customer], usage: 'off_session',
    'payment_method_types[0]': 'card', 'payment_method_types[1]': 'link', metadata: { booking: id, class: r[BK.date] + ' ' + r[BK.time], guests: String(r[BK.size]) } });
  return { clientSecret: si.client_secret };
}

/** Public: the guest saved their card. Confirms the booking. */
function saveCard(id, token, setupIntentId) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const x = findMine_(id, token), r = x.r;
    if (r[BK.status] === 'Confirmed') return summary_(r);
    if (r[BK.status] !== 'Needs card') throw new Error('This booking is no longer active. Text us at ' + STUDIO.phone + '.');
    const si = stripe_('get', 'setup_intents/' + encodeURIComponent(setupIntentId));
    if (si.status !== 'succeeded' || !si.metadata || si.metadata.booking !== id) throw new Error('Your card was not saved. Please try again.');
    if (Date.now() > cardDue_(r)) {   // past the 24-hour hold: only if the spots are still free
      const used = usedMap_(bkRows_(), id), ov = capacityOverrides_();
      if (capFor_(ov, r[BK.date], r[BK.time]) - (used[r[BK.date] + '|' + r[BK.time]] || 0) < Number(r[BK.size]))
        throw new Error('HOLD_EXPIRED');
    }
    const pm = stripe_('get', 'payment_methods/' + encodeURIComponent(si.payment_method));
    if (pm.card && pm.card.funding === 'prepaid') throw new Error('PREPAID');
    stripe_('post', 'customers/' + r[BK.customer], { 'invoice_settings[default_payment_method]': si.payment_method });
    r[BK.pm] = si.payment_method; r[BK.status] = 'Confirmed';
    writeRow_(x.row, r);
    hist_(r, 'Card saved · booking confirmed', 'Guest');
    try { sendBookingEmail_(r, 'confirmed'); } catch (e) {}
    try { logActivity_('card', r[BK.name], r[BK.date], r[BK.time], r[BK.size], bkKey_(r), ''); } catch (e) {}
    return summary_(r);
  } finally { lock.releaseLock(); }
}

/** Staff: send the card link again. */
function resendCardLink_(key) {
  const r = bkByKey_(key).r;
  if (r[BK.status] !== 'Needs card') throw new Error('This booking is not waiting for a card');
  const res = sendCardRequest_(r);
  if (!/^(text|email)$/.test(res)) throw new Error('Not sent: ' + res);
  return getBookingDetail_(key);
}

/** Staff: no-shows and late cancels from the last 30 days with a saved card where nobody decided the fee yet. */
/* End of shift: classes still "Booked" with nobody checked in show up to decide (no-show, or they came).
 * Today's appear once the studio closes (CLOSE_HOUR), earlier days right away. Nothing happens on its own. */
const CLOSE_HOUR = 18;   // 6 PM
function pendingFees_() {
  const tz = Session.getScriptTimeZone(), now = new Date(), since = Utilities.formatDate(new Date(Date.now() - 30 * 864e5), tz, 'yyyy-MM-dd');
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), afterClose = Number(Utilities.formatDate(now, tz, 'H')) >= CLOSE_HOUR;
  const item = (x, kind) => ({ bookingId: String(x.r[BK.id] || ''), reservation: String(x.r[BK.name]), date: x.r[BK.date], time: x.r[BK.time],
    size: Number(x.r[BK.size]) || 1, kind: kind, key: bkKey_(x.r), card: !!x.r[BK.pm] });
  const out = [];
  bkRows_().forEach(x => {
    const r = x.r;
    if (r[BK.date] < since) return;
    if ((r[BK.status] === 'No-show' || r[BK.status] === 'Late cancel') && r[BK.pm] && !r[BK.fee] && r[BK.id])
      out.push(item(x, r[BK.status] === 'No-show' ? 'noshow' : 'late'));
    else if (r[BK.status] === 'Confirmed' && !r[BK.partyId] && (r[BK.date] < today || (r[BK.date] === today && afterClose)))
      out.push(item(x, 'unchecked'));
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* ---------------- staff: find a returning guest ---------------- */
/** Past guests by name, phone or email, with the cards they saved before (brand + last 4 only). */
function findGuests_(q) {
  q = String(q || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/), digits = q.replace(/\D/g, ''), m = {};
  const add = (name, phone, email, date, pm, cust) => {
    const k = guestKey_(phone, email); if (!k) return;
    const hay = (name + ' ' + email).toLowerCase();
    if (!(words.every(w => hay.indexOf(w) >= 0) || (digits.length >= 4 && String(phone).replace(/\D/g, '').indexOf(digits) >= 0))) return;
    const g = m[k] || (m[k] = { key: k, name: '', phone: '', email: '', last: '', visits: 0, pms: [] });
    if (!g.last || date >= g.last) { g.last = date; if (name) g.name = String(name); if (phone) g.phone = String(phone); if (email) g.email = String(email); }
    if (pm && cust && !g.pms.some(p => p.pm === pm)) g.pms.push({ pm: pm, date: date });
  };
  bkRows_().forEach(x => { const r = x.r; if (r[BK.status] !== 'Pending') add(r[BK.name], r[BK.phone], r[BK.email], r[BK.date], r[BK.pm], r[BK.customer]); });
  // guests from FareHarbor (the "Past Guests" tab, imported once)
  const past = pastSheet_();
  if (past) {
    const first = digits.length >= 4 && !/[a-z]/.test(q) ? digits : words.reduce((a, b) => b.length > a.length ? b : a, '');
    past.getRange(2, PG.search + 1, past.getLastRow() - 1, 1).createTextFinder(first).findAll().slice(0, 200).forEach(c => {
      const v = past.getRange(c.getRow(), 1, 1, PG.search).getValues()[0];
      const k = guestKey_(v[PG.phone], v[PG.email]); if (!k) return;
      if (!m[k]) add(String(v[PG.name]), String(v[PG.phone]), String(v[PG.email]), '', '', '');
      if (m[k]) { m[k].fh = Number(v[PG.visits]) || 0; if (v[PG.last] && String(d_(v[PG.last])) > m[k].last) m[k].last = String(d_(v[PG.last])); }
    });
  }
  const stats = guestStats_();
  const out = Object.keys(m).map(k => m[k]).sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name)).slice(0, 8);
  out.forEach(g => {
    g.visits = ((stats[g.key] || {}).visits || 0) + (g.fh || 0);
    g.owes = owedBy_(g.phone, g.email);
    g.hasCard = g.pms.length > 0;
    delete g.pms;
  });
  return out;
}

/* ---------------- FareHarbor history (the "Past Guests" tab) ---------------- */
const PG = { key: 0, name: 1, phone: 2, email: 3, emailOk: 4, zip: 5, visits: 6, first: 7, last: 8, artists: 9, search: 10 };
function pastSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Past Guests');
  return sh && sh.getLastRow() > 1 ? sh : null;
}
/** { key: {visits, first, last, artists} } for the guest keys asked for (fast lookup, no full read). */
function pastFor_(keys) {
  const sh = pastSheet_(), out = {};
  if (!sh) return out;
  const want = [...new Set(keys.filter(Boolean).map(String))];
  if (!want.length) return out;
  const re = '^(' + want.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$';
  const cells = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(re).useRegularExpression(true).matchEntireCell(true).findAll();
  if (!cells.length) return out;
  const rows = cells.map(c => c.getRow()), lo = Math.min.apply(null, rows), hi = Math.max.apply(null, rows);
  const vals = hi - lo < 400 ? sh.getRange(lo, 1, hi - lo + 1, PG.search).getValues() : null;   // nearby rows: one read
  rows.forEach(row => {
    const v = vals ? vals[row - lo] : sh.getRange(row, 1, 1, PG.search).getValues()[0];
    out[String(v[PG.key])] = { visits: Number(v[PG.visits]) || 0, first: d_(v[PG.first]), last: d_(v[PG.last]), artists: Number(v[PG.artists]) || 0 };
  });
  return out;
}

/** Staff: the public booking page link (for texting guests). */
function bookingLink_() { return bookLink_(''); }

/** Staff: the cards a guest saved before (brand + last 4), newest first. Only called when a guest is picked. */
function guestCards_(phone, email) {
  const k = guestKey_(phone, email), seen = {}, out = [];
  bkRows_().filter(x => x.r[BK.pm] && x.r[BK.customer] && guestKey_(x.r[BK.phone], x.r[BK.email]) === k)
    .sort((a, b) => String(b.r[BK.date]).localeCompare(String(a.r[BK.date]))).forEach(x => {
      const pmId = x.r[BK.pm]; if (seen[pmId] || out.length >= 3) return; seen[pmId] = 1;
      try { const c = (stripe_('get', 'payment_methods/' + encodeURIComponent(pmId)).card) || {};
        out.push({ pm: pmId, label: (c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : 'Card') + ' ending ' + (c.last4 || '????') + (c.exp_year ? ' (exp ' + c.exp_month + '/' + String(c.exp_year).slice(-2) + ')' : '') });
      } catch (e) {}
    });
  return out;
}

/* ---------------- staff: edit the party (names, size, contact) ---------------- */
/** d = {name, phone, email, size, guests:[names], force}. Returns {needsForce, left} if adding guests overfills the class. */
function editBooking_(key, d) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const x = bkByKey_(key), r = x.r;
    const size = Math.floor(Number(d.size));
    if (!(size >= 1)) throw new Error('At least 1 artist');
    const name = titleCase_(clean_(d.name, 60));
    if (!name) throw new Error('Add the reservation name');
    const was = Number(r[BK.size]) || 1;
    if (size > was && !d.force) {
      const used = usedMap_(bkRows_()), ov = capacityOverrides_();
      const left = capFor_(ov, r[BK.date], r[BK.time]) - (used[r[BK.date] + '|' + r[BK.time]] || 0);
      if (left < size - was) return { needsForce: true, left: left, adding: size - was };
    }
    const before = { name: String(r[BK.name]), phone: String(r[BK.phone]), email: String(r[BK.email]), guests: String(r[BK.guests] || '') };
    r[BK.name] = name; r[BK.size] = size;
    if (d.phone !== undefined) r[BK.phone] = clean_(d.phone, 25);
    if (d.email !== undefined) r[BK.email] = clean_(d.email, 80).toLowerCase();
    r[BK.guests] = (d.guests || []).slice(0, size).map(g => titleCase_(clean_(g, 30))).filter(Boolean).join(', ');
    writeRow_(x.row, r);
    const ch = [];
    if (size !== was) ch.push((size > was ? 'Added ' + (size - was) : 'Removed ' + (was - size)) + ' guest' + (Math.abs(size - was) > 1 ? 's' : '') + ' (party of ' + was + ' to ' + size + ')' + (d.force ? ' over capacity' : ''));
    const oldG = before.guests.split(/,\s*/).filter(Boolean), newG = String(r[BK.guests]).split(/,\s*/).filter(Boolean);
    const out = oldG.filter(g => newG.indexOf(g) < 0), inn = newG.filter(g => oldG.indexOf(g) < 0);
    if (out.length || inn.length) ch.push('Names: ' + (out.length ? out.join(', ') + ' out' : '') + (out.length && inn.length ? ', ' : '') + (inn.length ? inn.join(', ') + ' in' : ''));
    if (before.name !== name) ch.push('Name changed from ' + before.name + ' to ' + name);
    if (before.phone !== String(r[BK.phone])) ch.push('Phone changed to ' + r[BK.phone]);
    if (before.email !== String(r[BK.email])) ch.push('Email changed to ' + r[BK.email]);
    if (ch.length) hist_(r, ch.join(' · '), 'Staff');
    return { ok: true, was: was, size: size, late: !!r[BK.id] && isLate_(r) && size < was && !!r[BK.pm] };
  } finally { lock.releaseLock(); }
}

/* ---------------- booking history (who changed what, when) ---------------- */
const HIST_HEADERS = ['At', 'Booking', 'Guest', 'What happened', 'By'];
const histSheet_ = () => sh_('Booking History', HIST_HEADERS);
function histId_(r) { return String(r[BK.id] || bkKey_(r)); }
function hist_(r, what, by) {
  try { histSheet_().appendRow([new Date().toISOString(), histId_(r), String(r[BK.name] || ''), String(what), by || 'Staff']); } catch (e) {}
}
/** Every change for one booking, newest first. */
function histFor_(r) {
  const sh = histSheet_(), n = sh.getLastRow() - 1, id = histId_(r), out = [];
  if (n > 0) sh.getRange(2, 1, n, 5).getValues().forEach(v => { if (String(v[1]) === id) out.push({ at: String(v[0]), what: String(v[3]), by: String(v[4]) }); });
  if (!out.some(h => /^Booked|^Walk-in|^Imported/.test(h.what)) && r[BK.created])
    out.unshift({ at: String(r[BK.created]), what: r[BK.source] === 'FareHarbor' ? 'Imported from FareHarbor' : 'Booked · party of ' + r[BK.size], by: r[BK.source] === 'Website' ? 'Guest' : 'Staff' });
  return out.reverse();
}