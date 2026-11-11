# ประวัติการเปลี่ยนแปลง

[English](../en/CHANGELOG.md)

## 1.1.3 — 2026-11-11

- อ่านและส่งอีเมลใน Portal หน้า **Mail** เปิดมาที่กล่องอีเมล: โฟลเดอร์ (Inbox, Sent, Drafts, Spam, Trash) พร้อมจำนวนที่ยังไม่อ่าน รายการข้อความที่มีผู้ส่ง หัวข้อ ตัวอย่างข้อความ และเครื่องหมายไฟล์แนบ หน้าอ่าน และหน้าต่างเขียนอีเมลสำหรับเขียนใหม่ ตอบ ตอบทุกคน และส่งต่อ ติดดาว ทำเครื่องหมายอ่านแล้วหรือยังไม่อ่าน ลบไป Trash ลบถาวรจาก Trash กู้คืน และดาวน์โหลดไฟล์แนบได้ อีเมลที่ส่งถูกเก็บใน Sent ซึ่ง IMAP client ก็เห็นเช่นกัน ใช้ได้แม้ปิดพอร์ตเมลขาเข้าทั้งหมด เฉพาะ Master root helper ทำเพียง list และย้ายไฟล์ Maildir ด้วย mailbox, folder และ reference ของข้อความ Portal เป็นผู้ถอดรหัส แสดง HTML ของผู้ส่งเฉพาะใน frame ที่ sandbox โดยปิดรูปจากภายนอกจนกว่าจะกดขอ และส่งไฟล์แนบเป็นการดาวน์โหลดเสมอ การส่งไปที่ Postfix ของ host เองทาง loopback การเขียนอีเมลยังไม่มีไฟล์แนบ draft และการค้นหา ไฟล์ใหม่ของ installer คือ `maildir-store.mjs` ดู how-to และ ADR 0033
- เพิ่มและลบโดเมนเมลในขั้นตอนเดียว โดเมนที่เพิ่มเข้า mail service ที่ทำงานอยู่ถูกเขียนลง host ทันที (helper operation ใหม่ `sync-mail-domains`: address map, ตาราง DKIM, reload) และการลบไม่ขึ้นกับสถานะ DNS อีกแล้ว เดิมโดเมนใหม่ยังไม่มีผลจนกว่าจะตรวจ DNS ครบสี่ record แล้วกด **Activate mail service** ซ้ำ ระหว่างนั้นสร้าง mailbox ไม่ได้ทุกโดเมน และโดเมนที่ยังไม่ verified ลบไม่ได้ ตอนนี้ MX, SPF, DKIM, DMARC เป็นสุขภาพของโดเมน ตรวจให้อัตโนมัติ (ตอนเพิ่ม ตอนเปิดหน้า และทุก 90 วินาทีระหว่างที่ยังไม่ผ่าน) แสดงเป็นราย record พร้อม host กับ value ที่ต้องกรอกและปุ่มคัดลอก การตั้งค่า service ยังต้องให้ mail hostname ชี้มาที่ host มี PTR ตรงกันสำหรับ direct และพอร์ตที่ยืนยันแล้ว โดเมนที่เพิ่มไว้ก่อนหน้าโดยยังไม่ได้ activate ซ้ำจะถึง host เมื่อเพิ่มหรือลบโดเมนครั้งถัดไป หรือกด **Apply configuration again**
- แสดงผล connectivity การ activate และการทดสอบใน mail setup เป็นรายการสั้นแทน JSON ดิบ ตัว setup ใช้สำหรับการตั้งค่าครั้งแรกเท่านั้น ส่วนโดเมน mailbox และ server จัดการที่หน้า **Mail**
- ตรวจใบรับรอง STARTTLS ด้วย mail hostname ที่ตั้งไว้เมื่อ Portal ส่งผ่าน Postfix บนเครื่องเดียวกัน
- ยังไม่ได้ตรวจบน host จริง: ยังไม่มีส่วนใดของการเปลี่ยนแปลงนี้รันกับ Postfix, Dovecot หรือ OpenDKIM เทสต์ครอบคลุมโมดูล Maildir กับไฟล์จริง (Windows และ Ubuntu บน WSL2) การถอดรหัสและประกอบข้อความ บทสนทนา SMTP กับ server จำลอง API ใน sandbox และ request ที่ Portal ส่งให้ helper ตัวบันทึก หน้าเว็บทดลองในเบราว์เซอร์กับ sandbox

