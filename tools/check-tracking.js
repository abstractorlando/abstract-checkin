/* Guard for the booking page's Google Ads / GA4 / Meta tracking.
 * Runs on every push (GitHub Actions) and before every publish from Claude.
 * If it fails, the change would break ad tracking: fix book.html (or funnel-tracking.js) before going live.
 *   node tools/check-tracking.js            (from the repo folder)
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const book = fs.readFileSync(path.join(root, 'book.html'), 'utf8');
const ft = fs.readFileSync(path.join(root, 'funnel-tracking.js'), 'utf8');
const fails = [];
const need = (ok, what) => { if (!ok) fails.push(what); };

// 1. the funnel tracker is loaded (this line was lost once, on Nov 13 2026, and the bk_ funnel went blank for 11 days)
need(/<script src="funnel-tracking\.js"><\/script>/.test(book), 'book.html must load funnel-tracking.js (<script src="funnel-tracking.js"></script> before </body>)');
// 2. bookings reach Google Ads (purchase, imported from GA4), GA4 and Meta, opened on its own or inside the website
need(/GA4_ID\s*=\s*'G-HWWX6TQXWG'/.test(book), "GA4 id G-HWWX6TQXWG is missing from book.html");
need(/META_PIXEL\s*=\s*'917533327429371'/.test(book), 'Meta Pixel 917533327429371 is missing from book.html');
need(/gtag\('event',\s*'purchase'/.test(book), "the GA4 'purchase' event (what Google Ads counts as a booking) is missing");
need(/gtag\('event',\s*'begin_checkout'/.test(book), "the GA4 'begin_checkout' event is missing");
need(/track\('checkout',/.test(book), "track('checkout', …) is no longer called");
need(/track\('booked',/.test(book), "track('booked', …) is no longer called (no booking would be reported)");
need(/postMessage\(\{ao:'track'/.test(book), "inside the website, events must go to the page above with postMessage({ao:'track', …})");
need(/transaction_id:\s*d\.id/.test(book), 'purchase must carry transaction_id (stops double counting)');
// 3. every element the funnel tracker watches still exists (renaming one silently kills that step)
const ids = new Set();
for (const m of ft.matchAll(/\bg\('([A-Za-z0-9_-]+)'\)/g)) ids.add(m[1]);
for (const m of ft.matchAll(/'#([A-Za-z][A-Za-z0-9_-]*)/g)) ids.add(m[1]);
for (const m of ft.matchAll(/\[\s*('[A-Za-z0-9_-]+'(?:\s*,\s*'[A-Za-z0-9_-]+')*)\s*\]\.forEach\(function \(id\)/g)) m[1].replace(/'([^']+)'/g, (_, x) => ids.add(x));
for (const m of ft.matchAll(/\.id === '([A-Za-z0-9_-]+)'/g)) ids.add(m[1]);
const fm = /var FIELD = \{([^}]*)\}/.exec(ft); if (fm) for (const m of fm[1].matchAll(/([A-Za-z0-9_]+)\s*:/g)) ids.add(m[1]);
const optional = new Set(['payCard', 'days', 'first', 'last', 'cc']);   // old form's elements, watched only if present
for (const id of ids) {
  if (optional.has(id)) continue;
  need(new RegExp(`id=["']${id}["']|id=${id}[\\s>]|\\$\\('${id}'\\)|getElementById\\('${id}'\\)`).test(book), `element #${id} (watched by funnel-tracking.js) is missing from book.html`);
}
if (fails.length) { console.error('TRACKING CHECK FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log(`Tracking check passed (${ids.size} watched elements, purchase/begin_checkout/Meta/funnel all present).`);
