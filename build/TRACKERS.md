# trackers.yaml — contributor guide

`build/trackers.yaml` is the authoritative tracker database. `build/build.py` reads it
and generates the JavaScript `const TR = { ... }` block injected into both HTML outputs.
After any edit, rebuild and test:

```
python build/build.py
node build/tests/validate.js
node build/tests/unit.js
```

---

## Entry structure

```yaml
trackers:
  - pattern: "ct.pinterest.com"
    name: "Pinterest Tag"
    category: "Advertising"
    cc: a
    risk: high
    regs:
      - ECPA
      - US State Privacy
    description: >-
      One or two sentences on what the vendor does and why it matters legally.
    action: >-
      Concrete steps the auditor should take.
```

Every field is required. Use `>-` (folded scalar, no trailing newline) for multi-line
`description` and `action` values.

---

## Fields

### `pattern`
URL **substring** matched against request URLs via `url.includes(pattern)`. Case-sensitive.

- Be as specific as needed to avoid false positives on unrelated domains.
- Prefer a subdomain (`ct.pinterest.com`) over a bare domain (`pinterest.com`) when the
  subdomain uniquely identifies the tracking endpoint.
- Use a bare domain (`amazon-adsystem.com`) when multiple subdomains all belong to the
  same vendor and same tracker concept.
- Path segments are valid: `"facebook.com/tr"`, `"gtag/js?id=AW-"`, `"mixpanel.com/track"`.
- One pattern per entry. Add a second entry (with a distinct name suffix like `(CDN)` or
  `(Beacon)`) if a vendor uses two meaningfully different domains.

### `name`
Human-readable vendor label shown in the tool UI.

- Prefer the vendor's own product name: `"Meta Pixel"`, `"Google Tag Manager"`.
- Use parenthetical suffixes to distinguish variants: `"GA4 (gtag)"`, `"Reddit Pixel (CDN)"`,
  `"Spotify Ads (Beacon)"`.
- Keep it short — it appears in tables.

### `category`
Display category string. Must be one of:

| Value | Meaning |
|---|---|
| `Advertising` | Ad pixels, conversion tags, DSPs, SSPs, retargeting |
| `Analytics` | Behavioral analytics, page-view tracking |
| `Session Replay` | Tools that record user interactions (clicks, scrolls, keystrokes) |
| `CDP` | Customer data platforms, identity resolution, data pipelines |
| `Consent Management` | CMPs, cookie banners, consent orchestration |
| `Tag Management` | TMS loaders (GTM, Tealium, Ensighten) |
| `Cross-Device` | Identity graphs, device fingerprinting, cross-device matching |
| `Affiliate` | Affiliate networks, commission tracking |
| `Call Tracking` | Dynamic number insertion, call attribution |
| `Experimentation` | A/B testing, feature flags, multivariate testing |
| `Error Tracking` | Crash reporting, APM agents |
| `Bot Protection` | CAPTCHA, fraud/bot detection |
| `Mobile Attribution` | App install attribution (Adjust, AppsFlyer, Branch) |
| `Email Marketing` | Email platform pixels, list sync endpoints |
| `Marketing` | Marketing automation platforms not covered by a more specific category |
| `Marketing / Chat` | Live chat widgets with marketing data collection |
| `Payment` | Payment processors, checkout SDKs |
| `Hosting` | Public CDNs, infrastructure services (low/no tracking intent) |

### `cc`
Single category code used internally. Must match `category`:

| cc | category |
|---|---|
| `a` | Advertising |
| `an` | Analytics |
| `s` | Session Replay |
| `d` | CDP |
| `c` | Consent Management |
| `t` | Tag Management |
| `x` | Cross-Device |
| `af` | Affiliate |
| `ct` | Call Tracking |
| `ex` | Experimentation |
| `er` | Error Tracking |
| `bp` | Bot Protection |
| `ma` | Mobile Attribution |
| `e` | Email Marketing |
| `m` | Marketing / Marketing / Chat |
| `p` | Payment |
| `an` | Hosting (same code as Analytics — hosting entries use `an` by convention) |

### `risk`
Severity used for finding prioritization:

| Value | When to use |
|---|---|
| `high` | Direct regulatory exposure: ECPA/wiretap theories, CCPA sale/sharing, session replay, cross-border transfer, sensitive-data categories |
| `medium` | Meaningful privacy impact but lower litigation profile: behavioral analytics, remarketing pixels without ECPA surface |
| `low` | Third-party data egress with limited tracking intent: CDN asset delivery, diagnostic endpoints, tag loader scripts |
| `ok` | Operator-controlled or privacy-neutral: first-party analytics under DPA, infrastructure with no user data |

