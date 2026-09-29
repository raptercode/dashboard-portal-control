# ADR 0013: Sessions เจ็ดวันเก็บเฉพาะ hash

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0013-owner-sessions-persist-for-seven-days-with-hashed-identifiers.md)


- Status: Accepted
- Date: 2026-08-07

## บริบทและการตัดสินใจ

Cookie lifetime เจ็ดวัน State เก็บ SHA-256 identifier, CSRF และ expiry ไม่เก็บ raw cookie Expired sessions ใช้ไม่ได้และ cleanup เมื่อสร้าง/logout Password query บน non-API GET redirect ลบก่อน static และ browser boot ลบจาก URL Nginx no-referrer Restart ปกติไม่ logout แต่ logout/expiry/password rotation ต้อง login ใหม่ Historical password URLs ต้อง rotate

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
