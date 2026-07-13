/* ============================================================
   HARstack extension panel
   ------------------------------------------------------------
   Captures live traffic via the DevTools network API (no
   permissions at all: no host access, no webRequest, no debugger,
   no storage), assembles a HAR, and hands it to the real engine
   in engine.js:

       window.HARStackEngine.analyzeHAR(har, {
         firstPartyDomain, gpcReported,
         live: { declaredConsent, dataLayerEvents }
       }) -> { analysis, json }

   The renderer consumes the engine's native analysis object
   (findings use .sev/.regs[]/.send_to[]; trackers and domains
   are Maps; outcome is { bucket, sev, reasons, action }).
   ============================================================ */

const api = (typeof browser !== "undefined") ? browser : chrome;
const IS_FIREFOX = (typeof browser !== "undefined");

const GITHUB_REPO = "https://github.com/pbarnhart/harstackplugin";

const state = {
  entries: [], lastHar: null, lastAnalysis: null, lastJson: null,
  lastSite: "", filterQ: "", filterSev: new Set(), debugView: false
};

/* ---------- theme: follow DevTools ---------- */

function initTheme() {
  let dark = false;
  try { dark = api.devtools && api.devtools.panels && api.devtools.panels.themeName === "dark"; } catch (e) {}
  if (!dark) {
    try { dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
  }
  document.documentElement.classList.toggle("dark", !!dark);
}

/* ---------- capture ---------- */

api.devtools.network.onRequestFinished.addListener(function (entry) {
  state.entries.push(entry);
  setCaptureState("recording", state.entries.length);
});
api.devtools.network.onNavigated.addListener(function () {
  state.entries = [];
  setCaptureState("recording", 0);
});

function setCaptureState(mode, count) {
  const el = document.getElementById("captureState");
  if (!el) return;
  if (mode === "recording") { el.className = "capture-state live"; el.innerHTML = "&#9679; Capturing &middot; " + count + " requests"; }
  else if (mode === "working") { el.className = "capture-state working"; el.innerHTML = "&#9679; Reading bodies…"; }
  else { el.className = "capture-state idle"; el.innerHTML = "&#9679; Idle"; }
}

function getEntryContent(entry) {
  return new Promise(function (resolve) {
    let settled = false;
    const done = function (c, enc) { if (settled) return; settled = true; resolve({ text: c || "", encoding: enc || "" }); };
    try {
      const maybe = entry.getContent(function (c, enc) { done(c, enc); });
      if (maybe && typeof maybe.then === "function") {
        maybe.then(function (v) { Array.isArray(v) ? done(v[0], v[1]) : done(v, ""); }).catch(function () { done("", ""); });
      }
    } catch (e) { done("", ""); }
    setTimeout(function () { done("", ""); }, 5000);
  });
}

/* Read page context from the inspected window: hostname, GPC flag, and the
   declared consent state. Google Consent Mode is read from
   google_tag_data.ics when present, falling back to gtag consent commands
   in the dataLayer. Everything is best-effort and degrades to null. The
   expression runs in the page and returns a JSON string; nothing is
   injected or persisted. */
function readPageContext() {
  return new Promise(function (resolve) {
    const EMPTY = { host: "", href: "", gpc: false, consent: null, dlEvents: null, consentApis: [] };
    const expr =
      "(function(){try{" +
      "var o={host:location.hostname,href:location.href," +
      "gpc:(typeof navigator!=='undefined'&&navigator.globalPrivacyControl===true)," +
      "consent:null,dlEvents:null};" +
      "try{var g=window.google_tag_data;" +
      "if(g&&g.ics&&g.ics.entries){var st={},en=g.ics.entries,any=false;" +
      "for(var k in en){var e2=en[k];var v=(e2&&e2.update!==undefined)?e2.update:(e2?e2['default']:undefined);" +
      "if(v!==undefined){st[k]=v?'granted':'denied';any=true;}}" +
      "if(any)o.consent={source:'google_tag_data.ics',state:st};}}catch(e){}" +
      "try{if(!o.consent&&Array.isArray(window.dataLayer)){var st2={},hit=false;" +
      "window.dataLayer.forEach(function(m){try{" +
      "var arr=(m&&typeof m!=='string'&&typeof m.length==='number')?Array.prototype.slice.call(m):null;" +
      "if(arr&&arr[0]==='consent'&&(arr[1]==='default'||arr[1]==='update')&&arr[2]){" +
      "for(var k3 in arr[2]){st2[k3]=String(arr[2][k3]);hit=true;}}}catch(e){}});" +
      "if(hit)o.consent={source:'dataLayer consent commands',state:st2};}}catch(e){}" +
      "try{if(Array.isArray(window.dataLayer)){" +
      "o.dlEvents=window.dataLayer.map(function(m){return(m&&m.event)?String(m.event):null;})" +
      ".filter(function(x){return!!x;}).slice(0,50);}}catch(e){}" +
      // IAB consent APIs: standardized surfaces even under custom CMPs.
      "try{o.consentApis=[];" +
      "if(typeof window.__tcfapi==='function')o.consentApis.push('__tcfapi (IAB TCF)');" +
      "if(typeof window.__uspapi==='function')o.consentApis.push('__uspapi (IAB US Privacy)');" +
      "if(typeof window.__gpp==='function')o.consentApis.push('__gpp (IAB GPP)');}catch(e){}" +
      "return JSON.stringify(o);}catch(e){return JSON.stringify({host:'',href:'',gpc:false,consent:null,dlEvents:null,consentApis:[]});}})()";
    try {
      api.devtools.inspectedWindow.eval(expr, function (result, err) {
        if (err || !result) { resolve(EMPTY); return; }
        try { resolve(JSON.parse(result)); }
        catch (e) { resolve(EMPTY); }
      });
    } catch (e) { resolve(EMPTY); }
  });
}

function seedFromGetHAR() {
  return new Promise(function (resolve) {
    try { api.devtools.network.getHAR(function (h) { resolve((h && h.entries) ? h.entries : []); }); }
    catch (e) { resolve([]); }
  });
}

function stripFns(obj) { const o = {}; for (const k in obj) { if (typeof obj[k] !== "function") o[k] = obj[k]; } return o; }

/* ---------- assemble + analyze ---------- */

function attribution() {
  return (window.HARStackEngine && window.HARStackEngine.attribution) ||
    "Generated by HARstack (harstack.com). A Pixel and Policy project.";
}

async function analyze() {
  setCaptureState("working");
  const ctx = await readPageContext();
  state.lastSite = ctx.host || "";

  let liveEntries = state.entries.slice();
  if (liveEntries.length === 0) liveEntries = await seedFromGetHAR();

  const filled = await Promise.all(liveEntries.map(async function (entry) {
    // stripFns + JSON round-trip preserves _initiator, which powers the
    // loaded-by attribution on tracker findings (Chrome; Firefox omits it).
    const e = JSON.parse(JSON.stringify(stripFns(entry)));
    if (typeof entry.getContent === "function") {
      const body = await getEntryContent(entry);
      e.response = e.response || {}; e.response.content = e.response.content || {};
      e.response.content.text = body.text;
      if (body.encoding) e.response.content.encoding = body.encoding;
    }
    return e;
  }));

  const har = {
    log: {
      version: "1.2",
      creator: { name: "HARstack Extension (harstack.com)", version: "4.0", comment: attribution() },
      pages: [{ startedDateTime: new Date().toISOString(), id: "page_1", title: ctx.href || ctx.host || "", pageTimings: {} }],
      entries: filled
    }
  };
  state.lastHar = har;

  let result;
  try {
    result = window.HARStackEngine.analyzeHAR(har, {
      firstPartyDomain: ctx.host || "",
      gpcReported: !!ctx.gpc,
      live: { declaredConsent: ctx.consent || null, dataLayerEvents: ctx.dlEvents || null, consentApis: ctx.consentApis || [] }
    });
  } catch (e) { renderError(e); setCaptureState("recording", state.entries.length); return; }

  state.lastAnalysis = result.analysis;
  state.lastAnalysis._dataLayerEvents = ctx.dlEvents || null;
  state.lastJson = result.json;
  renderReport(result.analysis);
  enableExports(true);
  showToolbar(true);
  applyDebugView();
  applyFilters();
  setCaptureState("recording", state.entries.length);
}

/* ---------- render (native engine shape) ---------- */

const SEV_ORDER = { high: 0, medium: 1, low: 2, info: 3, ok: 4 };

function renderError(e) {
  document.getElementById("report").innerHTML =
    '<div class="empty"><h1>Analysis failed</h1><p class="fineprint">' +
    escapeHtml(String(e && e.message ? e.message : e)) + '</p>' +
    '<p class="fineprint">Confirm engine.js exposes window.HARStackEngine.analyzeHAR.</p></div>';
}

function sevBucket(sev) { return (sev === "high" || sev === "medium" || sev === "low") ? sev : "info"; }

function findingCard(f) {
  const sev = f.sev || "info";
  let html = '<article class="finding ' + escapeHtml(sev) + '" data-sev="' + escapeHtml(sevBucket(sev)) + '">';
  html += '<div class="f-head"><span class="f-sev">' + escapeHtml(sev.toUpperCase()) + '</span>';
  html += '<h3 class="f-title">' + escapeHtml(f.title || "") + '</h3></div>';
  html += '<div class="f-tags">';
  (f.regs || []).forEach(function (reg) { html += '<span class="tag">' + escapeHtml(reg) + '</span>'; });
  if (f.confidence) html += '<span class="tag conf">' + escapeHtml(f.confidence) + '</span>';
  html += '</div>';
  if (f.plain) html += '<p class="f-plain">' + escapeHtml(f.plain) + '</p>';
  if (f.loadedBy) html += '<p class="f-line f-loadedby"><span class="lab">LOADED BY</span><span class="mono">' + escapeHtml(f.loadedBy) + '</span></p>';
  const sendTo = Array.isArray(f.send_to) ? f.send_to.join(" · ") : (f.send_to || "");
  if (sendTo) html += '<p class="f-line f-sendto"><span class="lab">SEND TO</span>' + escapeHtml(sendTo) + '</p>';
  if (f.action) html += '<p class="f-line f-action"><span class="lab">RECOMMENDED ACTION</span>' + escapeHtml(f.action) + '</p>';
  if (f.status) html += '<p class="f-line f-status"><span class="lab">HTTP STATUS</span><span class="mono">' + escapeHtml(String(f.status)) + '</span></p>';
  html += '</article>';
  return html;
}

function renderReport(a) {
  const findings = (a.findings || []).slice().sort(function (x, y) {
    return (SEV_ORDER[x.sev] ?? 9) - (SEV_ORDER[y.sev] ?? 9);
  });
  const counts = { high: 0, medium: 0, low: 0, info: 0, ok: 0 };
  findings.forEach(function (f) { if (counts[f.sev] != null) counts[f.sev]++; });

  const trackers = a.trackers ? [...a.trackers.values()] : [];
  const domains = a.domains ? [...a.domains.values()] : [];
  const cdp = a.cdpEvents || [];

  const bucket = (a.outcome && a.outcome.bucket) || "Review";
  const screenClass = /escalat/i.test(bucket) ? "escalate" : /review/i.test(bucket) ? "review" : "clear";

  let html = "";

  html += '<section class="masthead"><div class="mast-left">';
  html += '<h1 class="doc-title">Privacy Stack Audit Report</h1>';
  html += '<p class="doc-meta">' + escapeHtml(new Date().toLocaleString()) +
          (a.firstPartyDomain ? ' &middot; ' + escapeHtml(a.firstPartyDomain) : '') + '</p>';
  html += '<p class="doc-meta">' + trackers.length + ' trackers &middot; ' + domains.length +
          ' third-party domains &middot; ' + gpcLabel(a) + '</p>';
  if (a.declaredConsent && a.declaredConsent.state) {
    const stateStr = Object.keys(a.declaredConsent.state).map(function (k) {
      return k + ': ' + a.declaredConsent.state[k];
    }).join(' · ');
    html += '<p class="doc-meta">Declared consent (' + escapeHtml(a.declaredConsent.source) + '): ' + escapeHtml(stateStr) + '</p>';
  }
  if (a._dataLayerEvents && a._dataLayerEvents.length) {
    html += '<p class="doc-meta">dataLayer: ' + a._dataLayerEvents.length + ' named event' + (a._dataLayerEvents.length > 1 ? 's' : '') + ' observed</p>';
  }
  html += '</div><div class="mast-right">';
  html += '<div class="screen-label">SCREENING RESULT</div>';
  html += '<div class="screen-value ' + screenClass + '">' + escapeHtml(bucket) + '</div>';
  html += '</div></section>';

  const reasons = (a.outcome && a.outcome.reasons) || [];
  if (reasons.length) {
    html += '<section class="why"><div class="why-head">WHY ' + escapeHtml(bucket.toUpperCase()) + '</div><ul>';
    reasons.forEach(function (w) { html += '<li>' + escapeHtml(w) + '</li>'; });
    html += '</ul>';
    if (a.outcome && a.outcome.action) html += '<p class="why-action">' + escapeHtml(a.outcome.action) + '</p>';
    html += '</section>';
  }

  html += '<section class="tiles">';
  html += tile(counts.high, "HIGH RISK", "high");
  html += tile(counts.medium, "MEDIUM RISK", "medium");
  html += tile(trackers.length, "TRACKERS", "");
  html += tile(domains.length, "3RD-PARTY DOMAINS", "");
  html += tile(cdp.length, "CDP EVENTS", "");
  html += '</section>';

  // Consent timeline: chronology of tracker fires relative to the CMP
  const tl = a.consentTimeline;
  if (tl && tl.events && tl.events.length) {
    const preSet = new Set((tl.preCmp || []).map(function (ev) { return ev.name; }));
    html += '<section class="timeline filterable-section"><h2 class="sec-h">Consent timeline</h2>';
    html += '<p class="fineprint">Order and offsets are measured from the first request in the capture. ' +
            (preSet.size ? 'Rows marked PRE-CONSENT fired before the consent platform loaded.' :
             'No identified tracker fired before the consent platform.') + '</p>';
    html += '<table class="tl-table"><thead><tr><th>Offset</th><th>Tool</th><th>Category</th><th>Kind</th><th></th></tr></thead><tbody>';
    tl.events.forEach(function (ev) {
      const off = (ev.offset_ms === null || ev.offset_ms === undefined) ? ('#' + (ev.order + 1)) : ('+' + (ev.offset_ms / 1000).toFixed(2) + 's');
      const pre = ev.kind === 'tracker' && preSet.has(ev.name);
      html += '<tr class="' + (ev.kind === 'cmp' ? 'tl-cmp' : pre ? 'tl-pre' : '') + '" data-sev="' + escapeHtml(sevBucket(ev.risk)) + '">';
      html += '<td class="mono">' + escapeHtml(off) + '</td>';
      html += '<td>' + escapeHtml(ev.name) + '</td>';
      html += '<td>' + escapeHtml(ev.category || '') + '</td>';
      html += '<td class="mono">' + (ev.kind === 'cmp' ? 'CONSENT PLATFORM' : escapeHtml((ev.risk || '').toUpperCase())) + '</td>';
      html += '<td class="mono">' + (pre ? 'PRE-CONSENT' : '') + '</td></tr>';
    });
    html += '</tbody></table></section>';
  }

  // Findings, always expanded
  html += '<section class="findings filterable-section"><h2 class="sec-h">Findings</h2>';
  findings.forEach(function (f) { html += findingCard(f); });
  html += '</section>';

  // CDP events
  if (cdp.length) {
    html += '<section class="cdp filterable-section"><h2 class="sec-h">CDP events</h2>';
    cdp.forEach(function (ev) {
      const sev = (ev.hasPII || ev.hasAllTrue) ? 'high' : 'low';
      html += '<article class="finding ' + sev + '" data-sev="' + sev + '">';
      html += '<div class="f-head"><span class="f-sev">CDP</span><h3 class="f-title">' +
              escapeHtml(ev.platform || "CDP event") + (ev.eventType ? ' &middot; ' + escapeHtml(ev.eventType) : '') + '</h3></div>';
      html += '<p class="f-line"><span class="lab">ENDPOINT</span>' + escapeHtml(ev.url || "") + '</p>';
      if (ev.hasAllTrue) html += '<p class="f-plain"><strong>integrations: All true</strong> &mdash; every configured destination receives this event regardless of consent.</p>';
      if (ev.piiFound && ev.piiFound.length) {
        const labels = ev.piiFound.map(function (p) { return p.label || p.field; });
        html += '<p class="f-line"><span class="lab">PII FIELDS IN PAYLOAD</span>' + escapeHtml(labels.join(", ")) + '</p>';
      }
      if (ev.destinationList && ev.destinationList.length)
        html += '<p class="f-line"><span class="lab">DESTINATIONS</span>' + escapeHtml(ev.destinationList.join(", ")) + '</p>';
      html += '</article>';
    });
    html += '</section>';
  }

  // First-party POST PII
  const fpPII = a.firstPartyPII || [];
  if (fpPII.length) {
    html += '<section class="findings filterable-section"><h2 class="sec-h">First-party POST PII</h2>';
    fpPII.forEach(function (p) {
      html += '<article class="finding medium" data-sev="medium"><div class="f-head"><span class="f-sev">PII</span>' +
              '<h3 class="f-title">' + escapeHtml((p.host || "") + (p.path || "")) + '</h3></div>';
      if (p.rawPiiFields && p.rawPiiFields.length)
        html += '<p class="f-line"><span class="lab">RAW PII</span>' + escapeHtml(p.rawPiiFields.join(", ")) + '</p>';
      if (p.hashedPiiFields && p.hashedPiiFields.length)
        html += '<p class="f-line"><span class="lab">HASHED PII</span>' + escapeHtml(p.hashedPiiFields.join(", ")) + '</p>';
      html += '</article>';
    });
    html += '</section>';
  }

  html += '<section class="scope"><h2 class="sec-h">Scope and limitations</h2>' +
    '<p>This report is based on a single page capture from a single browser session. It is not a substitute ' +
    'for a comprehensive technical privacy audit. It does not examine authenticated pages, checkout flows, ' +
    'mobile app traffic, server-side tag configurations, data processor agreements, or your complete tracking ' +
    'implementation. A finding here warrants investigation by qualified legal and technical counsel. The absence ' +
    'of a finding does not establish compliance. Risk scores are heuristic indicators, not legal determinations. ' +
    'This tool does not constitute legal advice.</p></section>';

  html += '<footer class="stamp">' + escapeHtml(attribution()) + '</footer>';

  document.getElementById("report").innerHTML = html;
}

function gpcLabel(a) {
  if (a.gpcVerified) return "GPC verified active";
  if (a.gpcReported) return "GPC reported, not verified";
  return "GPC not active";
}
function tile(n, label, cls) {
  return '<div class="tile"><div class="tile-n ' + (cls || "") + '">' + (n || 0) + '</div><div class="tile-l">' + label + '</div></div>';
}

/* ---------- filtering ---------- */

function showToolbar(on) {
  const tb = document.getElementById("toolbar");
  if (tb) tb.hidden = !on;
}

function applyFilters() {
  const q = state.filterQ.trim().toLowerCase();
  const sevs = state.filterSev; // empty set = all severities
  let visible = 0, total = 0;

  document.querySelectorAll("#report .finding").forEach(function (el) {
    total++;
    const sevOk = sevs.size === 0 || sevs.has(el.dataset.sev || "info");
    const textOk = !q || el.textContent.toLowerCase().indexOf(q) !== -1;
    const show = sevOk && textOk;
    el.classList.toggle("filtered-out", !show);
    if (show) visible++;
  });

  // Timeline rows participate in keyword + severity filtering too.
  // The CMP row stays as the reference point unless keyword-filtered.
  document.querySelectorAll("#report .tl-table tbody tr").forEach(function (el) {
    const isCmp = el.classList.contains("tl-cmp");
    const sevOk = sevs.size === 0 || isCmp || sevs.has(el.dataset.sev || "info");
    const textOk = !q || el.textContent.toLowerCase().indexOf(q) !== -1;
    el.classList.toggle("filtered-out", !(sevOk && textOk));
  });

  // Hide section headers whose content is entirely filtered out
  document.querySelectorAll("#report .filterable-section").forEach(function (sec) {
    const items = sec.querySelectorAll(".finding, tbody tr");
    if (!items.length) return;
    let any = false;
    items.forEach(function (el) { if (!el.classList.contains("filtered-out")) any = true; });
    sec.classList.toggle("filtered-out", !any);
  });

  const fc = document.getElementById("filterCount");
  if (fc) fc.textContent = (q || sevs.size) ? (visible + " of " + total + " shown") : "";
}

/* Engineer view: hides legal citations, confidence levels, and owner
   routing (compliance-audience fields); keeps tracker name/category,
   load order (consent timeline), first/third-party, and HTTP status,
   which is what a dev debugging a tag deployment actually needs. Same
   findings data, denser render -- no re-analysis. */
function applyDebugView() {
  const report = document.getElementById("report");
  if (report) report.classList.toggle("debug-view", state.debugView);
  const btn = document.getElementById("btnDebugView");
  if (btn) btn.classList.toggle("on", state.debugView);
}

function clearFilters() {
  state.filterQ = "";
  state.filterSev.clear();
  const qEl = document.getElementById("q");
  if (qEl) qEl.value = "";
  document.querySelectorAll("#sevChips .chip").forEach(function (c) { c.classList.remove("on"); });
  applyFilters();
}

/* ---------- exports ---------- */

function enableExports(on) {
  ["btnHar", "btnJson", "btnCsv", "btnPrompt", "btnPrint"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.disabled = !on;
  });
}
function download(name, text, type) {
  const blob = new Blob([text], { type: type || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function flashButton(id, text) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(function () { btn.textContent = orig; }, 2000);
}

function copyText(text, btnId, fallbackName) {
  function fallback() {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) { flashButton(btnId, "✓ Copied"); return; }
    } catch (e) {}
    if (fallbackName) { download(fallbackName, text, "text/plain"); flashButton(btnId, "⤓ Downloaded"); }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { flashButton(btnId, "✓ Copied"); }, fallback);
  } else fallback();
}

