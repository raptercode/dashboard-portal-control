# ADR 0033: โดเมนเมลมีผลทันที และ Portal อ่านกล่องเมลผ่าน helper

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0033-mail-domains-apply-at-once-and-the-portal-reads-mailboxes.md)


- Status: Accepted
- Date: 2026-11-11
- Amends: [ADR 0025](0025-port-aware-mail-host-provisioning.md) (กฎเรื่องพอร์ตและ TLS ในฉบับนั้นไม่เปลี่ยน)

## บริบท

หลังตั้งค่า mail service ครั้งแรกแล้ว มีสองเรื่องที่ทำให้ใช้งานยาก

**โดเมน** helper ตรวจ mail state ทั้งก้อนใหม่ทุกครั้ง และบังคับให้ MX, SPF, DKIM, DMARC ของ*ทุก*โดเมนเป็น `verified` การเพิ่มโดเมนเข้า service ที่ทำงานอยู่จึง

- ยังไม่มีผลบน host จนกว่าจะตรวจ DNS ครบสี่ record แล้วกด **Activate mail service** ซ้ำ ซึ่งเขียน config ใหม่ทุกไฟล์ ขอ Certbot อีกรอบ และ restart Postfix, Dovecot, OpenDKIM
- ทำให้สร้าง mailbox ไม่ได้ทุกโดเมน รวมโดเมนที่ใช้งานได้อยู่แล้ว จนกว่า DNS ของโดเมนใหม่จะผ่าน
- ลบออกไม่ได้ เพราะการลบโดเมนที่ยังไม่ verified ก็ผ่านการตรวจชุดเดียวกันและถูกปฏิเสธ

record ทั้งสี่ไม่ได้กำหนดว่า host ตั้งค่าได้หรือไม่ แต่กำหนดว่า server อื่นจะส่งเมลมาให้และเชื่อเมลที่ส่งออกไปหรือไม่ สิ่งที่จำเป็นต่อการตั้งค่าจริงมีเพียง mail hostname (การขอ certificate ต้องมาถึง host นี้) และ PTR สำหรับการส่งแบบ direct

**การอ่านเมล** Portal สร้าง mailbox ได้แต่เปิดดูไม่ได้ ต้องใช้โปรแกรมอีเมลแยกและเปิดพอร์ต IMAP เจ้าของระบบขอให้ดูเมลที่รับและที่ส่งได้ใน Portal

บันทึกการออกแบบ mail เคยแนะนำตรงกันข้าม คือ webmail ในอนาคตควรเป็นผลิตภัณฑ์แยกที่มี Maildir permission, session isolation และ audit scope ของตัวเอง การตัดสินใจนี้ให้ตัวอ่านอยู่ใน Portal เพราะเจ้าของระบบต้องการที่เดียว และตอบทั้งสามข้อไว้ชัดเจนด้านล่างแทนการปล่อยให้เข้าใจเอง

## การตัดสินใจ

### 1. DNS ของโดเมนคือ "สุขภาพ" ไม่ใช่เงื่อนไข

- `validateMailState` ใน helper ตรวจเฉพาะโครงสร้าง (ชื่อ, DKIM key, รูปแบบ relay) เงื่อนไขเรื่อง hostname และ PTR ย้ายไป `assertMailActivationReady` ซึ่งมีแต่ `configure-mail` ที่เรียก ฝั่ง Portal `assertHostMailReadiness` ก็ตัดเงื่อนไข DNS รายโดเมนออก
- เพิ่ม helper operation `sync-mail-domains` เขียน domain map และ mailbox map ของ Postfix กับ key และตารางของ OpenDKIM จาก state ที่เก็บไว้ แล้ว reload Postfix กับ OpenDKIM ไม่ขอ certificate และไม่ restart อะไร
- `POST /api/mail/domains` บันทึกโดเมน และถ้า service ตั้งค่าบน host จริงแล้ว จะเรียก `sync-mail-domains` ใน request เดียวกัน ถ้า helper ปฏิเสธ โดเมนจะถูกถอนออกจาก state และ request ล้มเหลว Portal จึงไม่แสดงโดเมนที่ host ไม่มี ส่วนการลบมี operation ของตัวเองอยู่แล้ว (`remove-mail-domain`) และตอนนี้ทำได้ไม่ว่า DNS จะอยู่สถานะใด
- `create-mailbox` ไม่อ่าน port plan ซ้ำแล้ว ต้องการเพียง installation ที่ Portal ดูแลและโดเมนที่รู้จัก
- หน้าเว็บตรวจ DNS ให้เอง: ตอนเพิ่มโดเมน ตอนเปิดหน้า Domains และทุก 90 วินาทีสำหรับ record ที่ยังไม่ผ่าน การตรวจที่ส่ง `background: true` เขียน audit เฉพาะเมื่อสถานะของ record เปลี่ยน ผลแสดงเป็นราย record พร้อม host และ value ที่ต้องกรอกที่ผู้ให้บริการ DNS
- comment ใน `main.cf` เปลี่ยนเป็นชี้ไปที่ domain map แทนการแจกแจงโดเมน เพราะไฟล์นั้นไม่ถูกเขียนใหม่เมื่อรายการโดเมนเปลี่ยนแล้ว

