# Glossary

| Term | Meaning |
| --- | --- |
| Active release | The release currently receiving traffic |
| Audit event | A record of who/what invoked which operation, when, and with what result, with secrets redacted |
| Candidate | A new release that is built and health-checked before becoming the active release |
| Build step | An npm script run after `npm ci`; a Project may omit the build step but must still have a start script |
| Config drift | Owned config files no longer match the desired state or recorded hash |
| Desired state | The Project/Domain state the system intends to create and store in the database |
| Domain sync | Syncing Project, Domain, Nginx, and SSL relationships on the host only; not editing a DNS provider |
| Domain activation | Checking DNS, creating a managed Nginx file, requesting or expanding an ACME certificate, and pointing the reverse proxy at the active project release |
| Credential reference | The name of an environment secret the deployment service resolves, without storing the secret value in the Dashboard |
| Credential vault | Encrypted storage for HTTPS tokens in persistent state; tokens are never returned through the API |
| Deploy key | An SSH key pair that lets the host access one repository; the UI never accesses the private key |
| Native mode | Running the application on the host under systemd, not in a Docker container |
| Owned file | A file Host Manager creates and is allowed to modify, within the ownership boundary |
| Privileged helper | A separate service that performs allowlisted high-privilege operations after validating input |
| Project user | A limited Unix user used to build/run one Project's application |
| Release | The result of one deployment, tied to a commit and its metadata |
| Rollback | Returning traffic or the service to a previously verified Active release |
| Update manifest | An Ed25519-signed JSON document that names the version, HTTPS archive, and SHA-256 for a Dashboard Portal update |
| Install snapshot | Root-only timestamped copy of the Dashboard Portal files it owns before an installer change; used to restore managed files after a failed install. |
| TLS fail-closed | Production install does not report success or leave the login intentionally exposed over HTTP; a certificate and HTTPS health check must pass. |
| Session identifier hash | SHA-256 hash of the browser session cookie stored in persistent state; the raw cookie remains only in the browser. |
