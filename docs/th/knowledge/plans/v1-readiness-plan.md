# ลำดับงานเตรียมความพร้อม 1.0.0

## อนุญาต stable release และ candidate ล่าสุด 2026-10-15

ผู้ใช้สั่ง publish release แล้ว Candidate รวม v0.8.9 กับงาน v1 ใน checkout แยก Package/lock/changelog 1.0.0; full Docker 386/386 และ exact Node matrix 101 ต่อรุ่นรวม 404 ผ่าน ไม่มี fail/skip; browser ตรวจ Monitor/invitation revoke/member-disable/Worker failure-logs-lock เพิ่มแล้ว ดู [acceptance record](v1-acceptance-record.md) งาน local validation และ compatibility ด้านล่างมีผลรอบใหม่แทนแล้ว ขั้นที่กำลังทำคือ clean committed/tagged candidate → archive/signature/checksum → publish/download verification ข้อจำกัด host/Mail/ฟอร์ม interactive ที่ไม่ได้ตรวจยังอยู่ใน release notes การ publish stable ไม่ใช่ production host update

## สรุปงานค้างทั้งหมดหลัง full Docker ล่าสุด 2026-10-15 รอบ 2

Full suite ของ source ล่าสุดผ่าน **369/369, fail 0, skip 0**; hash ของ source 187 ไฟล์ตรงกันก่อน/หลังรัน Docker เอกสาร 121 ไฟล์และ diff check ผ่าน ลบ containers/image ของรอบนี้แล้ว ดู [acceptance record](v1-acceptance-record.md) ผู้ใช้ยืนยันว่าไม่มี production target และไม่ให้หา prod test จึงใช้ Docker/local เป็นขอบเขตรอบนี้ งาน host ที่ยังไม่มีหลักฐานเก็บเป็นข้อจำกัดตามตารางด้านล่าง ไม่วนขอ SSH/VM Source/package/lock ยังเป็น 0.8.5 กับ dirty diff และยังไม่มี release 1.0.0

### งานที่ยังทำก่อน publish เรียงตาม priority

| Priority | งานค้าง | เกณฑ์ปิด |
| --- | --- | --- |
| P0.1 | Browser flows สำคัญที่ยังขาด interaction evidence | Invitation create/accept แยก session/single-use/revoke; ถอน grants/disable สมาชิกแล้วตรวจ session เดิม; password form/confirmation/session invalidation; Monitor token create/one-time reveal-copy/revoke บนหน้าใหม่; Worker create release/progress/logs และ edit locks ด้วย fixture ที่ตรง contract (ไม่มี helperต้องแสดง awaiting activation ไม่จำลอง active) การ rollback จริงแยกเป็น host limitation |
| P0.2 | Compatibility หลัง Worker diff | ตรวจชุดที่เกี่ยวข้องกับ Worker/core/access/SQLite บน Node 20/22/24/26 จาก source สุดท้าย; matrix 320 executions เดิมเกิดก่อน Worker diff รอบล่าสุดมี full suite บน Node 24.20.0 เท่านั้น |
| P0.3 | ตรึงขอบเขตและ candidate | คัด dirty/untracked files ที่เป็นงาน 1.0.0 ให้ครบโดยไม่รวบงานอื่น; อัป package/lock เป็น 1.0.0, changelog/release notes สองภาษา พร้อม Mail/Worker/host limitations แล้ว commit Candidate; รัน final checks บน committed source และตรวจ version/commit identity |
| P0.4 | ตรวจแพ็กเกจและ signed artifacts | ใช้ canonical `release:prepare`/`git archive` จาก clean committed candidate; archive ต้องมี worker helper modules/UI/views/docs แต่ไม่มี `.env`, state/key, local evidence หรือ dependencies; ตรวจ archive contents, version/lock/tag, public-key match, Ed25519 signature, SHA-256 และ immutable archive URL/feed ใช้ key เดิมไม่สร้างใหม่ |
| P0.5 | Publish และตรวจสิ่งที่เผยแพร่ | เมื่อผู้ใช้สั่ง release จึง push branch/tag และ publish archive + checksum + signed stable.json; ดาวน์โหลดกลับมาตรวจ signature/hash/feed และ remote SHA; public bootstrap ถ้ามีแก้ต้องตรวจ bytes/syntax แยกจาก artifact; การ publish ไม่ใช่ deploy production |

