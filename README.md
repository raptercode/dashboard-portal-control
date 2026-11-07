# Strckro

![Strckro](public/ui/brand/wordmark.svg)

**Your stack. Under control.** A self-hosted deployment control plane for people, CLI workflows, and AI agents.

[ภาษาไทย](docs/th/README.md) · [English](docs/en/README.md) · [เอกสาร / Documentation](docs/README.md) · [Changelog](CHANGELOG.md)

Dashboard สำหรับจัดการแอปบน Linux server — Git deployment, logs, domains/TLS และสิทธิ์ตามองค์กร

A dashboard for applications on your Linux server: Git deployment, logs, domains/TLS and organization access.

## Install / ติดตั้ง

Ubuntu 24.04 / 25.04 amd64 · interactive SSH · root or sudo · domain + inbound TCP 80/443.

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash
```

คำสั่งด้านบนติดตั้ง **latest stable** หากต้องการระบุเวอร์ชัน ให้เพิ่ม `--version` พร้อม tag ที่มี `v` นำหน้า เช่น `v1.1.0`:

The command above installs **latest stable**. To select a specific release, pass `--version` with its `v`-prefixed tag:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash -s -- --version v1.1.0
```

**ต้องใส่อีเมล:** ระบบถาม domain และ TLS email ใน terminal จึงไม่ต้องใส่ใน command line ใช้อีเมลจริงที่ติดต่อได้สำหรับ Let's Encrypt/Certbot และโดเมนที่ DNS ชี้ server นี้ อีเมล TLS แยกจากอีเมลบัญชี login ที่ตั้งภายหลัง ใช้ Node 24 เป็นค่าเริ่มต้น แล้วตรวจ checksum ก่อนติดตั้ง ดูการเตรียมเครื่องและสำรองข้อมูลใน [ภาษาไทย](docs/th/how-to/production-install.md) หรือ [English](docs/en/how-to/production-install.md)

**Email is required:** enter a reachable email for Let's Encrypt/Certbot when the terminal prompts; it need not be in the command line. Also enter the Portal domain pointing to this server. TLS email is separate from the login email configured later. The bootstrap uses Node 24 by default and verifies the release checksum. See the guides above for prerequisites and backup/recovery. Public URL publishing is a separate [maintainer step](docs/en/how-to/bootstrap-hosting.md).

Remote CLI (`skctl` / `strckro`): `npm install -g strckro` — login ผ่าน browser/`--no-browser`/`--token`, deployments, domain/TLS และ ENV สำหรับคนและ AI — [ภาษาไทย](docs/th/how-to/cli.md) · [English](docs/en/how-to/cli.md). Source อยู่ในโปรเจคข้างกัน `dashboard-control-cli`; ต้องอัปเดต backend ให้รองรับ CLI ก่อน

Strckro v1.1.0 introduces the Signal interface with modular workspaces, responsive navigation, runtime detection and explicit npm/pnpm selection. The installer is now `strckro.sh` and the host command is `strckro` (it replaces `dashboard-portal`); host directories, service names, `HOSTMGR_*` variables, stored configuration and the signed update feed keep their names. A host on an older release must run the new installer once; see the [brand and migration notes](docs/en/how-to/strckro.md).

## UI preview / พรีวิวหน้าตาใหม่

Run `npm run preview:ui`, then open [localhost:4343](http://127.0.0.1:4343). Demo login: `preview@strckro.local` / `Strckro-Preview-2026!`.

พรีวิวใช้ข้อมูลชั่วคราวและแอปตัวอย่าง แยกจาก production ดูโครงหน้า การนำทาง และวิธีตรวจสอบใน [ภาษาไทย](docs/th/knowledge/context/ui-rewrite-layout.md) หรือ [English](docs/en/knowledge/context/ui-rewrite-layout.md).

Code: [MIT License](LICENSE). Runtime logo rights: [sources](public/ui/runtime-logos/SOURCES.md).