สิ่งที่ยังเป็นเงื่อนไขครั้งเดียวตอนตั้งค่า: package ที่ติดตั้งผ่าน Portal, mail hostname ชี้มาที่ host นี้, PTR ตรงกันสำหรับ direct, พอร์ตขาออกของโหมดที่เลือกยืนยันว่าเปิด และ policy พอร์ตขาเข้าตาม ADR 0025

### 2. Portal อ่านและเขียน Maildir ผ่าน helper operation แบบ typed

เมลอยู่ที่ `/var/vmail/<domain>/<local part>/Maildir` เป็นของ account `vmail` process ของ Portal อ่านไม่ได้และไม่ได้รับสิทธิ์เพิ่ม helper operation เจ็ดตัว (`mail-folders`, `mail-list`, `mail-read`, `mail-flag`, `mail-move`, `mail-delete`, `mail-store`) ผ่านประตูเดียวคือ `mailboxOperation`: ตรวจ domain กับ local part, address ต้องอยู่ใน user file ของ Portal เอง และโฟลเดอร์สามชั้นตามทางต้องเป็นโฟลเดอร์จริง

- **ไม่มี path ข้าม socket** request ระบุ folder (`INBOX` หรือชื่อแบบ Maildir++ ที่ตรง `[A-Za-z0-9&][A-Za-z0-9 _.&+,-]*` และไม่มี `..`) กับ reference ของข้อความ (ชื่อไฟล์ฐานใน Maildir) `scripts/maildir-store.mjs` ประกอบทุก path เอง ตรวจโฟลเดอร์ด้วย `lstat` และเปิดไฟล์ด้วย `O_NOFOLLOW` จึงไม่ตาม link ที่ถูกวางไว้ในกล่องเมล
- **helper ขนไบต์ Portal เป็นผู้ถอดรหัส** root ไม่ parse MIME, charset หรือ HTML การ list ส่ง header เก้าช่องกับ 2 KiB แรกของเนื้อหาต่อข้อความ (ไม่เกิน 50 ข้อความ) การอ่านข้อความส่งเป็นก้อน 256 KiB เพื่อให้แต่ละ response อยู่ในขีด 512 KiB ของ socket เดิม ข้อความเกิน 30 MiB ถูกปฏิเสธ `src/mail-message.mjs` ถอดรหัสใน process ที่ไม่มีสิทธิ์ โดยจำกัดความลึก (8) จำนวน part (200) และขนาดผลลัพธ์
- **สำเนา Sent ใช้ spool file ไม่ขยายขนาด request** ขีด 16 KiB ของ request คงเดิม Portal เขียนข้อความลง `mail-outbox/<uuid>.eml` ใน data directory ของตัวเองแล้วส่งเฉพาะ UUID helper เปิดด้วย `O_NOFOLLOW` และรับเฉพาะไฟล์ปกติที่มีชื่อเดียว เป็นของ account Portal และไม่เกินขนาด จากนั้นเขียนเข้า Maildir ด้วย `O_EXCL` และโอนให้ `vmail` ด้วย `lchown` Portal เป็นผู้ลบ spool file
- **การส่งไปที่ Postfix ของ host เอง** ทาง `127.0.0.1:25` ซึ่งอยู่ใน `mynetworks` อยู่แล้ว Postfix เซ็น DKIM เข้าคิว แล้วส่งตรงหรือ relay เหมือนโปรแกรมอีเมล ผู้รับ Bcc ส่งให้ SMTP เท่านั้น ไม่เขียนลงในข้อความ ผู้รับที่ถูกปฏิเสธหนึ่งรายทำให้หยุดก่อนส่งข้อมูล
- **flag และ folder ตาม Maildir++** Dovecot และ IMAP client จึงเห็นสถานะเดียวกัน: ข้อความที่อ่านแล้วย้ายจาก `new/` ไป `cur/` พร้อม `S`, Sent คือ `.Sent/`, การลบย้ายไป `.Trash/` และลบถาวรเฉพาะข้อความที่อยู่ใน Trash แล้ว

### 3. ไม่เชื่อ markup ของผู้ส่ง