`release:prepare` อ่าน version จาก working package แต่ archive committed HEAD จึงต้องตรึงและ commit ก่อน มิฉะนั้นไฟล์ Worker/UI ใหม่ที่ยัง untracked จะไม่เข้า archive อย่าใช้ legacy worktree archive script สำหรับ public release โดยไม่ตรวจ exclusions เพราะอาจรวม ignored local evidence

### Behavior ที่ยังไม่ยืนยันบน host — รอบนี้ไม่มี prod test

| กลุ่ม | ส่วนที่ยังไม่มีหลักฐานจริง |
| --- | --- |
| Install / tools | Clean Ubuntu install ผ่าน public bootstrap/extracted CLI, helper socket/Unix permissions และติดตั้ง runtime/tools ที่ขาดจริง |
| Deploy / recovery | Helper/systemd/Nginx integration ของ Native และ Compose, domainless Web, portless Worker ทุก runtime ที่ประกาศ; health/config/start/TLS failure recovery และ rollback บน service manager จริง |
| DNS / TLS | Public DNS/ACME/HTTPS, provider networking/firewall, Certbot renewal/timer และ unmanaged Nginx preservation |
| Reboot | Portal/helper/Nginx และ enabled projects กลับมาหลัง host reboot จริง; container restart ที่ผ่านแล้วไม่ยืนยันกรณีนี้ |
| Upgrade / restore | Legacy upgrade เมื่อไม่มีงานค้าง, installed Node major/ownership และ whole-host state + encryption key + application data/external DB/volumes restore; cross-driver/SQLite fixtures ที่ผ่านไม่ใช่ whole-host restore |

ข้อจำกัดเหล่านี้ต้องอยู่ใน release notes หากเผยแพร่โดยยังไม่มี host acceptance ไม่อ้างว่า Docker ยืนยัน production lifecycle ทั้งหมด Worker process check ไม่ยืนยัน queue/job business success หรือ exactly-once; trusted repositories บน host เดียวและ organization grants ไม่ใช่ hostile-tenant sandbox

### งานที่เลื่อนไปหลัง 1.0.0 — ไม่ใช่ gate บังคับของ scope นี้

- **Mail:** external inbound/outbound, DNS/TLS/provider-edge ports และ mailbox recovery; operational acceptance เลื่อนตามที่ผู้ใช้ตกลง
- **Remote CLI `dpctl`:** ยัง Proposed; client tokens/scopes, metadata/atomic ENV patch และ remote deploy/rollback ยังไม่ทำ CLI บน host ที่มีอยู่เป็นอีกตัว
- **Worker ที่ยังไม่รองรับ:** PHP, Docker Compose, Python ASGI/WSGI และ one-shot/cron jobs
- **P1 operations:** certificate expiry/renewal UI/alerts/action, standalone stop/restart, scheduled Nginx drift/diff preview, notification retry queue และ automated per-project backup/restore
- **P2:** SSH deploy-key lifecycle, GitLab inbound auto-deploy, log search/time filter, advanced/import Nginx config, browser terminal, OS/architecture เพิ่ม และ isolation สำหรับ untrusted repositories

Sections ต่อไปเป็นลำดับแผน/หลักฐานประวัติ; ใช้สรุปรอบล่าสุดนี้สำหรับขอบเขตการทำงานปัจจุบัน

## รอบ Web ภายใน / Worker 2026-10-15

