// HAR validation: both outputs against all seven fixtures
// Runs analysis functions directly in Node.js (no browser required)
// Usage: node build/tests/validate.js   (from repo root)

'use strict';
const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const REPO     = path.resolve(__dirname, '..', '..');
const CLASSIC  = path.join(REPO, 'harstack.html');
const WIZARD   = path.join(REPO, 'tool', 'index.html');
const FIXTURES = path.join(__dirname, 'fixtures');

// Per-output expected outcome buckets.
// classic and wizard can differ when wizard-injected trackers change the outcome.
// Stiles Switch BBQ: basic Google stack, no session replay in either build → Needs Review.
// Northwest Registered Agent (non-GPC): wizard detects Matomo HSR (session replay, wizard-injected) → Escalate;
//   classic does not detect session replay there → Needs Review.
const HARS = [
  { file: 'oldetownepetresort.com.har',              label: 'Olde Towne Pet Resort',         classicBucket: 'Escalate',    wizardBucket: 'Escalate' },
  { file: 'stilesswitchbbq.com.har',                 label: 'Stiles Switch BBQ',             classicBucket: 'Needs Review', wizardBucket: 'Needs Review' },
  { file: 'www.legalzoom.comwithoutpermissions.har', label: 'LegalZoom (no permissions)',    classicBucket: 'Escalate',    wizardBucket: 'Escalate' },
  { file: 'www.northwestregisteredagent.com.har',    label: 'Northwest Registered Agent',    classicBucket: 'Needs Review', wizardBucket: 'Escalate' },
  { file: 'www.northwestregisteredagent.comgpc.har', label: 'Northwest (GPC)',               classicBucket: 'Escalate',    wizardBucket: 'Escalate' },
  { file: 'www.rover.com.har',                       label: 'Rover',                         classicBucket: 'Escalate',    wizardBucket: 'Escalate' },
  { file: 'corp-registration-site.har',              label: 'Corp Registration Site (main)',  classicBucket: 'Escalate',    wizardBucket: 'Escalate' },
  { file: 'corp-registration-site-orders.har',       label: 'Corp Registration Site (orders)', classicBucket: 'Escalate',    wizardBucket: 'Escalate' },
  { file: 'usa-llc-filing.com.har',                  label: 'USA LLC Filing',                 classicBucket: 'Escalate',    wizardBucket: 'Escalate' },
];

// Domains injected only in the wizard build.
// Classic tracker URLs should not contain any of these.
const WIZARD_ONLY_DOMAINS = [
  'bzrcdn.openai.com',
  'stackadapt.com',
  'inspectlet.com',
  'humanz.com',
  'ketchcdn.com',
  'spotapps.co',
];

// Extract the first <script>...</script> block from an HTML file
function extractScript(html) {
  const open  = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  if (open < 0 || close < 0) throw new Error('No <script> block found');
  return html.slice(open + '<script>'.length, close);
}

// Build a minimal VM context sufficient for the analysis functions.
// The script block also contains DOM-setup lines (addEventListener, getElementById)
// that run at module level. We stub those so they silently no-op.
function makeContext() {
  const noop   = () => ({
    addEventListener: () => {},
    classList: { add: () => {}, remove: () => {} },
    style: {},
    disabled: false,
    textContent: '',
  });
  const ctx = {
    // DOM stubs (only needed so module-level setup code doesn't throw)
    document: {
      getElementById:        () => noop(),
      querySelector:         () => noop(),
      querySelectorAll:      () => [],
      createElement:         () => noop(),
      createElementNS:       () => noop(),
      body:                  noop(),
      addEventListener:      () => {},
    },
    window:    {},
    navigator: {},
    location:  { href: '' },
    alert:     () => {},
    console:   { log: () => {}, warn: () => {}, error: () => {} },
    // Standard globals the analysis code uses
    URL,
    URLSearchParams,
    Math,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Array,
    Object,
    Map,
    Set,
    Promise,
    RegExp,
    String,
    Number,
    Boolean,
    Date,
    // Page-level globals with neutral defaults
    har: null,
    gpc: null,
    bizCtx: { revenue: null, consumers: null },
  };
  ctx.window = ctx;  // many files reference window.xxx
  return vm.createContext(ctx);
}

// Load an HTML output file into a fresh VM context and return the context
// (which now has analyzeHAR, computeOutcome, etc. as properties).
function loadOutput(htmlPath) {
  const html   = fs.readFileSync(htmlPath, 'utf8');
  const script = extractScript(html);
  const ctx    = makeContext();
  vm.runInContext(script, ctx, { filename: path.basename(htmlPath), timeout: 30000 });
  if (typeof ctx.analyzeHAR !== 'function')   throw new Error(`analyzeHAR not found in ${htmlPath}`);
  if (typeof ctx.computeOutcome !== 'function') throw new Error(`computeOutcome not found in ${htmlPath}`);
  return ctx;
}

function pad(s, n) { return String(s).padEnd(n); }

