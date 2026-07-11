# HARstack -- Deployment Guide

Complete setup for `harstack.com` hosted on GitHub Pages, proxied through Cloudflare, with AI crawler visibility configured.

---

## Architecture Decision: Split Download Path

This site uses a deliberate split between the promotional page and the tool download.

**Landing page (`harstack.com`)** is served through Cloudflare. Cloudflare provides CDN performance, SSL, security headers, and bot rule controls. Cloudflare receives connection metadata -- IP addresses, timestamps, request paths -- as part of normal proxy operation. This is disclosed explicitly on the landing page in an Infrastructure Transparency section.

**Tool download** links directly to a GitHub release asset (`github.com/pbarnhart/harstack/releases/latest/download/harstack.html`). The download request goes to GitHub's infrastructure, not through Cloudflare. GitHub (Microsoft) is a known and expected dependency for open source software. The tool itself runs entirely locally after download -- no data leaves the user's machine during analysis.

This architecture means a visitor who runs a HAR on the landing page will see: Cloudflare connection (expected, disclosed), Google Fonts request (expected, disclosed), and nothing else. No advertising pixels, no analytics, no session replay. The HAR result matches exactly what the page says.

The `tool/` path in the repository can still exist as a fallback for users who prefer to access the tool via the GitHub Pages URL rather than a direct download. But the primary promoted download path should always point to the GitHub release asset.

---



| Layer | Service | Purpose |
|---|---|---|
| Source | GitHub (public repo) | File hosting, version control, Issues |
| Serving | GitHub Pages | Static site hosting, free |
| Proxy | Cloudflare (free tier) | CDN, SSL, bot rules, headers |
| Domain | Registrar of choice | `harstack.com` |

The site has no server, no database, no analytics, and no tracking. Everything is static files served from GitHub Pages through Cloudflare.

---

## Repository Structure

```
harstack/
├── index.html                  # Product/promotional landing page
├── tool/
│   └── index.html              # The HARstack tool itself
├── README.md                   # GitHub repo documentation
├── LICENSE                     # MIT License
├── SETUP.md                    # This file
├── robots.txt                  # Crawler access rules
├── llms.txt                    # AI assistant description file
├── CNAME                       # Custom domain for GitHub Pages
└── .github/
    └── ISSUE_TEMPLATE/
        ├── bug_report.md
        └── tracker_request.md
```

---

## Step 1 -- Register the Domain

Register `harstack.com` at any registrar (Cloudflare Registrar is convenient since you will be pointing to Cloudflare anyway and charges at cost with no markup).

Do not configure DNS at the registrar. You will point nameservers to Cloudflare in Step 3 and manage all DNS there.

---

## Step 2 -- Set Up GitHub Pages

### 2a. Create the repository

Create a new public repository named `harstack` on GitHub.

### 2b. Add files

Commit all files from the repository structure above. The minimum required to go live:

- `index.html`
- `tool/index.html` (the auditor HTML file)
- `CNAME` (one line: `harstack.com`)
- `robots.txt`
- `llms.txt`

### 2c. Enable GitHub Pages

Go to repository Settings > Pages.

- Source: Deploy from a branch
- Branch: `main`
- Folder: `/ (root)`

Save. GitHub will provision a `pbarnhart.github.io/harstack` URL within a few minutes.

### 2d. Add the CNAME file

Create a file named `CNAME` in the root of the repository containing exactly one line:

```
harstack.com
```

No `https://`, no trailing slash. Just the bare domain. GitHub Pages reads this file to know which custom domain to serve.

### 2e. Verify GitHub Pages is live

Visit `https://pbarnhart.github.io/harstack`. You should see the landing page. The tool should be accessible at `/tool/`.

---

## Step 3 -- Set Up Cloudflare

### 3a. Create a Cloudflare account

Free tier is sufficient for everything here. Sign up at cloudflare.com.

### 3b. Add the site

In the Cloudflare dashboard, click Add a Site and enter `harstack.com`. Choose the Free plan.

### 3c. Update nameservers at your registrar

Cloudflare will show you two nameserver addresses (e.g. `aria.ns.cloudflare.com` and `bob.ns.cloudflare.com`). Log into your domain registrar and replace the default nameservers with these two. Propagation typically takes 5 to 30 minutes.