เพิ่ม Web ที่ไม่ผูกโดเมน และ Worker ที่ไม่มีพอร์ต/โดเมนสำหรับ Node.js, Bun, Go และ Python script พร้อม UI แยกประเภท, ENV optional, process check หลัง activation และ recovery ที่หยุด consumer ใหม่ก่อนคืนตัวเดิม ดู [คู่มือ](../../how-to/internal-services-and-workers.md) Full Linux ผ่าน 368/368 ก่อน patch UI สุดท้าย; latest focused ผ่าน 22/22 หลังแก้ ENV ว่างและตรวจ browser ซ้ำ ลบ Docker ของรอบนี้แล้ว ดู [acceptance record](v1-acceptance-record.md) งาน P0 ถัดไปยังต้องตรวจ domainless Web และ Worker activation/failure/rollback/reboot บน systemd host จริง พร้อม install/upgrade/TLS/restore จาก frozen candidate ไม่ถือว่า Docker ปิด host gates และยังไม่ publish

## ผล Docker ล่าสุดและ cleanup 2026-10-14–15

ผู้ใช้อนุญาต Docker แล้ว Full Linux 349/349, exact Node matrix 320 executions, cross-driver restore, real runtime smoke, local browser scenarios และ Compose CLI smoke ผ่าน ลบ test containers/images และล้าง unused build cache แล้ว เก็บ state backup/หลักฐานไว้ในเครื่อง ดูขอบเขตและการแก้ fixture ใน [acceptance record](v1-acceptance-record.md) งานถัดไปคือ frozen candidate บน Ubuntu: install/upgrade, public TLS, helper/systemd/Nginx activation จริง, reboot และ whole-host restore ยังไม่ publish release

## รอบ implementation 2026-10-10 — ยังไม่ publish

ผู้ใช้ให้ปิดงาน v1 ใน source และแยก agent งานระบบ/UI/ตรวจผล โดยไม่รัน Docker และยังไม่ release ขอบเขต v1 คงเดิม: trusted repositories บน host เดียว, Mail operational acceptance เลื่อน, remote CLI `dpctl` ยังเป็นแผนแยก การผ่าน local ไม่ปิด host acceptance

| หมวด | งานที่ทำใน source | สถานะ |
| --- | --- | --- |
| ระบบ | Installer recovery, consistent snapshot, shared maintenance leases และ boot tmpfiles; Monitor GET ที่เขียน `lastUsedAt` ถือ lease ด้วย | Implemented; local/WSL fixtures ผ่าน ดูผลล่าสุดใน acceptance record |
| UI | Sidebar แบ่งงานและโปรเจค / สมาชิกและการเข้าถึง / เครื่องมือ host / การตั้งค่า พร้อม icons และลิงก์ตรง | Implemented; live visual acceptance รอบใหม่ยัง Pending |
| Settings | `/settings/account`, `/settings/updates`, `/settings/monitor` ใช้ templates แยกกัน; `/settings` เปิดบัญชี และ query links เดิมยังใช้ได้ | Route/render tests ผ่าน แต่ละ response มีเฉพาะฟอร์มของหน้าที่เลือก |
| สิทธิ์ | Grants, ENV read/write, ข้ามองค์กร, CSRF, disabled/revoked users และ invitation lifecycle | API regression ผ่าน; browser interaction ที่ยังไม่ได้ตรวจคง Pending |
| ส่งต่อ | เอกสารสองภาษาและ acceptance record แยก implementation, fixture และ host evidence | Updated; version ยัง 0.8.5 และไม่ tag/publish/deploy |

งานที่ยังต้องทำก่อน go live: ตรวจหน้าตา/keyboard/mobile ของ UI ใหม่ใน browser, clean install/public TLS/helper permissions, deploy/failure/rollback ทุก runtime ที่ประกาศ, reboot, legacy upgrade เมื่อ host ไม่มีงานค้าง และ whole-host restore บน Ubuntu VM/staging ที่ระบุแน่นอน จากนั้น freeze commit และตรวจ final candidate ส่วนการ publish รอคำสั่งใหม่ของผู้ใช้

[English](../../../en/knowledge/plans/v1-readiness-plan.md)

