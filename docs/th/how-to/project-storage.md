# Storage ถาวรสำหรับไฟล์ upload

[English](../../en/how-to/project-storage.md) · [สารบัญเอกสาร](../README-index.md)

ทุกครั้งที่ deploy จะได้ release directory ใหม่ และ Portal ลบ release เก่าทิ้ง (เก็บเฉพาะ release ที่ active กับ release ก่อนหน้าไว้สำหรับ rollback) ไฟล์ที่แอปเขียนลงในโฟลเดอร์ของตัวเอง เช่น `./uploads/photo.jpg` จึงรอด **Restart** ธรรมดา แต่หายตอน **deploy** หรือ **rollback** ครั้งถัดไป

ตั้ง **Mount path** ที่ project เพื่อเก็บไฟล์เหล่านี้ไว้:

1. เปิด project → **Edit application** → ขั้น **Source & runtime** แล้วกรอก **Persistent storage → Mount path** เป็นโฟลเดอร์ในแอป เช่น `uploads` หรือ `public/uploads` เว้นว่างเพื่อปิด
2. บันทึกและ sync แล้ว **deploy** ค่านี้มีผลใน deployment ถัดไป Restart ไม่ผูก link ให้ release ที่มีอยู่แล้ว
3. แอปใช้ path แบบ relative เดิม (`./uploads`) ได้เลย ไม่ต้องแก้โค้ดและไม่ต้องใช้ environment variable

ใช้ได้กับ service และ worker ที่เป็น Node.js, Bun, Go, Python และ PHP ส่วน Docker Compose ไม่รองรับที่นี่ ให้ประกาศ named volume ใน Compose file แทน (host bind mount ยังถูกปฏิเสธ) การแก้ค่านี้ต้องมีสิทธิ์ `project.configure`

## สิ่งที่เกิดบน host

- ไฟล์อยู่ในโฟลเดอร์เดียวต่อ project คือ `/srv/hostmgr/projects/<slug>/shared/storage` นอก `releases/` การลบ release เก่า, rollback และ Restart ไม่แตะที่นี่
- ทุก release จะถูกแทน `<release>/<mount path>` ด้วย symbolic link ไปยังโฟลเดอร์นั้น ทำตอนเตรียม release ตอน deploy และทำอีกครั้งตอน rollback release เก่าจึงได้ link ด้วย
- ถ้า repository มีโฟลเดอร์ชื่อเดียวกัน จะถูกแทนใน release (ของใน repository ถูกซ่อน เหมือน volume ซ่อนของเดิม) ถ้าชื่อนั้นเป็น **ไฟล์** deployment จะหยุดพร้อม error และไม่แตะไฟล์นั้น
- path เป็น relative จากโฟลเดอร์แอป ลึกได้ไม่เกิน 5 ชั้น แต่ละชั้นใช้ตัวอักษร ตัวเลข `.` `-` `_` และห้ามขึ้นต้นด้วยจุด ชื่อ `node_modules`, `vendor`, `venv` และ `hostmgr-app` ถูกปฏิเสธเพราะ runtime ต้องใช้ชื่อเหล่านี้
- โฟลเดอร์และ link สร้างโดย Unix user ของ project เอง ไม่ใช่ root ดังนั้น link ที่ซ่อนใน release ไม่ทำให้ privileged helper ของ Portal ไปแตะสิ่งที่ project เองยังไม่มีสิทธิ์แตะ service เขียนได้เฉพาะใต้ project directory ซึ่งรวมโฟลเดอร์นี้

## ย้ายไฟล์ที่มีอยู่แล้ว

การเปิด mount ไม่ copy ไฟล์ที่แอปเขียนไว้ใน release ที่ active อยู่ ให้ deploy หนึ่งครั้งโดยตั้ง path ไว้ release เดิมจะกลายเป็น release ก่อนหน้าและยังอยู่บนดิสก์ ให้ copy โฟลเดอร์ของมันออกมาก่อน deploy ครั้งถัดไปจะลบทิ้ง:

```sh
sudo cp -a /srv/hostmgr/projects/<slug>/releases/<previous-release-id>/uploads/. /srv/hostmgr/projects/<slug>/shared/storage/
```

release id ดูได้จากประวัติ deployment ของ project

## สิ่งที่ไม่ได้ทำให้

- เป็นดิสก์ธรรมดาบน host ไม่มี quota, replication หรือ backup ต้อง backup `/srv/hostmgr/projects/<slug>/shared/storage` เอง
- **การลบแอปจะลบ storage ด้วย** หน้ายืนยันจะบอกเมื่อมีการตั้ง mount path
- ไม่ได้เปิดไฟล์ให้ใคร แอปเป็นผู้กำหนดว่าอะไร public
- หนึ่ง project มี mount path ได้หนึ่งอัน เมื่อลบ path release ใหม่จะไม่ผูก link อีก แต่โฟลเดอร์และไฟล์ยังอยู่บนดิสก์
- ทุก deployment เปลี่ยน owner ของ project directory แบบ recursive ซึ่งรวมโฟลเดอร์นี้ ถ้ามีไฟล์จำนวนมากมาก deploy จะช้าลง

เหตุผลของการออกแบบอยู่ใน [ADR 0032](../knowledge/adr/0032-project-storage-is-a-linked-directory-outside-releases.md)
