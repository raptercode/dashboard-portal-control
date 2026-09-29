# Publish the bootstrap URL

[ภาษาไทย](../../th/how-to/bootstrap-hosting.md)


Serve [install.sh](../../../install.sh) at `https://dashboard-portal.cloud/install.sh` with HTTP 200, HTTPS and the actual script body, not HTML or an authentication page. Use text/plain or application/x-sh, preserve LF and validate `bash -n` before publishing. Serve the reviewed/tested commit; do not replace existing immutable release assets to add bootstrap.

## Verify publishing

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh -o /tmp/dashboard-portal-install.sh
bash -n /tmp/dashboard-portal-install.sh
sha256sum /tmp/dashboard-portal-install.sh
```

Compare the digest to the reviewed commit's file. Run the [installation command](production-install.md) in interactive SSH on a clean staging Ubuntu host. Check pinned v0.8.3 and latest resolution, prompts/sudo, checksum failure, services/HTTPS and temporary cleanup.

Committing source/docs does not publish the domain. Existing v0.8.3 archives can still be bootstrapped through their internal installer; no asset replacement is required. Additional OS support remains a [future plan](../knowledge/plans/ubuntu-compatibility-plan.md).
