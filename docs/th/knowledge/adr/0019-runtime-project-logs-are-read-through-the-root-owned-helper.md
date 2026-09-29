# ADR 0019: Runtime logs อ่านผ่าน helper

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0019-runtime-project-logs-are-read-through-the-root-owned-helper.md)


- Status: Accepted
- Date: 2026-08-13

## บริบทและการตัดสินใจ

Portal ไม่มี systemd-journal group ที่อ่านทุก host unit เพิ่ม read-project-log ที่รับ project slug derive unit เอง ตรวจ allowlist และ fixed recent lines ไม่รับ arbitrary unit/time/priority Runtime output ของแอปอาจมี secrets จึง redact known secrets/limit output Demo แสดง placeholder ไม่ fabricate logs Deployment history ยังแยกจาก runtime journal

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