ฐานที่ตรวจ: v0.8.5 commit `a14cf93` วันที่ 2026-10-01 แผนเริ่มต้นใช้จัดลำดับก่อน implementation; ผลรอบล่าสุดอยู่ด้านบนและใน acceptance record ไม่ใช่การอนุมัติ deploy production ขอบเขตคือ Ubuntu host เดียว, trusted repositories และสิทธิ์ตามองค์กร ไม่รับรอง sandbox สำหรับโค้ดของผู้ใช้ที่ไม่ไว้ใจกัน

ติดตามผลแต่ละรอบใน [acceptance record](v1-acceptance-record.md) ผู้ใช้ยืนยันเลื่อน operational Mail ออกจาก 1.0.0 ฟังก์ชัน Mail ที่มีอยู่ยังใช้ได้โดยไม่รับรองการรับส่งภายนอกหรือ mailbox recovery รอบ implementation ปัจจุบันเป็น dirty diff ที่ยังไม่ commit บน baseline ไม่ใช่ final release candidate

Working tree มี installer recovery และ maintenance exclusion แล้ว ดู [ADR 0031](../adr/0031-maintenance-exclusion-and-install-recovery.md) การ upgrade ครั้งแรกจาก legacy version ยังต้องยืนยันว่า host ไม่มีงานค้าง เพราะ process รุ่นเดิมไม่ถือ lease การได้ lock ไม่พิสูจน์ว่างาน legacy drain แล้ว การทดสอบ upgrade/restore บน host จริงยังเปิดอยู่

## หลักฐานเริ่มต้น 2026-10-01 (ประวัติ)

ทดสอบบน Windows ด้วย Node v24.11.1: 320 tests, ผ่าน 319, fail 0, skip 1 โดย bootstrap PTY harness ต้องรันบน Linux/WSL ก่อนแก้เอกสารรอบนี้ `docs:check` ผ่าน 109 ไฟล์ การ build Go จริงและ Python venv ที่ติดตั้ง offline wheel ผ่านแล้ว ผลนี้ไม่รับรอง Ubuntu, Node ทุก major, browser flow หรือ production และ changelog v0.8.4 ยังระบุว่า browser/host acceptance ไม่ได้รับการยืนยัน หลักฐาน host ของรุ่นก่อนต้องรันซ้ำกับ release candidate สุดท้าย

## P0 — ต้องปิดก่อนปล่อย เรียงตามลำดับทำงาน

| ลำดับ | งาน | หลักฐานที่ใช้ปิดงาน |
| --- | --- | --- |
| 1 | กำหนด scope และ acceptance matrix | ระบุ candidate commit, Ubuntu image/kernel, Portal Node major และ project runtimes ที่จะทดสอบ คง installer support 24.04/25.04 amd64 จนมีหลักฐาน compatibility แยก ระบุ trusted-repository boundary และจะนับ Mail เป็นบริการพร้อมใช้งานหรือไม่ |
| 2 | ติดตั้งบน Ubuntu ใหม่จริง | Public bootstrap และ CLI จาก release ติดตั้งโดยไม่แก้ไฟล์เอง; login, API/static files, helper socket และ permissions ผ่าน ทดลองติดตั้งเครื่องมือที่ขาดจาก UI และรัน PTY harness ที่ skip บน Linux/WSL แยก |
| 3 | Deploy, recovery และ reboot | Native/Compose ใช้ Nginx ร่วมกันและเข้า HTTPS ได้ ทดสอบทุก runtime ที่ประกาศ; build/health/config/TLS ล้มแล้ว release เดิมยังใช้ได้และไม่กระทบ unmanaged Nginx; rollback ผ่าน หลัง reboot Portal/helper/Nginx/แอปที่เปิดใช้กลับมาครบ |
| 4 | ซ้อม upgrade และ restore | อัป fixture ก่อน v0.8.3 และ v0.8.5 ไป candidate ตรวจ legacy Node detection/การรักษา major เดิม, SQLite ทั้งสอง drivers, องค์กร/สิทธิ์, credentials และ ENV Restore state ที่ consistent พร้อม key เดิมและข้อมูลแอปที่จำเป็นบน staging แล้วตรวจ login/decryption/ownership/การทำงานของแอป |
| 5 | Browser และ access acceptance | ใช้ browser จริงทดสอบ Master/User/Viewer/Operator/Maintainer, invitations, ENV grants, sync/deploy/rollback, progress/logs และมือถือ ตรวจ API ปฏิเสธข้ามองค์กร, สิทธิ์ที่ถูกถอน, ผู้ใช้ disabled และคำขอไม่มี CSRF แยกตรวจ redaction ออกจากการอ่าน ENV ตามสิทธิ์ |
| 6 | Mail acceptance ตามขอบเขต | ถ้าประกาศว่า Mail พร้อมใช้งาน ต้องมีรับ/ส่งจากภายนอกจริง, DNS, TLS, provider-edge ports และกู้คืน mailbox ถ้าเลื่อน ให้ระบุ operational acceptance ที่ยังค้างและไม่นับ Mail ในคำรับรองความพร้อม |
| 7 | Final signed candidate และ release | แก้ defect แล้วรัน checks ที่เกี่ยวข้องและ full release checks บน commit สุดท้าย ตรวจ package/lock/tag, archive, Ed25519 signature, downloaded SHA-256 และ stable feed การ publish และ update production เป็นคนละขั้นตอน |

