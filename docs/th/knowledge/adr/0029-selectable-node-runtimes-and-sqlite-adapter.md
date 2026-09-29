# ADR 0029: เลือก Node และ SQLite adapter

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0029-selectable-node-runtimes-and-sqlite-adapter.md)


Status: Accepted
Date: 2026-09-30

## บริบทและการตัดสินใจ

รองรับ 20.20.2+,22.13+,24.x,26.x ภายใน majors ติดตั้ง checksum-verified pinned x64 /opt runtimes Global Node/npm24 Portal/project เลือกแยกและ release snapshot major เพื่อ rollback Legacy default24 Signed updater เก็บ HOSTMGR_NODE_MAJOR Use node:sqlite22.13+และ better-sqlite3 11.10.0 สำหรับ 20 schema/file/key เดิมไม่ convert/rotate Addon optional แต่ Node 20 ต้อง preflight เปิด DB ใน staging ก่อน replace อาจต้อง compile tools Node 20 เป็น compatibility option nvm ไม่กำหนด host services Driver parity synthetic ไม่แทน backup/host acceptance

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
