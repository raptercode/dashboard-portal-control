# ADR 0013: Owner sessions persist for seven days with hashed identifiers

- Status: Accepted
- Date: 2026-08-07

## Context

An in-memory session map made every Dashboard Portal session disappear whenever the Node service restarted. Owner sessions must survive a normal service restart without writing a reusable browser cookie into persistent state. Passwords must never be accepted from, retained in, or propagated by URLs.

## Decision

The owner session cookie has a fixed seven-day lifetime. Persistent state retains only the SHA-256 hash of the cookie identifier, the CSRF value, and the expiry time; it never stores the raw session cookie. Expired entries are ignored and removed during the next session creation or logout.

Any non-API GET request containing a `password` query parameter is redirected to the same URL without that parameter before static content is served. The browser also removes that parameter from its address bar during boot. Production Nginx sends `Referrer-Policy: no-referrer`.

## Consequences

- A normal Dashboard service restart does not log the owner out, but logout, expiry, or rotating the owner password still requires a new login.
- Backups of the Dashboard state contain session hashes and CSRF values, so they remain access-controlled with the rest of the Dashboard state.
- Query strings cannot be treated as a credential transport. Existing logs cannot be retroactively unexposed; any password present in a historical URL must be rotated.
