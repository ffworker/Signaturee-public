# Signaturee frontend browser QA harness

This harness serves the checked-out `frontend/` unchanged and mounts an explicitly fictional, loopback-only API fixture on the same local HTTP origin. It never starts `backend/server.js`, touches AD, stores credentials, or calls a production host.

## Run

From the repository root:

```bash
node tools/ui-review/harness.mjs
```

The runner starts a local server on `127.0.0.1:4320`, launches system Chromium (`/usr/sbin/chromium`), runs the flows, and writes artifacts under `tools/ui-review/artifacts/`:

- `baseline/` — immediate page screenshots before interaction (1440x900, 390x844, 320x844)
- `flows/` — flow screenshots and `summary.json`
- `redesign/` — initial redesign rerun
- `baseline-original/` — original frontend at `1efe91c`
- `final/` — first-pass verification, 77 screenshots
- `editorial-v2/` — current editorial design, 97 screenshots and exact manifest in `summary.json`

Playwright is intentionally isolated outside the repository:

```bash
mkdir -p /home/dennis/.hermes/cache/scratch/signaturee-playwright
npm install --prefix /home/dennis/.hermes/cache/scratch/signaturee-playwright --no-save playwright@1.52.0
```

No package-lock or package.json changes are required. The default module path is relative to the current user's home; override `UI_REVIEW_PLAYWRIGHT` with an absolute path to `playwright/index.mjs` if installed elsewhere.

Final verification command:

```bash
UI_REVIEW_PHASE=editorial-v2 UI_REVIEW_PORT=4336 node tools/ui-review/harness.mjs
```

The harness exits nonzero for layout findings, unexpected routes, page exceptions, horizontal overflow, hidden-control regressions or failed workflow assertions. Expected console HTTP failures come from deliberate error-state tests. The final manifest enumerates actual PNG files rather than estimating the screenshot count.

## Scope and safety

The fixture accepts only loopback traffic and serves fictional values (`fixture-token`, `alex.fixture`, `Ada Example`). It implements only the response shapes the actual frontend currently consumes: health/auth, AD search, preflight, preview, newline-delimited generation stream, self-service bootstrap/generate/download, and admin profile/signature creation. Every request is recorded; the runner fails if an unexpected API path or non-loopback request is observed.

The harness deliberately does not fill password fields or submit credentials. Login coverage uses availability, empty-submit validation, and a fixture-down error state. Admin wizard validation uses empty required fields and fictional template files only.

## Coverage

- Generator: search, select, preflight, preview, streamed generation
- Self-service: identity, signature selection, generation, download response
- Admin: navigation, signature wizard, variables, save validation
- Login: fixture availability, empty validation, unavailable-backend error
- All four pages in light/dark at 1440,390,320px; all admin sections also at900px
- Expanded template/group and variable editors, generated results and preview in both themes
- Computed editorial heading, open-section, paper form/native-control and dark selection-label checks
- Real theme-toggle interactions; keyboard focus; reduced motion
- Preview shadow isolation assertion (rendered HTML is in `.signature-preview-surface`, not leaked into app DOM)
- Console/page errors and unexpected API request audit

The report is evidence from this fixture and browser only; it is not backend/AD verification.
