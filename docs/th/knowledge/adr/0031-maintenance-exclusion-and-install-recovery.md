# ADR 0031: Maintenance exclusion และ installation recovery

[English](../../../en/knowledge/adr/0031-maintenance-exclusion-and-install-recovery.md)

Status: Accepted สำหรับ working tree ปัจจุบัน; operational acceptance ยัง Pending
Date: 2026-10-01

## ที่มา

Health failure ที่ใช้ explicit `exit` ไม่ผ่าน ERR-only trap การ copy SQLite DB/WAL/SHM ขณะ writer ทำงานไม่พิสูจน์ backup ที่ consistent การกู้เฉพาะ Portal service state ทำให้ helper ยังหยุดอยู่ และ CLI/Nginx catchall ที่ถูกเขียนทับต้องมี snapshot การหยุด services ขณะมี host operation เสี่ยงตัดงานกลางทาง

## การตัดสินใจ

ใช้ EXIT recovery เมื่อ exit ไม่ใช่ 0 รวม explicit failure; INT/TERM คืน 130/143 ปิด recursive traps ระหว่าง recovery เมื่อสำเร็จให้ disarm แล้ว cleanup temporary files อย่างปลอดภัย

เก็บ enabled/active ของ Portal และ helper แยกกัน หยุดทั้งสองก่อน snapshot SQLite/control-plane state กู้ไฟล์เมื่อ snapshot ครบทั้งชุดเท่านั้น ถ้า backup ล้มกลางทางให้กู้ service state โดยไม่ลบหรือแทน originals ที่ยัง snapshot ไม่ครบ ใช้ per-item completion marker แยก absent original จาก incomplete copy กู้ helper ก่อน Portal รวม CLI directory, catchall available/enabled และ maintenance tmpfiles config ใน recovery ไม่ rollback packages หรือ TLS certificates ที่ออกแล้วโดยอัตโนมัติ

ใช้ Linux `flock` shared lease สำหรับ host operations ที่เข้าร่วม และ exclusive nonblocking lock ของ installer ก่อนหยุด services ครอบ host-mode HTTP mutations, background queues/polling และ helper dispatch Installer ที่เจอ busy ปฏิเสธก่อน service stop ส่วน host operations ปฏิเสธ lease ที่ busy/unsafe/unavailable Demo mode แยกจาก host mode ถือ lease ตลอด operation และคืนหลังเสร็จ

Lock เริ่มต้นคือ `/run/dashboard-portal-maintenance/operations.lock` แยกจาก `/run/dashboard-portal` RuntimeDirectory ของ helper Directory root:dashboardportal 0750; regular file ที่มี hard link เดียว root:dashboardportal 0660 ปฏิเสธ symlinks, owner ผิด, directory permissions ไม่ปลอดภัย และ lock ที่ world access ได้ ไม่ truncate/remove/replace inode เดิมระหว่าง update เพราะคนละ inode ทำให้ exclusion ไม่ทำงาน ต้องใช้ Linux และ utility `flock`

`/etc/tmpfiles.d/dashboard-portal-maintenance.conf` สร้าง volatile lock directory/file กลับเมื่อ boot ทั้งสอง services order หลัง `systemd-tmpfiles-setup.service` นี่คือ implementation เตรียม reboot แต่ acceptance systemd boot/reboot จริงยังเป็น release gate

## Trust boundary และผลกระทบ

เป็น cooperative update exclusion ไม่ใช่ sandbox หรือ drain protocol ทั่วไป ยังต้องใช้ trusted repositories และ privileged-helper boundary เดิม Process ที่ติดตั้งจาก legacy versions ไม่ถือ shared lease การได้ exclusive lock จึงไม่พิสูจน์ว่างานเก่าว่าง Upgrade ครั้งแรกต้องยืนยันว่า host ไม่มี deploy/tool/mail/background work ค้าง ไม่รับรองการ drain งาน legacy อัตโนมัติ คำสั่ง root นอก paths ที่เข้าร่วมต้องเคารพ maintenance ด้วย

Local Bash recovery และ Linux lease fixtures พิสูจน์พฤติกรรมที่จำกัด ไม่รับรอง service shutdown จริง, public TLS, database/key restore หรือ provider networking ดู [acceptance record](../plans/v1-acceptance-record.md) และ [readiness priorities](../plans/v1-readiness-plan.md) ก่อน final release
