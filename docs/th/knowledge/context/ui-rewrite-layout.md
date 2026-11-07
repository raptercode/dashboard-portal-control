# Strckro Signal UI (2026-11-07)

[English](../../../en/knowledge/context/ui-rewrite-layout.md)

## ขอบเขต

เปลี่ยน frontend ใหม่ ถอด app.js, app.css, markup หน้าเดิม, sidebar, dialog partials และ page controllers เดิมออก แบรนด์ runtime logos และ environment-editor.js ยังคงอยู่ เพราะ parser ENV ใช้ร่วมกับ backend ไม่เปลี่ยน API, session, CSRF, สิทธิ์, deployment helper หรือข้อมูลที่บันทึกบน server

## โครงใหม่

views/layout.html และ views/mail-layout.html เป็น shell ขนาดเล็กชุดเดียวกัน ส่วน views/pages เก็บเฉพาะ metadata สำหรับ reload ตาม route เดิม ใช้ History API เปลี่ยนหน้าโดยไม่โหลดเอกสารใหม่

public/ui/main.js ดูแล session, กรอบแอป (host strip + rail), navigation, keyboard search และวงจรชีวิตของหน้า core รวม DOM components, API cache, permission/route models, dialog, DNS และ polling ส่วน screens แยกโมดูล workspace, project, release, infrastructure, Mail, access, settings และ authentication โหลดเมื่อเปิดใช้

ระบบภาพทั้งหมดอยู่ใน public/ui/css โหลดตามลำดับ tokens.css (ธีม ตัวอักษร องค์ประกอบพื้นฐาน), components.css (ปุ่ม ฟอร์ม ตาราง เครื่องมือวัด dialog), shell.css (host strip, rail, หัวหน้า) และ screens.css (หน้า login และการจัดวางแต่ละหน้า) ไม่มี stylesheet เดิมซ้อนอยู่ข้างใต้ ภาพ public/ui/brand/hero-track.svg คือเส้นทางเคลื่อนไหวในหน้า login

กรอบแอปคือ host strip ด้านบนกับ rail ด้านซ้ายที่แสดงทุกเมนูพร้อมกัน จึงไม่มีปลายทางที่ต้องคลิกสองชั้น ต่ำกว่า 1040 px rail กลายเป็น drawer Overview เน้นสถานะแอปและสุขภาพโฮสต์ Applications เป็นตารางแบบ ledger ที่เปลี่ยนเป็นการ์ดบนมือถือ เปิดแอปแล้วใช้ sheet จัดการแผน deploy, ENV, domains, releases, automation และ notifications การสร้าง/แก้แอปยังมี identity, source/runtime, review ส่วน Mail ใช้รายการขั้นตอนในกรอบเดียวกัน

## ภาษาการออกแบบ

หน้าตามาจากแนวคิดเดียวในโลโก้: release คือราง (track) จาก source ไป build ไป serving พื้นผิวเงียบและเป็นกลาง (กระดาษโทนอุ่นในธีมสว่าง เขียวดำในธีมมืด) สีมะนาวใช้เป็น "สัญญาณ" เท่านั้น คือปุ่มหลัก ตัวบอกหน้าปัจจุบัน และสถานะ Live ไม่มีทรัพยากรที่ดึงจากภายนอก ตัวอักษรใช้ฟอนต์ระบบ

- Track (`track`): สามสถานีที่คำนวณจาก `pipelineStages(project)` ใน core/model.js ใช้ในรายการ Overview และหัว sheet ของแอป ทุกสถานะมีข้อความสำหรับโปรแกรมอ่านหน้าจอ
- เกจแบบขีด (`gauge`): CPU, memory และ disk ของโฮสต์ เปลี่ยนเป็นเหลืองตั้งแต่ 75 % และแดงตั้งแต่ 90 %
- ป้ายสถานะแบบ LED, ไทม์ไลน์ release แบบราง และภาพราง (track) เงียบๆ สำหรับหน้าว่าง
- ธีมสว่างและมืดตามค่าของระบบจนกว่าผู้ใช้เลือกเองด้วยปุ่มสลับธีม การเคลื่อนไหวเคารพการตั้งค่าลดการเคลื่อนไหว

## การโหลดและพฤติกรรม

เปิด Applications หลัง login ใช้เพียง /api/session, /api/access และ /api/projects ไม่รอ doctor, audit, credentials, Git settings หรือ software updates การตรวจอัปเดตทำเฉพาะหน้า System updates และโค้ดแต่ละฟีเจอร์โหลดเมื่อเปิดใช้

GET บางรายการมี cache ระยะสั้นเฉพาะใน memory การเปลี่ยนข้อมูลจะล้าง cache และ logout ล้างข้อมูลบัญชี ENV ไม่ถูก cache ส่วน token จริงไม่เขียนลง browser storage การเปลี่ยนหน้าป้องกัน response/โมดูลเก่าทับหน้าปัจจุบัน polling หยุดเมื่อออกจากหน้าและพักเมื่อซ่อนแท็บ Logs มีพื้นที่เลื่อนอ่านของตัวเอง

