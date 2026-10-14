# บันทึก acceptance ก่อน 1.0.0

## Candidate release 1.0.0 รวมฐาน v0.8.9 — 2026-10-15

ผู้ใช้อนุญาต stable/production-channel release โดยไม่มี production target จึงเตรียม release ใน checkout แยกจาก `origin/master` v0.8.9 (`3f611fc`) และรวมงาน v1 เพื่อรักษา pnpm/Prisma/Monitor fixes ที่ปล่อยแล้ว แก้ integration issue ของ Prisma Worker ที่ได้รับ HTTP PORT/HOST โดยรักษา explicit user ENV; ปรับ VM test contexts ให้ตรง helper dependencies ที่ merge แล้ว Package/lock/changelog เป็น 1.0.0

- **Full Linux:** 386/386, fail 0, skip 0, 19.435 วินาที บน pinned Node 24.18.0 / Go 1.26.3 / Python 3.11.2 / PHP 8.2.34 ใน Docker รวม pnpm 11.19.0 install/build/HTTP จริง
- **Node matrix:** 20.20.2 / 22.23.3 / 24.18.0 / 26.10.0 ผ่าน 101/101 ต่อรุ่น รวม 404 executions, fail/skip 0; pnpm smoke ใช้ project Node 24 ไม่อ้างว่า pnpm 11 รองรับ project Node 20
- **Source:** manifest 191 ไฟล์ก่อน/หลังตรงกัน SHA-256 `700106bf0ba6800dfadcbd73ac1f59a6fa87002cf1eadaa8ce7502dced9f0eeb`; docs 123 ไฟล์และ diff checks ผ่าน รอบแรกพบ stale VM fixtures 2 ตัวและขาด pnpm ใน harness แก้แล้วผลข้างต้นเป็น full rerun สุดท้าย
- **Browser:** Monitor token create/reveal ครั้งเดียว/reload-hide/revoke ผ่าน; invitation create/copy/revoke ผ่าน; disable Viewer ผ่าน UI แล้ว session เดิมตอบ 401; domainless Web/Worker cards แสดงถูก, Worker ENV ว่างสร้าง release ได้ การ prepare ล้มตาม fixture ที่ไม่มี repository และแสดง failure/logs ถูกต้อง มี failed release แล้ว type/runtime lock และ HTTP controls hidden ถูก ไม่รับรอง successful host activation/rollback หรือ interactive password/accept-invitation ทุกฟอร์ม

หลักฐาน ignored local อยู่ใน `E:/dashboard-control/docs/knowledge-local/v1-release-20261015/` การ sign/publish/download verification เป็นขั้นถัดไปบน committed/tagged candidate ไม่ใช่การ update production host Host install/systemd/Nginx/public TLS/reboot/whole-host restore ยังไม่ได้ทดสอบ และ Mail operational acceptance ยัง Deferred; ระบุข้อจำกัดใน changelog/release notes อย่างชัดเจน

## Full Docker ของ source ล่าสุด 2026-10-15 รอบ 2

ผู้ใช้ขอ full test อีกครั้งและสรุปงานค้างทั้งหมด โดยยืนยันว่าไม่มี production target และไม่ให้หา prod test รอบนี้จึงใช้ Docker/local เป็นขอบเขตการตรวจ และเก็บ host behaviors ที่ยังไม่ยืนยันเป็นข้อจำกัด ไม่ขอ SSH/VM หรือเปลี่ยน production

