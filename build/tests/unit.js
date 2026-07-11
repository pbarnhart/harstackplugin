// Unit tests for analysis utility functions (no HAR fixtures required)
// Usage: node build/tests/unit.js   (from repo root)
'use strict';
const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const REPO    = path.resolve(__dirname, '..', '..');
const CLASSIC = path.join(REPO, 'harstack.html');

// ── Context loader (same pattern as validate.js) ─────────────────────────────
function extractScript(html) {
  const open  = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  return html.slice(open + '<script>'.length, close);
}

function loadCtx(htmlPath) {
  const noop = () => ({
    addEventListener: () => {}, classList: { add: () => {}, remove: () => {} },
    style: {}, disabled: false, textContent: '',
  });
  const ctx = {
    document: {
      getElementById: () => noop(), querySelector: () => noop(),
      querySelectorAll: () => [], createElement: () => noop(),
      createElementNS: () => noop(), body: noop(), addEventListener: () => {},
    },
    window: {}, navigator: {}, location: { href: '' }, alert: () => {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL, URLSearchParams, Math, JSON, parseInt, parseFloat,
    isNaN, isFinite, Array, Object, Map, Set, Promise, RegExp,
    String, Number, Boolean, Date,
    har: null, gpc: null, bizCtx: { revenue: null, consumers: null },
  };
  ctx.window = ctx;
  const html   = fs.readFileSync(htmlPath, 'utf8');
  const script = extractScript(html);
  vm.runInContext(script, vm.createContext(ctx),
    { filename: path.basename(htmlPath), timeout: 30000 });
  return ctx;
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function ok(label, actual, expected) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed++;
  } else {
    process.stdout.write(`  FAIL  ${label}\n`);
    process.stdout.write(`        expected: ${JSON.stringify(expected)}\n`);
    process.stdout.write(`        got:      ${JSON.stringify(actual)}\n`);
    failed++;
  }
}

function okTruthy(label, value) {
  if (value) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed++;
  } else {
    process.stdout.write(`  FAIL  ${label} (falsy: ${JSON.stringify(value)})\n`);
    failed++;
  }
}

// ── Load context once ─────────────────────────────────────────────────────────
process.stdout.write('Loading classic output...\n');
const C = loadCtx(CLASSIC);

// ── getRegistrableDomain ──────────────────────────────────────────────────────
process.stdout.write('\ngetRegistrableDomain\n');
ok('plain domain',              C.getRegistrableDomain('example.com'),           'example.com');
ok('subdomain stripped',        C.getRegistrableDomain('sub.example.com'),        'example.com');
ok('www stripped',              C.getRegistrableDomain('www.example.com'),        'example.com');
ok('deep subdomain',            C.getRegistrableDomain('a.b.c.example.com'),      'example.com');
ok('co.uk multi-part TLD',      C.getRegistrableDomain('sub.example.co.uk'),      'example.co.uk');
ok('com.au multi-part TLD',     C.getRegistrableDomain('shop.brand.com.au'),      'brand.com.au');
ok('leading dot stripped',      C.getRegistrableDomain('.example.com'),           'example.com');
ok('null input',                C.getRegistrableDomain(null),                     null);
ok('empty string',              C.getRegistrableDomain(''),                       null);
ok('single label',              C.getRegistrableDomain('localhost'),              'localhost');
ok('uppercase normalised',      C.getRegistrableDomain('Example.COM'),            'example.com');

// ── resolveGPCStatus ─────────────────────────────────────────────────────────
process.stdout.write('\nresolveGPCStatus\n');
ok('verified overrides reported=true',  C.resolveGPCStatus(true,  true),  'verified');
ok('verified overrides reported=false', C.resolveGPCStatus(false, true),  'verified');
ok('reported=true, not verified',       C.resolveGPCStatus(true,  false), 'reported_only');
ok('reported=false, not verified',      C.resolveGPCStatus(false, false), 'not_observed');
ok('reported=null, not verified',       C.resolveGPCStatus(null,  false), 'unknown');
ok('reported=undefined, not verified',  C.resolveGPCStatus(undefined, false), 'unknown');

// ── detectGPCFromHAR ─────────────────────────────────────────────────────────
process.stdout.write('\ndetectGPCFromHAR\n');
const harWithGPC = { log: { entries: [
  { request: { headers: [{ name: 'sec-gpc', value: '1' }] } },
]}};
const harWithoutGPC = { log: { entries: [
  { request: { headers: [{ name: 'accept', value: '*/*' }] } },
]}};
const harGPCZero = { log: { entries: [
  { request: { headers: [{ name: 'Sec-GPC', value: '0' }] } },
]}};
ok('Sec-GPC: 1 detected',      C.detectGPCFromHAR(harWithGPC),    true);
ok('Sec-GPC: 0 not GPC',       C.detectGPCFromHAR(harGPCZero),    false);
ok('no header → false',        C.detectGPCFromHAR(harWithoutGPC), false);
ok('empty HAR → false',        C.detectGPCFromHAR({ log: { entries: [] } }), false);
ok('null HAR → false',         C.detectGPCFromHAR(null),          false);

