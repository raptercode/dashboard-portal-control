# ADR 0009: Project organization และ temporary AskPass

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0009-projects-are-organized-and-https-sync-uses-askpass.md)


- Status: Accepted
- Date: 2026-08-03

## บริบทและการตัดสินใจ

Project แยก organization label branch และ encrypted ENV HTTPS operation decrypt token แล้วใช้ private temporary token/GIT_ASKPASS files ไม่ใส่ token ใน URL/arguments และลบหลัง clone/pull Demo clone HTTPS ไป persistent volume ได้ ข้อจำกัด SSH/host ในบันทึกเดิมเป็นช่วงก่อน helper completion

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