### `regs`
Applicable regulations as a YAML list. Use only values from this set:

| Value | Statute |
|---|---|
| `ECPA` | Electronic Communications Privacy Act (Wiretap Act / CIPA) |
| `US State Privacy` | CCPA/CPRA, VCDPA, CPA, and other omnibus state privacy laws |
| `GDPR` | EU General Data Protection Regulation |
| `CIPA` | California Invasion of Privacy Act (wiretapping) |
| `VPPA` | Video Privacy Protection Act |
| `GLBA` | Gramm-Leach-Bliley Act (financial data) |
| `COPPA` | Children's Online Privacy Protection Act |
| `CAN-SPAM` | CAN-SPAM Act (email) |
| `TCPA` | Telephone Consumer Protection Act |
| `ADA` | Americans with Disabilities Act (accessibility-adjacent) |

**Calibration guidance:**
- Add `ECPA` when the vendor intercepts communications in real time (session replay, form-field
  capture, wiretap-theory ad pixels like Meta Pixel).
- Add `US State Privacy` for any third-party that receives behavioral or identifiable data —
  this is the default for advertising, analytics, and CDP trackers.
- Add `GDPR` only when there is a meaningful EU data-transfer dimension (e.g., vendor lacks
  SCCs, non-EU adequacy, or has documented enforcement history).
- Add `CIPA` separately from `ECPA` only when California-specific wiretapping exposure is
  distinct (e.g., session replay tools where CIPA § 631 applies independently).

### `description`
One to three sentences. Cover:
1. What the vendor/endpoint does technically.
2. Why it creates regulatory exposure or privacy risk.

Do not explain what the auditor should do — that belongs in `action`.

Use `<<SR_FRAMING>>` as the entire description body for session replay tools. This expands
to the shared legal framing block defined at the top of `trackers.yaml`.

### `action`
Concrete audit steps for the person reviewing the HAR. Be specific: name the CMP, name the
data type, name the contractual instrument.

Use `<<SR_ACTION>>` as the entire action body for session replay tools. This expands to the
shared five-step action block defined at the top of `trackers.yaml`.

---

## Placeholders

Two shared text blocks avoid duplicating long boilerplate across every session replay entry:

| Placeholder | Expands to |
|---|---|
| `<<SR_FRAMING>>` | Session replay legal framing (ECPA, CIPA, wiretap theory, standing) |
| `<<SR_ACTION>>` | Five-step session replay audit checklist |

Use them only in `description` and `action` respectively, and only for session replay tools.
`build.py` substitutes them at build time; the raw placeholder never appears in the output.

---

## Adding a new tracker

1. **Identify the pattern.** Open the HAR in the tool, find the request URL. Choose the
   shortest substring that is unique to this vendor. Test with `url.includes(pattern)` logic.

2. **Check for duplicates.** Search `trackers.yaml` for the domain before adding.

3. **Classify.** Pick `category`, `cc`, `risk`, and `regs` using the tables above.

4. **Write description and action.** Description = what + why. Action = what the auditor
   does. Use `<<SR_FRAMING>>` / `<<SR_ACTION>>` for session replay tools.

5. **Place the entry.** Append to the end of the `trackers:` list, or group near related
   vendors. Order does not affect matching.

6. **Rebuild and test.**
   ```
   python build/build.py
   node build/tests/validate.js
   ```
   Existing fixture counts may increase; existing bucket assignments must not change unless
   the new tracker genuinely changes the outcome for a known-good HAR.

---

## Identifying missed trackers from a HAR

Run a HAR through the built tool and check `unidentifiedThirdParties` in the analysis output,
or use the one-off node script pattern used during development:

```js
const a = ctx.analyzeHAR(ctx.har, null);
console.log(a.unidentifiedThirdParties);
```

Any domain with `identified: false` and `operator_related: false` is a candidate for a new
entry. Skip raw IPs, ephemeral cloud subdomains (`*.on.aws`, `*.run.app`), and domains that
belong to the site operator's own brand.

---

## Adding a fixture HAR

1. Copy the `.har` file to `build/tests/fixtures/` (directory is gitignored).
2. Run the built tool against it manually to determine the expected bucket (`Escalate`,
   `Needs Review`, or `No Issues`).
3. Add an entry to the `HARS` array in `build/tests/validate.js`:
   ```js
   { file: 'example.com.har', label: 'Example', classicBucket: 'Escalate', wizardBucket: 'Escalate' },
   ```
4. Run `node build/tests/validate.js` to confirm.

Classic and wizard buckets can differ when wizard-injected trackers change the outcome (e.g.,
a wizard-only session replay tool causes Escalate where classic shows Needs Review).
