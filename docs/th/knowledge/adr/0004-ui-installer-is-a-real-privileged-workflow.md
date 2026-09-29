# ADR 0004: UI installer เป็น privileged workflow แบบจำกัด

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0004-ui-installer-is-a-real-privileged-workflow.md)


- Status: Accepted
- Date: 2026-08-03

## บริบทและการตัดสินใจ

UI/CLI เรียก installer service ผ่าน typed allowlisted helper เช่น install/verify nginx certbot git ไม่มี generic run-command API ก่อนเปลี่ยน host UI แสดง packages/preflight/changes และ confirmation พร้อม audit/redaction Repair/force แตะเฉพาะ owned files พร้อม backup/diff Tool ใหม่ต้องมี manifest validation rollback และ tests ไม่ให้ UI เปลี่ยน external Nginx

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
