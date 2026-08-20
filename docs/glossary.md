# Glossary

| Term | Meaning |
| --- | --- |
| Active release | The release currently receiving traffic |
| Audit event | A record of who/what invoked which operation, when, and with what result, with secrets redacted |
| Candidate | A new release that is built and health-checked before becoming the active release |
| Build step | A constrained package script run after dependencies install; a Project may explicitly select Skip Build but must still have a start script |
| Bun runtime | A native project runtime using checksum-verified Bun, `bun install`, and `bun run <script>` under the project systemd service |
| Project port | A Portal-assigned loopback port used by one managed project; it is checked against saved projects and active host listeners before saving |
| Release dependency cleanup | Removing `node_modules` only from native releases older than the active and immediate rollback releases after a successful activation |
| Config drift | Owned config files no longer match the desired state or recorded hash |
| Desired state | The Project/Domain state the system intends to create and store in the database |
| Domain sync | Syncing Project, Domain, Nginx, and SSL relationships on the host only; not editing a DNS provider |
| Domain activation | Checking DNS, creating a managed Nginx file, requesting or expanding an ACME certificate, and pointing the reverse proxy at the active project release |
| Credential reference | The name of an environment secret the deployment service resolves, without storing the secret value in the Dashboard |
| Credential vault | Encrypted storage for HTTPS tokens in persistent state; tokens are never returned through the API |
| Deploy key | An SSH key pair that lets the host access one repository; the UI never accesses the private key |
| Docker Compose runtime | Optional runtime for a trusted owner repository; the helper validates a bounded Compose policy before controlled host activation. It is not multi-tenant container isolation. |
| Runtime detection | A shallow repository metadata inspection that suggests Docker Compose, Bun, or Node without executing repository code; the owner may override it. |
| Mail readiness | Separate evidence for SMTP egress and local inbound firewall policy. It does not prove that a cloud-provider firewall permits inbound mail from the Internet. |
| Mail hostname | The DNS-only hostname used for SMTP HELO, PTR, and mail TLS, normally `mail.example.com`. |
| Native mode | Running the application on the host under systemd, not in a Docker container |
| Monitor Logs Token | Project-scoped bearer token that reads safe deployment status only; it cannot read runtime logs, secrets, or repository URLs. |
| Notification hook | Encrypted HTTPS destination that receives a provider-aware deployment success/failure payload; delivery never changes deployment state. |
| Owned file | A file Host Manager creates and is allowed to modify, within the ownership boundary |
| Privileged helper | A separate service that performs allowlisted high-privilege operations after validating input |
| Project user | A limited Unix user used to build/run one Project's application |
| Release | The result of one deployment, tied to a commit and its metadata |
| Rollback | Returning traffic or the service to a previously verified Active release |
| Update manifest | An Ed25519-signed JSON document that names the version, HTTPS archive, and SHA-256 for a Dashboard Portal update |
| Install snapshot | Root-only timestamped copy of the Dashboard Portal files it owns before an installer change; used to restore managed files after a failed install. |
| TLS fail-closed | Production install does not report success or leave the login intentionally exposed over HTTP; a certificate and HTTPS health check must pass. |
| Session identifier hash | SHA-256 hash of the browser session cookie stored in persistent state; the raw cookie remains only in the browser. |