## 1.1.2 — 2026-11-10

- แสดง persistent storage ในหน้าแอป เพิ่มแท็บ **Storage** แบบอ่านอย่างเดียว แสดง mount path โฟลเดอร์บนโฮสต์ สถานะว่า release ที่ใช้งานอยู่ใช้แล้วหรือยัง (*ใช้งานอยู่* หรือ *รอ deploy ถัดไป*) จำนวน byte ของไฟล์ปกติ จำนวนรายการ และพื้นที่ดิสก์ที่เหลือ พร้อมปุ่ม **วัดใหม่** Portal ถาม root helper (`project-storage-status`) ซึ่งอ่าน metadata ของ link เอง แต่การนับโฟลเดอร์ใช้ `find` และ `df` ที่รันด้วย Unix user ของ project เอง ไม่ตาม link และเลิกหลัง 20 วินาที ผลที่วัดไว้ใช้ร่วมกันได้ 5 วินาที ผู้ที่มีสิทธิ์ `project.view` เห็นได้ผ่าน `GET /api/projects/<slug>/storage` ไม่แสดงชื่อไฟล์ และไม่มีดาวน์โหลด อัปโหลด หรือลบไฟล์ ดู how-to และภาคผนวกของ ADR 0032

## 1.1.1 — 2026-11-09

- เพิ่ม persistent storage ของ project เดิมไฟล์ที่แอปเขียนไว้ข้างโค้ดหายตอน deploy หรือ rollback ครั้งถัดไป เพราะ release directory ถูกแทนและ release เก่าถูกลบ ตอนนี้ project native (Node.js, Bun, Go, Python, PHP และ worker) ตั้ง **Mount path** เช่น `uploads` ได้ Portal เก็บ `/srv/hostmgr/projects/<slug>/shared/storage` นอก `releases/` แล้ว link เข้าทุก release ที่ path นั้นทั้งตอน deploy และ rollback แอปจึงใช้ `./uploads` เดิมได้ link สร้างโดย Unix user ของ project เอง ไม่ใช่ root ถ้ามีไฟล์ชื่อเดียวกัน deployment จะหยุดแทนที่จะลบไฟล์ Docker Compose ยังใช้ named volume มีผลใน deployment ถัดไป ต้องมีสิทธิ์ `project.configure` และการลบแอปลบ storage ด้วย ติดตั้งไฟล์ใหม่ `project-storage.mjs` ผ่าน installer ดู how-to และ ADR 0032

