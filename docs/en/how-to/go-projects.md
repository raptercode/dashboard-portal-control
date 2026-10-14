# Deploy a Go project

[ภาษาไทย](../../th/how-to/go-projects.md)


Choose **Go** in the project Runtime menu, or use automatic detection on a
directory containing `go.mod`. A Compose file still takes precedence when both
are present. Detection suggests Go but asks you to review the main package.

1. Set **Directory** to the directory containing `go.mod`.
2. Set **Main package** to `.` if `package main` lives there, or a local package
   such as `./cmd/api`. File names, wildcard patterns and shell commands are not
   accepted. A selected library package cannot be deployed as an executable.
3. Sync the repository. Open Deploy, save the application's environment and
   select its health path, for example `/healthz`.
4. Deploy. The Portal downloads modules and compiles a fresh candidate binary,
   starts it on a temporary port, and checks HTTP before requesting host
   activation. A failed candidate does not replace the active release.

The application must read `PORT` from its environment. `HOST` is provided as
`127.0.0.1`. Portal reserves both values for its candidate and active service;
saved project values cannot override them. Go applications do not need a
`package.json`, a start script, or `go run` on the production request path.

```go
package main

import (
    "log"
    "net"
    "net/http"
    "os"
)

func main() {
    http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })
    address := net.JoinHostPort(os.Getenv("HOST"), os.Getenv("PORT"))
    log.Fatal(http.ListenAndServe(address, nil))
}
```

## Build and host contract

Install a Go compiler on the host before the first native Go deployment.
The current Portal installer does not provision Go, and the Setup tool card
cannot install it. The default host executable is `/usr/local/bin/go`; expose
your installed compiler at that path. Choose a compiler compatible with the
repository's `go.mod` and verify it with `/usr/local/bin/go version`.
**Setup** and `dashboard-portal --versions` report the observed host version.
Selecting the Go runtime or rerunning the Portal installer does not install
a missing compiler. Follow the [official Go installation guide](https://go.dev/doc/install)
when preparing the host.

Each candidate runs fixed argument vectors without a shell:

```text
go mod download
go list -mod=readonly -f {{.Name}} ./cmd/api
go build -mod=readonly -trimpath -o hostmgr-app ./cmd/api
```

Builds always run; Skip Build applies to Node/Bun only. Commit a consistent
`go.mod` and `go.sum` after running `go mod tidy` locally. Go verifies downloaded
module checksums using its normal module behavior. Caches live in the project
workspace outside the releases. `-modcacherw` keeps cache directories removable
by the Portal when deleting a project. The original synced checkout is not modified.

The initial native path uses `CGO_ENABLED=0`, `GOWORK=off`, and
`GOTOOLCHAIN=local`. It builds one module with the installed host compiler,
without automatically downloading a newer toolchain. A newer minimum version
in `go.mod` fails with build diagnostics. For cgo, workspace-spanning modules,
custom build flags, code generation or extra system libraries, use the existing
Docker Compose runtime. Repository clone credentials are not automatically
forwarded to private module downloads.

The privileged helper runs the compiled binary as the project's dedicated Unix
user through systemd. Existing runtime logs, health checks, domain/TLS routing,
and release rollback are shared with the native deployment flow. Validate
systemd, Nginx activation and rollback on an Ubuntu host before production use;
the local compiler integration test does not certify these host operations.

See the official [Go command reference](https://pkg.go.dev/cmd/go) and
[toolchain selection documentation](https://go.dev/doc/toolchain).
