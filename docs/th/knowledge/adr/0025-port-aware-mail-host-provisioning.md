# ADR 0025: Mail provisioning ตาม ports และ fail closed

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0025-port-aware-mail-host-provisioning.md)


- Status: Accepted
- Date: 2026-08-21

## บริบทและการตัดสินใจ

Root helper จัด Postfix/Dovecot/OpenDKIM/mailboxes/TLS จาก typed desired state decrypt ภายใน host API probe egress25/587/2525 Helper อ่าน UFW inbound25/587/993 เปิด public listener เฉพาะ allowed blocked/unknown ไม่มี listener ไม่เปิด firewall เอง Direct MX ต้อง egress25/PTR relay ต้อง selected port Certificate fail ใช้ loopback-only ทั้งหมด Local UFW ไม่พิสูจน์ provider firewall ต้อง external mail test Keep reject_unauth_destination และ ownership marker ก่อนแก้ mail เดิม

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
