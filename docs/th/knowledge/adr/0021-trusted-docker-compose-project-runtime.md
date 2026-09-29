# ADR 0021: Trusted Docker Compose runtime

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0021-trusted-docker-compose-project-runtime.md)


- Status: Accepted
- Date: 2026-08-14

## บริบทและการตัดสินใจ

Compose เป็น optional runtime ของ trusted owner repository Helper validate bounded compose policy ก่อน build/start activation ปฏิเสธ privileged/host networking/host PID/IPC/host bind mounts Selected service ต้อง publish project port Docker build ใน helper activation ไม่ใช่ native candidate phase หาก activation/health fail restore prior release ต้องติดตั้ง Docker Engine/Compose ก่อน ไม่อ้าง hostile-tenant isolation

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