`npm test` ผ่าน **369/369, fail 0, skip 0, cancelled 0, todo 0** ใน 18.007 วินาที ใช้ Debian 12 / Node 24.20.0 / Go 1.26.3 / Python 3.11.2 / PHP 8.2.34 บน Docker 29.7.2 Harness ใช้ cached base image ที่ตรึง digest, mount source `/app` แบบ read-only, project root ชั่วคราว และ `privileged=false` ไม่มี host Docker socket หรือ `.env` ของผู้ใช้ Source manifest 187 ไฟล์ตรงกันก่อน/หลังรัน: SHA-256 `ace781b690b0d86889df373b590c3fcd4c0438a8616ff23e9f878496388ad646` บน HEAD `a14cf934a9a75bfb7e6d37141ac906d5cde49ee9` พร้อม dirty diff จึงยืนยัน source ล่าสุดที่รวม UI ENV fix แล้ว แต่ยังไม่ใช่ committed 1.0.0 candidate

หลักฐาน ignored local อยู่ใน `docs/knowledge-local/v1-full-20261015-r2/`: `full-linux.log`, `Dockerfile.test`, `source-manifest-before.json`, `source-manifest-after.json`, `source-verification.log`, `container-metadata.log`, `harness-image.log` เอกสาร 121 ไฟล์และ diff check ผ่าน ลบ container/image ที่สร้างรอบนี้และตรวจ inventory ว่างแล้ว ไม่เปลี่ยน containers/volumes หรือ shared base images ของโปรเจกต์อื่น ไม่มีแก้ production code, bump version, commit, tag, sign หรือ publish

ผลรอบนี้แทนข้อจำกัดเรื่อง full suite ก่อน UI patch ในรอบก่อน: full suite ล่าสุดครอบคลุม patch นั้นแล้ว ส่วน matrix 20/22/24/26 จำนวน 320 executions และ runtime/Compose/browser/restore smoke ของวันที่ 14 ยังเป็นหลักฐานประวัติ ไม่อ้างว่า rerun ทั้งหมดกับ Worker diff ปัจจุบัน งานค้างทั้งหมดและขอบเขตที่เลื่อนอยู่ที่ [readiness plan](v1-readiness-plan.md)

## Web ไม่ผูกโดเมน / Worker ไม่เปิดพอร์ต 2026-10-15

เพิ่ม `serviceType: web|worker` โดยโปรเจคเก่าถือเป็น Web: Web deploy ได้โดยไม่มีโดเมน และไม่เรียก Nginx/Certbot หากไม่มี config เดิม; Worker รองรับ Node.js/Bun/Go/Python script ที่รันต่อเนื่อง ไม่มีการกันพอร์ต, HTTP health check หรือเติม PORT/HOST อัตโนมัติ และ ENV ว่างได้ Candidate เตรียม/build โดยไม่เริ่ม consumer; activation หยุด process เดิมก่อนสลับแล้วตรวจ PID เดิมไม่ crash/restart ต่อเนื่อง 5 วินาที หากล้มเหลวพยายามคืน unit/ENV/current และ process เดิม เมื่อตรวจ recovery configuration ไม่ครบจะปฏิเสธก่อนหยุดบริการ ไม่รับรองผลประมวลผลงานหรือ exactly-once และอาจหยุดสั้น ๆ ระหว่างสลับ release มี release แล้วเปลี่ยนประเภทบริการไม่ได้; Worker เปลี่ยน runtime ไม่ได้ ดู [คู่มือ](../../how-to/internal-services-and-workers.md)

