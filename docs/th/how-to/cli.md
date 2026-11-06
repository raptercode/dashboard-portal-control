# CLI สำหรับคน, CI และ AI agents

[English](../../en/how-to/cli.md) · [สารบัญ](../README-index.md)

โปรเจคข้างกันชื่อ `strckro` ใช้คำสั่ง `skctl` รองรับ Node.js 20.20.2+ เวอร์ชัน `0.2.0` เผยแพร่บน npm แล้ว ติดตั้งด้วย `npm install --global strckro` หรือใช้ `npx --package strckro skctl --help` ได้ หากต้องการแจกไฟล์โดยตรง ให้สร้างด้วย `npm run pack:release` ในโฟลเดอร์ CLI ส่งไฟล์ `.tgz` ไปเครื่องอื่น แล้วติดตั้งด้วย `npm install --global ./strckro-0.2.0.tgz` สำหรับพัฒนาจาก source ยังใช้ `npm link` ได้ ต้องอัปเดต backend เป็น revision ที่มี CLI API ก่อนเชื่อมต่อ

```sh
skctl login --server https://portal.example.com
skctl login --server https://portal.example.com --no-browser
skctl login --server https://portal.example.com --token YOUR_CLI_TOKEN
skctl projects list --json
skctl init --project my-app
skctl env import --file .env.production --json
skctl domains set --domains app.example.com
skctl deploy --sync --wait --timeout 300 --json
skctl domains verify --json
```

Browser login ให้ใช้บัญชีเดิม ตรวจรหัสตรงกับ terminal แล้วกดอนุมัติ `--no-browser` แสดงลิงก์ให้คัดลอกโดยไม่เปิด browser หรือ callback port คำขอมีอายุ 10 นาทีและแลก token ได้ครั้งเดียว สร้าง/ถอน token ใน **Settings > Account > CLI และ AI access** จำกัดโปรเจค/scope อายุ 1–90 วัน (ค่าเริ่มต้น 30) ไม่เกินสิทธิ์ผู้ออก Default login ไม่รวม `env.read` สมาชิกที่สิทธิ์น้อยกว่าระบุ `--scope` ที่ตรงกับสิทธิ์ บัญชีถูกปิด/เปลี่ยนรหัสผ่านใช้ token เดิมไม่ได้ ตรวจสิทธิ์ทุก request และก่อน commit ส่วน Monitor token ยังคงอ่านอย่างเดียว

Windows เก็บ credential ด้วย DPAPI ของ OS user; Linux/macOS เก็บไฟล์ `0600` ในโฟลเดอร์ `0700` ใต้ `$XDG_CONFIG_HOME/skctl` หรือ `~/.config/skctl` เปลี่ยนด้วย `DASHBOARD_CONFIG_DIR` ได้ `logout` ลบเฉพาะเครื่อง ให้ถอนที่เว็บเพื่อยกเลิกทุกสำเนา ใช้ `--token-stdin` หรือ `DASHBOARD_TOKEN` รับจาก secret manager รองรับ HTTPS ยกเว้น HTTP loopback สำหรับพัฒนา ไม่ตาม redirect และไม่ส่ง credential ที่บันทึกให้ origin อื่น

ดูคำสั่งด้วย `skctl --help` รองรับสร้าง/ซิงก์/ดูโปรเจค, deploy/wait, jobs, restart, rollback, logs, domain list/set/clear/check/verify และ env keys/set/unset/import/pull เติม `--json` สำหรับ AI/CI: stdout เป็น result เดียว ลิงก์ login อยู่ stderr Deploy ใช้ Git source บน Portal ไม่อัปโหลดไฟล์ local; domain ใช้ workflow Nginx/TLS เดิม ไม่สร้าง records ที่ DNS provider `skctl.json` เก็บเพียง server/project

ENV แก้แบบ atomic รักษา comment/keys อื่น ตั้งว่าง/ลบได้ ตรวจ revision และคืน HTTP 412 / exit 5 หากมีคนแก้แทรกโดยไม่ retry ทับ `env keys` ใช้ `env.read` หรือ `env.write`; เขียนใช้ `env.write`; `env pull --file PATH` ใช้ `env.read` และสร้างไฟล์ใหม่โดยไม่แสดงค่า บันทึก ENV ไม่ deploy ทันที

API: anonymous `POST /api/cli/device/start` และ `/poll`; browser session `GET/POST /api/cli/tokens`, `DELETE /api/cli/tokens/:id`, `GET/POST /api/cli/devices/:userCode` (เขียนต้อง CSRF) endpoint โปรเจคเดิมรับ CLI bearer ผ่าน allow-list โดยไม่ให้จัดการบัญชี/ออก token ต่อ/ติดตั้ง host tools/จัดการ Git credentials เพิ่ม `GET /api/projects/:slug/environment/metadata` คืน keys/revision และ `PATCH /api/projects/:slug/environment` รับ `{ revision, set: { KEY: "value" }, unset: ["OLD"] }` server เก็บ hash ของ token/device secret ส่วน ENV เข้ารหัสและ audit ไม่มีค่า secret

Exit codes: 0 สำเร็จ, 1 API/deploy, 2 input, 3 auth, 4 permission, 5 ENV conflict, 6 network/timeout HTTP สำเร็จแต่ `ok:false` จะ exit 1 ทดสอบ backend ด้วย `node --test test/cli-api.test.mjs` และ CLI ด้วย `npm test` กำหนด `DASHBOARD_BACKEND_PATH` เพื่อเพิ่ม integration tests ระหว่างสองโปรเจค Demo ไม่รับรอง deploy/DNS/Nginx/TLS บน Linux จริง
