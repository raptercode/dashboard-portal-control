# ADR 0020: Helper เห็น shadow-utils และ ACME paths

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0020-host-helper-keeps-shadow-utils-and-acme-visible.md)


- Status: Accepted
- Date: 2026-08-14

## บริบทและการตัดสินใจ

แก้ systemd sandbox ที่ปิด paths จำเป็นต่อ Ubuntu account operations และ certificate/config generation โดยเปิดเฉพาะ managed/account/runtime paths ไม่ลด socket allowlist/input validation/error redaction Project user เข้าถึงได้เฉพาะ runtime root ส่วน Nginx อ่าน managed public files ได้ ต้องตรวจ actual host permissions ไม่แทนด้วย source assertions

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
