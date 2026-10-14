# Domainless web services and internal workers

[ภาษาไทย](../../th/how-to/internal-services-and-workers.md) · [Index](../README-index.md)

Choose the service purpose on the first **Create project** step, then configure the repository and runtime.

| Purpose | Port | Domain | Deployment readiness |
| --- | --- | --- | --- |
| Web / API | Explicit or automatically selected free port | Optional; can be added later | Configured HTTP candidate health followed by service activation |
| Worker / background process | No Portal-assigned or reserved port | None | Build/source preflight, then process stability after host activation |

## Web without a domain

Create a Web project and leave domains empty. Deployment does not request a certificate or create a project Nginx route. Removing the last domain removes an existing managed route through the Nginx validation/reload transaction while the service continues on its application port.

Access through IP:port depends on the application's bind address and host firewall. Omitting a domain does not automatically expose a public port. A loopback-bound application needs a local consumer or a separately configured access path. Adding a domain later uses the normal Nginx/TLS flow.

## Workers without ports

Workers support **Node.js, Bun, Go and Python scripts** for continuously running processes such as queue consumers. Portal does not inject PORT/HOST or `Environment=PORT` into a worker unit. Explicit application ENV is preserved, including PORT/HOST if required by the application, but Portal does not manage worker domains or HTTP health.

Node/Bun use a named start script, for example:

```json
{ "scripts": { "start": "node worker.mjs" } }
```

Go starts the compiled binary. Python requires script mode and an entry file inside the source. Workers can have no user ENV; Portal still creates a restricted empty environment file.

PHP, Docker Compose and Python ASGI/WSGI workers are unsupported in this round. This is not a cron/one-shot scheduler; a process that finishes and exits does not pass long-running worker readiness.

## Lifecycle and rollback

1. Install dependencies/build and validate source without executing the candidate start process. The old consumer and candidate are not started together. Build/install scripts remain trusted repository code.
2. The helper snapshots the previous unit, environment, release link and service state, then stops the old worker before changing live files.
3. Start the new process and require the same running PID with no crash/restart over five seconds. Exit or restart during this window fails activation.
4. Failed activation must stop the new process before restoring the previous release and verifying its process. Failure to stop or restore is reported as recovery failure requiring host inspection.

Worker cutover includes a short interruption. Applications should handle SIGTERM and their in-flight jobs. Process stability does not prove queue connectivity or successful business jobs; rollback cannot undo job side effects. Inspect runtime logs and the application's queue system.

Web/Worker purpose cannot change after any release exists, including failed releases; worker runtime is also locked. Create a separate project to change those fields. Rollback uses the release's start script and typed Python settings.

Organization grants, independent ENV read/write permissions, deployment queues, audit and maintenance exclusion retain their existing contracts. Local/Docker checks and unit rendering do not replace actual systemd/helper/reboot acceptance; see the [acceptance record](../knowledge/plans/v1-acceptance-record.md) before go live.
