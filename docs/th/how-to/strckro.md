# Strckro: แบรนด์, deployments และการย้าย CLI

[English](../../en/how-to/strckro.md) · [สารบัญ](../README-index.md)

Strckro คือชื่อผลิตภัณฑ์ใหม่ของ Dashboard Portal รุ่น control plane คือ `1.1.0` และ npm client ชื่อ `strckro@0.2.0` ใช้คำสั่ง `skctl` หรือ `strckro`

```sh
npm install --global strckro
skctl login --server https://portal.example.com --no-browser
skctl deployments list --json
skctl deploy my-app --sync --wait --timeout 300
```

หน้าบ้านมี login, Overview, โลโก้ และหน้า `/deployments` ใหม่ พร้อมตัวกรองโปรเจค/สถานะ อ่านข้อมูล jobs/releases จริง ไม่สร้างประวัติสมมติ API `GET /api/deployments` คืนเฉพาะ metadata ตามสิทธิ์ดูโปรเจคและ project binding ของ token โดย logs และ secrets ยังคงใช้ API กับสิทธิ์แยก คำสั่ง `skctl deployments list [SLUG]` ใช้ endpoint นี้

ตัวแปรหลักเปลี่ยนเป็น `STRCKRO_SERVER`, `STRCKRO_TOKEN`, `STRCKRO_PROJECT`, `STRCKRO_CONFIG_DIR` ยังรองรับ `DASHBOARD_*` เดิม โดยชื่อใหม่มีลำดับสูงกว่า `skctl init` เขียน `strckro.json`; หากไม่มีไฟล์ใหม่ยังอ่าน `dpctl.json` ได้ เก็บ credential ในโฟลเดอร์ config `strckro` และอ่าน fallback จาก `dpctl` เมื่อไม่มีค่า override โฟลเดอร์ การ login บันทึกไฟล์ใหม่ ส่วน logout ล้าง credential default ทั้งเก่าและใหม่ Windows ยังคงใช้ DPAPI

โลโก้เป็น SVG เส้นทาง delivery รูปตัว S ที่เชื่อม terminal nodes สองจุด ใช้สี ink `#14221d`, release lime `#d8ff70` และ muted mint `#a4d9bd` ไฟล์อยู่ใน `public/ui/brand/`: `logo.svg`, `logo-mono.svg`, `wordmark.svg`, `favicon.svg` และ PNG exports ใช้ SVG เป็นต้นฉบับสำหรับ favicon, dashboard และงาน release

ระบบยังเป็น control plane ของโฮสต์เดียวและใช้ขอบเขตสิทธิ์เดิม ตัวติดตั้งชื่อ `strckro.sh` คำสั่ง root-only บนโฮสต์ชื่อ `strckro` (`sudo strckro update`, `configure-update`, `--reset-pwd`, `--help`) และไฟล์ release ชื่อ `strckro-<version>.tar.gz` รุ่นนี้ยังไม่เปลี่ยน host directories (`/opt/dashboard-portal`, `/var/lib/dashboard-portal`, `/etc/dashboard-portal`), service `dashboard-portal` และ `hostmgr-deploy-helper`, service user, `HOSTMGR_*` หรือกุญแจและ URL ของ signed update เพราะการเปลี่ยนส่วนนี้ย้าย state ของ production และต้องมี migration ของตัวเอง การ publish release ไม่ใช่การอัปเดตโฮสต์ที่กำลังทำงาน

**อัปเกรดโฮสต์ที่ใช้รุ่นเก่า** `dashboard-portal update` ตัวเก่าหา `dashboard-portal.sh` ในไฟล์ release ใหม่ ซึ่งไม่มีแล้ว จึงติดตั้งรุ่นนี้ไม่ได้ ให้แตกไฟล์ release บนโฮสต์แล้วรัน `sudo bash strckro.sh --domain=<domain> --email=<email>` หนึ่งครั้ง (domain และ email อยู่ใน `HOSTMGR_PORTAL_DOMAIN` และ `HOSTMGR_ACME_EMAIL` ของ `/etc/dashboard-portal/dashboard-portal.env`) เป็นตัวติดตั้งเดียวกับที่ตัวอัปเดตเคยรัน จึงเก็บ state และ config ไว้ พร้อมลบคำสั่ง `dashboard-portal` เดิมและติดตั้ง `strckro` หลังจากนั้น `sudo strckro update` ใช้ได้ตามปกติ `install.sh --version` ติดตั้งได้เฉพาะรุ่นที่ publish ด้วยชื่อไฟล์ใหม่ (v1.1.0 ขึ้นไป) ตัวแปรสำหรับ key ลงนาม release คือ `STRCKRO_UPDATE_PRIVATE_KEY_PATH` ตัวเดิม `DASHBOARD_PORTAL_UPDATE_PRIVATE_KEY_PATH` ยังอ่านได้

ข้อมูล deployments แยกใน `src/deployments.mjs` และหน้าจอใน `public/ui/screens/workspace.js` เพื่อให้เพิ่มความสามารถภายหลังได้โดยไม่ฝัง deployment engine ไว้ใน UI วงจรปัจจุบันยังเป็น source → build → health → activation และใช้ restart/rollback เดิม
