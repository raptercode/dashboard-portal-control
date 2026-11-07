# Node.js ของ Portal และแอป

[English](../../en/how-to/node-versions.md)


Portal รองรับ Node.js **20.20.2+, 22.13+, 24.x และ 26.x** ตาม `engines` ใน [package.json](../../../package.json) ภายใน major ที่ระบุ ไม่ได้หมายถึงทุกเวอร์ชันที่มากกว่า 20: Node 21/23/25 และ major ในอนาคตยังไม่อยู่ในช่วงรองรับ

## เวอร์ชันที่ installer ติดตั้ง

| Major | เวอร์ชันที่ pin | SQLite driver ของ Portal |
| --- | --- | --- |
| 20 | 20.20.2 | better-sqlite3 11.10.0 |
| 22 | 22.23.4 | node:sqlite |
| 24 (ค่าเริ่มต้น) | 24.22.2 | node:sqlite |
| 26 | 26.13.0 | node:sqlite |

Installer ตรวจ SHA-256 และเก็บ runtime ที่เลือกไว้ที่ `/opt/node-v<version>` ไม่ติดตั้ง major ที่ยังไม่มีบนเครื่อง service ของ project อ้าง path `/opt/node-v<version>` ดังนั้นเมื่อ pin ขยับ major อื่นที่มีอยู่ใต้ `/opt` แล้วจะถูกย้ายไปรุ่นที่ pin ด้วย หากทำไม่สำเร็จ installer จะเตือน คง runtime เดิม และอัปเดต Portal ต่อ ส่วน major ที่ยังไม่มีบนเครื่องต้องเตรียมแยกก่อน deploy project ที่ใช้ Service ของ project บน Node 24 เรียก `/usr/local/bin/npm` ซึ่งตาม runtime ของ Portal จึงย้ายไปรุ่นใหม่เมื่อ restart ครั้งถัดไป ส่วน service บน major อื่นใช้ path `/opt/node-v<version>` ที่ activate ไว้จนกว่าจะ deploy ใหม่ Restart ไม่เปลี่ยน path เมื่อการอัปเดตติดตั้งรุ่นที่ pin ของ major ใดแล้ว จะลบ directory `/opt/node-v<version>` รุ่นเก่ากว่าของ major นั้นที่ชื่อตรงกับ runtime ที่ระบบจัดการ เหมือนที่ archive ของ Node.js แตกออกมาทุกประการ และไม่มีใครใช้แล้ว คือไม่มี systemd unit (รวมที่ link ไว้) หรือ config ของ project อ้างถึง และไม่มี process ที่ executable หรือ working directory อยู่ที่นั่น คำว่า "ทุกประการ" หมายถึงมี binary `node` กับ npm และระดับบนสุด `bin` `lib` `lib/node_modules` `share` `include` มีเฉพาะชื่อที่ archive นั้นใช้ directory ที่มีคนใส่อย่างอื่นลงไป (global package เช่น `pm2` หรือ `pnpm`, `etc/npmrc` จาก `npm config set -g`, แอปพลิเคชัน, dotfile) เป็นของเขาและจะอยู่ต่อ หากอ่าน `/proc` ไม่ได้จะไม่ลบอะไรเลย runtime ที่ยังใช้อยู่จะถูกเก็บไว้และตรวจใหม่ในการอัปเดตครั้งถัดไป directory ที่ใหม่กว่ารุ่นที่ pin จะไม่ถูกแตะ ให้เก็บ script, cron และเครื่องมือของคุณไว้นอก `/opt/node-v<version>` เพราะ installer มองไม่เห็นสิ่งที่ชี้เข้าไปใน directory เก่า และ directory บริสุทธิ์ที่ไม่มีสิ่งที่มันรู้จักใช้อยู่จะถูกลบ

