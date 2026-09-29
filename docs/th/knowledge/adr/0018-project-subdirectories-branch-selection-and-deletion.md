# ADR 0018: Repository subdirectory และ branch

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0018-project-subdirectories-branch-selection-and-deletion.md)


- Status: Accepted
- Date: 2026-08-11

## บริบทและการตัดสินใจ

Project เลือก working directory ภายใน synced repository และ branch ได้ ต้อง validate containment/safe relative path ไม่ยอม symlink escape Config change resync โดยเก็บ deployment history Delete project ต้องตรวจ owned resources แล้วจัดการ workspace/service/managed config ไม่ลบ certificate แยกโดยอัตโนมัติ ดูต้นฉบับสำหรับรายละเอียด constraints ของ directory และการลบ

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