- API ส่งส่วน HTML เป็นข้อมูล หน้าเว็บแสดงเฉพาะใน `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox">` ที่ใส่ผ่าน `srcdoc` ไม่มี `allow-scripts` และไม่มี `allow-same-origin` เอกสารเริ่มด้วย `Content-Security-Policy` `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:` และ `<base target="_blank">` ก่อนเนื้อหาของผู้ส่ง tag ที่ตามมาจึงขยาย policy ไม่ได้ รูปจากภายนอกโหลดเมื่อผู้อ่านกดขอเท่านั้น ซึ่งเปลี่ยน `img-src` เป็น `data: https:`
- รูปที่แนบมาในข้อความ (`cid:`) ถูกฝังเป็น `data:` URI เมื่อเป็น PNG, JPEG, GIF, WebP หรือ BMP ขนาดเล็ก ไม่ฝัง SVG
- ไฟล์แนบตอบเป็น `application/octet-stream` พร้อม `Content-Disposition: attachment`, `nosniff` และ policy `sandbox` เสมอ ไม่ว่าผู้ส่งจะประกาศชนิดใด
- เลือก `srcdoc` แทนการ frame response จาก API เพราะ Nginx ที่ติดตั้งส่ง `X-Frame-Options: DENY` ให้ Portal

### 4. สิทธิ์

ทุก route ใต้ `/api/mail/...` รวมของใหม่ ใช้ได้เฉพาะ Master (ค่า default ของ `authorizeRequest`) และทุกการเปลี่ยนแปลงต้องมี CSRF token การเปิดข้อความไม่เปลี่ยนอะไรเอง หน้าเว็บทำเครื่องหมายว่าอ่านแล้วด้วย `POST .../flags`

- **Maildir permission:** process ของ Portal ไม่ได้สิทธิ์ใดเลย มีแต่ helper ที่แตะ `/var/vmail` ผ่าน operation ข้างต้น
- **Session isolation:** ไม่มี ตัวอ่านเป็นส่วนหนึ่งของ session Master ใน Portal ใช้ cookie เดียวกันและอายุเจ็ดวันเท่ากัน ไม่มีการ sign-in แยกราย mailbox
- **Audit scope:** การส่งเขียน audit เฉพาะ address ผู้ส่งและจำนวนผู้รับ ไม่มีเนื้อหา ส่วนการอ่าน ติดธง ย้าย และลบไม่ถูก audit

## ผลที่ตามมา

- เพิ่มหรือลบโดเมนเมลเป็นการกระทำเดียว ไม่ต้องรอ DNS และไม่ต้อง activate ซ้ำ โดเมนที่ DNS ยังไม่ครบใช้งานบน host ได้ แต่เมลอาจถูกปฏิเสธหรือตกสแปมที่ปลายทาง หน้าเว็บแจ้งและตรวจต่อให้เอง
- Master อ่านทุกกล่องเมลของ host ได้จาก Portal ซึ่งสอดคล้องกับการเป็นเจ้าของ host แต่เป็นความสามารถใหม่ของ session Portal และของ helper socket: ผู้ที่คุมบัญชี Portal อ่านเมลได้
- อ่านเมลที่รับและที่ส่งได้แม้ปิดพอร์ตเมลขาเข้าทั้งหมด เพราะตัวอ่านไม่ใช้ IMAP
- การอัปเดตมาเวอร์ชันนี้ครั้งแรกต้องผ่าน installer ตามปกติ (`sudo strckro update`) เพราะ root helper และโมดูลใหม่ของ helper (`maildir-store.mjs`) เปลี่ยน
- โดเมนที่เพิ่มไว้ก่อนเวอร์ชันนี้โดยยังไม่ได้ activate ซ้ำ จะถูกเขียนลง host เมื่อเพิ่มหรือลบโดเมนครั้งถัดไป หรือเมื่อกด **Apply configuration again**
- ยังไม่ได้ทำ: ไฟล์แนบในเมลที่เขียน, บันทึก draft จาก Portal, ค้นหา, เปลี่ยนรหัสผ่าน mailbox และการรวมเป็น conversation

## การตรวจสอบ

มีเทสต์บนเครื่องพัฒนา: โมดูล Maildir กับไฟล์จริง (รวมการจัดการ link บน Linux), การถอดรหัสและประกอบ MIME, บทสนทนา SMTP กับ server จำลอง, HTTP API ใน sandbox และ request ที่ Portal ส่งให้ helper ตัวบันทึกในโหมด host หน้าเว็บทดลองในเบราว์เซอร์กับ sandbox ที่ความกว้าง 1440, 390 และ 320 พิกเซล

ยังไม่ได้ตรวจ: host จริง ยังไม่มีส่วนใดรันกับ Postfix, Dovecot หรือ OpenDKIM ดังนั้นการ reload หลัง `sync-mail-domains`, การที่ Dovecot เห็นไฟล์ที่ helper เขียน, ownership และ mode ใต้ `/var/vmail`, การเซ็น DKIM ของข้อความที่ส่งผ่าน loopback และการส่งต่อ spool ระหว่างสอง account ยังต้องมี host acceptance เก็บสถานะและวันที่ตามต้นฉบับ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่