// Correct CSV: real BOM, real CRLF, character class that matches actual
// quotes and line breaks (not the letters r and n).
function toCSV(rows) {
  const esc = function (v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") v = JSON.stringify(v);
    v = String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return "﻿" + rows.map(function (r) { return r.map(esc).join(","); }).join("\r\n") + "\r\n";
}
function analysisToCsvRows(a) {
  const rows = [["section", "severity", "type", "title", "regulations", "confidence", "send_to", "loaded_by", "plain", "action"]];
  (a.findings || []).forEach(function (f) {
    rows.push(["finding", f.sev, f.type, f.title, (f.regs || []).join("; "),
               f.confidence || "", Array.isArray(f.send_to) ? f.send_to.join("; ") : (f.send_to || ""),
               f.loadedBy || "", f.plain, f.action]);
  });
  if (a.trackers) [...a.trackers.values()].forEach(function (t) {
    rows.push(["tracker", t.r, t.cat, t.n, (t.regs || []).join("; "), "", "", t.loadedBy || "", "", ""]);
  });
  if (a.consentTimeline && a.consentTimeline.events) {
    a.consentTimeline.events.forEach(function (ev) {
      rows.push(["timeline", ev.risk || "", ev.kind, ev.name, "", "", "", "",
                 "offset_ms: " + (ev.offset_ms === null ? "n/a" : ev.offset_ms) + "; order: " + (ev.order + 1), ""]);
    });
  }
  rows.push(["generated_by", "", "", attribution(), "", "", "", "", "", ""]);
  return rows;
}

/* ---------- print ---------- */

/* Chrome prints the panel document directly. Firefox silently ignores
   window.print() inside a DevTools panel, so there the report is opened in
   a regular tab and printed from the panel via w.print() -- extension-page
   CSP forbids inline scripts, so the new tab cannot auto-print itself.
   If the popup is blocked, the standalone report downloads instead. */
async function printReport() {
  if (!IS_FIREFOX) { window.print(); return; }

  let css = "";
  try { css = await (await fetch("report.css")).text(); } catch (e) {}
  const site = state.lastSite || (state.lastAnalysis && state.lastAnalysis.firstPartyDomain) || "";
  // Print is always the complete report: drop any active screen filters.
  const reportHtml = document.getElementById("report").innerHTML
    .replace(/(class="[^"]*)\bfiltered-out\b([^"]*")/g, "$1$2");
  const doc = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<title>HARstack Privacy Stack Audit Report' + (site ? " · " + escapeHtml(site) : "") + '</title>' +
    '<style>\n' + css + '\n</style></head><body>' +
    '<div id="app"><main id="report" class="report">' + reportHtml + '</main></div>' +
    '</body></html>';

  let w = null;
  try { w = window.open("", "_blank"); } catch (e) {}
  if (w && w.document) {
    try {
      w.document.open();
      w.document.write(doc);
      w.document.close();
      setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
      return;
    } catch (e) {}
  }
  download("harstack-report.html", doc, "text/html");
  flashButton("btnPrint", "⤓ Saved: open it, then print");
}

/* ---------- bug reporting ---------- */

function diagnosticsText() {
  let version = "?";
  try { version = api.runtime.getManifest().version; } catch (e) {}
  const a = state.lastAnalysis;
  const lines = [
    "HARstack extension diagnostics",
    "(counts only; no URLs, domains, or page data)",
    "extension version: " + version,
    "browser: " + navigator.userAgent,
    "captured requests in panel: " + state.entries.length,
  ];
  if (a) {
    lines.push("last analysis: " + ((a.outcome && a.outcome.bucket) || "n/a") +
      " | findings: " + (a.findings ? a.findings.length : 0) +
      " | trackers: " + (a.trackers ? a.trackers.size : 0) +
      " | third-party domains: " + (a.thirdPartyDomains ? a.thirdPartyDomains.length : 0) +
      " | cdp events: " + (a.cdpEvents ? a.cdpEvents.length : 0));
    lines.push("gpc: reported=" + String(a.gpcReported) + " verified=" + String(a.gpcVerified) +
      " | cmp: " + (a.cmpStatus || "unknown"));
  } else {
    lines.push("last analysis: none");
  }
  return lines.join("\n");
}

function initReportMenu() {
  document.getElementById("lnkBug").href =
    GITHUB_REPO + "/issues/new?template=bug_report.md&title=" + encodeURIComponent("[bug] ");
  document.getElementById("lnkTracker").href =
    GITHUB_REPO + "/issues/new?template=tracker_request.md&title=" + encodeURIComponent("[tracker] ");
}

function toggleMenu(force) {
  const m = document.getElementById("reportMenu");
  if (!m) return;
  m.hidden = (force !== undefined) ? !force : !m.hidden;
}

/* ---------- events ---------- */

document.addEventListener("click", function (ev) {
  const id = ev.target && ev.target.id;
  if (id === "btnAnalyze") analyze();
  // ignoreCache matters: a consent platform served from browser cache never
  // appears in the capture, which blinds load-order analysis (the
  // cookie_only finding). A cache-bypassing reload shows the full stack.
  else if (id === "btnReload") { state.entries = []; api.devtools.inspectedWindow.reload({ ignoreCache: true }); setCaptureState("recording", 0); }
  else if (id === "btnHar" && state.lastHar) download("harstack-capture.har", JSON.stringify(state.lastHar, null, 2), "application/json");
  else if (id === "btnJson" && state.lastJson) download("harstack-analysis.json", JSON.stringify(state.lastJson, null, 2), "application/json");
  else if (id === "btnCsv" && state.lastAnalysis) download("harstack-report.csv", toCSV(analysisToCsvRows(state.lastAnalysis)), "text/csv");
  else if (id === "btnPrompt" && state.lastAnalysis) {
    const prompt = window.HARStackEngine.buildPrompt ? window.HARStackEngine.buildPrompt(state.lastSite) : "";
    if (prompt) copyText(prompt, "btnPrompt", "harstack-ai-prompt.txt");
  }
  else if (id === "btnPrint") printReport();
  else if (id === "btnDebugView") { state.debugView = !state.debugView; applyDebugView(); }
  else if (id === "btnMenu") { ev.stopPropagation(); toggleMenu(); }
  else if (id === "btnDiag") { copyText(diagnosticsText(), "btnDiag"); }
  else if (ev.target && ev.target.classList && ev.target.classList.contains("chip")) {
    const sev = ev.target.dataset.sev;
    if (state.filterSev.has(sev)) { state.filterSev.delete(sev); ev.target.classList.remove("on"); }
    else { state.filterSev.add(sev); ev.target.classList.add("on"); }
    applyFilters();
  }
  else if (!ev.target.closest || !ev.target.closest(".menu-wrap")) toggleMenu(false);
});

document.addEventListener("input", function (ev) {
  if (ev.target && ev.target.id === "q") { state.filterQ = ev.target.value || ""; applyFilters(); }
});

document.addEventListener("keydown", function (ev) {
  const tag = (ev.target && ev.target.tagName || "").toLowerCase();
  if (ev.key === "/" && tag !== "input" && tag !== "textarea") {
    const qEl = document.getElementById("q");
    if (qEl && !document.getElementById("toolbar").hidden) { ev.preventDefault(); qEl.focus(); }
  } else if (ev.key === "Escape") {
    toggleMenu(false);
    if (tag === "input") { clearFilters(); ev.target.blur(); }
  }
});

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

initTheme();
initReportMenu();
setCaptureState("idle");
