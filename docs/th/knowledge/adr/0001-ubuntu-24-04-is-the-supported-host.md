# ADR 0001: Ubuntu 24.04 เป็น baseline

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0001-ubuntu-24-04-is-the-supported-host.md)


- Status: Accepted
- Date: 2026-08-03

## บริบทและการตัดสินใจ

เดิมเลือก Ubuntu Server 24.04 LTS amd64 เพื่อทำ apt/systemd/Nginx/Certbot ซ้ำได้ ADR 0012 ขยาย host gate เป็น 25.04 โดยคงเหตุผลและ test boundary เดิม Docker/API tests ไม่แทน VM package/systemd/reboot certification รุ่นอื่นต้องมี ADR และหลักฐานก่อนเพิ่ม support

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
