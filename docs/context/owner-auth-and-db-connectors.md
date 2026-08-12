# Owner bootstrap, email login, and database connectors

## Auth

- First visit with no owner record shows bootstrap UI (`POST /api/bootstrap`)
- If an installer/env password already exists, bootstrap requires `currentPassword`
- Login is always `email + password`
- Passwords are stored as scrypt hashes; strong password rules apply to bootstrap and password changes
- Tests seed `owner@local.test` when `createApplication({ password })` is used

## Database connectors

- Page: `/databases`
- Providers: MongoDB, PostgreSQL, MySQL, Redis
- Client connectors only (encrypted secrets + TCP probe). No host DB package install and no installer flags
- API: `GET/POST /api/databases`, `POST /api/databases/:id/check`, `DELETE /api/databases/:id`
