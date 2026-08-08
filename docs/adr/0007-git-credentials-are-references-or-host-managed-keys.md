# ADR 0007: Git credentials are references or host-managed keys

- Status: Accepted
- Date: 2026-08-03

## Context

Project sync ต้องรองรับ private repository ผ่าน HTTPS และ SSH แต่ Dashboard/API/audit log ต้องไม่เก็บหรือส่ง Git token และ SSH private key แบบ plaintext

## Decision

ผู้ใช้เลือก protocol ต่อ project:

- HTTPS: เก็บได้เฉพาะชื่อ environment secret reference เช่น `HOSTMGR_GIT_TOKEN` ไม่มีช่องหรือ API ที่รับ token value
- SSH: Dashboard สร้างเพียง deploy-key identifier; privileged helper บน host เป็นผู้สร้างและเก็บ private key ตาม permission ที่เหมาะสม และ UI แสดงได้เฉพาะ public key เมื่อ helper รองรับ

Git author name/email เป็น metadata ปกติและเก็บใน state ได้ Sync ใน Docker demo เป็น validation ของ configuration เท่านั้น ไม่ clone repository

## Consequences

- Token ต้องถูก provision นอก Dashboard ผ่าน secret store/environment ที่ deployment service เข้าถึงได้
- deployment helper ในขั้นต่อไปต้อง resolve reference ในสิทธิ์จำกัดและ redact ค่าเสมอ
- public repository ใช้ HTTPS โดยไม่ต้องมี credential reference ได้
