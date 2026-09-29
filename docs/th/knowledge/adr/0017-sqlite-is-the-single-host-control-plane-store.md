# ADR 0017: SQLite เป็น control-plane store ของ host เดียว

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0017-sqlite-is-the-single-host-control-plane-store.md)


- Status: Accepted
- Date: 2026-08-12

## บริบทและการตัดสินใจ

ใช้ SQLite durable state/jobs ไม่เพิ่ม Redis service/cache/network port UI poll job status/deploy phases ได้ Restart ทำ in-flight job เป็น interrupted โดยไม่สลับ release Node 24 เดิมมี node:sqlite และ ADR 0029 เพิ่ม adapter สำหรับ Node 20 เก็บ schema/file เดิมและ backup key พร้อม state

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
