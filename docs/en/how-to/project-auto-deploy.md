# Project auto deploy

[ภาษาไทย](../../th/how-to/project-auto-deploy.md)


Dashboard Portal already checks every configured project branch every five minutes. Enable **Auto deploy** in a project's action menu to queue a release when a new commit is synced. A candidate must pass its build and health check before host activation; a failed candidate leaves the active release in place. The project needs a saved environment variable and, on an installed host, a project domain.

## Choose a trigger

| Choice | Setup outside the Portal | Behavior |
| --- | --- | --- |
| Auto deploy only | None | Check the configured Git branch every five minutes and deploy new commits. |
| GitHub push webhook | Add a repository webhook | Trigger a check immediately on a push; the five-minute check remains a fallback. |
| Actions hook | Add a CI step and secret | Sync can continue in the background, but deployment waits for the hook after CI passes. |

The hooks are optional. Creating a hook selects its trigger mode and turns on Auto deploy. Selecting **Auto deploy** from the project menu switches back to five-minute polling without needing GitHub Actions. GitHub push mode also uses polling as a fallback. Actions mode waits for the CI hook before deployment, including when a background poll already synced the commit. Disabling the Actions hook stops auto deployment until another mode is selected. A stored hook token can remain after changing modes, but only the selected mode accepts its trigger.

For faster GitHub delivery, use the project's **ตั้งค่า GitHub webhook** action:

1. Create a Secret. This also enables Auto deploy. Copy it immediately; the Portal only displays it once and stores it encrypted with `HOSTMGR_SECRET_KEY`.
2. In the GitHub repository, open **Settings → Webhooks → Add webhook**. Paste the Payload URL shown by the Portal, set Content type to `application/json`, paste the Secret, and select **Just the push event**.
3. Push to the branch configured in the Portal. A valid delivery starts a source sync, then queues a release only if the synced revision changed. Inspect the project's release log for build, health, and activation results.

The endpoint accepts GitHub `push` events for the exact repository and configured branch. It validates `X-Hub-Signature-256` against the raw request body. It fetches the branch tip instead of trusting the webhook's commit SHA, so late or repeated deliveries cannot roll a project back. Duplicate revisions do not create duplicate releases. The endpoint responds before the sync and deployment run. If a delivery arrives during a deployment, the source check runs after that job finishes. Polling remains the fallback for missed deliveries.

Rotating the Secret invalidates the previous GitHub webhook configuration immediately; update GitHub with the new Secret. Disabling the GitHub webhook switches to five-minute polling. To stop automatic deployment entirely, turn off **Auto deploy** too. Notification webhooks in the **แจ้งเตือน** dialog are outbound deploy result notifications and do not trigger deployment.

## GitHub Actions or another CI

Open **ตั้งค่า Actions hook** on the project and create a Token. Copy the Hook URL and Token. Store the Token as a repository or environment secret named `PORTAL_DEPLOY_TOKEN`; store the Hook URL as a repository variable named `PORTAL_DEPLOY_URL`. Add this as the **last step of an existing job after its checks pass**:

```yaml
- name: Trigger Portal sync and deploy
  if: github.ref == 'refs/heads/main'
  env:
    PORTAL_DEPLOY_URL: ${{ vars.PORTAL_DEPLOY_URL }}
    PORTAL_DEPLOY_TOKEN: ${{ secrets.PORTAL_DEPLOY_TOKEN }}
  run: curl --fail-with-body --silent --show-error --request POST --header "Authorization: Bearer $PORTAL_DEPLOY_TOKEN" "$PORTAL_DEPLOY_URL"
```

Set `branches` to the project's configured branch. The hook ignores request content and always syncs that branch, so it cannot deploy an arbitrary commit. It returns `202` when the check is scheduled; read the Portal release log for the deployment result. Rotate the Token if it is exposed. GitHub documents [encrypted Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) and [branch filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

This changes projects managed by the Portal. Releasing or updating Dashboard Portal itself uses the separate signed release process in [releasing-and-ai-handoff.md](releasing-and-ai-handoff.md).
