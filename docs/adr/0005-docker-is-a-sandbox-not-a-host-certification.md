# ADR 0005: Docker sandbox does not certify host behaviour

- Status: Accepted
- Date: 2026-08-03

## Context

ผู้ใช้ต้องการให้พัฒนาและทดสอบผ่าน Docker บนเครื่องหลักก่อน และจะชี้ `demo.test` มายัง container แต่ product นี้มีความสามารถที่ขึ้นกับ Ubuntu host จริง เช่น apt, systemd, file ownership และ Nginx reload

## Decision

Docker compose จะรัน Dashboard ใน `demo` mode บน Ubuntu 24.04 และ publish port 80 เพื่อรองรับ `demo.test` ใน environment ทดสอบ Installer ใน mode นี้ตรวจ allowlist, confirmation, audit และ state transition ได้ แต่ห้ามเปลี่ยน package ของ Docker host

การรับรอง privileged helper, package installation, systemd และ reboot persistence ต้องใช้ Ubuntu 24.04 VM แยกต่างหาก

## Consequences

- UI ต้องแสดงว่าเป็น Sandbox mode อย่างเด่นชัด
- CI สามารถใช้ Docker สำหรับ API/integration test ที่ไม่แตะ host
- ห้ามตีความการผ่าน Docker test ว่า installer บน server จริงผ่านแล้ว
