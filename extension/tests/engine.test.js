// Extension engine regression test.
// Runs the generated extension engine headless (no browser) against a
// synthetic HAR that reproduces the cases fixed in the 2026-05 QA pass.
// Usage:  node extension/tests/engine.test.js   (after `python build/build.py`)
//
// Asserts:
//   - the generated engine is the real engine, not the stub
//   - first-party resolves and is excluded from third parties
//   - GPC is verified from Sec-GPC headers, not just reported
//   - the new registry entries detect (Ketch CMP, IAS, DoubleVerify, Media.net, Criteo)
//   - a CMP loading after trackers yields cmpStatus 'late' and Escalate
//   - the analysis + export JSON build without throwing

'use strict';
const fs = require('fs');
const path = require('path');

const ENGINE = path.resolve(__dirname, '..', 'engine.js');
if (!fs.existsSync(ENGINE)) {
  console.error('engine.js not found. Run `python build/build.py` first.');
  process.exit(2);
}

global.window = global;
// navigator is read-only in newer Node; define it defensively.
if (typeof navigator === 'undefined') {
  try { global.navigator = { globalPrivacyControl: false }; }
  catch (e) { Object.defineProperty(global, 'navigator', { value: { globalPrivacyControl: false }, configurable: true }); }
}
require(ENGINE);

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) failures++;
}

