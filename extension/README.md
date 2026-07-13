# HARstack — Privacy Stack Auditor (browser extension)

A DevTools-panel extension that audits a page's privacy and martech stack
from its own network traffic. Chrome and Firefox. **Local only.**

This is the capture front end for the HARstack engine. It reads live traffic
through the DevTools network API and hands a standard HAR to your existing
`analyzeHAR`. The single-file HAR uploader stays as a third input path; this
adds live capture without replacing it.

---

## Why the permissions are zero

At install this extension requests no permissions. The `permissions` array
in the manifest is empty.

- **No host permissions.** No `<all_urls>`, no per-site access.
- **No `webRequest`.** Network data comes from the DevTools network API.
- **No `debugger`.** So Chrome shows **no** "started debugging this browser" banner.
- **No `storage`.** Nothing is persisted; captures live in panel memory only.
- **No background service worker** that watches you browse.

Response bodies — which power CNAME and GTM-injected vendor fingerprinting —
come from `devtools.network` `getContent()`, which works the same way in both
browsers and needs no extra grant. That is the whole reason for the
DevTools-panel design: full capture, zero footprint, identical on Chrome
and Firefox. A privacy auditor that asks for nothing is the only kind
that can make its own pitch without flinching.

The cost: the panel only captures requests made **after** DevTools is open on
the inspected tab. Use **Reload & Capture** to get everything from the first
request.

---

## Install — Chrome / Edge (unpacked)

1. Copy `manifest.chrome.json` to `manifest.json` in this folder.
2. Go to `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open any page, open DevTools (F12), and select the **HARstack** panel.

## Install — Firefox (temporary)

1. Copy `manifest.firefox.json` to `manifest.json` in this folder.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and pick `manifest.json` in this folder.
4. Open any page, open DevTools (F12), and select the **HARstack** panel.

> Keep both `manifest.*.json` files in the repo. Only the active one should be
> named `manifest.json`. A two-line build script can swap them per target.

## Package for the stores

```bash
cd build
python package.py
```

This builds the engine if needed, refuses to ship a stub or a manifest with
any permissions, and writes one store-ready zip per browser to `dist/`:
runtime files only (manifest, devtools, panel, engine, css, icons). Upload
the chrome zip to the Chrome Web Store developer console and the firefox
zip to addons.mozilla.org. Firefox self-distribution outside AMO requires
signing (`npx web-ext sign --channel unlisted`).

---

## Wiring in the real engine

The extension calls `window.HARStackEngine.analyzeHAR(har, opts)`.

`engine.js` is **generated from your repo**: the analysis closure from
`build/source/harstack-source.html` with `build/trackers.yaml` injected, wrapped
so it runs headless (a shimmed `document` makes the tool's UI wiring inert) and
exposes `window.HARStackEngine.analyzeHAR`. To regenerate after editing the
source or the tracker registry, re-run the extraction (add it as a `build.py`
target so it tracks every release).

1. In the single-file tool, refactor `analyzeHAR` so it does **not** read the
   DOM. It currently reaches for `#su` (first-party domain) and a module-global
   GPC flag. Take both from `opts` instead:

   ```js
   const firstParty   = opts.firstPartyDomain;  // host of the inspected page
   const gpcReported   = opts.gpcReported;        // navigator.globalPrivacyControl
   ```

   Your engine still verifies GPC by scanning `Sec-GPC` request headers in the
   HAR. `opts.gpcReported` only supplies the "reported" half, so the
   reported-vs-verified distinction in your output is preserved.

2. Paste `analyzeHAR`, the `TR` registry, the detectors, the consent decoder,
   and `buildAnalysisJSON` into `engine.js`.

3. Replace the last line of `engine.js` with:

   ```js
   window.HARStackEngine = { analyzeHAR };
   ```

Nothing else changes. The panel, the renderer, the exports, and the print path
all work against the analysis object your `buildAnalysisJSON` already produces.

### Expected analysis shape