ทุกแถวต้องเก็บคำสั่งจริง, log ที่ตัด secrets, ผล pass/fail/skipped, candidate version และข้อจำกัด การ skip ยังถือว่างานเปิดอยู่ เว้นแต่ตัดฟีเจอร์นั้นออกจากคำประกาศ release อย่างชัดเจน แก้ defect ที่พบก่อนเพิ่มฟีเจอร์เสริม หาก scope/โค้ดเปลี่ยนต้องรัน acceptance ที่ได้รับผลกระทบกับ candidate สุดท้าย

## P1 — ฟีเจอร์ด้าน operations ที่แนะนำให้ทำก่อน

เป็นข้อเสนอจัดลำดับพัฒนา ยังไม่ใช่ฟีเจอร์ที่ทำแล้วหรือ gate บังคับจนกว่าจะเพิ่มเข้า release scope

1. แสดงวันหมดอายุ certificate/สถานะ renewal แล้วเพิ่ม expiry alerts และ renewal test/action ที่มี guard ตรวจ Certbot timer บน host ใน P0 แม้เลื่อน UI
2. Stop/restart โปรเจกต์แยกจาก deploy พร้อม grants, audit, busy states และพฤติกรรมจริงทั้ง Native/Compose ปัจจุบัน deploy/rollback มีแล้ว
3. แจ้งเตือน Nginx drift และ preview diff ก่อน apply managed config ปัจจุบัน `checkDrift()` ยังไม่มี scheduled/UI integration
4. Notification retry queue ที่จำกัด retries และจัดการการส่งซ้ำ
5. Backup/restore รายโปรเจกต์แบบอัตโนมัติ ระบุความครอบคลุม external DB/Docker volumes ไม่ใช้แทนการซ้อม restore ใน P0

## P2 — เลื่อนไปหลังขอบเขต 1.0.0 นี้

SSH deploy-key lifecycle, GitLab inbound auto-deploy, ค้นหา/filter logs ตามเวลา, Advanced Nginx/config import, browser terminal และ OS profiles/architectures เพิ่มเติม ไม่ใช่เงื่อนไขของ 1.0.0 ขอบเขตแคบที่เสนอ หากเปลี่ยนไปรับ untrusted repositories ต้องทำ build isolation ก่อน สิทธิ์องค์กรไม่ใช่หลักฐาน process isolation

## จุดเริ่มงาน

งานถัดจาก local implementation คือ browser acceptance ของ UI ใหม่และ P0 host gates: กำหนด candidate matrix แล้วทำ clean-host acceptance บันทึก failures และแก้ก่อนเริ่ม P1 ดู [testing](../../how-to/testing.md), [installation/restore](../../how-to/production-install.md), [release workflow](../../how-to/releasing-and-ai-handoff.md), [architecture](../context/architecture.md) และ [scope](../context/scope-and-roadmap.md)
