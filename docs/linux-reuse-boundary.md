# Independent Linux repository boundary

A read-only inspection of `ffworker/signaturee-linux` `main` at `216ac65b568433b421edaec983f55926579c3c11` confirms it is a separate experimental ESM Node/Docker project (Node >=24), not a branch or drop-in port.

Its browser server is the explicitly unauthenticated localhost demo in `src/demo/http.js`, with only `GET /api/health`, `GET /api/preview`, `POST /api/generate`, and `GET /api/download/{htm,txt,rtf}`. It does not implement this Windows application's `/api/auth/*`, `/api/users/ad`, `/api/run/*`, `/api/self/generate`, or `/api/v2/admin/*` contracts.

Linux has a distinct `src/directory/ldap-provider.js` service layer with LDAPS/certificate validation, escaped filters, a read-only service bind, and optional user-bind verification, but no authenticated production HTTP session API; its README marks the browser demo unauthenticated and production web UI incomplete. Its identity model uses LDAP attributes and direct `memberOf` DNs, while this Windows application exposes AD users, local/AD login, bearer sessions, and admin/IT/employee roles.

Linux generation is `src/services/generate.js` plus LibreOffice and write-once local snapshots; real test-AD acceptance, SMB deployment, and Classic Outlook compatibility remain incomplete there. Frontend reuse is consequently only a future UX/workflow reference, not current API/auth parity or Linux support.