ตัวกรองทำงานในเครื่องไม่เรียก API ใหม่ ฟอร์มและ ENV ที่ยังไม่บันทึกถามก่อนทิ้ง การลบแอปต้องพิมพ์ชื่อตรงกัน token แสดงครั้งเดียวแล้วล้างเมื่อปิด dialog สิทธิ์ที่แสดงใน UI ยังคงตรวจซ้ำโดย backend เสมอ

## การเลือก runtime และ framework

Runtime และ Framework เป็นเมนูที่มีโลโก้ (core/picker.js ข้อมูลอยู่ใน core/runtimes.js) ไม่ใช่ select ธรรมดา รายการ framework ใน core/runtimes.js ตรงกับ PROJECT_FRAMEWORKS ใน src/core.mjs และมีเทสต์ล้มถ้าสองฝั่งไม่ตรงกัน runtime เสริมที่ host ไม่มี (Go, Python, PHP) จะแสดงแต่เลือกไม่ได้

เมื่อพิมพ์หรือวาง HTTPS repository URL ในฟอร์มแอป ระบบรอสักครู่แล้วดึง branch ตามด้วยตรวจ runtime และ framework ผ่าน /api/projects/runtime-detect ผลตรวจเติม runtime, framework และค่าที่เกี่ยวข้อง (เช่น run mode ของ Django หรือข้าม build เมื่อไม่มี build script) พร้อมแสดงสิ่งที่พบ และจะไม่ทับสิ่งที่ผู้ใช้เลือกระหว่างที่กำลังตรวจ ปุ่ม Fetch branches และปุ่มตรวจ App อัตโนมัติยังใช้ทำซ้ำด้วยมือได้ repository แบบ SSH ไม่ถูกตรวจอัตโนมัติ เพราะ server อ่านไม่ได้ถ้าไม่มี deploy key

## โดเมน การ deploy และ release

แท็บ Domains อ่านสถานะ DNS, Cloudflare proxy และ TLS ของ origin ของแต่ละโดเมนเมื่อเปิด และหลังการเปลี่ยนแปลงทุกครั้ง แสดงสถานะความพร้อมต่อโดเมนพร้อมตาราง A / AAAA และผลตรวจ Nginx / TLS Refresh แค่ตรวจ ส่วน Verify และ Verify all เปลี่ยนการตั้งค่า ระหว่างที่งานหนึ่งกำลังทำ ทุกปุ่มรอ หากการถอดโดเมนถูก host ปฏิเสธ จะแสดงข้อผิดพลาดและมีปุ่มลองใหม่ รับได้ไม่เกินสิบโดเมน

การ deploy แสดงเป็นบรรทัดเดียวในแท็บ Deploy ที่หัว sheet ของแอปและในรายการแอป คือเฟสที่กำลังทำ ผลลัพธ์ การย้อนกลับที่กำลังทำ หรือการย้อนกลับสำเร็จหลังล้มเหลว log เปิดเมื่อกด "ดูรายละเอียด" เท่านั้น ไม่เด้งเอง Restart และ Rollback ระบุ release และ commit ที่จะทำ และ Rollback เตือนเมื่อสอง release ใช้ commit เดียวกัน Restart อ่านแอปใหม่แม้ request ล้มเหลว รายการวาดใหม่เมื่อข้อมูลเปลี่ยนเท่านั้น focus คีย์บอร์ดจึงอยู่ที่แถวเดิม

## พรีวิว

~~~powershell
npm run preview:ui
~~~

เปิด http://127.0.0.1:4343 ด้วย preview@strckro.local / Strckro-Preview-2026! พรีวิวฟังเฉพาะ loopback ใช้ฐานข้อมูลและ project directory ชั่วคราว vault key ใหม่ และ demo mode ไม่โหลด .env หรือข้อมูล production กด Ctrl+C เพื่อหยุด เปลี่ยนพอร์ตด้วย STRCKRO_PREVIEW_PORT

## ตรวจสอบ

~~~powershell
npm test
npm run docs:check
npm run test:ui
~~~

Browser suite ต้องมี Playwright และ Chromium ให้ Node ใช้ได้ หากยังไม่มี ใช้ npm install --no-save playwright และ npx playwright install chromium หรือระบุโมดูลด้วย STRCKRO_PLAYWRIGHT_MODULE และ executable ด้วย STRCKRO_BROWSER_PATH เครื่องมือเหล่านี้ใช้ทดสอบเท่านั้น

Browser tests เปิด demo server แยก ตรวจ request ที่จำเป็น การเปลี่ยนหน้าโดยไม่ reload, ENV และแถวที่กรองไว้, การป้องกันข้อมูลยังไม่บันทึก, runtime settings, domains, tokens, CLI approval, invitation, สิทธิ์สมาชิก, Console, Mail, authentication และ deep links บนหลายขนาดจอ ชุด backend/security tests ยังอยู่ตามเดิม ส่วน tests ที่สกัดข้อความจาก monolith และ markup ที่ถอดออก เปลี่ยนเป็น tests ของ model ใหม่และการกดใช้งานจริง

การทดสอบความเร็วแบบควบคุมหน่วง API software-update ที่ไม่เกี่ยวกับ Applications 600 ms ชุดเดิมเรียกแปด API และรอ endpoint นี้ ชุดใหม่เรียกสาม API และไม่เรียก software-update บนหน้านั้น ตัวเลขเวลาจากพรีวิวในเครื่องไม่ใช่การรับประกัน latency ของ production
