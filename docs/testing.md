# การทดสอบแยกตามโมดูลและสิทธิ์ผู้ใช้

ใช้ Node.js 24 ตาม `engines` ของโปรเจกต์ รันจาก root ของ repository:

```powershell
npm test
node scripts/test-modules.mjs --all
node scripts/test-modules.mjs --list
node scripts/test-modules.mjs access
node scripts/test-modules.mjs server
node scripts/test-modules.mjs server-environment server-monitor
node --test --test-name-pattern="Mixed organization" test/access-api.test.mjs
```

Runner เลือกได้ทั้งชื่อโมดูลเต็มและ prefix เช่น `access` จะรัน `access-api`, `access-hardening`, `access-model` และ `access-races` ส่วนชื่อที่ไม่ตรงกับโมดูลใดจะจบด้วย exit code 1 ก่อนรัน แม้ชื่ออื่นในคำสั่งจะถูกต้อง `--all` รันเฉพาะไฟล์ `*.test.mjs` จึงไม่นับ helper เป็น test จำนวนไฟล์และชื่อโมดูลที่เป็นปัจจุบันดูได้จาก `--list` ไม่ต้องดูแลรายการซ้ำใน script

## โครงสร้าง

แต่ละ `test/*.test.mjs` เป็นหนึ่งโมดูล `test/support/server.mjs` เป็น fixture สำหรับเปิด HTTP server บน loopback ด้วยพอร์ตชั่วคราวและเก็บ state ใน temporary directory แต่ละชุดแยกกัน Helper login และ request ใช้ session cookie และ CSRF token จริง

เดิม `server.test.mjs` มี 35 tests ปัจจุบันย้ายครบทั้ง 35 tests ไปยัง 9 โมดูล:

| โมดูล | จำนวนเดิม | ขอบเขต |
| --- | ---: | --- |
| server-candidate | 7 | คัดลอก source, dependency install, redact logs, environment, health check และเลือกพอร์ต |
| server-monitor | 1 | Monitor token, ข้อมูลที่เปิดเผย และ revoke |
| server-shell | 2 | URL ของหน้าเว็บและ static asset traversal |
| server-runtime | 1 | Runtime ที่หยุดทำงานและการปิดบัง host diagnostics |
| server-auth | 4 | Login/CSRF, password change, invalid input และ persistent session |
| server-integrations | 4 | Mail package verification, Git credentials และ host Git probe |
| server-deployment | 9 | Manual/polling/webhook sync, deploy, queue, configuration, failure และ project lifecycle |
| server-environment | 2 | อ่าน/เขียน Environment และ legacy encrypted data |
| server-observability | 5 | Logs, domains, DNS และ edge checks |

โมดูลเดิมอื่นยังแยกตามงาน ได้แก่ authentication, core/state, secrets, runtime ของ Node/Bun/Go/Python/PHP, mail, DNS/Nginx, database, metrics, installer, software update และ UI แต่ละส่วน

## Role กับ permission template

ระบบมี role จริงสองค่า: `master` และ `user` ส่วน `viewer`, `operator`, `maintainer` เป็นชุด permission เริ่มต้นของ membership ในองค์กร ไม่ใช่ role ผู้ใช้คนเดียวใช้ permission ต่างกันในแต่ละองค์กรได้

| Scenario | สิ่งที่ต้องยืนยัน |
| --- | --- |
| Anonymous | Access, members, projects, audit และข้อมูลลับต้องผ่าน login |
| Master | เห็นทุกองค์กร จัดการสมาชิก/องค์กร/host ได้ แต่ยังต้องใช้ CSRF และห้ามลดสิทธิ์หรือปิด Master คนสุดท้าย |
| User ไม่มีองค์กร | ไม่มี projects หรือ organizations ที่มองเห็น และสร้างองค์กรเองไม่ได้ |
| Viewer template | เห็น projects/logs/audit ขององค์กรที่ได้รับสิทธิ์ แก้ค่า, sync, deploy, environment และ webhook ไม่ได้ |
| Operator template | มี source.sync/deploy.start/deploy.rollback แต่ไม่ได้ env.read/env.write หรือ host administration |
| Maintainer template | จัดการ project ภายในองค์กรได้ตาม grants แต่ไม่จัดการ host, สมาชิก, ลบหรือย้าย project |
| Mixed grants | Operator ใน Alpha กับ Viewer ใน Bravo ต้องใช้สิทธิ์ของ Bravo เมื่อเรียก Bravo แม้ payload ปลอม org/slug |
| Disabled user | Session เดิมใช้ไม่ได้และ login ใหม่ไม่ได้ |
| Revoked permission | Session ที่เปิดอยู่ก่อนแก้สิทธิ์ต้องไม่ทำงานด้วยสิทธิ์เก่า |

`access-api.test.mjs` มี 23 scenarios ผ่าน HTTP จริงสำหรับกรณีด้านบน รวมถึง invitation แบบ single-use/expired/revoked, การปลอม role ในการรับคำเชิญ, unknown permissions, การแยก env.read กับ env.write, plaintext secret ไม่หลุดใน project list, job ID ของอีกองค์กร, audit scoping และ hook/token lists ที่ไม่เปิดเผยองค์กรอื่นหรือ global hooks นอกจากนี้ยังตรวจการทำงานที่อนุญาตจริง ได้แก่ Operator sync/deploy, Viewer อ่าน logs, Maintainer จัดการ domains/environment, Master สร้าง/เปลี่ยนชื่อองค์กร และ session หลายบัญชีหลัง restart

`access-model.test.mjs` ตรวจ policy และ migration โดยตรง เพื่อแยก regression ของข้อมูล/permission ออกจาก HTTP behavior

`access-hardening.test.mjs` เพิ่ม 5 regressions จาก code review: จำกัดการรับคำเชิญที่ token ไม่ถูกต้อง, ไม่เปิดเผย hook/token/audit เมื่อไม่มี project.view, source.sync ไม่กระตุ้น auto deploy เมื่อไม่มี deploy.start, project list ไม่เปิดเผย failure logs/events เมื่อไม่มี logs.read และงาน deploy ที่ถูกเพิกถอนสิทธิ์หลัง restart ต้องจบทั้ง job และ candidate โดยไม่ค้างสถานะ deploying

## ขอบเขตการตรวจสอบ

Tests ใช้ demo mode และ fixture/simulated runtime เว้นแต่ test นั้นกำหนด fake host probe โดยเฉพาะ ผลผ่านยืนยัน behavior ของ API, policy และ UI contract ตาม assertions เท่านั้น ไม่ยืนยันการ deploy บน Linux จริง, DNS ของผู้ให้บริการ, SMTP delivery หรือ interactive browser flows ให้ตรวจ host และ browser แยกเมื่อ release เปลี่ยนพฤติกรรมเหล่านั้น

เมื่อเพิ่ม endpoint ให้เพิ่มทั้งกรณีได้รับสิทธิ์และถูกปฏิเสธ รวมการอ้าง project/org ของผู้อื่น หลีกเลี่ยงทดสอบเพียงการซ่อนปุ่มใน UI ทุก mutation ที่ใช้ session ต้องตรวจ CSRF ทุก read ต้องทบทวน secret fields และ organization scope
