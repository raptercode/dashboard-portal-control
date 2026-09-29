# ADR 0028: Organization repository credentials

[ภาษาไทย](../../../th/knowledge/adr/0028-organization-repository-credentials.md)


Status: Accepted for v0.8.2

This extends the credential policy in [ADR 0027](0027-members-and-organization-permissions.md): an organization owns its HTTPS repository credentials, names, and default selection. Four explicit grants separate use, creation, update/rotation, and deletion. A member must also have the relevant project permissions to bind or change a private repository; credential management alone does not authorize project operations.

Existing global credentials remain Master-managed because assigning a shared secret to one organization automatically could grant previously unavailable repository access. Existing memberships retain their explicit grants. An authorized source sync may use an unchanged project binding without a new credential-use grant, preserving operator and background automation workflows. Changing a legacy binding requires a Master; changing an organization binding requires credential use and project configuration grants.

Credential ownership is immutable. Tokens remain encrypted and write-only; credential changes and source-sync commits recheck current scope. Referenced credentials cannot be deleted or retargeted to another host. Git authentication is limited to the selected HTTPS authority, with isolated configuration and refused redirects, so a member cannot send an organization's token to another host through a repository URL.

This remains a trusted-team shared-host boundary. A credential-use grant permits repositories covered by the provider token on the configured host. Administrators should provision repository-limited read tokens, and must disable project automation separately when retiring an integration.