let _t = Date.parse('2026-06-10T12:00:00.000Z');
function entry(url, method, headers, respText, initiator, postBody) {
  _t += 250; // each request 250ms after the previous: gives the timeline real offsets
  const req = { url, method: method || 'GET', headers: headers || [] };
  if (postBody) req.postData = { mimeType: 'application/json', text: postBody };
  return {
    startedDateTime: new Date(_t).toISOString(),
    request: req,
    response: { status: 200, headers: [], content: { mimeType: respText ? 'application/javascript' : 'text/html', text: respText || '' } },
    time: 10,
    _initiator: initiator || undefined
  };
}
const gtmInitiator = { type: 'script', stack: { callFrames: [{ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST' }] } };

// CMP request is placed AFTER the trackers -> should be flagged 'late'.
const har = { log: { version: '1.2', pages: [{ id: 'p1', title: 'https://www.example.com/' }], entries: [
  entry('https://www.example.com/', 'GET', [{ name: 'Sec-GPC', value: '1' }]),
  entry('https://www.googletagmanager.com/gtm.js?id=GTM-TEST', 'GET'),
  entry('https://z.clarity.ms/collect', 'POST', [{ name: 'Sec-GPC', value: '1' }], '', gtmInitiator),
  entry('https://connect.facebook.net/en_US/fbevents.js', 'GET', [], '', gtmInitiator),
  entry('https://dt.adsafeprotected.com/x.js', 'GET'),
  entry('https://tps.doubleverify.com/x', 'GET'),
  entry('https://navvy.media.net/x', 'GET'),
  entry('https://gum.criteo.com/sync', 'GET'),
  entry('https://global.ketchcdn.com/web/v3/config.js', 'GET'),   // CMP, loads last
  entry('https://res.cloudinary.com/img.png', 'GET')
] } };

const E = window.HARStackEngine;
check('engine exposes analyzeHAR', E && typeof E.analyzeHAR === 'function');
check('engine is not the stub', E && E.__isStub === false);

let r;
try { r = E.analyzeHAR(har, { firstPartyDomain: 'www.example.com', gpcReported: true }); }
catch (e) { console.error('THREW:', e && e.stack || e); process.exit(1); }
const a = r.analysis;

check('first-party resolved to example.com', a.firstPartyDomain === 'example.com');
check('GPC verified from Sec-GPC header', a.gpcVerified === true);
check('export JSON built', !!r.json);

const names = [...a.trackers.values()].map(t => t.n.toLowerCase());
const has = q => names.some(n => n.includes(q));
check('Ketch CMP detected', has('ketch'));
check('Integral Ad Science detected', has('integral'));
check('DoubleVerify detected', has('doubleverify'));
check('Media.net detected', has('media.net'));
check('Criteo detected', has('criteo'));

check('CMP flagged as late (loaded after trackers)', a.cmpStatus === 'late');
check('outcome is Escalate', /escalat/i.test(a.outcome && a.outcome.bucket));

// ── 2026-06 additions: consent timeline, initiator chains, declared
//    consent, disclosure-gap prompt, attribution stamp ──────────────

const tl = a.consentTimeline;
check('consent timeline built', !!tl && Array.isArray(tl.events) && tl.events.length > 0);
check('consent timeline has real timestamps', !!tl && tl.hasTimestamps === true);
check('trackers recorded as firing before CMP', !!tl && tl.preCmp.length >= 4);
const tlFinding = a.findings.find(f => f.type === 'consent_timeline');
check('consent_timeline finding emitted', !!tlFinding);
check('consent_timeline finding is high severity', tlFinding && tlFinding.sev === 'high');
check('consent_timeline finding carries offsets', tlFinding && /\+\d+\.\d{2}s/.test(tlFinding.plain));

const clarity = [...a.trackers.values()].find(t => /clarity/i.test(t.n));
check('GTM-injected tracker attributed to gtm.js', !!clarity && /gtm\.js/.test(clarity.loadedBy || ''));
const trackerFinding = a.findings.find(f => f.type === 'tracker' && /clarity/i.test(f.title));
check('loadedBy flows into the tracker finding', !!trackerFinding && /googletagmanager\.com/.test(trackerFinding.loadedBy || ''));

check('analysis JSON carries consent_timeline', !!r.json && !!r.json.consent_timeline && r.json.consent_timeline.fired_before_cmp.length >= 4);
check('analysis JSON carries loaded_by', !!r.json && r.json.trackers.some(t => t.loaded_by));
check('analysis JSON carries attribution stamp', !!r.json && /harstack\.com/.test(r.json._meta.generated_by || ''));

// Declared consent (extension live context): denial on record + ad trackers fired
let r2;
try { r2 = E.analyzeHAR(JSON.parse(JSON.stringify(har)), { firstPartyDomain: 'www.example.com', gpcReported: true,
  live: { declaredConsent: { source: 'google_tag_data.ics', state: { ad_storage: 'denied', analytics_storage: 'denied' } } } }); }
catch (e) { console.error('THREW (live ctx):', e && e.stack || e); process.exit(1); }
const dcFinding = r2.analysis.findings.find(f => f.type === 'consent_declared' && /ad_storage/.test(f.title));
check('declared-consent mismatch finding emitted', !!dcFinding && dcFinding.sev === 'high');
check('declared consent state in analysis JSON', !!r2.json && !!r2.json.declared_consent_state);

// ── 2026-06 external review fixes: privacy-first analytics recognized,
//    Plausible /api/event not sGTM, authenticated capture warned, and the
//    no-CMP finding softened to "no recognized" ─────────────────────────

// A deliberately clean site: Plausible (self-hosted shape + hosted script),
// Supabase backend with auth refresh, logged-in session cookie, no CMP,
// no ad or session-replay trackers.
const har3 = { log: { version: '1.2', pages: [{ id: 'p1', title: 'https://app.cleansite.dev/' }], entries: [
  entry('https://app.cleansite.dev/', 'GET', [{ name: 'Cookie', value: 'sb-access-token=eyJx.y.z; theme=dark' }]),
  entry('https://plausible.io/js/script.js', 'GET'),
  entry('https://app.cleansite.dev/api/event', 'POST', [], '', null,
        JSON.stringify({ n: 'pageview', u: 'https://app.cleansite.dev/', d: 'app.cleansite.dev' })),
  entry('https://xyzcompany.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST',
        [{ name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.a.b' }]),
  entry('https://xyzcompany.supabase.co/rest/v1/items', 'GET',
        [{ name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.a.b' }]),
] } };

let r3;
try { r3 = E.analyzeHAR(har3, { firstPartyDomain: 'app.cleansite.dev', gpcReported: false }); }
catch (e) { console.error('THREW (clean site):', e && e.stack || e); process.exit(1); }
const a3 = r3.analysis;
const names3 = [...a3.trackers.values()].map(t => t.n);

check('Plausible identified', names3.some(n => /plausible/i.test(n)));
check('Plausible risk is ok', [...a3.trackers.values()].some(t => /plausible/i.test(t.n) && t.r === 'ok'));
check('Supabase identified as infrastructure', names3.some(n => /supabase/i.test(n)));
check('no unidentified third parties on the clean site', (a3.unidentifiedThirdParties || []).length === 0);
check('Plausible /api/event not flagged as sGTM', (a3.sgtmCandidates || []).length === 0);
const authF = a3.findings.find(f => f.type === 'capture_quality' && /authenticated session/i.test(f.title));
check('authenticated-capture warning emitted', !!authF && authF.sev === 'medium');
check('authenticated warning suggests private-window recapture', !!authF && /private or incognito/i.test(f2s(authF)));
const cmpF3 = a3.findings.find(f => f.type === 'cmp');
check('no-CMP finding says "recognized"', !!cmpF3 && /no recognized consent/i.test(cmpF3.title));
check('no-CMP finding softened to medium on quiet stack', !!cmpF3 && cmpF3.sev === 'medium');
check('no-CMP finding routes questions to engineering', !!cmpF3 && /engineering team/i.test(cmpF3.action || ''));
check('no-CMP finding still high with sale/sharing trackers', (function () {
  const f = a.findings.find(x => x.type === 'cmp');
  // main HAR has a CMP (Ketch), so verify via a copy without it
  const harNoCmp = JSON.parse(JSON.stringify(har));
  harNoCmp.log.entries = harNoCmp.log.entries.filter(e => !/ketchcdn/.test(e.request.url));
  const rr = E.analyzeHAR(harNoCmp, { firstPartyDomain: 'www.example.com', gpcReported: true });
  const cf = rr.analysis.findings.find(x => x.type === 'cmp');
  return !!cf && cf.sev === 'high' && /no recognized/i.test(cf.title);
})());
check('outcome regex still catches the retitled no-CMP finding',
  (a3.outcome.reasons || []).some(w => /no recognized consent management/i.test(w)));

function f2s(f) { return (f.plain || '') + ' ' + (f.action || ''); }

// ── Custom consent layer: no registry CMP, but consent artifacts present
//    (consent cookie + IAB US Privacy string on an ad tracker URL) ──────
const har4 = { log: { version: '1.2', pages: [{ id: 'p1', title: 'https://www.customconsent.example/' }], entries: [
  entry('https://www.customconsent.example/', 'GET', [{ name: 'Cookie', value: 'cookie_consent={"ads":false,"analytics":true}; theme=dark' }]),
  entry('https://www.customconsent.example/js/our-own-consent.js', 'GET'),
  entry('https://www.facebook.com/tr?id=123&us_privacy=1YNN', 'GET'),
] } };

let r4;
try { r4 = E.analyzeHAR(har4, { firstPartyDomain: 'www.customconsent.example', gpcReported: false }); }
catch (e) { console.error('THREW (custom consent):', e && e.stack || e); process.exit(1); }
const a4 = r4.analysis;
const cmpF4 = a4.findings.find(f => f.type === 'cmp');

check('cmpStatus is unrecognized with consent artifacts', a4.cmpStatus === 'unrecognized');
check('unrecognized-CMP finding emitted', !!cmpF4 && /Consent signals present, platform not recognized/.test(cmpF4.title));
check('unrecognized-CMP softened to medium despite ad tracker', !!cmpF4 && cmpF4.sev === 'medium');
check('finding cites the consent cookie', !!cmpF4 && /cookie_consent/.test(cmpF4.plain || ''));
check('finding cites the IAB privacy string', !!cmpF4 && /us_privacy/.test(cmpF4.plain || ''));
check('finding suggests the two-capture enforcement test', !!cmpF4 && /consent declined and once accepted/i.test(cmpF4.action || ''));
check('unrecognized CMP does not add the no-CMP review reason',
  !(a4.outcome.reasons || []).some(w => /no recognized consent management/i.test(w)));

// ── CMP detected by cookie signature when its script is not in the
//    capture (cached script / late capture start). Modeled on a real
//    Osano site whose capture held only the CMP's cookies ──────────────
const har6 = { log: { version: '1.2', pages: [{ id: 'p1', title: 'https://www.cachedcmp.example/' }], entries: [
  entry('https://www.cachedcmp.example/', 'GET',
        [{ name: 'Cookie', value: 'osano_consentmanager_uuid=abc-123; osano_consentmanager=base64stuff; other=1' }]),
  entry('https://bat.bing.com/bat.js', 'GET'),
  entry('https://e.clarity.ms/collect', 'POST'),
] } };

let r6;
try { r6 = E.analyzeHAR(har6, { firstPartyDomain: 'www.cachedcmp.example', gpcReported: false }); }
catch (e) { console.error('THREW (cached cmp):', e && e.stack || e); process.exit(1); }
const cmpF6 = r6.analysis.findings.find(f => f.type === 'cmp');
check('cmpStatus is cookie_only for cached CMP', r6.analysis.cmpStatus === 'cookie_only');
check('CMP named from cookie signature (Osano)', !!cmpF6 && /Osano/.test(cmpF6.title));
check('cookie_only finding is low severity', !!cmpF6 && cmpF6.sev === 'low');
check('cookie_only finding says script not in capture', !!cmpF6 && /script not in capture/i.test(cmpF6.title));
check('cookie_only recommends full-load recapture', !!cmpF6 && /Reload & Capture|full page load/i.test(cmpF6.action || ''));
check('cmpNames carries the cookie-detected vendor', (r6.analysis.cmpNames || []).indexOf('Osano') > -1);

// generic consent cookie (har4) must NOT be vendor-attributed
check('generic consent cookie stays unrecognized, not cookie_only', a4.cmpStatus === 'unrecognized');

// ── Operator-related: same brand label on a different TLD (cnn.com vs
//    cnn.io) must classify as operator-related, not unidentified ────────
const har7 = { log: { version: '1.2', pages: [{ id: 'p1', title: 'https://www.cnn.com/' }], entries: [
  entry('https://www.cnn.com/', 'GET'),
  entry('https://registry.api.cnn.io/v1/reg', 'GET'),
] } };
const r7 = E.analyzeHAR(har7, { firstPartyDomain: 'www.cnn.com', gpcReported: false });
check('same-label different-TLD domain is operator-related',
  (r7.analysis.operatorRelatedDomains || []).some(d => /cnn\.io/.test(d.domain)));
check('operator-related domain kept out of unidentified list',
  !(r7.analysis.unidentifiedThirdParties || []).some(d => /cnn\.io/.test(d.domain)));

// Live-page consent APIs alone (extension probe) also flip the status
const har5 = JSON.parse(JSON.stringify(har3));
const r5 = E.analyzeHAR(har5, { firstPartyDomain: 'app.cleansite.dev', gpcReported: false,
  live: { consentApis: ['__uspapi (IAB US Privacy)'] } });
check('live IAB API probe alone yields unrecognized status', r5.analysis.cmpStatus === 'unrecognized');
check('live API named in the finding', (r5.analysis.findings.find(f => f.type === 'cmp') || {}).plain.indexOf('__uspapi') > -1);

// Disclosure-gap prompt block (re-run the primary HAR so prompt state
// reflects the main analysis, not the clean-site one)
E.analyzeHAR(JSON.parse(JSON.stringify(har)), { firstPartyDomain: 'www.example.com', gpcReported: true });
const prompt = E.buildPrompt('example.com');
check('buildPrompt exposed and returns text', typeof prompt === 'string' && prompt.length > 1000);
check('prompt contains policy paste markers', prompt.includes('BEGIN PRIVACY POLICY') && prompt.includes('END PRIVACY POLICY'));
check('prompt asks for candidate disclosure gaps', /CANDIDATE DISCLOSURE GAPS/.test(prompt));
check('prompt frames output as investigative lead', /investigative lead, not legal advice/.test(prompt));
check('prompt carries attribution stamp', /harstack\.com/.test(prompt));
check('engine exposes attribution constant', typeof E.attribution === 'string' && /harstack\.com/.test(E.attribution));

console.log('\n' + (failures ? (failures + ' FAILED') : 'All extension engine checks passed.'));
process.exit(failures ? 1 : 0);
