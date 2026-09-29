# ADR 0005: Docker tests ไม่รับรอง host

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0005-docker-is-a-sandbox-not-a-host-certification.md)


- Status: Superseded by [ADR 0021](0021-trusted-docker-compose-project-runtime.md)
- Date: 2026-08-03

## บริบทและการตัดสินใจ

Docker Compose demo ใช้ Ubuntu 24.04 port 80 ใน sandbox เพื่อทดสอบ allowlist/confirmation/audit/state โดยไม่แก้ Docker host apt/systemd/helper/reboot ต้อง VM แยก แม้ภายหลัง Compose เป็น project runtime ก็ไม่ทำให้ demo test รับรอง host UI แสดง sandbox และ CI ใช้ container เฉพาะงานที่เหมาะสม Status เดิม superseded โดย ADR 0021

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
