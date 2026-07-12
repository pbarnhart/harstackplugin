# HARstack

**Audit your stack. Start with the HAR.**

A free, open-source HAR file analyzer for martech engineers, privacy professionals, and compliance teams.

[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](LICENSE)

---

## What It Does

The HARstack reads an HTTP Archive (HAR) file from your browser and identifies tracking technologies, PII transmission patterns, consent signal gaps, and regulatory exposure across your live web stack.

It produces:

- **Outcome bucket** -- Escalate, Needs Review, or Likely OK
- **Per-finding analysis** -- plain-language description, applicable regulations, and recommended action
- **Confidence levels** -- Observed, Likely, Heuristic, or Needs Legal Review
- **Owner routing** -- which team should handle each finding
- **GPC verification** -- checks Sec-GPC header in actual request data, not just self-reported state
- **POST body PII scan** -- detects raw and hashed PII transmitted to first-party and third-party endpoints
- **sGTM detection** -- identifies server-side GTM deployments and consent bypass risk
- **Consent timeline** -- per-tracker chronology relative to the consent platform, with timestamps for every tracker that fired before consent gating was possible
- **Consent-artifact detection** -- separates "no consent mechanism" from "custom consent layer the registry does not recognize" using consent cookies, IAB privacy strings (us_privacy, GPP, TCF), Consent Mode signals, and live IAB API probes
- **Loaded-by attribution** -- which script loaded each tracker (Chrome captures), so findings route to the team that owns the firing mechanism
- **Sanitized HAR export** -- PII-stripped for safe sharing with counsel
- **Analysis JSON export** -- structured findings with legal citations for downstream review
- **AI disclosure-gap prompt** -- pairs the sanitized findings with a slot for the site's privacy policy and asks your own AI for candidate disclosure gaps to review. Does your policy match your pixels?
- **Audit questions** -- targeted questions derived from what was observed

## Why This Exists

In August 2025, a federal judge ruled that a company's own privacy policy could serve as the predicate tort for a federal wiretapping claim under the ECPA crime-tort exception. The gap between what the policy promised and what the tracking stack actually did was sufficient to state a claim.

Plaintiffs' attorneys build these cases from HAR files. This tool lets you run the same analysis on your own site before they do.

## How to Use It

1. Download `harstack.html` from [Releases](https://github.com/pbarnhart/harstackplugin/releases)
2. Open it in Chrome or Firefox (no install required)
3. Record a HAR file from your site using browser DevTools (Network tab, export HAR). Use a private window and check **Disable cache** before loading the page: cached scripts, consent platforms especially, never appear in the capture otherwise
4. Drop the HAR file into the tool
5. Answer two context questions (consent state, GPC usage)
6. Review findings and export the analysis JSON or sanitized HAR

**Nothing is transmitted. The analysis runs entirely in your browser.**

## Regulatory Coverage

Findings include citations to specific regulations and enforcement actions:

- ECPA (18 U.S.C. § 2511) -- federal wiretapping, crime-tort exception
- CIPA (Cal. Pen. Code § 631(a)) -- California wiretapping
- CCPA/CPRA -- sale, sharing, and GPC compliance
- GLBA Safeguards Rule (16 CFR § 313) -- financial services NPI
- VPPA (18 U.S.C. § 2710) -- video viewing data
- CAN-SPAM Act -- email opt-out compliance
- FTC enforcement precedents (BetterHelp, COPPA)

## Tracker Registry

The tool includes 336 URL signature entries across:

- Advertising (Meta, Google, TikTok, Reddit, Microsoft, DoubleClick)
- Session Replay (Clarity, Hotjar, FullStory, LogRocket, Mouseflow)
- Analytics (GA4, Mixpanel, Heap, Comscore)
- CDP (RudderStack, Segment)
- Consent Management (Osano, Cookiebot, OneTrust, Cookie-Script)
- Tag Management (GTM, server-side GTM detection)
- Affiliate (Awin, Impact, CJ)
- Call Tracking (Invoca, CallRail)
- Identity Resolution (LiveRamp, Tapad)

## Limitations

This is a first-pass screening instrument. It does not:

- Determine legal compliance
- See server-side data flows (by definition absent from the HAR)
- Replace qualified privacy counsel

Findings flagged as "Needs Legal Review" require attorney review before action.

## Contributing

Pull requests are welcome. If you add a tracker entry, include:

- Specific URL substring or path pattern
- Category and class code
- Risk level
- Applicable regulations
- Plain-language description with legal framing
- Recommended action

Follow the existing TR entry shape documented in the source comments.

## License

MIT -- see [LICENSE](LICENSE)



## Need Help With What You Found?

HARstack surfaces the issues. Remediating them is a different conversation. If you need help interpreting findings, closing policy disclosure gaps, or building a remediation plan, reach out via [Pixel and Policy](https://pixelsandpolicy.substack.com) or [LinkedIn](https://linkedin.com/in/pbarnhart).

---

**Built by Phil Barnhart, CIPP/US**  
Newsletter: [Pixel and Policy](https://pixelsandpolicy.substack.com) -- Martech, Privacy, and Risky Stacks

---

## Browser extension (Chrome & Firefox)

The `extension/` folder is a DevTools-panel build of HARstack. It runs the **same
engine** as the HAR tool, but reads the inspected page's live traffic instead of
an uploaded file.

**Permission footprint: zero.** The `permissions` array is empty. No host
permissions, no `webRequest`, no `debugger` (so no Chrome debugging banner), no
background worker. Network data comes from the DevTools network API; response
bodies come through `getContent()`, which needs no extra grant on either browser.

`extension/engine.js` is **generated by the build** (it is gitignored). It wraps
the analysis closure from `build/source/harstack-source.html` with
`build/trackers.yaml` injected, so new vendors and rule changes flow to the
extension on the next build with no drift.

### Build everything

```bash
cd build
python build.py
```

This regenerates the following outputs:

| Output | Path |
|--------|------|
| Classic tool | `harstack.html` |
| Wizard tool | `tool/index.html` |
| Extension engine | `extension/engine.js` |
| Extension landing page (source, hand-maintained) | `extension/site/index.html` |
| Extension landing page (published, copied from the source above) | `plugin/index.html` -> served at harstack.com/plugin/ |

### Load the extension

```bash
cd extension
cp manifest.chrome.json manifest.json   # or manifest.firefox.json
```

- **Chrome/Edge:** `chrome://extensions` → Developer mode → Load unpacked → select `extension/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → pick `manifest.json`.

Open DevTools, select the **HARstack** panel, browse, press **Analyze**.

---

## Repository layout

```
build/
  build.py            # single build script -> classic, wizard, extension engine
  trackers.yaml       # authoritative tracker registry (336 entries)
  citations.json      # regulatory citation map
  source/             # harstack-source.html (the engine + UI source)
  wizard-body.html    # wizard wrapper template
  tests/              # node validation harness (fixtures gitignored)
extension/            # DevTools-panel extension (engine.js generated)
  manifest.chrome.json / manifest.firefox.json
  panel.html / panel.js / report.css / devtools.*
  site/index.html     # extension landing page (GitHub Pages)
tool/index.html       # generated wizard tool
harstack.html         # generated classic tool
index.html            # main site landing (harstack.com)
```