- นับความพยายาม login, รับคำเชิญ และ login ของ CLI แยกตามผู้เยี่ยมชม เดิมหลัง Nginx ทุกคำขอมาจาก `127.0.0.1` ใส่รหัสผ่านผิด 5 ครั้งจากใครก็ตามจึงล็อกเจ้าของ 15 นาที ตอนนี้ Portal อ่าน `X-Real-IP` แต่เชื่อเฉพาะการเชื่อมต่อ loopback ที่ส่งความลับ (`HOSTMGR_PROXY_TOKEN`) ซึ่ง Nginx ประทับจาก snippet ที่อ่านได้เฉพาะ root เพื่อให้ process บนโฮสต์ เช่นโปรเจกต์ที่ deploy ไว้ ปลอม IP หลบขีดจำกัดไม่ได้
- ให้ Nginx รายงาน IP ผู้เยี่ยมชมหลัง Cloudflare Proxy (`/etc/nginx/conf.d/strckro-realip.conf` เชื่อ `CF-Connecting-IP` เฉพาะจากช่วง IP ที่ Cloudflare เผยแพร่) โปรเจกต์ได้ IP ผู้เยี่ยมชมใน `X-Real-IP` ติดตั้งโดย `strckro.sh` ทุกครั้งที่ติดตั้งและอัปเดต และตัดทิ้งพร้อมคำเตือนเมื่อ Nginx เองรายงานว่าซ้ำกับ `real_ip_header` หรือ `real_ip_recursive` ที่โฮสต์ตั้งไว้ระดับ http แล้ว (ให้ Nginx เป็นผู้ตัดสิน บล็อก `server` ของไซต์อื่นจึงไม่ถูกเข้าใจผิดว่าชน) config ผ่าน `nginx -t` และทดลองใช้บน Ubuntu 24.04 กับ Nginx 1.24 แล้ว แต่ยังไม่เคยลอง `sudo strckro update` ครบขั้นตอนบนโฮสต์จริง
- ขยับ Node.js runtime ที่ pin ไปเป็น security release เดือนตุลาคม 2026: 22.23.4, 24.22.2 และ 26.13.0 (เดิม 22.23.3, 24.18.0 และ 26.10.0) โดย checksum มาจาก `SHASUMS256.txt` ที่เซ็นด้วย GPG ของแต่ละ release แก้ช่องโหว่ระดับ High เช่น Brotli out-of-bounds write ใน `node:zlib` (CVE-2026-111497) ส่วน Node.js 20 ไม่มี build ที่แก้เพราะสิ้นสุดการสนับสนุนแล้ว installer จึงเตือนเมื่อ Portal ใช้ Node 20
- คง Node.js major อื่นให้ทันสมัยเมื่ออัปเดต: service ของ project อ้าง `/opt/node-v<version>` ดังนั้น major ที่มีอยู่ใต้ `/opt` แล้วทุกตัวจะถูกย้ายไปรุ่นที่ pin ด้วย หากล้มเหลวจะเป็นคำเตือนที่คง runtime เดิม ไม่ทำให้การอัปเดต Portal ล้ม
- ทำให้ปลายทางที่ไม่ต้อง login เบา เดิมทุกคำขอคัดลอก state ทั้งก้อนของ Portal ก่อนรู้ว่าผู้เรียกคือใคร และผู้เรียกนิรนามสั่งให้ทำได้หลายพันครั้งต่อวินาที (`/api/*` ที่ไม่มี credential, bearer token มั่ว, webhook ของโปรเจกต์ที่ไม่มีจริง, การ poll CLI login) ตอนนี้คำขอที่ไม่มี credential ที่ Portal รู้จักได้คำตอบโดยไม่คัดลอกหรือเขียน state การ poll CLI login จำกัดต่อผู้เยี่ยมชม และ Nginx ให้แต่ละ address มีงบคำขอ (40/วินาที burst 200 ใน `/etc/nginx/conf.d/strckro-limits.conf`)
- จำกัดการเดาให้แน่นขึ้น การลอง login นับต่อบัญชีด้วย (10 ครั้งใน 15 นาที รวมทุกผู้เยี่ยมชม ไม่ว่าอีเมลนั้นจะมีบัญชีหรือไม่) การเดาที่กระจายหลาย address จึงยังถูกจำกัด ผู้เยี่ยมชม IPv6 นับทั้ง /64 ทั้งใน Portal และ Nginx การลองถูกนับตั้งแต่เริ่มแล้วคืนให้เมื่อสำเร็จ คำขอเดาที่มาพร้อมกันจึงลอดผ่านทั้งหมดไม่ได้ และการ login สำเร็จไม่ล้างความล้มเหลวก่อนหน้าของผู้เยี่ยมชม อีเมลที่ผิดต้องจ่ายค่า hash รหัสผ่านหนึ่งครั้ง ตรวจบน thread pool ทีละสอง เวลาตอบจึงไม่บอกว่าบัญชีไหนมีอยู่ และการเดาท่วมทำให้ Portal ค้างไม่ได้ การ login ที่ล้มเหลวเขียน audit ได้ไม่เกินหนึ่งรายการต่อวินาที และการเดารหัสผ่านของ installer ตอน bootstrap ครั้งแรกจำกัดต่อผู้เยี่ยมชมและรวมทั้งหมด ผู้เยี่ยมชมที่เคย login บัญชีหนึ่งสำเร็จนับแต่ Portal เริ่ม จะไม่ถูกขีดจำกัดของบัญชีนั้นปฏิเสธ คนแปลกหน้าจึงล็อกเจ้าของออกจาก address ประจำไม่ได้ และการ restart Portal ล้างตัวนับทั้งหมด ทุก address ใน 127.0.0.0/8 ถือเป็นผู้เยี่ยมชมในเครื่องคนเดียว และคิวตรวจรหัสผ่านที่ถูกท่วมยังกันที่ไว้ให้ผู้เยี่ยมชมที่เป็นที่รู้จัก ความล้มเหลวเขียนลง audit log ได้ไม่เกินวินาทีละครั้ง และรายการที่ถูกเก็บไว้จะถูกเขียนรวมกันเมื่อครบวินาที สิ่งที่ควรรู้: การ login สำเร็จไม่ล้างความล้มเหลวก่อนหน้าของผู้เยี่ยมชมอีกต่อไป ความล้มเหลวรวม 5 ครั้งจาก address ที่ใช้ร่วมกันจึงล็อก address นั้นตลอด 15 นาที
- ปฏิเสธ webhook แจ้งเตือนที่ชี้ไป address ภายใน เดิมสมาชิกที่จัดการ webhook ได้สั่งให้ Portal ยิงไป `127.0.0.1` เครื่องใน LAN หรือ address cloud metadata แล้วอ่าน HTTP status กลับได้ ตอนนี้ปลายทางต้องเป็น address สาธารณะ ตรวจตอนบันทึกและตอนส่งทุกครั้ง โดยเชื่อมต่อเฉพาะ address ที่เพิ่งตรวจ ไม่ตาม redirect และไม่เก็บ response body `HOSTMGR_WEBHOOK_ALLOW_PRIVATE=true` เป็นสิทธิ์ที่เจ้าของเครื่องเลือกเปิดสำหรับเครือข่ายภายใน
- จำกัดวงโปรเจกต์ที่ deploy unit systemd ของโปรเจกต์ตั้ง `MemoryMax=85%`, `TasksMax=4096` และปิดช่องทางเคอร์เนล (`ProtectKernelTunables/Modules/Logs`, `ProtectControlGroups`, `LockPersonality`, `RestrictSUIDSGID`, `RestrictAddressFamilies`) โปรเจกต์ที่มีอยู่จะได้เมื่อ deploy ครั้งถัดไป
- ลบ Node.js runtime ที่ถูกแทนที่เมื่ออัปเดต เฉพาะ `/opt/node-v<version>` รุ่นเก่าของ major ที่ติดตั้งรุ่น pin แล้วและรันได้ ซึ่งเหมือนที่ archive ของ Node.js แตกออกมาทุกประการ (ไม่มีใครใส่อะไรลงไป: ไม่มี global package, `etc/npmrc`, แอปพลิเคชัน หรือ dotfile) ไม่มี unit (รวมที่ link ไว้) หรือ config ของโปรเจกต์อ้างถึงและไม่มี process ที่ executable หรือ working directory อยู่ที่นั่น หากอ่าน `/proc` ไม่ได้จะไม่ลบอะไรเลย service ของโปรเจกต์บน Node 24 ตาม runtime ของ Portal เมื่อ restart ครั้งถัดไป ส่วน major อื่นใช้ path เดิมจนกว่าจะ deploy ใหม่
- ไม่เตรียม release ที่ไฟล์ไม่ครบ `release:prepare` archive จาก `HEAD` ที่ commit แล้ว ไฟล์ runtime ที่ไม่เคย commit จึงเคยถูกข้ามเงียบๆ และ Portal ที่ import ไฟล์นั้นเริ่มไม่ขึ้น ตอนนี้จะหยุดเมื่อมีไฟล์ runtime ที่ยังไม่ track (`--allow-untracked=yes` เพื่อข้าม) และเตือนเมื่อมีการแก้ที่ยังไม่ commit
- ส่งการแจ้งเตือน deployment ไป Discord เป็น embed จาก "Strckro" พร้อมโลโก้ โดยระบุโปรเจกต์ runtime branch commit release ระยะเวลา และโดเมนใน embed ผู้ให้บริการอื่นไม่เปลี่ยน

