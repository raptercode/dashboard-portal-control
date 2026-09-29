# ประวัติการเปลี่ยนแปลง

[English](../en/CHANGELOG.md)

## 0.8.3 — 2026-09-30

เพิ่ม Portal Node 20.20.2+/22.13+/24.x/26.x และ per-project major แยกจาก Portal ใช้ใน build/health/activation/rollback Installer ลง checksum-verified runtimes พร้อมเลือก Node และ updater คง major เดิม SQLite adapter ใช้ better-sqlite3 บน 20 และ node:sqlite บนรุ่นใหม่ร่วม file/schema เดิม เพิ่ม MIT license และคู่มือติดตั้ง/backup/nvm

แก้ Docker image ให้มี scripts/views และ Node 20 staging dependencies/permissions ก่อน replace Default Portal/app เดิมยัง 24 Node 20 สำหรับ compatibility Backup state พร้อม encryption key ไม่ต้อง convertDB Native app dependencies อาจต้อง rebuild หลังเปลี่ยน major Local tests ไม่แทน Ubuntu/systemd/Nginx/TLS/reboot acceptance

รุ่นก่อนหน้า: [GitHub Releases](https://github.com/raptercode/dashboard-portal-control/releases)
