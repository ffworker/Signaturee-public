# Signaturee project website

Static HTML/CSS, no JavaScript, dependency installation, tracking, fonts CDN,
application credentials or backend connection. Public assets live in this directory;
this README is operational documentation and need not be served.

## Preview and validate

From the repository root:

```sh
python3 -m unittest discover -s website/tests -v
python3 -m http.server 8080 --bind 127.0.0.1 --directory website
```

Open http://127.0.0.1:8080 and inspect desktop and mobile widths, keyboard focus,
anchors and reduced-motion behavior. Source validation does not replace a browser
or post-deployment HTTPS test. Deployment must serve missing paths as 404, not as
an application route.

## Content and download policy

- Windows is the available edition; Linux is an independent experimental project.
- Classic Outlook local signature files are not native new Outlook/web deployment.
- All download links name the existing published v2.0.0 release, not `latest`, a
  moving branch or an ordinary CI artifact. The ZIP and SHA256SUMS were downloaded
  and checked during this website mission. See the baseline audit for evidence.
- Creator acceptance is explicitly attributed, not presented as customer validation.
- The signature specimen uses the owner's fictional Max Mustermann data, explicitly labeled as a
  template illustration, never a real employee or product screenshot.
- No screenshots are used because no approved sanitized capture was supplied.
- Verify release metadata, actual downloaded bytes and checksum before changing a
  download button. Do not automatically promote a CI build.

The primary surface is Decide / Learn, composed as an editorial specimen sheet
rather than a generic developer-tool landing page. Ink `#191b1a`, warm paper
`#eeece2` and vermilion `#ff795c` distinguish the project within Bytegeist. Georgia
serif display type contrasts with deliberately restrained Helvetica/Arial body
type and small mono annotations; all are local fallbacks, not remote font loads.
Native details/summary keep requirements and acceptance evidence accessible
without a long front-page wall of text or JavaScript. AI-assisted development is
acknowledged without claiming manual authorship or inventing an AI product feature.
Do not reintroduce gradients, floating dashboard cards, glowing accents or fake UI.

Field notes A/B/C explain installation, template assignment and release/rollback
on the page; GitHub guides are supplemental. Keep these summaries consistent with
the actual Windows requirements and never imply that CI validates AD/SMB/Outlook.

The fictional paper specimen illustrates template → Windows script + AD →
mapped replacement → completed signature on one stationary document. The previous
full-document slide, stepped status changes, rolling AD data and long individual
field delays were too clunky. A twelve-second timeline now uses shared decelerating
easing, a gliding active-step pill, a forward-only status loop and short12px field
transitions with100ms stagger. Fields replace as whole values with a brief soft
highlight; opacity only supports the short transition, never a typewriter reveal.
The directory record stays still. Template and filled values share the same font,
size, weight, line height, spacing and text color; the canvas never moves.
Use exactly Max / Mustermann, my-website.com and max.mustermann at my-domain.com;
the HTML email display reconstructs the at sign through CSS. The department example
is retained; no company field participates. Website demonstrates a configured
mapping through the supported additive schema, not a claimed built-in default.
It uses fictional data, not a directory connection or fake application screen;
the only input is a native, keyboard-accessible checkbox that pauses it locally.
No form or JavaScript is used. Reduced motion disables animation, shows the filled
result and hides the unnecessary pause control. The supplied domains are display text
only, never a fetched resource or claimed live company site. The illustrative email
uses a CSS-generated at sign plus a full accessible spoken label so Cloudflare does
not rewrite it or inject a decoder blocked by CSP. This is specimen rendering, not
production-template guidance or a functional email link. Require exact live HTML
byte identity, zero scripts and the visible at sign after edge traversal.
Verify input, script, document handoff, each whole-field swap and final states,
keyboard pause/resume and the reduced-motion static result in a real browser.

Self-service copy follows docs/data-sources.md: LDAP is the Windows login provider;
the authenticated account's AD record and group assignments drive generation.
Employees can regenerate assigned signatures on demand when directory access,
attributes and variable mappings are configured correctly, then download and
follow import instructions. Do not imply automatic Outlook synchronization or
extend this claim to the independent experimental Linux edition.

CSS and favicon references include the first 12 hex characters of each file's
SHA-256 as `?v=...`. Update those references in both HTML pages whenever the asset
changes; the site tests enforce this. Cloudflare and browsers cache the old bare
URLs for hours, so an origin rollout or hard reload alone is not publication proof.
Verify the actual versioned URLs referenced by the served HTML.

## Publication and rollback

Website content is maintained here, independently of Windows release promotion.
The private infrastructure repository owns runtime configuration and hostname
routing; no private deployment data belongs in this public directory. Pin a reviewed
full Git commit or content-addressed artifact, never a floating branch. A successful
source PR does not establish that the public website is live.

Deploy only the dedicated Signaturee resources using the scoped Public-Edge runbook.
Do not apply the existing entire production overlay or adopt other workloads into
Flux. Before and after deployment compare existing workload revision/readiness,
then test real-name HTTPS, page content, CSS, favicon, robots, sitemap, 404 and
mobile layout. Keep the previous approved content revision or generated ConfigMap
for rollback. Roll back only Signaturee, leaving shared ingress and tunnel settings
otherwise unchanged. The exact runtime publication commands and prior revision
are recorded with the deployment PR in the owning infrastructure repository.

## Security headers

The site requires no scripts, frames, forms or external asset fetches. Configure
`Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
and a restrictive Permissions-Policy at the static server. Keep HTTPS/HSTS ownership
with the established edge. Only publish index.html, style.css, favicon.svg,
robots.txt, sitemap.xml and 404.html; do not serve this repository, README or tests.