## 1.1.0 — 2026-11-07

- เปลี่ยน frontend เป็น Signal พร้อม host strip และ rail ร่วมกัน รายการแอปที่ปรับตามหน้าจอ แถบ source → build → serving เกจสุขภาพ ไทม์ไลน์ release และธีมสว่าง/มืดตามระบบ
- โหลด workspace และ API เมื่อใช้ นำทางในหน้าเดียว พัก polling เมื่อซ่อนแท็บ ป้องกันการทิ้งฟอร์มและ ENV ที่ยังไม่บันทึก เพิ่มค้นหาผ่านคีย์บอร์ดและพรีวิวผ่าน loopback ที่ใช้ข้อมูลชั่วคราว
- คืนสถานะ DNS, Cloudflare proxy และ TLS ของ origin รายโดเมน แยก Refresh/Verify ลองลบใหม่เมื่อถูกปฏิเสธ แสดง progress โดยเปิด log เมื่อกด และยืนยัน Restart/Rollback พร้อม release/commit
- เพิ่มเมนู runtime/framework พร้อมโลโก้และตรวจจาก repository เลือก Auto/npm/pnpm ได้โดยเก็บค่าใน deployment และ rollback และปฏิเสธค่าที่ขัดกับ packageManager
- ใช้ชื่อ Strckro ใน installer คำสั่งโฮสต์และ archive ครบถ้วน โฮสต์ที่ใช้ updater ชื่อ dashboard-portal เดิมต้องรัน strckro.sh หนึ่งครั้ง โดยคง paths, services และ signing trust เดิม ดูคู่มือย้ายรุ่น
- แทน tests ที่อิง markup เดิมด้วย model tests และ browser workflows จริง ผลทดสอบในเครื่องไม่ยืนยัน Ubuntu/systemd/Nginx/TLS การติดตั้งใหม่หรือ reboot และการเผยแพร่ไม่อัปเดตโฮสต์ที่ติดตั้งอยู่

