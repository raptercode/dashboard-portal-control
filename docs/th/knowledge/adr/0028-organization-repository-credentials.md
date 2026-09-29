# ADR 0028: Credentials ขององค์กร

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0028-organization-repository-credentials.md)


Status: Accepted for v0.8.2

## บริบทและการตัดสินใจ

Credential ownership แยกองค์กรพร้อม use/create/update/delete grants Names/defaults scope องค์กรและ encrypted token ไม่คืน API Blank edit token เก็บเดิม Rotation ใช้ future sync Host ที่ถูกใช้เปลี่ยนไม่ได้และ referenced credentials ลบไม่ได้ Ownership immutable Legacy global bindings เก็บ compatibility แต่ members เลือกใหม่ไม่ได้ Provider token scope กำหนด repo ที่ใช้ได้ ไม่ให้ project/deploy grants อัตโนมัติ Git ใช้ isolated config HTTPS canonical/no redirect และ authority-scoped AskPass

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