// ── looksLikeSensitiveValue ──────────────────────────────────────────────────
process.stdout.write('\nlooksLikeSensitiveValue\n');
ok('MD5 hex (32 chars)',            C.looksLikeSensitiveValue('x', 'a'.repeat(32)),           true);
ok('UUID',                          C.looksLikeSensitiveValue('x', '550e8400-e29b-41d4-a716-446655440000'), true);
ok('short value → false',          C.looksLikeSensitiveValue('x', 'abc'),                    false);
ok('empty value → false',          C.looksLikeSensitiveValue('x', ''),                      false);
ok('null value → false',           C.looksLikeSensitiveValue('x', null),                    false);
ok('IPv4 address',                 C.looksLikeSensitiveValue('x', '192.168.1.100'),          true);
ok('plain word → false',           C.looksLikeSensitiveValue('x', 'helloworld'),             false);
ok('id field + long value',        C.looksLikeSensitiveValue('uid', 'abc123xyz000'),         true);
ok('id field + short value→false', C.looksLikeSensitiveValue('uid', 'abc'),                 false);
ok('AQ bearer token prefix',       C.looksLikeSensitiveValue('x', 'AQ' + 'A'.repeat(22)),   true);

// ── computeOutcome ────────────────────────────────────────────────────────────
process.stdout.write('\ncomputeOutcome\n');

function makeA(opts = {}) {
  const { trackers: _t, unknowns: _u, ...rest } = opts;
  return {
    trackers:                 new Map(_t || []),
    unidentifiedThirdParties: _u || [],
    cmpStatus:                opts.cmpStatus || 'none',
    ...rest,
  };
}

// Escalate: session replay
const srFindings = [{ type: 'sr', sev: 'high', title: 'Session replay detected', regs: [] }];
ok('SR → Escalate bucket',
  C.computeOutcome(srFindings, makeA()).bucket, 'Escalate');

// Escalate: GPC violation
const gpcFindings = [{ type: 'gpc', sev: 'high', title: 'GPC was verified active in HAR and sale/sharing trackers still fired.', regs: [] }];
ok('GPC violation → Escalate bucket',
  C.computeOutcome(gpcFindings, makeA()).bucket, 'Escalate');

// Escalate: CMP late
const cmpLateFindings = [{ type: 'cmp', sev: 'high', title: 'CMP loaded after tracking scripts', regs: [] }];
ok('CMP late → Escalate bucket',
  C.computeOutcome(cmpLateFindings, makeA()).bucket, 'Escalate');

// Escalate: raw PII to third party
const piiFindings = [{ type: 'thirdparty-pii', sev: 'high', title: 'Raw PII', regs: [] }];
ok('3P raw PII → Escalate bucket',
  C.computeOutcome(piiFindings, makeA()).bucket, 'Escalate');

// Needs Review: sharing tracker only
const sharingA = makeA({ trackers: [['facebook.com/tr', { cc: 'a', n: 'Meta Pixel', cat: 'Advertising' }]] });
ok('Advertising tracker only → Needs Review',
  C.computeOutcome([], sharingA).bucket, 'Needs Review');

// Needs Review: no CMP
const noCMPFindings = [{ type: 'cmp', sev: 'medium', title: 'No consent management platform detected.', regs: [] }];
ok('No CMP → Needs Review',
  C.computeOutcome(noCMPFindings, makeA()).bucket, 'Needs Review');

// Likely OK: no trackers, no findings
ok('No findings, no trackers → Likely OK',
  C.computeOutcome([], makeA()).bucket, 'Likely OK');

// Escalate sev is 'high'
ok('Escalate sev=high',
  C.computeOutcome(srFindings, makeA()).sev, 'high');

// Needs Review sev is 'medium'
ok('Needs Review sev=medium',
  C.computeOutcome([], sharingA).sev, 'medium');

// Likely OK sev is 'low'
ok('Likely OK sev=low',
  C.computeOutcome([], makeA()).sev, 'low');

// ── annotateFinding ───────────────────────────────────────────────────────────
process.stdout.write('\nannotateFinding\n');

function annotate(type, title = 'test', cat = '') {
  return C.annotateFinding({ type, title, cat, sev: 'high', regs: [] });
}

ok('SR finding → needs_legal_review',
  annotate('sr').confidence, 'needs_legal_review');
ok('Advertising tracker → Tag manager owner in sendTo',
  annotate('tracker', 'test', 'Advertising').send_to.includes('Tag manager owner'), true);
ok('Session Replay tracker → Legal in sendTo',
  annotate('tracker', 'test', 'Session Replay').send_to.includes('Legal'), true);
ok('CDP tracker → Data engineering in sendTo',
  annotate('tracker', 'test', 'CDP').send_to.includes('Data engineering'), true);
ok('GPC no-CMP title → Capture owner in sendTo',
  annotate('gpc', 'GPC not tested').send_to.some(s => s.includes('Capture owner')), true);
ok('GPC analytics-fired → needs_legal_review',
  annotate('gpc', 'Analytics fired with verified GPC active').confidence, 'needs_legal_review');

// ── Summary ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${'='.repeat(60)}\n`);
process.stdout.write(`Summary: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