## 1.0.4 — 2026-11-06

- เปลี่ยนแบรนด์เป็น Strckro พร้อมโลโก้ SVG ใหม่ หน้า login/Overview และหน้า Deployments ที่กรองโปรเจค/สถานะและอัปเดต metadata จากระบบจริง
- เพิ่ม CLI token ที่จำกัด scope/โปรเจค/อายุได้, browser/device login ที่ต้องอนุมัติ, หน้าออก/ถอน token และ bearer API ที่ตรวจสิทธิ์องค์กรซ้ำก่อน commit
- เพิ่ม atomic ENV patches พร้อม revision และ deployment feed ที่ไม่คืน logs/secrets พร้อม npm CLI ชื่อ `strckro` ใช้ `skctl` หรือ `strckro` โดยรองรับ config/credential เดิม
- รักษาชื่อ service, paths, host commands และ signed update trust เดิม การเผยแพร่ release ไม่อัปเดตโฮสต์ที่ติดตั้งอยู่ และ local fixtures ไม่แทน acceptance Linux/systemd/Nginx/TLS จริง

## 1.0.3 — 2026-10-20

- เพิ่ม Restart app สำหรับ process ของ active release หลัง Sync หรือ Deploy ล้มเหลว โดยตรวจความเสถียรของ process และ HTTP health ตามการตั้งค่า แสดงผลระหว่างทำและเมื่อจบ พร้อมกันงานจัดการโปรเจคซ้อนกัน
- ย้าย ENV และแผน Deploy เป็นหน้าต่างกว้าง ค้นหาตัวแปรได้ สลับ Environment / Build / Review โดยตรง และเตือนก่อนทิ้งค่าที่ยังไม่บันทึก ENV ใหม่มีผลผ่าน Deploy รวมถึงขั้น build ส่วน Restart ใช้ ENV ที่ deploy อยู่เดิม
- แสดง Deploy, Sync latest, ENV, Restart app และ Logs บนการ์ดโปรเจคโดยตรง Restart รองรับแอป native ที่รันด้วย systemd ส่วน Docker Compose ใช้ flow Deploy ตามเดิม