function runHar(ctx, harJson) {
  try {
    ctx.har  = JSON.parse(harJson);
    ctx.gpc  = null;
    const a  = ctx.analyzeHAR(ctx.har, null);
    const out = ctx.computeOutcome(a.findings, a);
    return {
      ok: true,
      bucket:       out.bucket,
      trackerCount: a.trackers.size,
      trackerNames: [...a.trackers.keys()],
      trackerUrls:  [...a.trackers.values()].map(t => t.url || ''),
      cmpStatus:    a.cmpStatus,
      cmpNames:     a.cmpNames || [],
      highCount:    a.findings.filter(f => f.sev === 'high').length,
      medCount:     a.findings.filter(f => f.sev === 'medium').length,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function main() {
  let passes = 0, failures = 0;
  const failLog = [];

  const outputs = [
    { name: 'classic', path: CLASSIC },
    { name: 'wizard',  path: WIZARD  },
  ];

  const allResults = {};  // [output.name][har.file] → result

  for (const output of outputs) {
    allResults[output.name] = {};

    let ctx;
    try {
      ctx = loadOutput(output.path);
    } catch (e) {
      console.error(`\nFATAL: could not load ${output.path}: ${e.message}`);
      failures++;
      failLog.push(`${output.name}: load failed: ${e.message}`);
      continue;
    }

    console.log(`\n${'='.repeat(72)}`);
    console.log(`Output: ${output.name.toUpperCase()}  (${path.basename(output.path)})`);
    console.log('='.repeat(72));
    console.log(pad('HAR', 40) + pad('Bucket', 16) + pad('Trk', 5) + 'CMP');

    for (const har of HARS) {
      const harPath = path.join(FIXTURES, har.file);
      if (!fs.existsSync(harPath)) {
        console.log(`  SKIP  ${har.label}: fixture not found`);
        continue;
      }

      const harJson    = fs.readFileSync(harPath, 'utf8');
      const r          = runHar(ctx, harJson);
      allResults[output.name][har.file] = r;

      if (!r.ok) {
        console.log(`  FAIL  ${pad(har.label, 38)} error: ${r.error}`);
        failures++;
        failLog.push(`${output.name} / ${har.label}: ${r.error}`);
        continue;
      }

      const expectedBucket = output.name === 'wizard' ? har.wizardBucket : har.classicBucket;
      const bucketOk = r.bucket === expectedBucket;
      const cmpStr   = r.cmpStatus === 'none'
        ? 'none'
        : `${r.cmpStatus}(${r.cmpNames.join(',')})`;

      console.log(`  ${bucketOk ? 'PASS' : 'FAIL'}  ${pad(har.label, 38)} ${pad(r.bucket, 16)} ${pad(r.trackerCount, 5)} ${cmpStr}`);

      if (bucketOk) { passes++; } else {
        failures++;
        failLog.push(`${output.name} / ${har.label}: expected ${expectedBucket}, got ${r.bucket}`);
      }
    }
  }

  // Cross-output: wizard tracker count >= classic per HAR
  console.log(`\n${'='.repeat(72)}`);
  console.log('Cross-output: wizard tracker count >= classic');
  console.log('='.repeat(72));
  for (const har of HARS) {
    const c = allResults['classic']?.[har.file];
    const w = allResults['wizard']?.[har.file];
    if (!c?.ok || !w?.ok) {
      console.log(`  SKIP  ${har.label}: missing result`);
      continue;
    }
    const ok   = w.trackerCount >= c.trackerCount;
    const diff = w.trackerCount - c.trackerCount;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${pad(har.label, 38)} classic=${c.trackerCount}  wizard=${w.trackerCount} (${diff >= 0 ? '+' : ''}${diff})`);
    if (ok) { passes++; } else {
      failures++;
      failLog.push(`cross / ${har.label}: wizard (${w.trackerCount}) < classic (${c.trackerCount})`);
    }
  }

  // Isolation: classic must not detect wizard-only injected domains
  console.log(`\n${'='.repeat(72)}`);
  console.log('Isolation: wizard-injected domains absent from classic results');
  console.log('='.repeat(72));
  for (const har of HARS) {
    const c = allResults['classic']?.[har.file];
    if (!c?.ok) { console.log(`  SKIP  ${har.label}: no classic result`); continue; }
    const leaked = WIZARD_ONLY_DOMAINS.filter(d => c.trackerUrls.some(u => u.includes(d)));
    const ok     = leaked.length === 0;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${pad(har.label, 38)} ${ok ? 'clean' : 'LEAKED: ' + leaked.join(', ')}`);
    if (ok) { passes++; } else {
      failures++;
      failLog.push(`isolation / ${har.label}: wizard domain(s) in classic: ${leaked.join(', ')}`);
    }
  }

  // Per-HAR tracker detail (informational, always printed)
  console.log(`\n${'='.repeat(72)}`);
  console.log('Tracker detail by HAR');
  console.log('='.repeat(72));
  for (const har of HARS) {
    const c = allResults['classic']?.[har.file];
    const w = allResults['wizard']?.[har.file];
    if (!c?.ok && !w?.ok) continue;
    console.log(`\n  ${har.label}`);
    if (c?.ok) console.log(`    classic (${c.trackerCount}): ${c.trackerNames.join(', ') || 'none'}`);
    if (w?.ok) {
      const wizardOnly = w.trackerNames.filter(n => !(c?.trackerNames || []).includes(n));
      console.log(`    wizard  (${w.trackerCount}): ${w.trackerNames.join(', ') || 'none'}`);
      if (wizardOnly.length) console.log(`    wizard-only additions: ${wizardOnly.join(', ')}`);
    }
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`Summary: ${passes} passed, ${failures} failed`);
  if (failLog.length > 0) {
    console.log('\nFailures:');
    failLog.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('All checks passed.');
    process.exit(0);
  }
}

main();
