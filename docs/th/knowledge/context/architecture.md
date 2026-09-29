# สถาปัตยกรรมปัจจุบัน

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/context/architecture.md)


Dashboard Portal เป็น control plane สำหรับ Linux host เดียว Master/User และ organization grants จำกัดการเข้าถึงใน Portal แต่ไม่แยก host sandbox ผู้ดูแลต้องเลือก repository ที่เชื่อถือ เพราะ build/start รัน application code จริง Candidate ใช้ context ของ Portal ที่ไม่มี root ส่วน native service ที่ activate แล้วใช้ Unix user ของ project

## Trust boundary

Browser/CLI → management API (unprivileged) → root-owned Unix socket helper → allowlisted systemd/apt/Nginx/Docker/mail operations ไม่มี free-form shell จาก browser/API ทุก operation ต้อง typed และ validated Helper ทำเฉพาะไฟล์/paths ที่เป็นเจ้าของและ restore เมื่อ activation/domain/TLS ล้มเหลว

Database เก็บ desired state/audit Generated Nginx เป็น managed state และ Nginx ของระบบอื่นเป็น read-only Release เก็บ source/metadata แยกจาก persistent application data Rollback ไม่ลบข้อมูลแอป

## Delivery lifecycle

Validate config/repository → เตรียม candidate/dependencies/build → start/health → activation และ domain/TLS → เก็บ audit หรือ restore release เดิม Ports auto-assign Release snapshot Node major ให้ rollback ใช้ runtime ถูกต้อง Docker Compose build/start ใน controlled activation และปฏิเสธ privileged/host namespaces/host bind mounts แต่ไม่ใช่ security isolation สำหรับ untrusted tenant

Node 20/22/24/26 อยู่ใต้ `/opt/node-v<version>` Portal กับ project เลือก major แยกกัน Global links อยู่ Node 24 SQLite ใช้ node:sqlite (22.13+) หรือ better-sqlite3 (20) กับ schema/file/key เดิม Node/Bun ใช้ lock install พร้อม isolated fallback, optional named build และ required start script Go/Python ใช้ runtime contract ตามคู่มือ

## Host services

ติดตั้งผ่าน [bootstrap](../../how-to/production-install.md) แล้วใช้ systemd และ Nginx loopback 3100 Production ต้องผ่าน DNS, certificate, HTTPS redirect/HSTS และ health ห้ามเปลี่ยน Nginx ภายนอก

Mail helper ถอดรหัส desired state ภายใน host จัด Postfix/Dovecot/OpenDKIM API ตรวจ egress และ helper อ่าน UFW inbound policy ไม่เปิด firewall เอง TLS ล้มเหลวใช้ loopback-only ต้องตรวจ external delivery แยกจาก local evidence

Notification hooks เข้ารหัส ส่ง provider-aware success/failure payload แต่ delivery ไม่เปลี่ยน deployment state UI ตรวจ signed manifest ได้แต่ apply Portal update ต้อง SSH root command ที่ตรวจ Ed25519/SHA-256 Project deployment แยกจาก Portal update

## Evidence และประวัติ

Docker ใช้ทดสอบ API/dependencies/templates ไม่รับรอง apt/systemd/permissions/reboot ต้องมี Ubuntu host acceptance v0.1 เดิมเป็น owner-only; v0.8.1 ขยาย Master/User ตาม ADR 0027 ดู [scope/roadmap](scope-and-roadmap.md) และ [ADR](../adr/README.md) สำหรับสถานะและประวัติ
