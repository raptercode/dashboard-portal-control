# ประวัติการเปลี่ยนแปลง

[English](../en/CHANGELOG.md)

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
