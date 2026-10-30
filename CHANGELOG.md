# Changelog

## 2.0.1 — UI improvements (unreleased)

### Improved

- Refined the Windows application frontend across login, employee self-service, signature generation and administration.
- Introduced a shared editorial design: ink masthead, warm paper surfaces, serif headings, restrained vermilion actions and open sections separated by fine rules.
- Updated both light and dark modes, including readable native controls and a paper login form against ink surroundings.
- Clarified workflow hierarchy, template/group configuration, variable mapping, loading/empty states, validation, errors and generation results.
- Improved responsive navigation, keyboard focus, skip navigation, live status announcements and reduced-motion behavior.

### Fixed

- Prevented mobile save controls from covering or extending beyond configuration fields.
- Preserved hidden-state behavior for conditional controls such as configuration activation.
- Corrected initial signature headings to identify their configured template.
- Removed legacy blue-theme overrides and low-contrast selected-signature labels in dark mode.

### Compatibility and verification

- No authentication, permission, API or directory-contract changes. Existing signature templates and generated formatting are retained; previews remain isolated from application styling.
- No production dependency additions. The independent experimental Linux edition is unchanged.
- Local Node tests and Chromium frontend workflows pass. Browser coverage uses explicitly fictional, loopback-only API fixtures, including both themes, mobile layouts, expanded editors and generated-result states.
- This entry describes prepared source changes, not a published release. Exact-revision Windows CI, package checks and manual Windows/AD/Classic Outlook acceptance are required before stable publication; see [the release procedure](docs/windows-release.md).

## 2.0.0

Previous published Windows baseline. Existing tags and release assets remain unchanged.
