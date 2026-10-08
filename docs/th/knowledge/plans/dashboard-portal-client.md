# แผน dashboard-portal-client

[English](../../../en/knowledge/plans/dashboard-portal-client.md) · [สารบัญ](../../README-index.md)

- สถานะ: **Proposed** — ยังไม่ได้สร้าง client, token สำหรับเขียน หรือ endpoint ใหม่
- วันที่: 2026-10-09
- เป้าหมาย: CLI แยกโปรเจกต์สำหรับ Windows/Linux/CI ใช้ตรวจ Portal และโปรเจกต์ รวมถึงแก้ ENV แบบระบุ key โดยให้ Portal เป็นผู้ตรวจสิทธิ์ บันทึก และเข้ารหัส

## ฐานที่มีอยู่

| ความสามารถ | ปัจจุบัน | ช่องว่างสำหรับ client |
| --- | --- | --- |
| Portal health | `GET /api/health` แบบ public | บอกเพียงว่า process ตอบ ไม่ยืนยันโปรเจกต์หรือ host ทั้งหมด |
| Deploy status | Monitor token อ่าน `GET /api/monitor/v1/projects/:slug/deployments` ได้ในโปรเจกต์เดียว | อ่าน runtime log, host doctor หรือสั่งเปลี่ยนข้อมูลไม่ได้ |
| Host doctor / DNS / edge | มี endpoint ที่ใช้ web session และ permissions | ยังไม่มี bearer contract สำหรับ CLI |
| Project ENV | `GET /api/projects/:slug/environment` ส่ง plaintext ให้ `env.read`; `POST` แบบ `mode: replace` เขียนทั้งเอกสารด้วย `env.write` | การ replace เสี่ยงเขียนทับ key อื่นเมื่อแก้พร้อมกัน; legacy `variables` merge ตั้งค่าว่างหรือลบ key ไม่ได้ |
| Host CLI | `dashboard-portal` ที่ติดตั้งบน host มี help/version/update/configure-update/reset password | ไม่ใช่ remote client |

Monitor response ใน checkout นี้ใช้ field allowlist และไม่ส่ง `failureLog`; ตรวจรายละเอียดใน [Monitor API](../../how-to/monitor-api.md) การแก้ source ใน checkout ไม่เท่ากับการอัปเดต host ที่ติดตั้งแล้ว

## รูปแบบที่เสนอ

