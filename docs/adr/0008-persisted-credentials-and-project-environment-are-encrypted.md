# ADR 0008: Persisted credentials and project environment are encrypted

- Status: Accepted
- Date: 2026-08-03

## Context

Private HTTPS repositories ต้องใช้ token จริง และ project ต้องมี `.env` ที่ใช้ซ้ำข้าม deployment ได้ ผู้ใช้เลือกให้ระบบบันทึกทั้งสองอย่างครั้งเดียวแล้วใช้ต่อได้

## Decision

Dashboard รับ HTTPS token และ `.env` ผ่าน authenticated, CSRF-protected request แล้วเข้ารหัสด้วย AES-256-GCM ก่อนเขียนลง persistent state API, audit log และ UI จะคืนเฉพาะ credential metadata และชื่อ environment keys เท่านั้น

`HOSTMGR_SECRET_KEY` เป็น base64 key ขนาด 32 bytes ที่อยู่ใน `.env` ของ deployment และต้องคงเดิมตลอดอายุของ state หาก key หายหรือเปลี่ยน ระบบจะไม่สามารถถอดรหัสค่าเดิมได้

เมื่อ host deployment helper ถูกเชื่อมแล้ว helper จะถอดรหัสค่าใน memory เท่าที่จำเป็น ใช้ token กับ Git โดยไม่ใส่ใน command line/log และสร้าง `.env` ของ release ตาม permission ของ project user

## Consequences

- Backup state ต้อง backup `HOSTMGR_SECRET_KEY` อย่างปลอดภัยด้วย มิฉะนั้น restore credential ไม่ได้
- การ rotate master key ต้องเป็น operation เฉพาะที่ถอดและเข้ารหัส secrets ทุกค่าใหม่แบบ atomic; ยังไม่รองรับใน v0.1
- ผู้ใช้จะดู/แก้ไข `.env` ได้โดยการบันทึกเนื้อหาใหม่ ไม่ใช่ read-back ผ่าน UI
