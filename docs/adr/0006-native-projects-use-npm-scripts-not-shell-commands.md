# ADR 0006: Native projects use npm scripts, not UI-provided shell commands

- Status: Accepted
- Date: 2026-08-03

## Context

README รุ่นแรกเคยระบุ build/start command แต่การรับ shell string จาก UI แล้วนำไปประกอบเป็น command หรือ systemd unit ทำให้มี command injection boundary ที่ตรวจสอบได้ยาก

## Decision

Native Node.js project ระบุ `buildScript` และ `startScript` ซึ่งเป็นชื่อ npm script เท่านั้น ตัวอักษรที่อนุญาตคือ letters, digits, colon, underscore และ hyphen helper จะ execute เป็น argument vector ที่กำหนดตายตัว เช่น `/usr/bin/npm run start` ภายใต้ Unix user เฉพาะ project

Environment variable จะอยู่ใน root-owned environment file แยกจาก unit และ log; ไม่แสดง value กลับผ่าน API หรือ audit event

## Consequences

- native project ที่ต้องการ command นอกเหนือจาก npm script ใช้ Docker mode หรือยังไม่อยู่ในขอบเขต
- systemd unit สามารถใช้ hardening directives และไม่มี shell interpolation จาก UI
- README และ UI ต้องใช้คำว่า script แทน command เมื่อ Native mode
