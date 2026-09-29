# ADR 0006: Native Node/Bun รับชื่อ script

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0006-native-projects-use-npm-scripts-not-shell-commands.md)


- Status: Accepted
- Date: 2026-08-03

## บริบทและการตัดสินใจ

รับ buildScript/startScript เป็น package-script names ที่มี letters/digits/colon/underscore/hyphen Helper รัน fixed vectors npm/bun run ภายใต้ project user ไม่ interpolate shell จาก UI Environment แยก root-owned file ไม่ใส่ audit logs ข้อจำกัดอ่าน ENV เดิมถูกขยายด้วย ADR 0026/0027 Native custom workflows ใช้ runtime contract หรือ Compose

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