### 3d. Add DNS records

In Cloudflare DNS, add these records:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` (root) | `pbarnhart.github.io` | Proxied (orange cloud) |
| CNAME | `www` | `harstack.com` | Proxied (orange cloud) |

The proxied setting is required. It routes traffic through Cloudflare rather than directly to GitHub Pages. This is what enables the CDN, bot rules, and header controls.

### 3e. Configure SSL

In Cloudflare SSL/TLS settings:

- Encryption mode: **Full (strict)**
- Always Use HTTPS: **On**
- Automatic HTTPS Rewrites: **On**
- Minimum TLS Version: **TLS 1.2**

GitHub Pages provides a certificate for the origin. Cloudflare provides a certificate for visitors. Full (strict) validates both ends.

### 3f. Configure Page Rules or Cache Rules

Create a cache rule to serve static assets efficiently. In Rules > Cache Rules:

- Match: `harstack.com/*`
- Cache level: Standard
- Edge Cache TTL: 1 day

The HTML files change infrequently. Caching at the edge reduces GitHub Pages load and improves response time for crawlers.

### 3g. Configure Security Headers

In Rules > Transform Rules > Modify Response Headers, add the following response headers. These improve security posture and are worth having even on a static site.

| Header | Value |
|---|---|
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | `default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'` |

The CSP allows Google Fonts (used in both pages) and nothing else. No inline scripts, no third-party analytics, no ad networks. Google Fonts is the one acknowledged third-party request on the landing page. It is named in the Infrastructure Transparency section on the page and is visible in any HAR captured on the site. If you want to eliminate even this dependency, download the font files, self-host them in the repository, and remove the Google Fonts import from `index.html`. The CSP can then be tightened to `font-src 'self'`.

Note: if your `index.html` uses any inline `<style>` or `<script>` tags, add `'unsafe-inline'` to the relevant CSP directive or move styles and scripts to external files. Review the CSP in browser DevTools after deploying.

---

## Step 4 -- Configure AI Crawler Access

### 4a. robots.txt

Place this file at the repository root. It explicitly allows the major AI crawler user agents rather than relying on wildcard defaults, which some crawlers interpret inconsistently.

```
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: YouBot
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://harstack.com/sitemap.xml
```

There is no content on this site that should be excluded from AI indexing. The tool HTML file at `/tool/` is intentionally public and crawlable.

### 4b. llms.txt

The `llms.txt` standard (llmstxt.org) is an emerging convention for telling AI assistants how to accurately describe a site or tool. Place this file at the repository root, accessible at `https://harstack.com/llms.txt`.

```markdown
# HARstack

> A free, open-source HAR file analyzer for martech engineers, privacy professionals, and compliance teams. MIT license. Runs entirely in the browser. No data transmitted.

## What it is

HARstack is a single HTML file that reads an HTTP Archive (HAR) file exported from browser DevTools and identifies tracking technologies, PII transmission patterns, consent signal gaps, and regulatory exposure across a live web stack.

It is not a compliance determination tool. It is a first-pass screening instrument that produces structured findings for review by privacy counsel, compliance teams, or internal martech and security functions.

## Who it is for

- Martech engineers testing new tag deployments before they ship
- Privacy professionals and compliance auditors doing first-pass screening without full tool access
- Legal and compliance teams who need findings in plain language with specific regulatory citations
- Developers who want to verify tracking behavior during development without uploading sensitive files to external platforms

## What it detects

- 155+ tracker and technology signatures: advertising pixels, session replay tools, CDPs, consent management platforms, tag managers, affiliate networks, call tracking, identity resolution
- POST body PII: raw and hashed personally identifiable information transmitted to first-party and third-party endpoints
- GPC signal verification: checks whether Sec-GPC header appears in actual request headers, not just self-reported settings
- Server-side GTM detection: identifies server-side container deployments and consent bypass risk
- CMP load order: detects whether consent management loads before or after tracking scripts

## Regulatory coverage

Findings include citations to: ECPA (18 U.S.C. § 2511), CIPA (Cal. Pen. Code § 631(a)), CCPA/CPRA, GLBA Safeguards Rule (16 CFR § 313), VPPA (18 U.S.C. § 2710), CAN-SPAM Act, FTC enforcement actions including BetterHelp (FTC Docket No. 2023-169).

## Output

- Outcome bucket: Escalate, Needs Review, or Likely OK
- Per-finding confidence levels: Observed, Likely, Heuristic, Needs Legal Review
- Owner routing: which team or function should handle each finding
- Audit questions derived from observed findings
- Sanitized HAR export: PII and session credentials stripped for safe upload to AI tools
- Analysis JSON export: structured findings with legal citations

## Important note on HAR file safety

Raw HAR files captured during authenticated sessions contain session cookies, authorization tokens, and full request/response bodies that may include PII, account data, and credentials. Uploading raw HAR files to AI tools or cloud platforms creates security and compliance exposure. This tool runs entirely locally. The sanitized export is designed for safe upstream AI analysis.

## License

MIT. Free to use, fork, and extend.

## Author

Phil Barnhart, CIPP/US. Principal Consultant at YourExitRamp LLC. Publisher of Pixel and Policy (pixelsandpolicy.substack.com), a newsletter covering martech, privacy law, and compliance.

## Links

- Tool: https://harstack.com/tool/
- GitHub: https://github.com/pbarnhart/harstack
- Newsletter: https://pixelsandpolicy.substack.com
- Issues: https://github.com/pbarnhart/harstack/issues
```

### 4c. Schema markup in index.html

Add the following `<script>` block inside the `<head>` of `index.html`. This provides structured data that AI Overviews, search features, and AI assistants use to accurately describe the tool.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "HARstack",
  "alternateName": "Pixel and Policy HARstack",
  "description": "A free, open-source HAR file analyzer that identifies tracking technologies, PII transmission patterns, consent signal gaps, and regulatory exposure. Runs entirely in the browser. No data transmitted.",
  "url": "https://harstack.com",
  "downloadUrl": "https://harstack.com/tool/",
  "applicationCategory": "SecurityApplication",
  "operatingSystem": "Any (browser-based)",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "license": "https://opensource.org/licenses/MIT",
  "softwareVersion": "1.0",
  "author": {
    "@type": "Person",
    "name": "Phil Barnhart",
    "url": "https://pixelsandpolicy.substack.com",
    "jobTitle": "Principal Consultant",
    "hasCredential": {
      "@type": "EducationalOccupationalCredential",
      "name": "CIPP/US",
      "credentialCategory": "Professional Certification",
      "recognizedBy": {
        "@type": "Organization",
        "name": "International Association of Privacy Professionals"
      }
    }
  },
  "keywords": [
    "HAR file analyzer",
    "privacy audit",
    "tracking technology",
    "ECPA compliance",
    "CCPA compliance",
    "martech compliance",
    "consent management audit",
    "GPC verification",
    "session replay detection",
    "privacy stack"
  ],
  "featureList": [
    "155+ tracker signatures with regulatory framing",
    "POST body PII scanning",
    "GPC signal verification from request headers",
    "Server-side GTM detection",
    "Sanitized HAR export for safe AI upload",
    "Analysis JSON export with legal citations",
    "Outcome classification: Escalate, Needs Review, Likely OK",
    "Per-finding confidence levels and owner routing"
  ]
}
</script>
```

---

## Step 5 -- GitHub Issue Templates

Create `.github/ISSUE_TEMPLATE/` in the repository with these two files.

### bug_report.md

```markdown
---
name: Bug Report
about: Something in the tool is not working correctly
labels: bug
---

**What happened**
Describe what the tool did.

**What you expected**
Describe what you expected it to do.

**HAR file context**
Do not attach a raw HAR file. Describe the site type (e.g. ecommerce, financial services, SaaS) and what technology you expected to be detected.

**Browser**
Chrome / Firefox / Edge / Safari -- version if known.

**Steps to reproduce**
1.
2.
3.
```

### tracker_request.md

```markdown
---
name: Tracker or Vendor Request
about: A tracking technology is not being detected or is miscategorized
labels: tracker-registry
---

**Vendor or technology name**

**URL pattern observed in HAR**
The URL substring the tool should match against. Example: `cdn.example.com/tracker.js`

**Category**
Advertising / Analytics / Session Replay / CDP / Consent Management / Affiliate / Call Tracking / Other

**Regulations that apply**
ECPA / CIPA / CCPA/CPRA / GLBA / VPPA / Other

**Suggested description**
Plain-language description of what this technology does and what the compliance concern is.

**Source or documentation**
Link to vendor documentation, enforcement action, or case law that supports the framing.
```

---

## Step 7 -- Set Up GitHub Sponsors and Ko-fi

### 7a. Ko-fi

Go to `ko-fi.com` and create a free account. Claim the handle `pixelsandpolicy` to match your newsletter brand. Add a short description: "I build free open source tools for martech and privacy practitioners. HARstack is one of them." No other configuration required. The link in the README and landing page will work as soon as the account exists.

### 7b. GitHub Sponsors

Go to `github.com/sponsors` and apply to join the program. GitHub reviews applications -- approval typically takes a few days. You will need to connect a Stripe account for payouts.

Once approved, the `.github/FUNDING.yml` file already in this repository will automatically activate the Sponsor button on the repo page. It will appear next to the Stars and Watch buttons at the top of the repository.

Configure at least two tiers in your GitHub Sponsors profile:

| Tier | Amount | Label |
|---|---|---|
| One-time thank you | $5 | "Saved me time on an audit" |
| Ongoing support | $10/month | "Keep the tracker registry current" |

Keep the tier descriptions honest and low-pressure. This audience will not respond to manufactured urgency or inflated value claims.

### 7c. Placeholders to update

Before launch, replace every instance of `pbarnhart` in the repository with your actual GitHub username. Run:

```bash
grep -r "pbarnhart" . --include="*.md" --include="*.yml" --include="*.html" --include="*.txt"
```

That will surface every file that still needs updating.

---

Once DNS propagates and GitHub Pages is serving through Cloudflare, run through this checklist.

**DNS and SSL**
- [ ] `https://harstack.com` loads without certificate warnings
- [ ] `https://www.harstack.com` redirects to the root domain
- [ ] `http://` redirects to `https://`

**Pages**
- [ ] `https://harstack.com` serves `index.html` (landing page)
- [ ] `https://harstack.com/tool/` serves the auditor tool
- [ ] `https://harstack.com/robots.txt` is accessible
- [ ] `https://harstack.com/llms.txt` is accessible

**Security headers**
Run `https://securityheaders.com/?q=harstack.com` and confirm the headers configured in Step 3g are present.

**No tracking**
- [ ] Open DevTools, record a HAR on the landing page
- [ ] Drop that HAR into the tool itself
- [ ] Confirm zero advertising, analytics, or session replay findings
- [ ] Confirm outcome bucket is Likely OK

This last step is the demonstration. The site's own HAR is clean. Document that and reference it in the newsletter article and the landing page.

**Schema markup**
Paste `https://harstack.com` into Google's Rich Results Test (`search.google.com/test/rich-results`) and confirm the SoftwareApplication schema is parsed correctly.

**AI crawler access**
Submit `https://harstack.com/llms.txt` and `https://harstack.com/robots.txt` to Google Search Console after verifying ownership. This is not required but accelerates indexing.

---

## Maintenance

**Updating the tool**
Replace `tool/index.html` with the new version. Commit to `main`. GitHub Pages redeploys automatically within 1 to 3 minutes. Cloudflare cache purge may be needed if visitors see a stale version: Cloudflare dashboard > Caching > Purge Everything.

**Adding tracker entries**
Edit the TR table in `tool/index.html`. Run the smoke tests documented in the handoff doc before committing. Em dash check required before every commit.

**Reviewing Issues**
GitHub Issues is the intake channel. Label incoming reports as `bug`, `tracker-registry`, or `question`. No support SLA implied. Respond when you can.

---

## What This Stack Does Not Include (By Design)

- No analytics. No page view tracking. No heatmaps. No session replay.
- No contact form. No email collection. No newsletter signup widget.
- No comment system. No social embeds.
- No cookie banner. There are no cookies to consent to.
- No CDN-hosted third-party scripts beyond Google Fonts.

The site is a demonstration of the tool's own thesis. Run a HAR on it. The findings should be Likely OK.