| ชุดตรวจ | ผลและขอบเขต |
| --- | --- |
| Full Linux suite | **368/368, fail 0, skip 0**, 19.392 วินาที บน Debian 12 / Node 24.20.0 / Go 1.26.3 / Python 3.11.2 / PHP 8.2.34 / WSL2 kernel 6.6.87; รันก่อนแก้ UI รอบท้ายและเพิ่ม regression cases จึงไม่ใช่ full rerun ของ diff สุดท้าย |
| Final focused Linux | **22/22, fail/skip 0** หลังแก้ UI รอบท้าย ครอบคลุม helper 11, model/API 4, service UI 4, project list 3 รวม ENV ว่างไป Build ได้และตรวจ ENV เดิมก่อนหยุดบริการ |
| Process smoke | **5 checks ผ่าน** ใช้ child process และ filesystem จริง ตรวจไม่เริ่มระหว่าง prepare, หยุดเดิมก่อนเริ่มใหม่, crash rejection และ rollback; command manager เป็น stub ไม่ใช่ systemd จริง |
| Browser | สร้าง Worker ผ่าน 3 ขั้นและบันทึกใน local demo สำเร็จ; ไม่มีพอร์ต/HTTP health controls, ไม่มีเมนู domain, Web แสดงไม่ผูกโดเมน; worker ENV ว่างไป Build/Release review ได้ และ direct deploy แสดงคำยืนยัน process/downtime ตรวจพบ UI ที่ยังบังคับ ENV และ copy PORT เดิมแล้วแก้/ตรวจซ้ำ ไม่เรียก helper activation จริง |
| เอกสาร / cleanup | Docs check **121 ไฟล์**, syntax และ diff check ผ่าน; ลบเฉพาะ containers/image ของรอบนี้แล้ว ไม่แตะ containers/volumes อื่น ปิด browser fixture หลังตรวจ |

หลักฐาน ignored local อยู่ใน `docs/knowledge-local/v1-worker-20261015/`: `full-linux.log`, `focused-ui-final.log`, `real-worker-smoke.log`, `container-metadata.log` และ `worker-release-review.png` ไม่มี commit/tag/version bump หรือ publication Source ยังเป็น v0.8.5 baseline `a14cf93` กับ dirty diff ต้อง frozen candidate และผ่าน clean-host install/upgrade, real systemd/helper/Nginx recovery, domainless Web และ portless Worker activation/rollback/reboot, public TLS และ whole-host restore ก่อน stable release; Mail operational acceptance ยัง Deferred

## Docker acceptance 2026-10-14 และ cleanup 2026-10-15

ผู้ใช้อนุญาต Docker สำหรับรอบทดสอบนี้เพิ่มเติมจากข้อจำกัดเดิม แล้วขอ cleanup หลังทดสอบ คอมดับระหว่างสรุปงาน; ต่อวันที่ 15 ตรวจหลักฐานเดิมและปิด cleanup โดยไม่รัน suite ซ้ำที่ไม่มี code change Source ยังเป็น v0.8.5 `a14cf93` พร้อม dirty diff ไม่ commit/tag/publish/deploy production

| ชุดตรวจ | ผล | ขอบเขตหลักฐาน |
| --- | --- | --- |
| Full Linux suite | **349/349 ผ่าน, fail 0, skip 0**, 13.303 วินาที | Ubuntu 24.04, Node 24.18.0, Go 1.26.3, Python 3.12.3, PHP 8.3.6 บน Docker 29.7.2; PTY harness ภายใน 7 cases, Go build/HTTP, Python venv/wheel/HTTP/failure/rollback, real flock/crash/path guards และ root tmpfiles ผ่าน |
| Node matrix | **80 ต่อรุ่น รวม 320 executions**, fail/skip 0 | Pinned 20.20.2 better-sqlite3 และ 22.23.3 / 24.18.0 / 26.10.0 node:sqlite; core/access/auth/secrets/upgrade fixtures ไม่ใช่ installed-host provisioning |
| Cross-driver restore | **6 seed/verify runs ผ่าน** | Reciprocal Node 20↔24, schema 4 snapshots 77,824 bytes, restored sessions/login/ENV read/write grants, wrong-key rejection, integrity และ persisted writes; ไม่ใช่ legacy migration หรือ whole-host/key-file restore |
| HTTP acceptance | **12/12 ผ่าน** | Settings/static assets, CSRF, organization isolation, invitations/revoke/disabled sessions, ENV grants และ simulated sync/deploy/two-release rollback; token/password/invitation submission ตรวจผ่าน API |
| Real runtime smoke | ผ่าน | Node 24.18.0/Bun 1.3.13 ใช้ actual candidate preparation/queue/build/HTTP health 200; build exit 42 ลบ candidate และรักษา prior release state/process fixture; PHP 8.3.6 prepare source/php-l/built-in server HTTP 200 ภายใต้ UID/GID 65534 ไม่รับรอง Composer/FPM/helper activation |
| Real Compose CLI | **5/5 ผ่าน** | Compose 5.4.0 build/up, restart, bad candidate 503/unhealthy โดย active r1 ยัง 200, promote r2 และ rollback r1; manual fixture workflow ไม่ใช่ Portal helper/Nginx/TLS integration |
| Browser | Scenarios ผ่าน | Master Settings แยก 3 หน้า, desktop และ mobile 390×844; menu Escape คืน focus; Viewer ไม่มี deploy/host controls และ direct Monitor URL กลับหน้าบัญชี; Operator อ่าน/เขียน ENV ไม่ได้ (ช่องว่าง read-only), deploy ถูกปฏิเสธเมื่อไม่มี ENV แล้วใช้ ENV ที่ Master บันทึก deploy แบบ simulated สำเร็จ; Logs เปิดเองและแจ้ง sandbox ชัด; Maintainer อ่าน/แก้ ENV ได้ตาม grant; unassigned เห็น 0 โปรเจกต์ ไม่มีปุ่มสร้างและไม่มีหมวดเมนูว่าง |
| Container restart | **5 checks ผ่าน** | Session, จำนวน projects, active release ID และ ENV decryption คงเดิม รวม browser session; writable layer ของ container เดิมยังอยู่ ไม่ใช่ reboot/volume migration/host restore |

