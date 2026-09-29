# ADR 0014: Build script เป็น optional

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0014-native-project-build-step-is-optional.md)


- Status: Accepted
- Date: 2026-08-07

## บริบทและการตัดสินใจ

Node ใช้ npm ci เมื่อ lock ใช้ได้หรือ npm install เฉพาะ candidate ไม่แก้ synced source Bun ใช้ frozen lock/install Build ว่างหมายถึงติดตั้งแล้ว start/health โดย startScript ยังจำเป็นและเป็น named script ไม่รับ arbitrary shell Expose node/npm/npx/corepack ครบ Failures เก็บ bounded stage diagnostics ไม่ persist process output/ENV ที่มี secrets Express/Bun ไม่ต้อง dummy build

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
