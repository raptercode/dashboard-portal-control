# Dashboard UI routing

Dashboard Portal uses one authenticated application shell with URL-backed
sections. These paths are intentionally explicit so a browser reload, bookmark,
or back/forward navigation opens the same section:

- `/` — overview
- `/setup` — host and Git setup
- `/projects` — project management
- `/credentials` — repository credentials
- `/activity` — audit activity
- `/settings` — Portal settings

`public/router.js` is the single route map. The server only falls back to the
application shell for those allowlisted paths; unknown paths remain a 404. This
keeps static-file handling constrained while allowing future UI work to move a
section into its own module or template without changing public URLs.
