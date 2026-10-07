# API

The UI is the primary interface. The routes below are the current v2 integration/troubleshooting surface.

## Health / auth

- `GET /health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

## V2 profile / administration

- `GET /api/v2/profile`
- `PUT /api/v2/profile`
- `POST /api/v2/templates/import`
- `POST /api/v2/targets/check`
- `GET /api/v2/auth/users`
- `POST /api/v2/auth/users`
- `PATCH /api/v2/auth/users/:username`
- `DELETE /api/v2/auth/users/:username`

## AD / generation

- `GET /api/users/ad`
- `POST /api/run/preflight`
- `POST /api/run/generate`

## Self-service

- `GET /api/self/bootstrap`
- `POST /api/self/generate`
- `GET /api/self/signature/download`

## Operations

- `GET /api/runner/status`
- `POST /api/runner/control`
- `GET /api/logs/latest`
- `GET /api/logs/download`
- `GET /api/storage/backup`
- `POST /api/storage/restore`

Compatibility routes may remain internally, but new integrations should use only the v2 endpoints above.
