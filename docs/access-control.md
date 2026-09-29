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

Global host tools, host metrics, Git identity, credential vault, mail, database connections/queries, Portal updates, member management, and organization management remain Master-only. Users cannot change a private project's repository or credential binding. A Master configures those bindings first; authorized Users can sync the existing binding.

## Enforcement and migration

The server denies unlisted User API operations by default and checks permissions using the current persisted account. UI controls reflect these checks. Project lists, jobs, integration lists, and audit history are scoped to memberships. Permissions in one organization never authorize operations in another. Environment read and write permissions are independent; write-only users replace values without downloading existing values.

The existing owner migrates to a Master and existing organization names migrate to stable IDs on database load. Existing owner sessions are bound to the migrated account. Migration is idempotent and will not reactivate a disabled account or restore a demoted role. Keep a database backup before a production upgrade; rollback to a version predating multi-account access is not an access-control rollback procedure.

Manual deployment jobs record their initiator and organization. Permission is checked again when execution starts and before host activation. Polling and authenticated project hooks execute as project automation; removing a human membership does not disable already configured automation. Disable or rotate project triggers separately when retiring an integration.

## Deployment boundary

This is access control for a trusted team managing one shared host. It does not provide isolation against hostile tenants running arbitrary project code. Environment access and deployment authority should be granted with that shared-host boundary in mind.

See [testing.md](testing.md) for module commands and the role/scenario matrix.
