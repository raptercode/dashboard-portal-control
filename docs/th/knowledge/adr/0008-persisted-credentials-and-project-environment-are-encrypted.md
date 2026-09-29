# ADR 0008: เข้ารหัส credentials และ environment

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0008-persisted-credentials-and-project-environment-are-encrypted.md)


- Status: Accepted
- Date: 2026-08-03

## บริบทและการตัดสินใจ

Authenticated CSRF requests รับ HTTPS token/.env แล้ว AES-256-GCM ก่อน persist HOSTMGR_SECRET_KEY เป็น base64 32 bytes ต้องเก็บเดิมตลอดอายุ state Helper decrypt ใน memory ตามจำเป็นไม่ใส่ token command/log Backup state พร้อม key หากหาย decrypt ไม่ได้ Key rotation ต้อง dedicated atomic re-encryption ไม่ใช่เปลี่ยน env key ข้อจำกัดอ่าน ENV เดิมถูก supersede โดย ADR 0026/0027

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
