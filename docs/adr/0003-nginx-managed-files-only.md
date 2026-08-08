# ADR 0003: Nginx is managed through owned files only

- Status: Accepted
- Date: 2026-08-03

## Context

Host Manager must create reverse proxies and detect config drift, but must not destroy Nginx configuration owned by the user or other tools.

## Decision

The database stores desired Domain and Project state. Host Manager owns only config under a designated directory such as `/etc/nginx/sites-available/hostmgr/` and symlinks it creates itself.

Apply must preview a diff, write atomically, back up owned files, run `nginx -t`, and reload only after validation passes. Import reads/adopts only config that can be mapped to a managed template; it is not two-way sync of the whole machine's Nginx.

## Consequences

- External edits to Host Manager-owned config are detected as drift and require the user to adopt or restore
- Custom directives must live in a defined managed extension block, not as raw whole-file config
- Config outside the ownership boundary is read-only for this system
