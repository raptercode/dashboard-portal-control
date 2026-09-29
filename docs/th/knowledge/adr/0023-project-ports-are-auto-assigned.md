# ADR 0023: จอง project port อัตโนมัติ

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0023-project-ports-are-auto-assigned.md)


- Status: Accepted
- Date: 2026-08-14

## บริบทและการตัดสินใจ

New project เลือก random 12000–45000 ตรวจ saved assignments กับ loopback bindability และ retry 128 ครั้ง Node/Bun จอง candidate port ด้วย Existing project เก็บ port จน explicit reassignment Health ยังจับ bind race ที่เกิดภายหลัง Portal ตั้ง PORT ใน systemd override env default ป้องกันคนละ domain ชี้ upstream แอปเดียวกันโดยไม่ตั้งใจ

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