- Repository แยกชื่อ `dashboard-portal-client`; binary ชื่อ `dpctl` เพื่อไม่ชนกับคำสั่ง `dashboard-portal` ที่อยู่บน host
- Portal เป็นเจ้าของ HTTP contract, การ authorize, transaction, encryption และ audit; client ทำหน้าที่รับ input, เรียก API และแสดงผลเท่านั้น
- เริ่มจาก Node CLI ที่รันได้บน Windows/Linux และ CI มี `--json` สำหรับ AI/automation กับข้อความสั้นสำหรับคน ระบุ compatibility กับ API version ในเอกสารและทดสอบทั้งสองฝั่ง
- เก็บ origin/profile ใน config; เก็บ token ใน OS credential store หรือ CI secret store ไม่บันทึก token ใน config/log/URL และไม่ปิด TLS certificate verification ตาม [RFC 6750](https://www.rfc-editor.org/info/rfc6750/)

## คำสั่งชุดแรก

| คำสั่งที่เสนอ | ผลลัพธ์ | API ที่ต้องใช้ |
| --- | --- | --- |
| `dpctl check portal` | HTTP/TLS และสถานะ process | `/api/health` ที่มีอยู่ |
| `dpctl project status <slug>` | sync, active release, job ล่าสุด, failure summary | Monitor API ที่มีอยู่ |
| `dpctl project checks <slug>` | health/edge/domain ที่ตรวจได้ พร้อมเวลาและขอบเขตหลักฐาน | endpoint แบบอ่านใหม่ที่มีสิทธิ์เฉพาะโปรเจกต์ |
| `dpctl host doctor` | tools และ host diagnostics สำหรับ Master | endpoint ใหม่ที่ใช้ scope ระดับ host |
| `dpctl env keys <slug>` | ชื่อ key และ revision โดยไม่คืนค่า | endpoint metadata ใหม่ |
| `dpctl env set <slug> KEY --stdin` หรือ `--file PATH` | ตั้ง key เดียวอย่าง atomic; มี `--prompt` สำหรับคนและ `--empty` สำหรับค่าว่าง | endpoint patch ใหม่ที่ต้องมี `env.write` |
| `dpctl env unset <slug> KEY` | ลบ key โดยระบุชัด | endpoint patch เดียวกัน |

ค่า ENV ที่เป็น secret ไม่ควรอยู่ใน argument เช่น `KEY=value` เพราะอาจไปอยู่ใน shell history หรือ process listing; client ไม่พิมพ์ค่ากลับ stdout/stderr และไม่เปิด debug body อัตโนมัติ แนวทางการจัดการ secret สำหรับ CLI/CI อ้างอิง [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) และ [CI/CD Security](https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html)

## สิทธิ์และ ENV contract ที่ต้องเพิ่มใน Portal

1. รักษา Monitor token เดิมเป็น read-only และไม่เพิ่มสิทธิ์ ENV ให้ token ชนิดนี้ สร้าง client token แบบใหม่ที่กำหนด project/host scope, action scopes, วันหมดอายุ, revoke และ actor ใน audit ได้ สิทธิ์ของ token ต้องไม่เกินสิทธิ์ผู้สร้าง; เมื่อ account หรือ grants ถูกเพิกถอน token ต้องใช้ต่อไม่ได้
2. เพิ่ม metadata read สำหรับ ENV ที่คืน `keys` และ revision โดยไม่คืน values เพื่อให้ผู้มี `env.write` แต่ไม่มี `env.read` ใช้ `env set` ได้
3. เพิ่ม key-level `PATCH` ที่รองรับ `set`, `unset` และค่าข้อความว่างแยกกันชัดเจน ตรวจ precondition เช่น `If-Match`/revision ภายใน transaction แล้วคืน `412` เมื่อมีคนแก้ก่อนหน้า วิธีนี้ป้องกัน lost update ตาม [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1)
4. ใช้ validator, vault และ audit เดิม บันทึกเฉพาะชื่อ key/ผลการทำงาน ไม่มีค่า secret ใน audit หรือ error; การแก้ ENV มีผลกับ deploy ถัดไป ไม่สั่ง deploy อัตโนมัติ
5. แยก `env.read` จาก `env.write`; คำสั่งอ่านค่าจริง หากเพิ่มภายหลัง ต้องเรียกอย่างชัดเจนและตรวจสิทธิ์ `env.read`

## ลำดับทำงานและเกณฑ์ผ่าน

1. **Read-only MVP:** ตรึง response/exit-code contract, ทำ `check portal` และ `project status` ด้วย Monitor token, ทดสอบ Windows/Linux, JSON output, revoked/wrong-project token และ network failure
2. **Scoped checks:** เพิ่ม client token และ endpoint สำหรับ project checks/host doctor ตาม scope; ทดสอบข้ามโปรเจกต์/องค์กร, หมดอายุ, revoke, เปลี่ยน grants และข้อมูลใน response
3. **ENV write:** เพิ่ม metadata + atomic patch ใน Portal แล้วทำ `env keys/set/unset`; ทดสอบ write-only grant, ค่าว่าง, ลบ key, conflict 412, concurrent writers, encryption/restore, audit redaction และ secret ไม่ปรากฏใน output
4. **Acceptance:** ตรวจบน host ที่ติดตั้งจริงพร้อม TLS, proxy, account grants และ deployment ใหม่ที่รับ ENV หลังแก้; release client แยกจาก Portal เมื่อ contract และ compatibility matrix ผ่าน

รอบแรกยังไม่รวม deploy/rollback, shell command หรือ AI auto-fix ถ้าจะเพิ่ม ให้ใช้ API queue/health/audit ของ Portal และ scope แยกต่างหาก