```
{
  meta: { generated, site, total_requests, first_party_domain,
          screening_result, screening_priority, why: [..],
          recommended_action, gpc_reported_by_user, gpc_verified_in_har },
  findings: [ { severity, type, title, regulations, confidence,
                send_to, plain, action } ],
  trackers: [ { name, category, risk, code, regulations } ],
  domains:  [ { domain, registrable, requests } ],
  audit_questions: [ ... ]
}
```

---

## What this build already fixes

- **CSV export.** `panel.js` `toCSV()` writes a real BOM (`\ufeff`) and real
  CRLF (`\r\n`), with a character class that matches actual quotes and line
  breaks. Excel opens it as rows. (The single-file tool emitted literal
  `\ufeff` and `\r\n` text; this build does not.)
- **Print / PDF.** `report.css` has an `@media print` block that strips the app
  chrome, removes interactive affordances, renders all findings expanded (no
  collapsing accordions), and paginates without breaking finding cards. Press
  **Print / PDF** for a clean deliverable.

---

## Files

| File | Role |
|------|------|
| `manifest.chrome.json` / `manifest.firefox.json` | Per-browser manifests (rename the active one to `manifest.json`) |
| `devtools.html` / `devtools.js` | Registers the DevTools panel |
| `panel.html` / `panel.js` | Capture, HAR assembly, render, exports |
| `engine.js` | **Engine slot** — paste your `analyzeHAR` here |
| `report.css` | Editorial report styling + print rules |
| `icons/` | Toolbar / panel icons |

## What the panel adds on top of the engine

- **Consent timeline.** A chronological table of every identified tool relative
  to the consent platform, with offsets from the first request. Trackers that
  fired before the CMP are marked PRE-CONSENT and produce a finding with
  per-tracker timestamp evidence.
- **Loaded-by attribution.** Chrome's `_initiator` data is preserved in the
  assembled HAR, so tracker findings show which script loaded them
  (e.g. `gtm.js (googletagmanager.com)`). Firefox omits initiators; the line
  is simply absent there.
- **Declared consent check.** At analysis time the panel reads the page's
  Google Consent Mode state (`google_tag_data.ics`, falling back to dataLayer
  consent commands) through `inspectedWindow.eval` — the same zero-permission
  channel as the GPC flag. A recorded denial plus tracker traffic in the same
  capture becomes a finding.
- **AI Prompt export.** Copies the disclosure-gap prompt block: sanitized
  findings plus a marked slot to paste the site's privacy policy, asking your
  own AI for candidate disclosure gaps to review. Nothing is sent anywhere by
  the extension; you choose the AI.
- **Search and severity filters.** Keyword filter (`/` to focus) and
  High / Medium / Low / Info chips. Filters affect the screen only; Print / PDF
  always renders the complete report.
- **Print on Firefox.** Firefox ignores `window.print()` inside a DevTools
  panel, so there Print / PDF opens the report in a regular tab and prints
  from that tab (or downloads `harstack-report.html` if the popup is
  blocked). Chrome prints the panel directly.
- **Dark mode.** Follows the DevTools theme. Print is always light.
- **Report menu.** Report a bug or request a tracker (GitHub issue templates),
  and Copy diagnostics: version, browser, and result counts only. No URLs,
  domains, or page data.

Every export carries the attribution stamp: report footer, analysis JSON
(`_meta.generated_by`), CSV (`generated_by` row), HAR (`creator`), and the AI
prompt block.

v0.3.1 — engineer view toggle (hides legal citations, confidence levels, and
owner routing; shows HTTP status per finding), CNAME-deployed CDP detection
no longer guesses a vendor name from payload shape alone.
v0.3.0 — zero permissions, consent timeline, loaded-by attribution, declared
consent check, disclosure-gap AI prompt, filtering, dark mode, bug reporting.
v0.2.0 — capture front end with the real HARstack engine wired in (generated
from build/source + build/trackers.yaml). The renderer consumes the engine's
native analysis object, including the CDP Events section.
