# Node.js ของ Portal และแอป

[English](../../en/how-to/node-versions.md)


Portal รองรับ Node.js **20.20.2+, 22.13+, 24.x และ 26.x** ตาม `engines` ใน [package.json](../../../package.json) ภายใน major ที่ระบุ ไม่ได้หมายถึงทุกเวอร์ชันที่มากกว่า 20: Node 21/23/25 และ major ในอนาคตยังไม่อยู่ในช่วงรองรับ

## เวอร์ชันที่ installer ติดตั้ง

| Major | เวอร์ชันที่ pin | SQLite driver ของ Portal |
| --- | --- | --- |
| 20 | 20.20.2 | better-sqlite3 11.10.0 |
| 22 | 22.23.3 | node:sqlite |
| 24 (ค่าเริ่มต้น) | 24.18.0 | node:sqlite |
| 26 | 26.10.0 | node:sqlite |

Installer ตรวจ SHA-256 และเก็บแต่ละเวอร์ชันไว้ที่ `/opt/node-v<version>` โดยติดตั้งทั้งสี่ major เพื่อให้เลือกต่อแอปได้ จึงต้องมีพื้นที่และการเชื่อมต่อสำหรับดาวน์โหลดทุก runtime

Node 20 สิ้นสุดการสนับสนุนจาก Node.js แล้ว คงไว้เพื่อความเข้ากันได้กับระบบเดิม สำหรับการติดตั้งใหม่แนะนำ Node 24 ตรวจสถานะ lifecycle ได้ที่ [Node.js releases](https://nodejs.org/en/about/previous-releases)

## เลือก Node สำหรับ Portal

คำสั่งเดียวใน [คู่มือติดตั้ง](production-install.md) ใช้ Node 24 สำหรับ Portal หากต้องการ major อื่น bootstrap มี advanced option `--node-major` รองรับ `20`, `22`, `24` หรือ `26`

ตัว Portal, helper และคำสั่งดูแลระบบใช้ absolute path ของ Node ที่เลือก ส่วน global `/usr/local/bin/node` และ `npm` ยังชี้ Node 24 สำหรับแอปเดิม

Signed updater ส่งต่อ `HOSTMGR_NODE_MAJOR` จาก config จึงคงเวอร์ชันเดิมไว้ หากต้องการเปลี่ยน Node ของ Portal ภายหลัง ให้สำรอง state พร้อม encryption key แล้วใช้ advanced option ของ bootstrap หากไม่ระบุจะใช้ 24

ตรวจบน host:

```bash
/opt/node-v20.20.2/bin/node --version
/opt/node-v22.23.3/bin/node --version
/opt/node-v24.18.0/bin/node --version
/opt/node-v26.10.0/bin/node --version
systemctl show dashboard-portal -p ExecStart
```

## ผลต่อฐานข้อมูลและลูกค้าที่อัปเดต

ทั้งสอง driver อ่าน/เขียน SQLite ไฟล์และ schema เดิม ไม่มีขั้นตอนแปลงฐานข้อมูลเพื่อรองรับ Node 20 ข้อมูลผู้ใช้, องค์กร, projects และ encrypted secrets จึงใช้ต่อได้โดยเก็บ encryption key เดิมไว้

เมื่อเลือก Node 20 installer จะติดตั้ง dependency ใน staging ด้วย `npm ci`, ทดลองเปิด SQLite ก่อนสลับแอป และเตรียมสิทธิ์ให้ service อ่าน native module ได้ การติดตั้งอาจล้มเหลวได้หากดาวน์โหลดหรือ compile dependency ไม่สำเร็จ จึงควรทดสอบการอัปเดตบน staging และเก็บ backup ตาม [คู่มือติดตั้ง](production-install.md)

การทดสอบสลับ driver ด้วยฐานข้อมูลจำลองไม่ได้รับประกันข้อมูลทุกฐานของลูกค้า และไม่ได้แทนการทดสอบ restore จริง

## เลือก Node สำหรับแอป

ในหน้าเพิ่ม/แก้ Project เลือก runtime **Node.js** แล้วเลือก **Node.js สำหรับแอป** เป็น 20, 22, 24 หรือ 26 จากนั้น deploy release ใหม่

- Projects เดิมที่ไม่เคยระบุเวอร์ชันใช้ Node 24
- เวอร์ชันที่เลือกใช้ใน dependency installation, build, candidate health check และ service บน host
- แต่ละ release บันทึก major ไว้; rollback จึงใช้ major ของ release นั้น ส่วน release เก่าที่ไม่มีข้อมูลใช้ 24
- การเปลี่ยน Node ของ Portal ไม่เปลี่ยน Node ของแอป
- Portal ไม่อ่าน `.nvmrc` เพื่อสลับ runtime ของ service ให้เลือกใน Project ให้ตรงกับ requirement ของแอป

## ติดตั้งหลายเวอร์ชันด้วย nvm

สำหรับ **Linux, macOS หรือ WSL** ติดตั้ง nvm ตาม [คำแนะนำอย่างเป็นทางการ](https://github.com/nvm-sh/nvm#install--update-script) แล้วเปิด shell ใหม่ ตรวจว่า `nvm --version` ใช้งานได้ จากนั้น:

```bash
nvm install 20.20.2
nvm install 22.23.3
nvm install 24.18.0
nvm install 26.10.0

nvm ls
nvm use 24.18.0
nvm alias default 24.18.0
node --version
npm --version
```

ลอง Portal บน Node 20 จาก root ของ repository:

```bash
nvm use 20.20.2
npm ci
npm test
npm run demo
```

เมื่อสลับ major ให้รัน `npm ci` ใหม่ เพื่อให้ native dependency ตรงกับ Node ที่ใช้งาน สามารถสร้าง `.nvmrc` ในโปรเจกต์ของคุณ เช่น `echo 24.18.0 > .nvmrc` แล้วใช้ `nvm use` โดยไม่ต้องพิมพ์เวอร์ชัน

`better-sqlite3` เป็น optional dependency เพื่อให้ Node 22/24/26 ติดตั้ง Portal ได้โดยไม่บังคับ compile addon ที่ไม่ได้ใช้ แต่ Node 20 จำเป็นต้องมี addon นี้: อย่าใช้ `--omit=optional` และหากติดตั้ง native module ไม่ผ่านให้แก้ build tools แล้วรัน `npm ci` อีกครั้ง Installer จะตรวจเปิด SQLite ก่อน activate เสมอเมื่อเลือก Node 20

nvm-sh ใช้กับ shell บน Linux/macOS/WSL ไม่ใช่ PowerShell โดยตรง ผู้ใช้ Windows ใช้ WSL เพื่อทำตามคำสั่งนี้ได้ และ nvm เป็นการตั้งค่าระดับผู้ใช้/shell; production installer ใช้ runtime ใต้ `/opt` เพื่อให้ systemd ทำงานหลัง reboot โดยไม่พึ่ง login shell
