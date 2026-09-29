# Members, organizations, and permissions

Version 0.8.1 introduces two account roles: **Master** and **User**. An account may belong to several organizations with different permissions in each. Viewer, Operator, and Maintainer are editable permission presets, not additional account roles.

## Account and organization management

Masters manage accounts, invitations, organizations, and memberships from **Members**. An invitation link expires after 48 hours, can be revoked, and can be used once. Only a hash of its random token is stored. The recipient sets their own password; there is no public signup or shared account password.

Changing an account's role, status, or memberships invalidates its existing sessions. Disabling an account also prevents new logins. The final active Master cannot be disabled or demoted. Each account can change its own password.

Projects use stable organization IDs. Renaming an organization updates the display name without moving its projects. Project slugs remain globally unique because they identify host directories and services. Only Masters may move or delete projects.

## Permission catalog

| Permission | Capability |
| --- | --- |
| `project.view` | List projects and see configuration/status in the organization |
| `project.create` | Create a project in the organization |
| `project.configure` | Edit project configuration |
| `source.sync` | Refresh the configured repository source |
| `credentials.use` | Select an organization's HTTPS credential for private repositories (requires the relevant project permission too) |
| `credentials.create` | Add encrypted HTTPS credentials to the organization |
| `credentials.update` | Rename/rotate credentials and set or clear the organization's default |
| `credentials.delete` | Delete credentials that are not selected by a project |
| `deploy.start` | Start a deployment |
| `deploy.rollback` | Activate a previous release |
| `logs.read` | Read logs and deployment job details |
| `env.read` | Read environment values |
| `env.write` | Replace environment values |
| `domains.manage` | Configure domains and check DNS/edge status |
| `webhooks.manage` | Manage project hooks and monitoring tokens |
| `audit.read` | Read organization audit history |

Project operations require project visibility as well as their action permission. Editing configuration through source sync additionally requires `source.sync`. Domain changes through that route require `domains.manage`. Enabling automatic deployments or configuring GitHub/Actions triggers requires both `webhooks.manage` and `deploy.start`.

Creating a monitoring token also requires `logs.read` because the token exposes deployment diagnostics. A source sync request from a User without `deploy.start` does not immediately start an automatic deployment.

Presets:

- **Viewer:** project visibility, logs, and audit history.
- **Operator:** Viewer plus source sync, deploy, and rollback.
- **Maintainer:** all organization permissions, including environment values and project creation.

Global host tools, host metrics, Git identity, legacy global credentials, mail, database connections/queries, Portal updates, member management, and organization management remain Master-only. Organization HTTPS credentials are managed using the four separate credential permissions above.

## Organization repository credentials

In **Members**, a Master grants the required credential permissions separately for each organization. On **Credentials**, select that organization, then add a name, Git hostname and repository token. Creating a private project requires `project.create` and `credentials.use`; editing its repository or credential additionally requires `project.view`, `source.sync` and `project.configure`. Selecting the Maintainer preset includes all four credential grants. Existing memberships keep their explicit grants and are not automatically expanded by this update.

Credential names and defaults are scoped to their organization. Credentials from another organization cannot be selected, even by a Master moving a project; select a credential in the destination organization first. Members cannot select legacy global credentials. Their existing projects can still sync an unchanged legacy binding, but a Master must change that binding or repository.

Tokens are encrypted using the existing vault and are never returned by credential APIs or prefilled in the edit form. Editing with a blank token retains the current secret; entering a new token rotates it for future syncs. The host cannot change while a project references the credential, and changing an unused credential's host requires a replacement token. Credentials in use cannot be deleted; change each project's binding first. Organization ownership is immutable; create a separate credential in a different organization instead.

`credentials.use` authorizes access to repositories permitted by the stored Git token on its configured host. Scope the provider token to the repositories and read permissions the team needs. Credential management does not automatically grant project/deploy permissions, and `source.sync` can continue refreshing an already bound repository without a separate `credentials.use` grant. Already configured polling and hooks also keep their project binding. Revoking a provider token requires rotation at the Git provider or replacing the stored credential.

Git identity and Git installation remain host setup prerequisites maintained by Master. The Credentials page manages HTTPS repository authentication; it does not create repositories at GitHub or grant Git-provider permissions. SSH keys remain under the existing Master-managed policy.

Git authentication refuses HTTP redirects and uses an isolated configuration instead of host credential helpers or global URL rewrites. Use the canonical HTTPS clone URL, including after a repository is renamed or moved. Existing checkouts with local transport overrides must have those overrides removed before a saved credential can be used. Temporary authentication files are private and removed after each operation; the askpass helper only answers for the selected HTTPS authority.

## Enforcement and migration

The server denies unlisted User API operations by default and checks permissions using the current persisted account. UI controls reflect these checks. Project lists, jobs, integration lists, and audit history are scoped to memberships. Permissions in one organization never authorize operations in another. Environment read and write permissions are independent; write-only users replace values without downloading existing values.

The existing owner migrates to a Master and existing organization names migrate to stable IDs on database load. Existing owner sessions are bound to the migrated account. Migration is idempotent and will not reactivate a disabled account or restore a demoted role. Keep a database backup before a production upgrade; rollback to a version predating multi-account access is not an access-control rollback procedure.

Manual deployment jobs record their initiator and organization. Permission is checked again when execution starts and before host activation. Polling and authenticated project hooks execute as project automation; removing a human membership does not disable already configured automation. Disable or rotate project triggers separately when retiring an integration.

## Deployment boundary

This is access control for a trusted team managing one shared host. It does not provide isolation against hostile tenants running arbitrary project code. Environment access and deployment authority should be granted with that shared-host boundary in mind.

See [testing.md](testing.md) for module commands and the role/scenario matrix.
