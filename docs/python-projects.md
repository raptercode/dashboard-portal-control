# Deploy Python in a project venv

Select **Python** in the Runtime picker. Automatic detection recognizes
`requirements.txt`, `pyproject.toml`, or `main.py`; review the entry point before
deploying. Go and Compose detection continue to take precedence.

Each release has its own environment:

```text
/srv/hostmgr/projects/<slug>/releases/<release-id>/.venv
```

The installer adds the host's Ubuntu `python3` and `python3-venv` packages.
Project packages are installed only through that release's `.venv/bin/python
-m pip`. The helper drops to the dedicated `hostmgr-<slug>` Unix uid/gid before
creating the venv, invoking pip, running a package build backend, or checking
the interpreter. It rejects uid/gid zero. No `sudo pip`, global pip install,
`--user`, `--system-site-packages`, or `--break-system-packages` is used.

## Choose how to start

| Run type | Entry point example | Required dependencies |
| --- | --- | --- |
| Python script | `main.py` or `src/server.py` | Your script's packages |
| ASGI (FastAPI / Starlette) | `app.main:app` | `uvicorn` plus the application framework |
| WSGI (Flask / Django) | `app:app` or `project.wsgi:application` | `gunicorn` plus the application framework |

The script mode runs `.venv/bin/python -E -s -u <entry>`. It must read `PORT`
from the environment and can use `HOST`, which is set to `127.0.0.1`. ASGI and
WSGI modes invoke Uvicorn/Gunicorn through the venv interpreter with fixed
loopback and port arguments. There are no free-form shell commands or manual
activation scripts. User-site packages and ambient Python paths are ignored.

Choose one dependency source:

- **Requirements:** `requirements.txt` or a path such as
  `requirements/production.txt`; pip installs it inside the venv.
- **Install project:** the selected directory contains an installable
  `pyproject.toml`; pip installs `.` and its declared dependencies into the venv.
- **No dependencies:** create the isolated venv without installing application
  packages. This works for a standard-library-only script.

Pin dependency versions in the repository for reproducible new releases. The
Portal runs `pip check` after installation. Private indexes, native OS libraries,
Poetry/uv lockfile-specific installers, and arbitrary pre-start/migration commands
are not configured by this initial Python runtime. Use Docker Compose when a
project requires a custom operating-system environment.

## Deployment and rollback

The Portal copies source and the saved environment while excluding repository
venvs, caches and readiness markers. It reports source preflight separately from
the host health check. On the host, the helper copies source to its final release
path, sets project ownership, then creates the venv as the project user. This
avoids moving a venv after pip has written absolute console-script shebangs.

After installation succeeds, systemd starts the application as the same project
user and the helper checks the configured HTTP path. Installation failure occurs
before switching the active symlink. Start/health/TLS failure restores the prior
symlink, systemd unit and environment file. The old release keeps its own venv;
rollback reuses it without downloading packages again. Python entry settings are
saved with each release so a later settings edit does not change its launcher.

An installation without the host helper stops after source preflight and does
not claim the application passed its HTTP check. The UI demo still simulates
deployment, as for other runtimes. Existing production hosts need an installer
update containing Python support before deploying Python projects.

## Verification

`node --test test/python-project.test.mjs` uses an offline fixture wheel to verify
real venv creation, dependency isolation, an HTTP application, reuse on rollback,
and a failed separate release. Set `HOSTMGR_PYTHON_PATH` for a nonstandard local
interpreter; production always uses `/usr/bin/python3` to create the venv.
The Linux test runs with nonzero uid/gid. Tests of a local venv do not replace
acceptance checks of systemd and Nginx/TLS on the production host.

References: [Python venv](https://docs.python.org/3/library/venv.html),
[pip install](https://pip.pypa.io/en/stable/cli/pip_install/),
[Uvicorn settings](https://uvicorn.dev/settings/),
[Gunicorn quickstart](https://gunicorn.org/quickstart/).
