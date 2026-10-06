# ประวัติการเปลี่ยนแปลง

[English](../en/CHANGELOG.md)

## 0.8.7 — 2026-10-06

- ตรวจหา Prisma ในโปรเจกต์ Node/Bun และ generate client ก่อน build โดยใช้ environment ของโปรเจกต์ ไม่ต้องเพิ่ม build script และไม่รัน migration, seed หรือดาวน์โหลด CLI อัตโนมัติ
- รองรับ pnpm 12 และค้นหา pnpm ที่ติดตั้งข้าง Node runtime รวมถึงตำแหน่ง global การติดตั้งผ่าน Setup ยังเป็นทางเลือก
- แสดงคำสั่ง npm/pnpm และ lockfile ตามที่ตรวจพบในหน้าตรวจการตั้งค่า deploy

## 0.8.6 — 2026-10-06

- เพิ่ม pnpm แบบทางเลือกในหน้า Setup การติดตั้งและอัปเดต Portal ไม่ติดตั้ง pnpm อัตโนมัติ
- โปรเจกต์ Node เลือก npm/pnpm จาก packageManager และ lockfile หากยังไม่มี pnpm หรือเวอร์ชันไม่ตรงจะแจ้งให้ติดตั้งก่อน โดยไม่ดาวน์โหลดหรือสลับรุ่นเอง
- ใช้ pnpm ในขั้นตอน install, build, health check, service และ rollback ตาม Node runtime ของโปรเจกต์ ตรวจ frozen lockfile และรักษา relative symlink เมื่อ activate
- แสดง error ต้นทางจากการติดตั้ง dependencies ใน deploy log พร้อมปกปิด secrets
- ดู [โปรเจกต์ pnpm](how-to/pnpm-projects.md) สำหรับวิธีติดตั้งและข้อกำหนด

## 0.8.5 — 2026-09-30

เพิ่ม CLI `-h`/`--help` แสดงคำสั่งและ options ทั้งหมด และ `-v`/`--versions`/`--version` แสดง Portal/runtime versions โดยไม่ต้อง sudo ดู help ของแต่ละคำสั่งได้ก่อน mutation

Updater คง Node major จาก config หรือ runtime ปัจจุบันของเครื่องเก่า Installer เตรียมเฉพาะ major ที่เลือกและชี้ global node/npm/npx ให้ตรงกัน Node 26 ที่ไม่ได้ใช้ไม่บล็อก update ของ Node 20/22/24 อีก เมื่อเลือก 26 จึงติดตั้ง libatomic1 รองรับ updater เก่าที่ไม่ส่ง major โดยตรวจ config/service เดิม Fresh install ยัง default 24 และไม่ลบ runtime ของ project ที่มีอยู่

## 0.8.4 — 2026-09-30

- Sync, Deploy, wizard และ Rollback แสดง progress บนการ์ด Projects โดยไม่เปิด popup log อัตโนมัติ
- อัปเดตทุก 1.5 วินาทีระหว่าง deploy และทุก 5 วินาทีเมื่อว่าง รวมงาน Auto deploy; พัก request เมื่อซ่อนแท็บ
- แสดงเตรียม source, dependencies, build, health check, activation และผลสุดท้าย เปิด log เองผ่านปุ่มดูรายละเอียด
- รักษาเมนู/details ที่เปิดและโฟกัสคีย์บอร์ดระหว่างอัปเดต API summary จำกัดตามสิทธิ์ project และไม่ส่งข้อความ log หรือรายละเอียด failure ส่วนตัว

Tests ครอบคลุม polling, หลายโปรเจกต์, สถานะจบงาน, network failure, focus และสิทธิ์ API ยังไม่ได้ตรวจ interactive browser หรือ production host การเผยแพร่ release ไม่ได้อัปเดต host ที่ติดตั้งไว้

## 0.8.3 — 2026-09-30

เพิ่ม Portal Node 20.20.2+/22.13+/24.x/26.x และ per-project major แยกจาก Portal ใช้ใน build/health/activation/rollback Installer ลง checksum-verified runtimes พร้อมเลือก Node และ updater คง major เดิม SQLite adapter ใช้ better-sqlite3 บน 20 และ node:sqlite บนรุ่นใหม่ร่วม file/schema เดิม เพิ่ม MIT license และคู่มือติดตั้ง/backup/nvm

แก้ Docker image ให้มี scripts/views และ Node 20 staging dependencies/permissions ก่อน replace Default Portal/app เดิมยัง 24 Node 20 สำหรับ compatibility Backup state พร้อม encryption key ไม่ต้อง convertDB Native app dependencies อาจต้อง rebuild หลังเปลี่ยน major Local tests ไม่แทน Ubuntu/systemd/Nginx/TLS/reboot acceptance

รุ่นก่อนหน้า: [GitHub Releases](https://github.com/raptercode/dashboard-portal-control/releases)