- กด Sync latest เพื่อ retry commit ที่ sync มาแล้วแต่ deploy ล้ม หรือกลับไป commit ล่าสุดหลัง rollback ได้เมื่อ Auto deploy อนุญาต แยกจากการบันทึก config, polling, การปิด Auto deploy และ Actions mode
- หลัง rollback สำเร็จการ์ดแสดงผลใหม่ พร้อม release ID และแจ้งเมื่อปลายทางใช้ commit เดียวกัน ยังดู log ที่ล้มเหลวเดิมได้ โดยไม่แจ้งเหมือนเพิ่งเกิด failure ใหม่หรือแสดงว่างานที่จบแล้วกำลังรัน

## 1.0.2 — 2026-10-20

- รอผลตรวจ HTTP/TLS สูงสุด 30 วินาทีหลัง graceful reload ของ Nginx เมื่อ managed config ถูกต้อง แก้โดเมนใหม่ถูก rollback ทันทีเพราะ worker เดิมยังปฏิเสธ TLS ส่วน config ที่ผิดจริงยังหยุดทันที
- เปิด HTTP connection ใหม่ทุกครั้งที่ตรวจ readiness และแยก error ของ certificate, HTTP routing และ upstream
- เพิ่ม regression tests สำหรับ worker ที่พร้อมช้า, เวลารอสูงสุด, config ผิด และการใช้ connection ซ้ำ ก่อน publish ทดสอบแพตช์บน Ubuntu host จริงแล้ว: Verify API สำเร็จ, Nginx/TLS ผ่านทั้ง 8 ข้อ และ HTTPS ตอบ 200 การติดตั้งใหม่และ reboot ยังเป็นการทดสอบแยกต่างหาก

## 1.0.1 — 2026-10-20

- เปลี่ยนหรือลบโดเมนแล้วอัปเดตชุดโดเมนใน certificate เดิมให้ตรง ใช้ public DNS สำรองแบบจำกัดเวลาเมื่อ resolver บน host ยังตอบไม่พบโดเมน โดยยังต้องผ่าน HTTP-01 จริง
- Add โดเมนก่อนตั้ง DNS ดู record A/AAAA ที่ต้องตั้ง แล้วกด Verify เพื่อเปิด Nginx/TLS โดเมนที่ยังรอไม่กระทบโดเมนเดิมหรือการ deploy แอปรอบถัดไป ส่วน Refresh ตรวจสถานะโดยไม่แก้ config
- แสดง Cloudflare Proxy จาก DNS สาธารณะทั้ง IPv4/IPv6 โดยไม่บังคับปิด และตรวจ certificate ของ origin จริงด้วย SNI, hostname และ trust validation แยกจาก IP origin ที่ Proxy ซ่อนไว้และ certificate ของ CDN ฝั่งผู้เข้าชม
- แยกผลบันทึกกับผลเปิดใช้งาน Nginx/TLS เก็บ error และมี retry แก้กรณี helper ปฏิเสธการลบโดเมนสุดท้ายแต่รายงานว่า sync สำเร็จ ป้องกันกดซ้ำและ response เก่าเขียนทับเมื่อปิดหรือเปลี่ยนโปรเจค
- ทดสอบ failure/retry ด้วย local fixtures; การออก certificate และกู้คืน production จริงต้องตรวจหลังติดตั้งแพตช์

