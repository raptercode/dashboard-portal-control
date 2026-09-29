# ADR 0016: Portal update สั่งผ่าน SSH

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0016-dashboard-software-updates-are-ssh-initiated.md)


- Status: Accepted
- Date: 2026-08-08

## บริบทและการตัดสินใจ

UI ตรวจ signed HTTPS manifest และแสดง version/notes/copy SSH command แต่ apply ไม่ได้ Root command sudo dashboard-portal update ตรวจ Ed25519 และ SHA-256, stage immutable archive แล้ว transactional installer Standard install มี stable channel/public verification key Private signing key ไม่อยู่ host Signature/network/malformed manifest fail closed Project deployments แยกจาก Portal software updates

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