พบและแก้เฉพาะ fixture/test: CPU test เดิมอาศัย `os.loadavg()` ของเครื่องจริงแล้วคาด 0; ใช้ scoped mock และตรวจ delta 75%, fallback 50%/clamp 100% อย่าง deterministic โดยไม่แก้ production behavior Harness ใช้ project root ใน `/tmp` เพราะ source mount read-only; raw browser seed เดิมขาด protocol ปรับผ่าน actual sync API และแก้ seed ให้ถูก contract แล้ว Final full Linux rerun ผ่านทั้งหมด

Image ของ demo build จาก Dockerfile ปัจจุบัน: `dp-v1-candidate:20261014`, image `sha256:495ebbfa9b8358c199785f647c19f59f366e0ffa0cc90ad6391973b5a2409e24`, non-root `hostmgr`, cap-drop ALL/no-new-privileges, port ผูก loopback ไม่มี host Docker socket หรือ privileged mode หลักฐาน/log/scripts/screenshots/synthetic snapshots อยู่ใน ignored `docs/knowledge-local/v1-docker-20261014/`

Cleanup วันที่ 15: เก็บ current/previous demo state ไว้ใต้ `docker-state-backup/` ก่อนลบ demo containers ที่เหลือ 2 ตัวและ test images 5 ตัว รวมชุด readiness เก่า Agents ลบ matrix/runtime/Compose containers และ network ที่สร้างเองไปแล้ว ล้าง unused build cache ด้วย `docker builder prune --force` ได้ 5.566 GB; ตรวจ inventory แล้ว project containers อื่นยังครบและ volumes ทั้ง 15 รายการไม่เปลี่ยน ไม่ลบ named volumes หรือ images ของโปรเจกต์อื่น

ยังเปิดก่อน stable go live: clean Ubuntu install/legacy upgrade, installed runtime/tool/helper permissions, public DNS/ACME/TLS, real helper/systemd/Nginx activation และ failure recovery, reboot และ whole-host/key/application-data restore จาก frozen candidate commit การตรวจ browser รอบนี้เป็น local fixtures ไม่ครอบคลุมทุก interactive form หรือ public HTTPS Mail operational acceptance ยังเลื่อน และ remote `dpctl` ยังเป็น proposed plan แยก

## รอบระบบ / UI / independent test วันที่ 2026-10-10

