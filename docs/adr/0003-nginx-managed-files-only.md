# ADR 0003: Nginx is managed through owned files only

- Status: Accepted
- Date: 2026-08-03

## Context

Host Manager ต้องสร้าง reverse proxy และตรวจ config drift แต่ไม่ควรทำลาย Nginx configuration ที่ผู้ใช้หรือเครื่องมืออื่นดูแลอยู่

## Decision

ฐานข้อมูลเก็บ desired state ของ Domain และ Project ส่วน Host Manager เป็นเจ้าของเฉพาะ config ใน directory ที่กำหนด เช่น `/etc/nginx/sites-available/hostmgr/` และ symlink ที่ระบบสร้างเองเท่านั้น

การ apply ต้อง preview diff, เขียนแบบ atomic, สำรองไฟล์ที่ระบบเป็นเจ้าของ, รัน `nginx -t` และ reload หลัง validation ผ่านเท่านั้น การ import เป็นการอ่าน/adopt เฉพาะ config ที่แปลงเป็น managed template ได้ ไม่ใช่ two-way sync ของ Nginx ทั้งเครื่อง

## Consequences

- การแก้ config ที่ Host Manager เป็นเจ้าของจากภายนอกจะถูกตรวจเป็น drift และต้องให้ผู้ใช้เลือก adopt หรือ restore
- custom directives ต้องอยู่ใน managed extension block ที่กำหนด ไม่ใช่ raw config ทั้งไฟล์
- config นอก ownership boundary เป็น read-only สำหรับระบบนี้
