# ADR 0015: Domain sync ผ่าน root socket helper

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0015-project-domain-sync-uses-a-root-owned-socket-helper.md)


- Status: Accepted
- Date: 2026-08-07

## บริบทและการตัดสินใจ

Root-owned helper รับ bounded JSON เฉพาะ dashboardportal group ไม่รับ browser shell/paths Activation สร้าง project user สลับ current atomically ตรวจ final health และ restore เมื่อ activation/TLS fail Domain sync ตรวจ FQDN/DNS/external conflicts เขียน own hostmgr config validate/reload และ webroot ACME ถ้าล้ม restore managed Nginx Project ต้องมี domain ENV ว่าง default NODE_ENV=production

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
