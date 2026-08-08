# Current architecture context

## Product boundary

Modern Host Manager เป็น control plane สำหรับเจ้าของ single Linux server ที่ deploy application ของตนเอง ไม่ใช่ shared-hosting panel, DNS provider, file manager หรือ multi-tenant platform

ระบบเชื่อว่า owner เลือก repository ที่เชื่อถือได้ การ build หรือ start source code จาก repository จึงเป็นการรัน arbitrary application code โดยตั้งใจ แต่ application code นั้นต้องไม่ได้รับ root privilege หรือ secret ของ control plane

## Trust boundary

```text
Browser / CLI
  -> Management API (unprivileged service account)
  -> Privileged helper (fixed allowlisted operations)
  -> systemd, apt, owned Nginx files, Docker

Project source/build process
  -> dedicated project Unix user
  -> project working and release directories only
```

ไม่มีชั้นใดรับ free-form shell command จาก Browser หรือ API การทำงานที่มีสิทธิ์สูงต้องถูกแปลงเป็น operation แบบมีชนิดและ validate แล้วก่อนถึง helper

## Configuration ownership

- Database: desired state และ audit metadata
- Host Manager Nginx directory: generated state ที่ระบบเป็นเจ้าของ
- Other Nginx files: external state, read-only สำหรับ Host Manager
- Project releases: immutable per deployment เท่าที่เป็นไปได้
- Persistent application data: แยกจาก release และไม่ลบด้วย rollback

## Delivery lifecycle

1. Validate project configuration และ repository reference
2. Build candidate ด้วย project user ใน release ใหม่
3. Start candidate โดยไม่กระทบ active release
4. Run bounded health check
5. เมื่อผ่าน จึงสลับ traffic/config ที่ระบบเป็นเจ้าของ
6. เมื่อไม่ผ่าน เก็บ log และ active release เดิม; rollback ต้องเป็น operation ที่ตรวจสอบได้

รายละเอียด port allocation, release layout, health-check contract และ Node.js major ยังเป็นหัวข้อออกแบบถัดไป

## Test environments

Docker บนเครื่องพัฒนาใช้สำหรับ repeatable integration test ที่แยกได้ เช่น API, database, project build และ Nginx template validation

ต้องมี Ubuntu 24.04 หรือ 25.04 host acceptance test สำหรับเส้นทางที่ขึ้นกับ host จริง: apt/package state, systemd, privileged helper, Nginx reload, file permission และ reboot persistence Docker container ไม่ใช่ตัวแทนที่เพียงพอของ systemd host

Production deployment uses `dashboard-portal.sh` to install the service directly on Ubuntu 24.04 or 25.04. The application binds only to loopback and host Nginx owns public HTTP/HTTPS. A direct install fails closed unless domain resolution, a Certbot certificate, HTTPS redirect/HSTS, and an HTTPS health check succeed. It never removes unrelated Nginx virtual hosts.

The pinned Node runtime is exposed as `node`, `npm`, `npx`, and `corepack` in
`/usr/local/bin`. Native candidates always run `npm ci`; they then run an
optional named build script and a required named start script. Failure metadata
identifies the bounded deployment stage without storing process output or
environment values.

Project activation and domain/TLS sync use a root-owned Unix-socket helper,
not a setuid script or browser-provided command. The helper can create only the
project's service and managed Nginx file, run a bounded health check, and use
Certbot after DNS preflight. It restores the prior project symlink and managed
Nginx file if activation or TLS setup fails.

Dashboard Portal software updates are separate from project deployments. The
web UI only reads and verifies a signed release manifest; it has no endpoint to
apply an update. An owner invokes the root-only `dashboard-portal update`
command through SSH. The command downloads an immutable HTTPS archive, verifies
its Ed25519 manifest signature and SHA-256 digest, then hands the staged release
to the normal installer and its rollback path.

## Implemented v0.1 foundation

- Dashboard single-owner login ด้วย HttpOnly, SameSite cookie และ rate limit สำหรับ login
- CSRF token สำหรับทุก write request
- `doctor` report, tool inventory และ persistent audit log
- UI installer ที่บังคับ confirmation, จำกัด tool เป็น allowlist และสื่อสารกับ helper โดยไม่ผ่าน shell string
- Docker compose sandbox บน Ubuntu 24.04 ที่ publish port 80 สำหรับ `demo.test`
- native project contract ที่สร้าง project user, release paths, systemd hardening และ environment file โดยรับเฉพาะชื่อ npm script
- Git onboarding: author identity, HTTPS credential identifier หรือ SSH deploy-key identifier, project sync configuration และ audit event
- encrypted credential vault สำหรับ HTTPS token และ encrypted per-project `.env`; API คืนเฉพาะ metadata/ชื่อ key

การ provision/release native project บน host, TLS และ Docker-project orchestration ยังไม่ถือว่า implemented; Nginx renderer และ native systemd contract ผ่าน unit test แล้ว แต่ยังไม่เชื่อมกับ privileged helper
