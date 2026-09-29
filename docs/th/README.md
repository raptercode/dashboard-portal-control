# Dashboard Portal

[English](../en/README.md) · [สารบัญเอกสาร](README-index.md) · [Changelog](CHANGELOG.md)

Dashboard สำหรับดูแลแอปบน Linux server ของคุณ เชื่อม Git deploy แอป อ่าน logs ตั้ง domain/TLS และจัดการสมาชิกตามองค์กร รองรับ trusted Node.js/Bun/Go/Python/PHP/Docker Compose projects เลือก Node 20/22/24/26 แยก Portal กับแอป พร้อม build/health/activation/rollback, auto deploy, encrypted credentials/ENV และ signed Portal updates

ระบบจัดการ host เดียว ต้องเลือก source ที่เชื่อถือเพราะ build/start รัน code จริง Organization permissions ไม่แยก host security sandbox

## ติดตั้ง Ubuntu

Installer รับ Ubuntu 24.04/25.04 amd64 ต้อง domain ชี้ host และ TCP80/443 เข้าถึงได้ ใช้ interactive SSH พร้อม root/sudo ติดตั้ง latest stable ด้วยคำสั่งเดียว:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash
```

ถ้าต้องการระบุรุ่น ให้ใช้ `curl -fsSL https://dashboard-portal.cloud/install.sh | bash -s -- --version v0.8.3` โดยเปลี่ยน tag เป็นรุ่นที่เผยแพร่แล้วและใส่ `v` นำหน้า ต้องใส่อีเมลจริงสำหรับ Let's Encrypt/Certbot แต่กรอกเมื่อ terminal ถามได้ ไม่ต้องใส่ในคำสั่ง อีเมล TLS แยกจากบัญชี login อ่าน [version และข้อมูลที่ต้องกรอก](how-to/production-install.md) ก่อนติดตั้ง


Bootstrap ถาม domain/email และใช้ Node 24 เป็นค่าเริ่มต้น ดาวน์โหลด release ตรวจ SHA-256 และเรียก installer จากนั้นถาม initial password และตรวจ HTTPS อ่าน [เตรียมเครื่อง/backup/recovery](how-to/production-install.md) และ [runtime versions](how-to/node-versions.md) ตรวจเครื่องมือจริงใน Setup/Doctor

## ทดลองบนเครื่องพัฒนา

```bash
git clone https://github.com/raptercode/dashboard-portal-control.git
cd dashboard-portal-control
cp .env.example .env
```

PowerShell ใช้`Copy-Item .env.example .env` ตั้ง HOSTMGR_ADMIN_PASSWORD และ HOSTMGR_SECRET_KEY เป็น base64 32bytes เก็บ key เดิมเมื่อมี state

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npm ci
npm run demo
```

เปิดhttp://localhost:3000แล้วสร้างบัญชีแรก Demo อนุญาต HTTP และไม่ใช้ secure cookies อย่าเปิด public login นี้ Node 20 อาจต้อง C/C++/Python สำหรับ better-sqlite3 หลังเตรียม.env ใช้`docker compose up --build`ได้ที่http://localhost Compose ไม่รับรอง host systemd/TLS

## Deploy แอปแรก

1. สร้างองค์กร/สมาชิกและ credential ของ private repository
2. สร้าง Project ตั้ง repository/branch/runtime และ Node major
3. ตั้ง directory/build/start/health แล้ว sync
4. ใส่ Environment และ domain ที่ DNS ชี้ host
5. Deploy ตรวจ build/health/activation/HTTPS/logs และ rollback

Node ใช้ npm ci เมื่อ lock ใช้ได้ มิฉะนั้น fallbacknpm install เฉพาะ candidate แอปต้องอ่าน PORT จาก Portal ENV อ่าน/แก้ตาม env.read/env.write และเข้ารหัสใน DB เปลี่ยน Node/ENV มีผล release ใหม่

## Update และทดสอบ

```bash
sudo dashboard-portal update --check
sudo dashboard-portal update
sudo systemctl is-active dashboard-portal hostmgr-deploy-helper nginx
curl -fsS https://portal.example.com/api/health
curl -fsSI https://portal.example.com/
```

Backup state+key ก่อน update Updater ตรวจ Ed25519/SHA-256 และเก็บ Node major เดิม UI แจ้ง version แต่ apply ผ่าน SSH

```bash
npm test
node scripts/test-modules.mjs --list
bash -n install.sh dashboard-portal.sh
```

Windows ใช้ Git Bash Local tests ไม่แทน host acceptance ดู [testing](how-to/testing.md), [access control](how-to/access-control.md), [auto deploy](how-to/project-auto-deploy.md), [Go](how-to/go-projects.md), [Python](how-to/python-projects.md), [architecture](knowledge/context/architecture.md), [roadmap](knowledge/context/scope-and-roadmap.md), [ADR](knowledge/adr/README.md) และ [release guide](how-to/releasing-and-ai-handoff.md)

## License

Code ใช้ [MIT](../../LICENSE) Dependencies และ [runtime logos](../../public/ui/runtime-logos/SOURCES.md) ตามสิทธิ์เจ้าของเดิม