## 1.0.0 — 2026-10-15

- Stable release สำหรับ Ubuntu amd64 host เดียวและ trusted repositories การ publish ไม่อัปเดตเครื่องที่ติดตั้งอยู่
- Web/API deploy โดยไม่ผูกโดเมนได้ เพิ่ม Worker แบบ Node.js, Bun, Go และ Python script ที่รันต่อเนื่อง ไม่มีพอร์ต/HTTP health check ที่ Portal กำหนด และ ENV ว่างได้ Build ไม่เริ่ม candidate consumer; หยุดบริการเดิมก่อนสลับ ตรวจ process และพยายามกู้คืนเมื่อ activation ล้ม
- Installer/update/helper/CLI ใช้ maintenance leases ร่วมกัน เก็บ state snapshot ให้ consistent และกู้คืนเมื่อเปลี่ยน installation ไม่สำเร็จ Monitor usage writes ตรวจ maintenance exclusion ด้วย
- เมนูแยกหมวดงาน และ Settings แยกบัญชี/อัปเดต/Monitor integration พร้อมปรับ keyboard/focus ของมือถือ
- รักษา pnpm/Prisma fixes ของ v0.8.6–0.8.9, การคง Node major และ Monitor field allowlist โปรเจคเดิมเป็น Web; มี release แล้วเปลี่ยนประเภทหรือ runtime ของ Worker ไม่ได้
- Mail operational และ remote `dpctl` เลื่อน ยังไม่รองรับ Worker แบบ PHP/Compose/ASGI/WSGI และ one-shot; process stability ไม่ยืนยันว่างาน queue สำเร็จหรือ exactly-once
- ใช้ผล local/Docker และ fixtures; clean-host install, helper/systemd/Nginx/TLS จริง, reboot และ whole-host restore ยังไม่ยืนยัน ดู [acceptance record](knowledge/plans/v1-acceptance-record.md) ไม่รับรอง hostile-tenant isolation

## 0.8.9 — 2026-10-10

- อ่านตำแหน่ง Prisma CLI จาก bin ของแพ็กเกจที่ติดตั้งจริง รองรับ `dist/prisma.js` ของ Prisma 8
- ใช้ `contract emit` สำหรับ Prisma 8 ก่อน build คง `generate` สำหรับ Prisma 2–7 และข้ามแอปที่ไม่ใช้ Prisma
- แยก error กรณีแพ็กเกจหาย, CLI entry ผิด และ contract ล้มเหลว พร้อม diagnostics ที่ปกปิด secrets ไม่มี database operations อัตโนมัติ

## 0.8.8 — 2026-10-09

- จำกัด response ของ Monitor token ให้ส่งเฉพาะฟิลด์ job, health และ event ที่กำหนดไว้ ไม่ส่ง build/startup `failureLog` หรือ metadata ภายในของ job ส่วนผู้มีสิทธิ์อ่าน log ใน Portal ยังเห็น diagnostics ตามเดิม
- เพิ่มเอกสาร Monitor API สำหรับ AI และแผน `dashboard-portal-client` แบบแยกรุ่น ตัว client และ API สำหรับเขียน ENV ยังไม่อยู่ใน release นี้

## 0.8.7 — 2026-10-06

- ตรวจหา Prisma ในโปรเจกต์ Node/Bun และ generate client ก่อน build โดยใช้ environment ของโปรเจกต์ ไม่ต้องเพิ่ม build script และไม่รัน migration, seed หรือดาวน์โหลด CLI อัตโนมัติ
- รองรับ pnpm 12 และค้นหา pnpm ที่ติดตั้งข้าง Node runtime รวมถึงตำแหน่ง global การติดตั้งผ่าน Setup ยังเป็นทางเลือก
- แสดงคำสั่ง npm/pnpm และ lockfile ตามที่ตรวจพบในหน้าตรวจการตั้งค่า deploy

## 0.8.6 — 2026-10-06