ผู้ใช้ให้ปิด v1 source work โดยแยก agent งานระบบ, UI และตรวจผล รอบนี้ไม่รัน Docker, ไม่เตรียม/publish release, ไม่สร้าง tag และไม่ deploy production Source ยังเป็น v0.8.5 baseline `a14cf93` พร้อม dirty diff จึงยังไม่ใช่ final candidate commit

- **ระบบ:** แก้ Monitor GET ที่เขียน `lastUsedAt` ให้ถือ shared maintenance lease; busy ส่ง 503 โดยไม่เปลี่ยน state แล้วกลับมาอ่าน/บันทึก usage ได้เมื่อ lock ว่าง รวมกับ installer recovery/consistent snapshots/CLI/helper leases ที่ทำไว้ก่อน
- **UI:** Sidebar แบ่ง 4 หมวด พร้อม icons/ลิงก์ตรงและซ่อนหมวดที่ไม่มีเมนูตาม grants; แยก `/settings/account`, `/settings/updates`, `/settings/monitor` เป็น templates คนละหน้า โดยแต่ละ response มีเฉพาะฟอร์มที่เลือก `/settings` default account และ query links เดิมยังใช้ได้ เพิ่ม current-page state และ mobile Escape/focus/label behavior
- **Independent tests:** `npm test` บน Windows Node 24.11.1 รวม 348: ผ่าน 342, fail 0, skip Linux-only 6; 41.570 วินาที พบ Mail/sidebar accessibility-label contract ที่ล้มในรอบแรก แก้แล้ว full rerun ผ่าน การแก้ aria-label outside-click 1 บรรทัดท้ายรอบตรวจ syntax และ Settings/Mail targeted tests ซ้ำ ผ่าน 8/8 ไม่ได้รัน full suite เพิ่มหลังบรรทัดนี้
- **Linux fixtures:** Ubuntu WSL 24.04.1, kernel `6.6.87.2-microsoft-standard-WSL2`, root, Node 22.16.0 ที่มีอยู่ ผ่าน 21/21, skip 0 จาก bootstrap/CLI-maintenance/installer-recovery/maintenance-lock/server-maintenance; bootstrap wrapper ยืนยัน PTY harness ภายใน 7 cases ไม่มีการเรียก Docker หรือแก้ host service configuration จริง
- **HTTP smoke:** Node demo fixture บน loopback จาก source ปัจจุบัน ตรวจ project visibility สำหรับ Master/Viewer/Operator/Maintainer/unassigned, missing-CSRF denial, Settings 3 routes และ JS module asset ผ่าน ไม่ใช่ browser acceptance
- **เอกสาร/checks:** `npm run docs:check` ผ่าน 119 Markdown files, `git diff --check`, JS syntax และ `bash -n install.sh dashboard-portal.sh scripts/build-release.sh` ผ่าน

ยังเปิด: browser visual/keyboard/mobile acceptance ของ UI ใหม่ (รอบนี้ browser automation ไม่พร้อมใช้งาน), clean install/public TLS/helper permissions, real Native/Compose deploy/failure/rollback, reboot, legacy upgrade หลังยืนยัน quiescence และ whole-host restore บน Ubuntu VM/staging ที่ระบุแน่นอน Mail operational acceptance เลื่อน และ `dpctl` เป็น proposed plan แยก ไม่ประกาศ v1 พร้อม go live จาก fixture tests การ publish ต้องรอคำสั่งใหม่

## ทำต่อเฉพาะ local วันที่ 2026-10-06

ทำต่อโดยไม่เปิดหรือรัน Docker โค้ดปัจจุบันที่ยังไม่ commit ผ่าน `npm test` รวม 341 tests: ผ่าน 335, fail 0, skip ตาม platform 6 รายการ ตรวจ recovery/maintenance แยกแล้วไม่พบ P0 เพิ่ม `npm run docs:check` ผ่าน 115 files, `git diff --check` และ Bash syntax ของ installer/wrapper/release script ผ่าน

