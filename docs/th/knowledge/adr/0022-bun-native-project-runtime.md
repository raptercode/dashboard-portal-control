# ADR 0022: Bun เป็น native runtime

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0022-bun-native-project-runtime.md)


- Status: Accepted
- Date: 2026-08-14

## บริบทและการตัดสินใจ

รองรับ checksum-verified Bun ที่ pin Native install/build/start ผ่าน bun named scripts ใช้ candidate health, systemd project user, domain/TLS/logs/rollback ตาม native flow Existing Node/Compose อยู่เดิมและ Portal เองไม่พึ่ง Bun Updating installer ลง pinned Bun ก่อนใช้งาน Runtime path/hardening ดู ADR 0024

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
