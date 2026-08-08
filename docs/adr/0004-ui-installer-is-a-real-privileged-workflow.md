# ADR 0004: UI installer is a real, constrained privileged workflow

- Status: Accepted
- Date: 2026-08-03

## Context

รุ่นแรกต้องให้เจ้าของเครื่องติดตั้ง Nginx, Certbot และ Git จาก UI ได้จริง แต่การให้ UI ส่ง shell command ไปหา root โดยตรงเป็นความเสี่ยงที่รับไม่ได้

## Decision

UI และ CLI เรียก installer service ชุดเดียวกันผ่าน privileged helper helper รับเฉพาะ operation ที่มี allowlist และ typed parameters จาก package manifest ที่ระบบดูแล เช่น install หรือ verify `nginx`, `certbot` และ `git` ไม่มี generic `run command` API

ก่อนเปลี่ยนเครื่อง UI ต้องแสดง package, ผล preflight, สิ่งที่จะเปลี่ยน และ confirmation การทำงานต้องบันทึก audit event และ redact secrets จาก output การซ่อมหรือ force ต้องแตะเฉพาะ package/config ที่ Host Manager เป็นเจ้าของ พร้อม backup และ diff

## Consequences

- การเพิ่มเครื่องมือใหม่ต้องเพิ่ม manifest, validation, rollback behaviour และ test; ไม่ใช่เปิดให้ผู้ใช้พิมพ์ package หรือ command อิสระ
- privileged helper เป็น workstream แรกก่อน UI installer
- UI installer ไม่ได้มีสิทธิ์แก้ config Nginx นอก ownership boundary ตาม ADR 0003
