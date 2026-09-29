# ADR 0027: Master/User และ grants ขององค์กร

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0027-members-and-organization-permissions.md)


Status: Accepted for v0.8.1

## บริบทและการตัดสินใจ

เพิ่ม account roles master/user membership ใช้ stable organization IDs และ explicit permissions Invitation single-use และ revocable sessions Server deny unlisted User APIs ตาม grants ปัจจุบัน Project/job/audit/hooks scope องค์กร ENV read/write แยก Migration owner→Master idempotent ไม่เปิด disabled accounts Manual jobs recheck ก่อน execute/activate automation ไม่ผูกสมาชิก Individual revocation ไม่หยุด polling/hooks ต้อง disable แยก Protect last Master ไม่อ้าง tenant isolation

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
