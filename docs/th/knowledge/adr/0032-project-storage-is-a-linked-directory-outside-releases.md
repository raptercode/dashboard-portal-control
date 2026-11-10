# ADR 0032: Storage ของ project เป็นโฟลเดอร์ที่ link เข้ามาจากนอก releases

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0032-project-storage-is-a-linked-directory-outside-releases.md)


- Status: Accepted
- Date: 2026-11-08

## บริบทและการตัดสินใจ

แอปรันโดยมี `WorkingDirectory=<project root>/current` ซึ่งชี้ไป release ที่ทุก deployment แทนที่ และ `pruneHistoricalReleases` ลบทุก release ยกเว้นตัวที่ active กับตัวก่อนหน้า ไฟล์ที่แอปเขียนข้างโค้ด (upload, ฐานข้อมูลในเครื่อง, ภาพที่สร้าง) จึงหายตอน deploy หรือ rollback ครั้งถัดไป

project native ตั้ง `storagePath` ได้หนึ่งค่า เป็นโฟลเดอร์แบบ relative ในแอป (`uploads`, `public/uploads`) helper เก็บโฟลเดอร์เดียวต่อ project ที่ `<project root>/shared/storage` และแทน `<release>/<storagePath>` ด้วย symbolic link ไปที่นั่นทุกครั้งที่เตรียม release ทั้งตอน deploy และ rollback

- API ตรวจ path ตอน sync และ root helper ตรวจซ้ำจากข้อมูลใน SQLite ด้วยโมดูลเดียวกัน (`scripts/project-storage.mjs`): relative, ไม่เกิน 5 ชั้น, ชื่อแต่ละชั้นตรง `[A-Za-z0-9_][A-Za-z0-9._-]*`, สงวน `node_modules`, `vendor`, `venv`, `hostmgr-app`
- เลือก symbolic link แทน `BindPaths=` ของ systemd เพื่อไม่แตะ sandbox ของ unit ทุกตัว ใช้ได้เหมือนกันทุก runtime รวม bind ของ release ใน Bun และทดสอบกับ Linux จริงได้
- helper รันเป็น root แต่ release เป็นของ project user และมีโค้ดที่ Portal ไม่ได้เขียน ทุกการแก้ใต้ release (สร้างโฟลเดอร์, ลบโฟลเดอร์หรือ link ที่ repository ส่งมา, สร้าง link) ทำโดย spawn `mkdir`, `rm`, `ln` ด้วย uid/gid ของ project เอง โมดูลนี้ import เฉพาะ `lstat` กับ `readlink` และมีเทสต์บังคับ
- ไฟล์จริงที่ชื่อตรงกับ mount path ทำให้ deployment หยุด ไม่ถูกลบ ส่วนโฟลเดอร์หรือ link จาก repository จะถูกแทน
- Docker Compose ไม่รวม (ใช้ named volume, ADR 0021) การแก้ต้องมีสิทธิ์ `project.configure` และ sync ที่ไม่ส่ง key นี้คงค่าเดิมไว้ ส่งค่าว่างเพื่อปิด

## การใช้งานบันทึก

Upload รอด Restart, deploy, rollback และการลบ release เก่าโดยแอปไม่ต้องแก้ แต่การลบ project ลบ storage ด้วย การเปิด mount ไม่ย้ายไฟล์ที่เขียนไว้แล้ว (มีคำสั่ง copy ครั้งเดียวใน how-to) ไม่มี quota/replication/backup และยังไม่ได้ทดสอบบน systemd host จริง เก็บสถานะและวันที่ตามต้นฉบับ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่

## ภาคผนวก (2026-11-10): การอ่านสถานะ storage

แท็บ **Storage** ในหน้าแอปอ่านอย่างเดียว (`GET /api/projects/<slug>/storage`, สิทธิ์ `project.view`) ใช้ helper operation `project-storage-status` และคงหลักการข้างต้น root เรียกเพียง `lstat` กับ `readlink` (release ที่ใช้งานอยู่ link ไปที่โฟลเดอร์หรือยัง และโฟลเดอร์มีอยู่ไหม) ส่วนการนับรัน `find` และ `df` ด้วย uid/gid ของ project เอง เพราะแอปควบคุมสิ่งที่อยู่ข้างใน: `find` ไม่ตาม link และอยู่ใน file system เดียว และ stream รายการทีละบรรทัดจึงไม่เก็บทั้งรายการไว้ในหน่วยความจำ helper เลิกนับหลัง 20 วินาที และ Portal ใช้ผลที่วัดไว้ร่วมกัน 5 วินาที เฉพาะไฟล์ปกติที่นับเป็นขนาด โฟลเดอร์ว่างจึงเป็น 0 byte ไม่ว่า file system จะกำหนดขนาดให้โฟลเดอร์เท่าไร แท็บไม่แสดงชื่อไฟล์และไม่แก้อะไร การแสดงรายชื่อ ดาวน์โหลด อัปโหลด หรือลบไฟล์ผ่าน Portal ต้องตัดสินใจใหม่ในเรื่องการจัดการ path และ link ขีดจำกัดขนาด และสิทธิ์แยกต่างหาก
