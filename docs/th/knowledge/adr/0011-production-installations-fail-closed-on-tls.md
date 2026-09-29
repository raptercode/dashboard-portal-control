# ADR 0011: ติดตั้งสำเร็จเมื่อ TLS ผ่าน

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0011-production-installations-fail-closed-on-tls.md)


- Status: Accepted
- Date: 2026-08-07

## บริบทและการตัดสินใจ

ต้อง domain/email valid ตรวจ DNS ก่อนเปลี่ยน managed config ขอ Certbot redirect HTTP→HTTPS พร้อม HSTS และ HTTPS health ใช้ secure cookies ตรวจ SHA-256 ของ pinned Node Stage/syntax-check และ snapshot owned files Restore managed service/config/app/state เมื่อขั้นตอนถัดไปพัง ไม่ถอน apt packages/certificates อัตโนมัติ เก็บ external Nginx ต้อง Ubuntu host acceptance DNS/firewall/reboot จริง

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
