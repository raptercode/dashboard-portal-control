# ADR 0007: Git credentials เป็น references หรือ host keys

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0007-git-credentials-are-references-or-host-managed-keys.md)


- Status: Accepted
- Date: 2026-08-03

## บริบทและการตัดสินใจ

นโยบายแรก HTTPS เก็บชื่อ environment secret reference ไม่รับ token value SSH เก็บ deploy-key identifier และ private key อยู่ helper/host UI เห็นเฉพาะ public key Git author metadata เก็บได้ ต่อมา ADR 0008 เพิ่ม encrypted vault และ ADR 0028 เพิ่ม organization credentials Public HTTPS ไม่จำเป็นต้อง credential ข้อจำกัด demo/SSH ในบันทึกเดิมเป็นประวัติ

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
