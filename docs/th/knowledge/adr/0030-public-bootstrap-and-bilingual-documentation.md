# ADR 0030: Public bootstrap และเอกสารสองภาษา

[English](../../../en/knowledge/adr/0030-public-bootstrap-and-bilingual-documentation.md)


Status: Accepted
Date: 2026-09-30

## การตัดสินใจ

ใช้ public install.sh เป็นทางเข้าติดตั้ง เอกสารแสดงคำสั่งเดียวสำหรับ latest stable ส่วน version pinning ยังคงเป็น option ภายใน bootstrap ถาม domain/email ผ่าน controlling terminal และใช้ Node 24 เป็นค่าเริ่มต้น รองรับ curl pipe และ sudo ตรวจ SHA-256 ของ requested GitHub release ก่อนเรียก internal dashboard-portal.sh คง OS gate, TLS, backup/recovery และ privilege boundary เดิม

จัด docs/th และ docs/en เป็น how-to สำหรับขั้นตอนที่ทำได้ กับ knowledge สำหรับ architecture/design/ADR/plans เก็บ knowledge ที่ใช้ร่วมกันใน Git โน้ตเฉพาะเครื่องอยู่ docs/knowledge-local ที่ gitignore ไม่ลบหรือ untrack ประวัติเดิม Localized guides ปรับความยาวตามหัวข้อและ link รายละเอียดต้นฉบับ ต้องคงข้อเท็จจริง/status/date

## ผลตามมา

Publishing bootstrap URL เป็นอีกขั้นตอนหนึ่งไม่เกิดจากการเพิ่มไฟล์ใน Git Initial bootstrap trust HTTPS/GitHub + checksum ส่วน installed signed updater ตรวจ Ed25519 การรันต้อง interactive terminal เพื่อ prompts/password Documentation link checker ต้องตรวจทุกภาษาและ references หลังย้าย Current how-to ไม่แสดง manual archive download/install เป็นอีกวิธีหนึ่ง Historical ADR คงบริบทคำสั่งเก่าไว้
