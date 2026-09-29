# ADR 0003: จัดการเฉพาะ Nginx files ที่ระบบเป็นเจ้าของ

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0003-nginx-managed-files-only.md)


- Status: Accepted
- Date: 2026-08-03

## บริบทและการตัดสินใจ

DB เก็บ desired Project/Domain state เขียนเฉพาะ designated managed config/symlinks Apply preview diff, atomic write, backup, nginx -t แล้ว reload Import รับเฉพาะ config ที่ map กับ template ได้ไม่ใช่ two-way sync ทั้ง host External edits ของ owned files เป็น drift ต้อง adopt/restore Custom directives อยู่ managed extension block นอก boundary เป็น read-only

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
