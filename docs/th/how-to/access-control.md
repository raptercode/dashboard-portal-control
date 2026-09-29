# สมาชิก องค์กร และสิทธิ์

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../en/how-to/access-control.md)


ระบบมี role `master` กับ `user` ส่วน Viewer/Operator/Maintainer เป็นชุด permission ของ membership ในแต่ละองค์กร ผู้ใช้คนเดียวมี grants ต่างกันในแต่ละองค์กรได้ Master เห็นทุกองค์กรและจัดการ host สมาชิกและองค์กร โดยยังต้องผ่าน CSRF และห้ามปิดหรือลดสิทธิ์ Master คนสุดท้าย

## เพิ่มสมาชิกและองค์กร

Master สร้างองค์กรใน Members แล้วเชิญสมาชิกผ่าน invitation แบบ single-use พร้อม role และ grants ตามงาน Invitation หมดอายุหรือถูกยกเลิกใช้ซ้ำไม่ได้ การปิดบัญชีหรือถอนสิทธิ์มีผลกับ session ที่เปิดอยู่แล้ว

| Permission | สิทธิ์ |
| --- | --- |
| `project.view` | เห็นโปรเจกต์ในองค์กร |
| `project.create` / `project.configure` | สร้าง / แก้ config โปรเจกต์ |
| `source.sync` | Sync repository ที่ผูกไว้ |
| `deploy.start` / `deploy.rollback` | Deploy / rollback |
| `logs.read` | อ่าน logs และ diagnostics |
| `env.read` / `env.write` | อ่านค่า / แทนที่ environment แยกกัน |
| `domains.manage` | จัดการ domain |
| `credentials.use` / `credentials.create` / `credentials.update` / `credentials.delete` | ใช้ / เพิ่ม / แก้ / ลบ credential ในองค์กร |
| `webhooks.manage` | จัดการ hook และ monitoring token |
| `audit.read` | อ่าน audit ขององค์กร |

Viewer อ่าน project/logs/audit; Operator เพิ่ม sync/deploy/rollback; Maintainer ได้ grants ทั้งหมดขององค์กร รวม ENV และ credentials แต่ไม่ได้สิทธิ์ host หรือสมาชิก การใช้งานต้องมี project visibility ร่วมกับ permission ของ action นั้น การแก้ config ผ่าน sync ต้องมี `project.configure` เพิ่ม; แก้ domain ต้องมี `domains.manage` และเปิด auto deploy/hook ต้องมี `webhooks.manage` กับ `deploy.start` Monitoring token ต้องมี `logs.read`

Global tools/metrics, Git identity, legacy global credentials, mail, database, Portal updates, สมาชิกและองค์กร เป็น Master-only

## Repository credentials ขององค์กร

Master ให้ credential grants ใน Members จากนั้นเลือกองค์กรใน Credentials และเพิ่มชื่อ Git hostname และ token ชื่อ/default แยกแต่ละองค์กร สร้าง private project ต้องมี `project.create` และ `credentials.use`; เปลี่ยน repository/credential ต้องมี grants ของการดู config และ sync ด้วย Token เข้ารหัสและไม่ส่งกลับ API/form ปล่อย token ว่างตอนแก้จะเก็บค่าเดิม กรอกใหม่เพื่อ rotate

Credential ที่ถูกใช้เปลี่ยน host หรือลบไม่ได้ ต้องเปลี่ยน project bindings ก่อน Ownership ของ credential ย้ายองค์กรไม่ได้ ให้สร้างใหม่ในองค์กรปลายทาง Members เลือก global legacy credential ไม่ได้ แต่ sync binding เดิมที่ไม่เปลี่ยนได้ Master ต้องจัดการการเปลี่ยน binding/repository นั้น

`credentials.use` ให้ใช้ repository ตาม scope ของ provider token ไม่ได้ให้ project/deploy grants อัตโนมัติ Sync binding เดิมและ automation ที่ตั้งไว้ยังทำงานได้ตาม policy ถอน provider token ที่ Git provider หรือ rotate credential แยก การย้าย project ต้องเลือก credential ในองค์กรปลายทาง

ใช้ canonical HTTPS clone URL Git ปฏิเสธ redirect และใช้ isolated config แทน global helper/URL rewrite AskPass ตอบเฉพาะ HTTPS authority ที่เลือก Temporary auth files จำกัดสิทธิ์และลบหลังใช้งาน SSH key และ Git installation/identity ยังจัดการโดย Master

## Enforcement และ migration

API ปฏิเสธ User operations ที่ไม่อนุญาตและอ่าน account/grants ปัจจุบันทุกครั้ง สิทธิ์องค์กรหนึ่งใช้กับอีกองค์กรไม่ได้ ENV read/write แยกกัน ผู้ใช้ write-only แทนที่ค่าทั้งชุดโดยไม่อ่านค่าเดิม Lists/jobs/audit/integrations ต้อง scope ตามองค์กรและปิด secret fields

Owner เดิม migrate เป็น Master และ organization labels เป็น stable IDs แบบ idempotent ไม่คืน role หรือเปิดบัญชีที่ถูกปิด Backup DB ก่อนอัปเกรด การย้อนกลับไปก่อน multi-account ไม่ใช่วิธี rollback access control

Manual deployment บันทึก initiator/องค์กรและตรวจสิทธิ์อีกครั้งก่อน execution กับ activation ส่วน polling/hook ทำงานเป็น project automation การถอนสมาชิกไม่ปิด automation เดิม ให้ปิดหรือ rotate trigger แยก ระบบนี้สำหรับทีมที่เชื่อใจกันบน host ร่วม ไม่ใช่ sandbox สำหรับ hostile tenants

ดู [คู่มือทดสอบ](testing.md)
