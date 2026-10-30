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
- The workflow drawing is labeled as an illustration, never a product screenshot.
- No screenshots are used because no approved sanitized capture was supplied.
- Verify release metadata, actual downloaded bytes and checksum before changing a
  download button. Do not automatically promote a CI build.

The visual system follows the live Bytegeist source observed during this mission:
navy `#020617`, slate panels, cyan `#22d3ee`, purple mono accents and the existing
system UI/monospace font stacks. It deliberately omits boot delays, external fonts
and background effects. The primary surface is Decide / Learn.

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
