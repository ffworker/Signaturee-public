# Contributing

Pull requests are welcome.

## Before opening a PR

Run the same Windows quality gate used by GitHub Actions:

```powershell
npm ci --omit=dev
npm run quality-gate
```

Keep changes focused and avoid introducing environment-specific names, paths, domains or credentials.

For UI changes, prefer the existing Admin / IT / Self-Service workflows instead of adding parallel configuration paths.

## Branches

Use a short feature branch from `main` and open a pull request back to `main`.

The quality gate must be green before merge.
