# ADR 0001: Ubuntu 24.04 LTS is the supported host

- Status: Accepted
- Date: 2026-08-03

## Context

ระบบจัดการ package, systemd, Nginx และ Certbot ของ host โดยตรง จึงต้องมี platform เป้าหมายที่ทดสอบซ้ำได้เพียงหนึ่งชุดในระยะแรก เดิมเอกสารอ้าง Ubuntu 25.04 ซึ่งหมดระยะสนับสนุนแล้ว

## Decision

รุ่นแรกจะรองรับและรับรองเฉพาะ Ubuntu Server 24.04 LTS amd64 ทุก workflow ที่เปลี่ยน host ต้องผ่านการทดสอบบน environment นี้

เครื่องพัฒนาที่เป็น Ubuntu 25.04 ใช้ทำงานกับ source code หรือรัน Docker test ได้ แต่ไม่ถือว่าเป็นผลรับรองการทำงานบน host

## Consequences

- scripts, package manifests และเอกสารติดตั้งต้องระบุ Ubuntu 24.04
- ระบบจะยังไม่อ้างว่ารองรับ Ubuntu 26.04 หรือ distribution อื่นจนกว่าจะมี ADR และ test evidence เพิ่ม
- Docker ใช้ทดสอบ service/API และ dependency isolation ได้ แต่ต้องมี VM test แยกสำหรับ package installation, systemd, Nginx reload และ reboot