Browser ใช้ Node demo fixture บน localhost จาก source ปัจจุบัน ผู้ใช้ active ที่ไม่มี membership login ได้ แต่ Projects แสดง 0 โปรเจกต์และไม่มีปุ่มสร้าง ที่ขนาด 390 × 844 หน้า empty state อยู่ใน viewport และเปิด/ปิด mobile navigation ได้ หลักฐานนี้จำกัดเฉพาะ demo ยังเหลือ invitation, ถอนสิทธิ์, disabled user, mobile ของบทบาทอื่น และ deploy บน host จริง ภาพ local: `docs/knowledge-local/v1-browser-evidence/unassigned-mobile-local.jpg` (ignored)

ลำดับต่อไป: ปิด browser/access variants ที่เหลือด้วย local fixtures; ทดสอบ clean install/public TLS/deploy/failure/rollback/reboot/legacy upgrade/whole-host restore บน Ubuntu VM/staging แบบ disposable; จากนั้น freeze candidate commit และตรวจ signed release การ upgrade legacy ต้องยืนยันว่าไม่มีงานค้างก่อน Mail ยังเลื่อน operational acceptance version ยังเป็น 0.8.5 และยังไม่ได้ tag/publish/deploy production

## จุดพักงาน 2026-10-01

ผู้ใช้ขอพักงานแล้ว Agents จบรอบ งานยังไม่ commit และ version ยังเป็น 0.8.5 ไม่ได้ tag/publish/deploy production หยุด Docker demo และขอปิด Docker Desktop โดยเก็บ images/state/volumes ไว้ ไม่ลบข้อมูลโปรเจกต์อื่น

ผลล่าสุด: full suite Windows 340 tests ผ่าน 334, fail 0, skip ตาม platform 6; Linux root targeted 35 ผ่านทั้งหมด หลัง full run เพิ่ม queue/close regression แล้ว maintenance integration ผ่าน 5/5 บน Windows/Linux และปรับ restore fixture ผ่าน local 1 test การเพิ่มท้ายรอบตรวจแบบ targeted ยังไม่ได้รัน full suite ใหม่

Cross-driver restore ผ่าน 6 Docker seed/verify runs ทั้ง Node 20.20.2 better-sqlite3 → Node 24.20.0 node:sqlite และย้อนกลับ ใช้ schema 4, consistent snapshot 77,824 bytes ตรวจ session ที่ใช้งานได้จริง, master/member login, อ่าน ENV ตาม grant, ปฏิเสธเขียน ENV, wrong-key rejection, integrity และข้อมูลที่เขียนข้าม driver ไม่ใช่ whole-host restore หรือ legacy-version acceptance

Browser demo ตรวจ Master สร้าง/sync/ENV/deploy, Viewer controls อ่านอย่างเดียว, Operator deploy/rollback โดยไม่เห็น ENV editor, Maintainer อ่าน ENV และ Escape ปิด logs แล้ว ยังต้องตรวจ final candidate, ผู้ไม่มี membership, mobile/access variants และ host queue จริง ภาพ local อยู่ `docs/knowledge-local/v1-browser-evidence/operator-rollback-demo.jpg` ซึ่งถูก ignore

รอบถัดไป: review dirty candidate และตรวจ final checks หลังแก้ แล้วใช้ Ubuntu VM/staging พร้อมโดเมนทดสอบเพื่อปิด clean install/public TLS/deploy/rollback/reboot/legacy upgrade/whole-host restore การอัปจากรุ่นเก่าต้องยืนยัน quiescence ก่อน Mail เลื่อนจากคำประกาศ operational 1.0.0 และ P1 ยังเป็นข้อเสนอ ดูรายละเอียดรอบล่าสุดใน [English record](../../../en/knowledge/plans/v1-acceptance-record.md)

