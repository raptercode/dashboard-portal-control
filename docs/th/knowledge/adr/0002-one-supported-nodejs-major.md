# ADR 0002: Native ใช้ Node major เดียวในระยะแรก

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0002-one-supported-nodejs-major.md)


- Status: Superseded by [ADR 0022](0022-bun-native-project-runtime.md)
- Date: 2026-08-03

## บริบทและการตัดสินใจ

บันทึกนโยบายเดิม Node 24 major เดียวเพื่อลด runtime management ไม่มี per-project selector ในระยะแรก Project ที่ต้อง major อื่นใช้ Docker Status เดิมถูกแทนที่ด้วย Bun ADR 0022 และนโยบาย Node ปัจจุบันดู ADR 0029 ห้ามใช้บันทึกนี้สรุป support matrix ปัจจุบัน

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
