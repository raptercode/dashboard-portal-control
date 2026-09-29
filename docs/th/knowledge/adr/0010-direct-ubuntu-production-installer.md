# ADR 0010: Production ใช้ Ubuntu systemd/Nginx

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0010-direct-ubuntu-production-installer.md)


- Status: Accepted
- Date: 2026-08-03

## บริบทและการตัดสินใจ

Installer ภายใน release รัน root ติดตั้ง packages สร้าง service account ที่ไม่ใช่ root Node ฟัง loopback และ Nginx รับ public HTTPS ตาม ADR 0011 OS ตาม ADR 0012 Docker เป็น dev/integration ไม่ใช่ prerequisite State อยู่ /var/lib/dashboard-portal และ config/key อยู่ /etc/dashboard-portal คำสั่ง installer เดิมเป็นประวัติ ทางเข้า public ปัจจุบันดู ADR 0030

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