[English](../../../en/knowledge/plans/v1-acceptance-record.md)

ลำดับงาน: [แผน readiness](v1-readiness-plan.md) อัปเดต 2026-10-15 บันทึกนี้แยกสิ่งที่โค้ดทำได้ ผลทดสอบ local และการยืนยันใช้งานจริง แถว Pending ยังไม่รับรอง release หรือ production

## Candidate และขอบเขต

| รายการ | สถานะปัจจุบัน |
| --- | --- |
| Source baseline | v0.8.5, `a14cf934a9a75bfb7e6d37141ac906d5cde49ee9` |
| โค้ดปัจจุบัน | Implementation และเอกสารเป็น dirty diff ที่ยังไม่ commit บน baseline; ยังไม่มี final candidate commit |
| Final candidate/tag | Pending; โค้ดเปลี่ยนต้องตรวจส่วนที่กระทบซ้ำ และตรวจสุดท้ายบน release commit จริง |
| ขอบเขตใช้งาน | Ubuntu amd64 host เดียว, trusted repositories, สิทธิ์ตามองค์กร |
| Build boundary | Node/Bun build และ candidate รันในบริบทบัญชี Portal; grants ขององค์กรไม่ใช่ isolation สำหรับโค้ดที่ไม่ไว้ใจ |
| Mail | เลื่อน operational Mail ออกจาก readiness ของ 1.0.0; ฟีเจอร์ที่มีอยู่ไม่ใช่คำรับรองการรับส่งภายนอกหรือ recovery ที่ทดสอบแล้ว |
| สภาพแวดล้อมทดสอบ | รอบล่าสุดใช้ Docker ที่ผู้ใช้อนุญาตและ loopback browser scenarios; เก็บผล Windows/WSL เดิมเป็นประวัติ; Ubuntu VM/host แบบ disposable ที่ใช้ systemd ยัง Pending |

## Release gates

| ID | Priority / งาน | สถานะ | หลักฐานที่ต้องมี |
| --- | --- | --- | --- |
| A01 | P0 scope | Recorded | Trusted-repository boundary และเลื่อน Mail ตามข้างต้น; ระบุ candidate กับ Ubuntu image/kernel ก่อนทดสอบ host |
| A02 | P0 local baseline | Current local pass; frozen commit pending | Full Docker ล่าสุด 369/369, fail/skip 0 และ source manifest ไม่เปลี่ยน ดูรอบ 2 ด้านบน; ต้องตรวจ committed candidate อีกครั้งหลังตรึง version/commit |
| A03 | P0 Node matrix | Partial local evidence | ล่าสุด pinned 20.20.2 / 22.23.3 / 24.18.0 / 26.10.0 ผ่าน core/access/auth/restore 80 tests ต่อรุ่น; ยังต้องตรวจ installed provisioning, integration better-sqlite3 ของ Node 20/node:sqlite ของรุ่นอื่น, project build/start และ upgrade รักษา major |
| A04 | P0 clean install | Partial local evidence | WSL Linux PTY harness ผ่าน 7 tests; bootstrap/extracted CLI บน Ubuntu 24.04/25.04 amd64 จริง, API/static/login/helper permissions และติดตั้ง tools ยัง Pending |
| A05 | P0 deploy/failure/rollback | Pending | Native Node/Bun/Go/Python/PHP และ Compose ใช้ Nginx/HTTPS ร่วมกัน; domainless Web และ Node/Bun/Go/Python script Worker ไม่มีพอร์ต; build/health/config/TLS/process ล้มต้องคืน release เดิมกับ unmanaged config; rollback จริง |
| A06 | P0 reboot | Pending real host | Reboot VM/host disposable แล้ว Portal/helper/Nginx/แอปที่ enabled กลับมา; ตรวจ Certbot timer |
| A07 | P0 upgrade/restore | Partial fixture evidence; real host pending | Recovery fixtures ผ่านแล้ว; upgrade legacy ต้องเริ่มเมื่อไม่มีงานค้าง เพราะ process เก่าไม่ถือ lease; fixture ก่อน v0.8.3/v0.8.5 ไป candidate, SQLite ทั้งสอง drivers, major, orgs/grants/ENV/decryption และ restore state/key เดิม/ข้อมูลแอปยังเป็น host gates |
| A08 | P0 browser/access | Partial local browser/API pass | Master/User กับ Viewer/Operator/Maintainer, invitation, ENV, progress/logs, deploy/rollback/mobile; API ปฏิเสธข้ามองค์กร/สิทธิ์ถูกถอน/disabled/ไม่มี CSRF |
| A09 | Mail operational acceptance | Deferred from 1.0.0 | ยังไม่รับรอง inbound/outbound ภายนอก, provider-edge ports, DNS/TLS และ mailbox recovery; ต้องมี acceptance แยกก่อนประกาศ Mail พร้อมใช้งานจริง |
| A10 | P0 signed release | Pending | Tests/docs สุดท้าย, version/lock/tag/archive, Ed25519 signature, downloaded SHA-256, stable feed; publish กับ update production เป็นคนละขั้นตอน |

