# ADR 0024: Bun bind path และ cleanup dependencies

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0024-bun-sandbox-path-and-release-dependency-cleanup.md)


- Status: Accepted
- Date: 2026-08-14

## บริบทและการตัดสินใจ

Bun 1.3.13 resolve cwd ไม่ได้ใต้ private managed parents จึง bind active release ไป /run/hostmgr-project-<slug>/app เป็น working directory โดยคง source/hardening หลัง native activation/domain sync สำเร็จลบเฉพาะ node_modules จาก releases เก่ากว่า active และ immediate rollback เก็บ source/metadata ไม่ prune failed/current/rollback Older historical release ต้อง fresh deploy ไม่อ้าง immediate rollback ได้

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
