# Strckro: แบรนด์, deployments และการย้าย CLI

[English](../../en/how-to/strckro.md) · [สารบัญ](../README-index.md)

Strckro คือชื่อผลิตภัณฑ์ใหม่ของ Dashboard Portal รุ่น control plane คือ `1.0.4` และ npm client ชื่อ `strckro@0.2.0` ใช้คำสั่ง `skctl` หรือ `strckro`

```sh
npm install --global strckro
skctl login --server https://portal.example.com --no-browser
skctl deployments list --json
skctl deploy my-app --sync --wait --timeout 300
```

หน้าบ้านมี login, Overview, โลโก้ และหน้า `/deployments` ใหม่ พร้อมตัวกรองโปรเจค/สถานะ อ่านข้อมูล jobs/releases จริง ไม่สร้างประวัติสมมติ API `GET /api/deployments` คืนเฉพาะ metadata ตามสิทธิ์ดูโปรเจคและ project binding ของ token โดย logs และ secrets ยังคงใช้ API กับสิทธิ์แยก คำสั่ง `skctl deployments list [SLUG]` ใช้ endpoint นี้

ตัวแปรหลักเปลี่ยนเป็น `STRCKRO_SERVER`, `STRCKRO_TOKEN`, `STRCKRO_PROJECT`, `STRCKRO_CONFIG_DIR` ยังรองรับ `DASHBOARD_*` เดิม โดยชื่อใหม่มีลำดับสูงกว่า `skctl init` เขียน `strckro.json`; หากไม่มีไฟล์ใหม่ยังอ่าน `dpctl.json` ได้ เก็บ credential ในโฟลเดอร์ config `strckro` และอ่าน fallback จาก `dpctl` เมื่อไม่มีค่า override โฟลเดอร์ การ login บันทึกไฟล์ใหม่ ส่วน logout ล้าง credential default ทั้งเก่าและใหม่ Windows ยังคงใช้ DPAPI

โลโก้เป็น SVG เส้นทาง delivery รูปตัว S ที่เชื่อม terminal nodes สองจุด ใช้สี ink `#14221d`, release lime `#d8ff70` และ muted mint `#a4d9bd` ไฟล์อยู่ใน `public/ui/brand/`: `logo.svg`, `logo-mono.svg`, `wordmark.svg`, `favicon.svg` และ PNG exports ใช้ SVG เป็นต้นฉบับสำหรับ favicon, dashboard และงาน release

ระบบยังเป็น control plane ของโฮสต์เดียวและใช้ขอบเขตสิทธิ์เดิม รุ่นนี้ไม่เปลี่ยน host directories, service users, `HOSTMGR_*`, คำสั่ง root-only `dashboard-portal` หรือชื่อ/URL ของ signed archive เพื่อรักษาเครื่องที่ติดตั้งอยู่ การ publish release ไม่ใช่การอัปเดตโฮสต์ที่กำลังทำงาน

ข้อมูล deployments แยกใน `src/deployments.mjs` และหน้าจอใน `public/ui/deployments.js` เพื่อให้เพิ่มความสามารถภายหลังได้โดยไม่ฝัง deployment engine ไว้ใน UI วงจรปัจจุบันยังเป็น source → build → health → activation และใช้ restart/rollback เดิม
