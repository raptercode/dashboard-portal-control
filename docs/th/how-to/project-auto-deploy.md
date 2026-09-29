# ตั้งค่า automatic deployment

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../en/how-to/project-auto-deploy.md)


Portal ตรวจ branch ของแต่ละ project ทุกห้านาที เปิด Auto deploy ในเมนู project เพื่อ queue release เมื่อ sync พบ commit ใหม่ Candidate ต้องผ่าน build/health ก่อน activation หากล้มเหลวคง active release เดิม ต้องมี environment ที่บันทึกไว้และ domain สำหรับ host deployment

| Trigger | การตั้งค่าภายนอก | พฤติกรรม |
| --- | --- | --- |
| Auto deploy | ไม่ต้องเพิ่ม | Poll ทุกห้านาที |
| GitHub push | Repository webhook | ตรวจทันทีเมื่อ push และมี polling fallback |
| Actions | CI step + secret | Sync ได้ แต่รอ CI hook ก่อน deploy |

สร้าง hook จะเลือก mode และเปิด auto deploy เลือก Auto deploy จากเมนูจะกลับ polling GitHub mode ยังคง polling fallback Actions mode รอ CI แม้ poll sync แล้ว ปิด Actions hook จะหยุด auto deploy จนเปลี่ยน mode Token เก็บไว้ได้แต่เฉพาะ mode ที่เลือกจึงรับ trigger

## GitHub push webhook

1. เปิด action ตั้งค่า GitHub webhook สร้าง Secret และคัดลอกทันที ระบบแสดงครั้งเดียวและเข้ารหัสด้วย `HOSTMGR_SECRET_KEY`
2. ที่ repository ไป Settings → Webhooks → Add webhook ใส่ Payload URL, `application/json`, Secret และ Just the push event
3. Push ไป branch ที่ project ตั้งไว้ ตรวจ release log สำหรับ sync/build/health/activation

Endpoint ตรวจ exact repository/branch และ HMAC `X-Hub-Signature-256` ของ raw body จากนั้น fetch branch tip ไม่เชื่อ commit ที่ caller ส่งมา Revision ซ้ำไม่สร้าง healthy release ซ้ำ Trigger ระหว่าง sync/deploy จะรวมไปตรวจ source ภายหลัง

## Actions hook

สร้าง Actions hook แล้วเก็บ bearer token เป็น CI secret หลัง tests ผ่านเรียก URL ที่ Portal ให้ โดยใช้ `Authorization: Bearer <token>` ห้าม commit token ลง workflow ดูชื่อ secret และตัวอย่าง YAML ที่ Portal แสดง การเลือก Actions mode ใช้ CI เป็น gate หาก hook ไม่มาจะ sync แต่ยังไม่ deploy ให้ retry หลัง CI ผ่านหรือเปลี่ยน mode เมื่อเลิก integration ให้ disable/rotate hook แยกจากการถอนสิทธิ์สมาชิก

Token/secret ไม่ส่งกลับ project list และไม่ส่งให้ privileged helper Hooks เลือก commit หรือส่ง shell command ไม่ได้ ใช้ deployment queue, health, rollback เดิม การ release/update Portal แยกจาก project automation ดู [release guide](releasing-and-ai-handoff.md)
