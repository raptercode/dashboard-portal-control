# โปรเจกต์ Node.js ที่ใช้ pnpm

[English](../../en/how-to/pnpm-projects.md)

pnpm เป็นเครื่องมือทางเลือก การติดตั้งหรืออัปเดต Dashboard Portal **ไม่ติดตั้ง
pnpm อัตโนมัติ** โปรเจกต์ npm และ Bun เดิมไม่จำเป็นต้องมี pnpm เจ้าของระบบเลือก
กดติดตั้ง pnpm 11.19.0 ในหน้า **Setup** หรือเตรียมเองผ่าน SSH ก่อนใช้งานได้
ปุ่ม Setup ต้องใช้ Node 22.13 ขึ้นไป และต้องมี executable ที่
`/usr/local/bin/pnpm` ซึ่ง user ของ Portal และโปรเจกต์เรียกได้

```bash
sudo /usr/local/bin/npm install --global --prefix /usr/local --ignore-scripts pnpm@11.19.0
/usr/local/bin/pnpm --version
```

เลือก runtime **Node.js** แล้วระบุเวอร์ชันใน `package.json` ของแอป:

```json
{
  "packageManager": "pnpm@11.19.0",
  "scripts": { "build": "your-build-command", "start": "node dist/main.js" }
}
```

ถ้าระบุ npm ไว้ ระบบจะใช้ npm แม้มี pnpm lockfile เก่าค้างอยู่ หากไม่ระบุ
`packageManager` แต่มี `pnpm-lock.yaml` จะเลือก pnpm; ถ้าไม่มีจะใช้ npm ตามเดิม
ระบบอ่านไฟล์ใน directory ที่เลือกของโปรเจกต์ หากเป็น workspace ให้เลือก root
ที่มี lockfile และ workspace settings

pnpm บน host ต้องตรงกับ pin รูปแบบ `pnpm@major.minor.patch` รองรับ pnpm 8–11
โดย pnpm 11 ต้องใช้ Node 22/24/26 ของโปรเจกต์ รูปแบบอื่น เช่น tag, range หรือ
Corepack integrity suffix จะแจ้ง error ให้แก้ก่อนใช้งาน ถ้าไม่ pin จะใช้รุ่น
ที่รองรับซึ่งติดตั้งอยู่ ทุกแอปใช้ pnpm ของ host ร่วมกัน จึงควรตรวจแอปอื่นก่อน
เปลี่ยนเวอร์ชัน Portal ไม่ติดตั้งหรือสลับ pnpm ระหว่าง deploy/build/start/rollback

เมื่อมี lockfile จะติดตั้งแบบ frozen และรวม devDependencies ที่จำเป็นต่อ build
ถ้า lockfile ไม่ตรงกับ package.json จะหยุด candidate ให้แก้และ commit จากเครื่อง
พัฒนา หากไม่มี lockfile จะ resolve เฉพาะใน candidate โดยไม่เขียนกลับ Git
แนะนำให้ commit lockfile เพื่อให้ติดตั้งซ้ำได้ตรงกัน Portal ไม่ข้าม peer check
และไม่อนุมัติ build scripts ของ dependencies แทนผู้ใช้ ให้ตรวจ settings ใน
`pnpm-workspace.yaml` ของแอปเอง

ขั้นตอน install, build และ candidate start ใช้ package manager ที่ตรวจพบ
service จริงและ rollback ใช้ pnpm ที่ติดตั้งไว้ร่วมกับ Node major ของ release
ปิดการดาวน์โหลด package manager และการติดตั้ง dependency อัตโนมัติก่อน `run`
เก็บ relative symlink ของ dependencies เมื่อคัดลอกไป runtime directory
กรณีติดตั้งไม่ผ่านจะมีรายละเอียด error ที่ปกปิด secrets และจำกัดขนาดใน deploy log

หากแจ้งว่า pnpm หายหรือเวอร์ชันไม่ตรง ให้ติดตั้งเวอร์ชันที่แอปต้องการแล้วลองใหม่
การอัปเดต Portal ไม่ได้แก้ dependency conflict ของแอป ควรตรวจ build, tests และ
health endpoint ที่มีความหมายก่อนเปิดใช้งานจริง