Docker/WSL ช่วยยืนยัน Linux scripts, PTY, dependencies, runtime build และ HTTP/API/browser บาง flows ได้ แต่ผลผ่านไม่ปิด gates ของ systemd boot, reboot จริง, public ACME/TLS, provider networking หรือ VM restore ต้องระบุ environment ของทุกผล

## รูปแบบบันทึกแต่ละรอบ

แบ่งรอบเล็กโดย agent implementation แล้ว agent test ตรวจแยก บันทึก round/date, candidate commit และ dirty diff, gate IDs, คำสั่งจริง, environment/version, หลักฐานตัด secrets, pass/fail/skip, defects และงานย่อยถัดไป ห้ามเก็บ secrets หรือ private host identifiers ในไฟล์นี้

## ผลแต่ละรอบที่บันทึกแล้ว

ผลต่อไปนี้เป็นหลักฐาน local วันที่ 2026-10-01 บน baseline พร้อม dirty diff ที่ยังไม่ commit ไม่ปิด final-candidate หรือ real-host gates

| รอบ | หลักฐาน | ผล / ขอบเขตที่เหลือ |
| --- | --- | --- |
| 1 baseline | Full local suite (`npm test`), Windows Node 24.11.1 | รวม 320: ผ่าน 319, fail 0, skip Linux PTY 1 |
| 1 Linux bootstrap | WSL PTY bootstrap harness | ผ่าน 7; public install และ lifecycle host จริงยัง Pending |
| 2 independent checks | Agent ตรวจ CLI/installer/bootstrap แบบ focused แยกจากผู้แก้ | ผ่าน 13; แก้ Go path ของ CLI และคำอธิบาย reset แล้ว |
| Node matrix | Core suite บน pinned Node 20.20.2 / 22.23.3 / 24.18.0 / 26.10.0 | ผ่าน 68 ต่อรุ่น รวม 272, fail/skip 0; installed runtime provisioning ยัง Pending |
| 3 recovery | Installer suites เดิม และ `node --test test/installer-recovery.test.mjs` | เดิมผ่าน 28; recovery ผ่าน 6: explicit failure, partial backup, service state แยก, absent catchall, success, signal codes และ busy lease |
| Linux lease | `test/maintenance-lock.test.mjs` บน Linux Docker | ผ่าน 4; systemd/upgrade/reboot จริงยัง Pending |

รายละเอียด recovery/shared lease อยู่ใน [ADR 0031](../adr/0031-maintenance-exclusion-and-install-recovery.md) Browser acceptance ยังเปิดระหว่างตรวจ Docker demo ไม่มีคำรับรอง final browser, HTTPS จริง หรือ operational host acceptance ในบันทึกนี้
