# Signaturee — editorial Windows product UI

## Scope

Local worktree: `/home/dennis/Projects/signaturee-product-ui`.
Branch: `design/product-editorial-ui`, based on public `main` revision `1efe91c`.

This is the actual supported Windows application's vanilla HTML/CSS/JavaScript frontend: `login.html`, `index.html`, `self-service.html`, `admin.html`. It does not modify `website/`, the independent experimental Linux edition, release assets or production infrastructure. No new production dependencies were added.

## Design

The public website is a visual reference, not an application layout. Its local `website/` source was inspected and rendered because the public URL returned Cloudflare Tunnel error 1033 during this pass. The local reference is not evidence of current live website health.

Primary product surface: **Operate**; secondary: **Configure**.

- Shared ink masthead, editorial wordmark, restrained vermilion actions, warm paper light mode and neutral ink dark mode.
- Serif page/section headings with selective italic emphasis; sans-serif forms, controls, technical information and navigation. Small monospaced indices establish hierarchy without decorative icons.
- Open working sections separated by fine rules replace nested cards. No gradients, glow, decorative metrics or feature-tile grids.
- Login is a working paper form beside concise account guidance. Its scoped light color scheme keeps ink text and native fields readable even against the dark application background.
- Generation keeps people/worklist on the left and output/checks on the right. Preview and generation span the workspace; the rendered signature remains an isolated white document rather than a themed app panel. Mapping details are an open inspection column.
- Employee self-service uses compact identity fields alongside assigned signatures, followed by the generation/download flow and Classic Outlook instructions.
- Administration has underlined active navigation, ruled template/group and variable editors, consistent fields and restrained status colors. Legacy blue dark-theme overrides now consume shared tokens.
- Mobile/tablet navigation wraps and dirty save controls stay in document flow, avoiding cropped or obscured configuration fields.

## Engineering boundaries

`theme.css` contains interaction primitives; `ui-polish.css` owns shared tokens and final composition. Existing workflow-specific CSS remains in place. Existing IDs, permissions, authentication, API calls and directory behavior are retained. The small admin initialization change labels each existing signature with its configured name rather than the generic template heading.

Generated signature HTML remains in the existing ShadowRoot. Application CSS does not enter it. Generated HTML/TXT/templates are not changed. Browser assertions compare actual signature markup and computed typography/colors before and after theme changes.

Skip links, named search fields, live statuses, visible focus, native controls, reduced-motion behavior and `[hidden]` application visibility remain tested.

## Verified final pass

```bash
UI_REVIEW_PHASE=editorial-v2 UI_REVIEW_PORT=4336 node tools/ui-review/harness.mjs
npm run test:backend
git diff --check
```

All commands passed. The exact artifact manifest contains **97 screenshots**, verified against PNG files on disk under `tools/ui-review/artifacts/editorial-v2/`. It covers all four pages in both themes at 1440, 390 and 320px, all seven admin sections in both themes at 1440, 900, 390 and 320px, and expanded/result/error states.

Actual Chromium interactions exercised:

- Generator search, selection, preflight, preview and NDJSON streamed generation; loading, empty and directory-error states.
- Employee identity, selected-signature payload, generation and download response.
- Admin navigation, existing template/group and variable editors, required-key wizard validation, variable addition and successful fixture save. Activation controls remain hidden before save and appear after success.
- Login availability, empty-submit validation and unavailable-backend feedback, including dark mode.
- Real theme-toggle interactions, visible keyboard focus/skip navigation and reduced-motion behavior.

Final result: no layout findings, no page exceptions, no horizontal page overflow in captured states, no unexpected API routes and no non-loopback browser requests. Expected console failures come from deliberately injected search HTTP 500, health HTTP 503 and unavailable local backend. The Node suite emits its existing experimental SQLite warnings.

New visual browser assertions were first observed failing on title prominence, paper-form color, legacy-blue admin controls and dark selected-signature labels. The final source passes all of them. Fixed dark selected-label contrast would otherwise have been missed by initial-screen screenshots alone.

Calculated contrast ratios: light body 12.74:1; paper-form muted text 5.10:1; light accent 4.97:1; dark body 14.62:1; dark muted text 8.41:1; primary button 6.71:1; dark selected-signature text 9.94:1. These are scoped checks, not an exhaustive accessibility certification.

## Still unverified / not authorized

All browser API responses are explicitly fictional, loopback-only fixtures. They verify frontend behavior, not real LDAP/AD authentication, Windows PowerShell generation, UNC/ACL deployment, archive validity or Outlook import. The harness download is deliberately only a fictional response; it is not a generated production signature package.

Windows/AD/Classic Outlook acceptance requires a separately authorized environment before release. No push, PR, deployment or release publication was performed. The existing production dependency tree has a previously reported moderate `qs` advisory; no unrelated dependency upgrade was made.

The project-worklog helper refused the milestone update because its global size cap was reached. This document contains the verified handoff; no worklog-save success is claimed.