Node 20 สิ้นสุดการสนับสนุนจาก Node.js แล้ว และ Node.js security release เดือนตุลาคม 2026 ไม่มี build 20.x installer จะเตือนทุกครั้งที่ Portal ใช้ Node 20 สำหรับการติดตั้งใหม่แนะนำ Node 24 และย้าย Portal เดิมหลังสำรองข้อมูล ตรวจสถานะ lifecycle ได้ที่ [Node.js releases](https://nodejs.org/en/about/previous-releases)

## เลือก Node สำหรับ Portal

คำสั่งเดียวใน [คู่มือติดตั้ง](production-install.md) ใช้ Node 24 สำหรับ Portal หากต้องการ major อื่น bootstrap มี advanced option `--node-major` รองรับ `20`, `22`, `24` หรือ `26`

ตัว Portal, helper และคำสั่งดูแลระบบใช้ absolute path ของ Node ที่เลือก Global `node`, `npm`, `npx` ชี้ runtime เดียวกัน และ link corepack เมื่อ distribution มีให้

Signed updater ส่งต่อ `HOSTMGR_NODE_MAJOR` จาก config จึงคง major เดิม เครื่องเก่าที่ไม่มีค่าใช้ major ของ runtime ปัจจุบันแทนการบังคับ 24 Installer ที่ได้รับจาก updater รุ่นเก่าซึ่งไม่ส่ง major จะตรวจ runtime ของ service เดิมด้วย Fresh install จึงค่อยใช้ default 24 เมื่อเลือก 26 จะเตรียม libatomic1 ด้วย หากต้องการเปลี่ยน major ให้สำรอง state พร้อม encryption key แล้วเลือกอย่างชัดเจน

ตรวจบน host:

```bash
/opt/node-v20.20.2/bin/node --version
/opt/node-v22.23.4/bin/node --version
/opt/node-v24.22.2/bin/node --version
/opt/node-v26.13.0/bin/node --version
systemctl show dashboard-portal -p ExecStart
```

## สำหรับผู้ดูแล: ขยับ pin

เอา checksum จากไฟล์ที่เซ็นโดยผู้ปล่อย release เท่านั้น ห้ามใช้ mirror หรือผลค้นหา:

1. เลือก release ที่ [nodejs.org/dist](https://nodejs.org/dist/) แล้วดาวน์โหลด `SHASUMS256.txt` และ `SHASUMS256.txt.asc`
2. ตรวจลายเซ็นด้วย `gpg --verify` โดย fingerprint ของ key ที่เซ็นต้องอยู่ในรายการ release keys ของ [README Node.js](https://github.com/nodejs/node#release-keys) และนำเข้า key จาก [nodejs/release-keys](https://github.com/nodejs/release-keys)
3. คัดลอก hash ของ `node-v<version>-linux-x64.tar.xz` ไปใส่ `node_pin()` ใน `strckro.sh` (Node 24 ใช้ `NODE_VERSION` กับ `NODE_SHA256` ต้นไฟล์) แล้วแก้เวอร์ชันใน `scripts/node-versions.mjs` Dockerfile และตารางด้านบน หากไม่ตรงกันเทสต์จะล้ม
4. รัน `npm test` และลองอัปเดตด้วย installer บน host ก่อนเผยแพร่

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
nvm install 22.23.4
nvm install 24.22.2
nvm install 26.13.0

nvm ls
nvm use 24.22.2
nvm alias default 24.22.2
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

เมื่อสลับ major ให้รัน `npm ci` ใหม่ เพื่อให้ native dependency ตรงกับ Node ที่ใช้งาน สามารถสร้าง `.nvmrc` ในโปรเจกต์ของคุณ เช่น `echo 24.22.2 > .nvmrc` แล้วใช้ `nvm use` โดยไม่ต้องพิมพ์เวอร์ชัน

`better-sqlite3` เป็น optional dependency เพื่อให้ Node 22/24/26 ติดตั้ง Portal ได้โดยไม่บังคับ compile addon ที่ไม่ได้ใช้ แต่ Node 20 จำเป็นต้องมี addon นี้: อย่าใช้ `--omit=optional` และหากติดตั้ง native module ไม่ผ่านให้แก้ build tools แล้วรัน `npm ci` อีกครั้ง Installer จะตรวจเปิด SQLite ก่อน activate เสมอเมื่อเลือก Node 20

nvm-sh ใช้กับ shell บน Linux/macOS/WSL ไม่ใช่ PowerShell โดยตรง ผู้ใช้ Windows ใช้ WSL เพื่อทำตามคำสั่งนี้ได้ และ nvm เป็นการตั้งค่าระดับผู้ใช้/shell; production installer ใช้ runtime ใต้ `/opt` เพื่อให้ systemd ทำงานหลัง reboot โดยไม่พึ่ง login shell