- เพิ่ม pnpm แบบทางเลือกในหน้า Setup การติดตั้งและอัปเดต Portal ไม่ติดตั้ง pnpm อัตโนมัติ
- โปรเจกต์ Node เลือก npm/pnpm จาก packageManager และ lockfile หากยังไม่มี pnpm หรือเวอร์ชันไม่ตรงจะแจ้งให้ติดตั้งก่อน โดยไม่ดาวน์โหลดหรือสลับรุ่นเอง
- ใช้ pnpm ในขั้นตอน install, build, health check, service และ rollback ตาม Node runtime ของโปรเจกต์ ตรวจ frozen lockfile และรักษา relative symlink เมื่อ activate
- แสดง error ต้นทางจากการติดตั้ง dependencies ใน deploy log พร้อมปกปิด secrets
- ดู [โปรเจกต์ pnpm](how-to/pnpm-projects.md) สำหรับวิธีติดตั้งและข้อกำหนด

## 0.8.5 — 2026-09-30

เพิ่ม CLI `-h`/`--help` แสดงคำสั่งและ options ทั้งหมด และ `-v`/`--versions`/`--version` แสดง Portal/runtime versions โดยไม่ต้อง sudo ดู help ของแต่ละคำสั่งได้ก่อน mutation

Updater คง Node major จาก config หรือ runtime ปัจจุบันของเครื่องเก่า Installer เตรียมเฉพาะ major ที่เลือกและชี้ global node/npm/npx ให้ตรงกัน Node 26 ที่ไม่ได้ใช้ไม่บล็อก update ของ Node 20/22/24 อีก เมื่อเลือก 26 จึงติดตั้ง libatomic1 รองรับ updater เก่าที่ไม่ส่ง major โดยตรวจ config/service เดิม Fresh install ยัง default 24 และไม่ลบ runtime ของ project ที่มีอยู่

## 0.8.4 — 2026-09-30

- Sync, Deploy, wizard และ Rollback แสดง progress บนการ์ด Projects โดยไม่เปิด popup log อัตโนมัติ
- อัปเดตทุก 1.5 วินาทีระหว่าง deploy และทุก 5 วินาทีเมื่อว่าง รวมงาน Auto deploy; พัก request เมื่อซ่อนแท็บ
- แสดงเตรียม source, dependencies, build, health check, activation และผลสุดท้าย เปิด log เองผ่านปุ่มดูรายละเอียด
- รักษาเมนู/details ที่เปิดและโฟกัสคีย์บอร์ดระหว่างอัปเดต API summary จำกัดตามสิทธิ์ project และไม่ส่งข้อความ log หรือรายละเอียด failure ส่วนตัว

Tests ครอบคลุม polling, หลายโปรเจกต์, สถานะจบงาน, network failure, focus และสิทธิ์ API ยังไม่ได้ตรวจ interactive browser หรือ production host การเผยแพร่ release ไม่ได้อัปเดต host ที่ติดตั้งไว้

## 0.8.3 — 2026-09-30

เพิ่ม Portal Node 20.20.2+/22.13+/24.x/26.x และ per-project major แยกจาก Portal ใช้ใน build/health/activation/rollback Installer ลง checksum-verified runtimes พร้อมเลือก Node และ updater คง major เดิม SQLite adapter ใช้ better-sqlite3 บน 20 และ node:sqlite บนรุ่นใหม่ร่วม file/schema เดิม เพิ่ม MIT license และคู่มือติดตั้ง/backup/nvm

แก้ Docker image ให้มี scripts/views และ Node 20 staging dependencies/permissions ก่อน replace Default Portal/app เดิมยัง 24 Node 20 สำหรับ compatibility Backup state พร้อม encryption key ไม่ต้อง convertDB Native app dependencies อาจต้อง rebuild หลังเปลี่ยน major Local tests ไม่แทน Ubuntu/systemd/Nginx/TLS/reboot acceptance

รุ่นก่อนหน้า: [GitHub Releases](https://github.com/raptercode/Strckro/releases)
