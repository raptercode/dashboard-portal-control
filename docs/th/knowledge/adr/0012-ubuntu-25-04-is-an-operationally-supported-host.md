# ADR 0012: ข้อยกเว้น operational host Ubuntu 25.04

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0012-ubuntu-25-04-is-an-operationally-supported-host.md)


- Status: Accepted
- Date: 2026-08-07

## บริบทและการตัดสินใจ

จาก baseline 24.04 แต่ available production host เป็น 25.04 amd64 จึงให้ installer รับทั้งสองโดยใช้ pins/ownership/hardening/TLS/recovery เดียวกัน ไม่อ้าง long support lifetime ของ LTS ต้องเก็บ systemd/Nginx/Certbot/HTTPS/reboot evidence Reject OS/arch อื่น Migration ไป supported LTS ต้อง acceptance ใหม่ นี่เป็นเหตุผล ณ วันที่ตัดสินใจไม่ใช่ lifecycle assurance ปัจจุบัน

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
