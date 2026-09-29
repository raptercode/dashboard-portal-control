# แผนทดลองรองรับ Ubuntu ของ Dashboard Portal

[English](../../../en/knowledge/plans/ubuntu-compatibility-plan.md)
> สถานะ: แผนพัฒนาต่อและหลักฐาน ณ baseline v0.8.1 ไม่ใช่ support matrix ปัจจุบัน ข้อสังเกตเก่าเรื่อง Dockerfile/Go ต้องตรวจ source ใหม่ คำสั่ง `--check`/`--dry-run` ด้านล่างเป็นข้อเสนอที่ยังไม่มีใน installer ทางเข้า public bootstrap ปัจจุบันอยู่ใน [คู่มือติดตั้ง](../../how-to/production-install.md) และไม่ได้เพิ่ม multi-OS support



วันที่ประเมิน: **29 กันยายน 2026** · ฐานโค้ด **v0.8.1 / 65a1627**

เอกสารนี้เป็นผลตรวจโค้ดและแหล่งข้อมูลทางการ พร้อมแผนทดลองก่อนเริ่มแก้โค้ดจริง ยังไม่มีผลติดตั้งบน clean VM ที่รับรอง Ubuntu รุ่นใหม่ได้

## ข้อเสนอ

เริ่มทดลอง **Ubuntu Server 22.04, 24.04 และ 26.04 amd64** จำนวน 3 VM โดยใช้ 24.04 เป็นตัวเทียบ เสนอรับรองแยกตาม feature หลังผ่านเกณฑ์จริง ส่วน 20.04 ให้เป็นงานเสริมเมื่อมีเครื่องเดิมที่ต้องรองรับพร้อม Ubuntu Pro/ESM รุ่น interim ที่หมดอายุให้ใช้ตรวจเส้นทางย้ายระบบเท่านั้น

คำว่า “รอด” ต้องแยกเป็น 4 ขั้น: binary รันได้ → Portal/tests ผ่าน → host deploy/TLS/reboot ผ่าน → optional runtimes/mail ผ่าน การผ่านขั้นแรกยังไม่ใช่รองรับทั้งระบบ

## สิ่งที่ตรวจแล้ว

- Installer ปัจจุบันอนุญาตเฉพาะ `ubuntu` รุ่น `24.04` หรือ `25.04` และ `amd64`; รุ่นอื่นจะหยุดก่อนติดตั้ง ดู [dashboard-portal.sh](../../../../dashboard-portal.sh)
- Installer ใช้ apt, systemd และ Nginx; ติดตั้ง Node.js `24.18.0` กับ Bun `1.3.13` แบบ Linux x64 โดยตรวจ SHA-256 ส่วนตัวแปร Go `1.27.1` มีในไฟล์แต่ไม่ได้แปลว่ามีขั้นตอนติดตั้ง Go ดู [installer](../../../../dashboard-portal.sh)
- Go, Python/venv และ PHP/Composer เป็น prerequisite ที่ต้องเตรียมบน host แยก ดู [TOOLS](../../../../src/core.mjs)
- ตรวจ HTTP availability ของ Node checksum manifest, Bun baseline archive และ Go archive ได้ HTTP 200; ค่า Node linux-x64 ใน manifest ตรงค่าที่ pin ใน installer แต่ยังไม่ได้ดาวน์โหลดและรัน binary บนแต่ละ OS
- เครื่องทำงานมี WSL Ubuntu 24.04.1 ที่ตรวจ `/etc/os-release` แบบอ่านอย่างเดียวแล้ว; Docker daemon ยังเชื่อมต่อไม่ได้ จึงยังไม่มี container/VM acceptance run จากงานนี้
- Dockerfile ของ Portal ขาดการคัดลอก `scripts/` และ `views/` ที่ server ต้องใช้ ต้องแก้ก่อนนำ Dockerfile นี้เป็นฐาน lab ดู [Dockerfile](../../../../Dockerfile)
- ผลเดิม 264 tests / 55 modules เป็นหลักฐานของ v0.8.1; งานนี้ยังไม่ได้รันซ้ำ และ [installer tests](../../../../test/installer.test.mjs) ส่วนใหญ่ตรวจ source/text จึงไม่ใช่หลักฐานติดตั้งสำเร็จบน Ubuntu แต่ละรุ่น

## ประเมิน Ubuntu ทุกรุ่นเป็นกลุ่ม

ตารางนี้เป็น **ผลคัดกรองความเป็นไปได้** ไม่ใช่ผลทดสอบติดตั้งสำเร็จทุกแถว ค่า “ติดตั้งปัจจุบัน” อ้างจาก installer v0.8.1

| รุ่น | ติดตั้งปัจจุบัน | ความเป็นไปได้และข้อเสนอ |
|---|---|---|
| 4.10–17.10 ทุก release รวม LTS 6.06/8.04/10.04/12.04/14.04/16.04 | ปฏิเสธ | ไม่ทำเป้ารองรับ stock OS: ฐาน libc เก่าและบางรุ่นยังไม่ใช้ systemd; ใช้การย้ายไป LTS ใหม่ |
| 18.04 LTS ทุก point release | ปฏิเสธ | stock glibc 2.27 ต่ำกว่า Node 24 binary ต้องการ 2.28; HWE kernel ไม่ได้อัปเกรด glibc ข้าม release ให้ ไม่เสนอแก้โดยแทน system libc |
| 18.10 / 19.04 / 19.10 | ปฏิเสธ | รุ่นเก่าที่หมดอายุ แม้บางตัวผ่านฐาน libc ก็ไม่เสนอ production support |
| 20.04 LTS ทุก point release | ปฏิเสธ | Node มีฐานรองรับ; ทดลองได้แบบมีเงื่อนไข Pro/ESM และตรวจ optional package ทุกตัว แยกจากเป้าหมายหลัก |
| 20.10 / 21.04 / 21.10 | ปฏิเสธ | หมดอายุแล้วทั้งหมด; ไม่ขยาย fresh install support |
| 22.04 LTS ทุก point release | ปฏิเสธ | candidate ที่มีโอกาสสูง; ต้องทดสอบ apt sources/Compose และ systemd/config จริง |
| 22.10 / 23.04 / 23.10 | ปฏิเสธ | หมดอายุแล้วทั้งหมด; ทดสอบเฉพาะเมื่อจำเป็นต้องย้ายเครื่องเดิม |
| 24.04 LTS ทุก point release | อนุญาต amd64 | baseline ของโค้ดปัจจุบัน; ยังต้อง clean install acceptance กับ image/kernel ที่ระบุ |
| 24.10 | ปฏิเสธ | หมดอายุ 10 กรกฎาคม 2025 |
| 25.04 | อนุญาต amd64 | หมดอายุ 15 มกราคม 2026; ควรเปลี่ยนนโยบาย fresh install หลังแผนได้รับอนุมัติ |
| 25.10 | ปฏิเสธ | หมดอายุ 9 กรกฎาคม 2026; เก็บเป็น migration test เมื่อมีเครื่องเดิม |
| 26.04 LTS ทุก point release ที่ออกแล้ว | ปฏิเสธ | candidate หลักสำหรับขยาย support; **Mail มีความต่าง Dovecot 2.4 ที่ต้องแก้ก่อนรับรอง feature นี้** |
| 26.10 | ปฏิเสธ | ยังเป็น development release ณ วันที่ประเมิน; smoke test ได้ภายหลัง แต่ยังไม่รับรอง production |

หลักฐาน lifecycle: [Ubuntu list of releases](https://ubuntu.com/project/docs/release-team/list-of-releases/), [Ubuntu 25.10 EOL announcement](https://discourse.ubuntu.com/t/ubuntu-25-10-questing-quokka-reached-end-of-life-on-9-july-2026/85017), [26.10 release notes](https://documentation.ubuntu.com/release-notes/26.10/)

LTS 22.04/24.04/26.04 อยู่ใน standard maintenance ถึงปี 2027/2029/2031 ตามลำดับ ส่วน 20.04 พ้น standard maintenance ตั้งแต่ปี 2025 และต้องพิจารณา coverage ของ Pro/ESM แยก: [Canonical release cycle](https://ubuntu.com/about/release-cycle)

Node.js 24 official Linux x64 binary ต้องการ kernel >= 4.18, glibc >= 2.28 และ libstdc++ >= 6.0.25; Node ไม่รับรอง OS ที่ vendor หมดอายุ support แล้วแม้ binary อาจรันได้: [Node 24 BUILDING.md](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list) · Ubuntu 18.04 ใช้ glibc 2.27: [Ubuntu Bionic package source](https://launchpad.net/ubuntu/bionic/arm64/libc6-dev/2.27-3ubuntu1)

Point release ไม่ใช่การรับรองรวมอัตโนมัติ: ใน lab ให้บันทึก image checksum, patch level, GA/HWE/cloud kernel และ package versions ที่ผ่านจริง เริ่มจาก image ล่าสุดที่ patched ครบของแต่ละ LTS แล้วค่อยขยาย kernel/image matrix ตามการใช้งาน

## Edition และ architecture

| กลุ่ม | ขอบเขตการทดลองที่เสนอ |
|---|---|
| Ubuntu Server amd64 | เป้าหมายหลักของ host install |
| Ubuntu Desktop amd64 | ฐาน package ใกล้เคียง แต่ต้องทดสอบ service/port/sleep/reboot แยก; ไม่อ้างผล Server ว่ารับรอง Desktop แล้ว |
| Cloud/minimal amd64 | ทดสอบเพิ่มเติมเรื่อง package ที่ขาด, Universe/updates, cloud firewall, DNS และ systemd |
| Kubuntu/Xubuntu/Lubuntu และ flavors อื่น | ยังไม่รับรองรวมตามชื่อ Ubuntu; lifecycle ของ flavor และ image ต้องตรวจแยก |
| Ubuntu Core | all-snap และ confinement ต่างจาก installer apt/systemd ปัจจุบัน ต้องออกแบบแพ็กเกจ/สิทธิ์ใหม่ เป็นโครงการแยก |
| arm64 | Node มี upstream binary แต่ installer/Bun/Go mapping ของ Portal ต้องเพิ่มและทดสอบบน ARM จริงภายหลัง |
| i386/armhf/riscv64/ppc64el/s390x | ไม่อยู่ในรอบนี้; การที่ Ubuntu รองรับสถาปัตยกรรมนั้นไม่เพียงพอให้ Portal รองรับ |
| WSL หรือ container Ubuntu | ใช้ช่วยตรวจแอป/package ได้; ไม่ใช้แทนผล native host/systemd/TLS/reboot |

ข้อมูล edition/flavor: [Canonical release cycle — editions](https://ubuntu.com/about/release-cycle#editions-and-flavors) · สถานะ architecture ของ runtime: [Node platform list](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list)

## Feature matrix และจุดที่ต้องพิสูจน์

เครื่องหมาย “ทดลอง” หมายถึงยังไม่มีผลรับรองในงานนี้

| Feature | 20.04 + Pro | 22.04 | 24.04 | 26.04 |
|---|---|---|---|---|
| Portal/API/UI/SQLite | ทดลองเสริม | ทดลอง | baseline ทดสอบซ้ำ | ทดลอง |
| systemd helper + Nginx/TLS | ทดลองเสริม | ทดลอง | baseline ทดสอบซ้ำ | ทดลอง |
| Node/Bun build/start/health/rollback | ตรวจ binary/CPU เพิ่ม | ทดลอง | baseline ทดสอบซ้ำ | ทดลอง |
| Docker Engine + Compose v2 | หา package source ที่รองรับก่อน | มี jammy-updates/universe; ทดลอง | ทดลอง | ทดลอง |
| Go/Python/PHP | เตรียม compiler/venv/Composer และ dependencies แยก | เช่นเดียวกัน | เช่นเดียวกัน | เช่นเดียวกัน |
| Mail/Postfix/Dovecot/OpenDKIM | ตรวจ package/config ก่อน | ทดลอง config 2.3 | ทดลอง config 2.3 | ต้องปรับ config ให้ Dovecot 2.4 ก่อน |
| Sync/auto-deploy/GitHub hook/Actions hook | ตาม runtime ที่ผ่าน | ทดลองครบ | ทดลองครบ | ทดลองครบ |
| Master/User/multi-org/12 permissions | integration ทุก host ที่ผ่าน | เช่นเดียวกัน | เช่นเดียวกัน | เช่นเดียวกัน |

### ข้อขัดข้องที่พบจากหลักฐาน

1. **การปลด version allowlist อย่างเดียวไม่พอ:** privilege helper ติดตั้ง package ตามชื่อคงที่ ดู [host helper](../../../../scripts/hostmgr-deploy-helper.mjs)
2. **Compose บน 22.04 มีทางไปต่อ:** `docker-compose-v2` มีใน `jammy-updates` component `universe`; ต้องตรวจว่าจริงใน image ที่ใช้เปิด pocket/component นี้ ไม่สรุปว่า 22.04 ไม่มี Compose v2 จาก package ใน release pocket อย่างเดียว: [Ubuntu package](https://packages.ubuntu.com/jammy-updates/docker-compose-v2)
3. **Mail บน 26.04 ต้องแก้:** package `dovecot-core` ของ Resolute เป็น 2.4.2 แต่ template ใช้ `mail_location`, `ssl_cert`, `passdb { driver... }` แบบ 2.3; upstream ระบุว่า config 2.3 ใช้กับ 2.4 โดยไม่แปลงไม่ได้และเพิ่ม required version settings ดู [template](../../../../scripts/mail-host-config.mjs), [Ubuntu package](https://packages.ubuntu.com/resolute/dovecot-core), [Dovecot migration guide](https://doc.dovecot.org/2.4.2/installation/upgrade/2.3-to-2.4.html)
4. **Runtime ของแอปที่ deploy มีข้อกำหนดของตัวเอง:** Python/PHP/Go จากแต่ละ OS ไม่เท่ากัน; ให้ใช้ fixture projects ที่ pin dependency และบันทึกเวอร์ชันจริง ไม่อ้างว่า Portal ผ่านแล้วทุกแอปจะ build ผ่าน
5. **Postfix ต้องตรวจความสามารถจริง:** ใช้ `postconf -m` ตรวจ backend `hash` ที่ template ต้องใช้ และตรวจค่า `compatibility_level` ที่ package ยอมรับ; ยังไม่มีหลักฐานพอจะฟันธงว่า Ubuntu 20.04 ล้มตรงนี้

## แผนทดลองก่อนเริ่มพัฒนาจริง

### ระยะ A — Metadata และ binary preflight

- กำหนด image ของ 22.04/24.04/26.04 amd64 พร้อม checksum และใช้ snapshot แยก 3 เครื่อง ไม่มี production data
- ตรวจ `/etc/os-release`, architecture, kernel/libc/libstdc++, CPU instruction support สำหรับ Bun baseline, systemd และ package repository
- ตรวจ candidate/version ของ package ที่ installer/helper ใช้จริง รวม optional tools; ไม่เพิ่ม third-party repository แบบเงียบ ๆ
- ดาวน์โหลด runtime แบบ pin เวอร์ชัน, ตรวจ checksum แล้วรัน version + Node SQLite/crypto smoke test บน target; HEAD 200 ไม่นับผ่านขั้นนี้
- ส่งมอบตาราง pass/fail/blocker พร้อม log ที่ตัด secret ออก ก่อนเสนอการแก้ compatibility

**เกณฑ์ผ่าน:** runtime เปิดได้, package resolve ได้ และไม่มีการจำเป็นต้องแทน system libc หรือยกเลิกกลไก security ของ installer

### ระยะ B — Container tests สำหรับคัดกรอง

- หลัง Docker daemon ใช้งานได้ ใช้ Ubuntu image แยก 22.04/24.04/26.04 ทดสอบ dependency install, Node tests, config generation, archive contents และ module imports
- ใช้ released source ของ v0.8.1 เป็น baseline; การแก้ Dockerfile/harness หรือ compatibility code ให้เริ่มใน branch ทดลองหลังอนุมัติแผน
- ตรวจ Nginx/Dovecot/Postfix config ด้วย binary รุ่นจริง โดยไม่ส่ง mail ออกหรือเปิดบริการสาธารณะ
- เมื่อ baseline แสดง blocker ให้ทำการแก้ขั้นต่ำใน branch ทดลองตามแผนที่ผู้ใช้อนุมัติ แล้วรัน B ซ้ำก่อน C/D; บันทึกผล baseline และผลหลังแก้แยกกัน

**เกณฑ์ผ่าน:** tests และ syntax/config validation ผ่านทุก feature ที่จะประกาศรองรับ เก็บ known failures แยกตามรุ่น ไม่มีการ skip ให้ suite เขียวโดยไม่อธิบาย

### ระยะ C — Clean VM acceptance

ใช้ **3 clean VM** สำหรับ 22.04/24.04/26.04 จาก baseline image เดียวกับระยะ A; snapshot ก่อนติดตั้งและก่อนอัปเกรด ใช้โดเมนทดสอบเฉพาะแต่ละเครื่อง

24.04 เริ่มด้วย installer v0.8.1 ได้ ส่วน 22.04/26.04 ต้องใช้ candidate จาก branch ทดลองหลังอนุมัติและแก้ blocker ใน B แล้ว เพราะ installer ปัจจุบันปฏิเสธทั้งสองรุ่น ห้ามนับการข้าม allowlist อย่างเดียวเป็นผลรองรับ

1. Install เป็น root ผ่าน installer และตรวจ Portal/helper ทำงานด้วย uid/gid/สิทธิ์ filesystem ที่ถูกต้อง
2. ตรวจ DNS, Nginx syntax, loopback binding, HTTP→HTTPS, certificate chain, secure cookie และ renewal ด้วย ACME staging ก่อนใช้ production certificate เฉพาะรอบ acceptance ที่จำเป็น
3. Deploy fixture Node, Bun, Go, Python, PHP และ Docker ตาม feature ที่ทดสอบ; ตรวจ candidate health, active release, logs, env, domain routing และ failed build/health ที่ไม่ทำ active release เดิมเสีย
4. Sync poll, GitHub signed webhook และ Actions token: ถูกต้อง, ผิด secret, replay/duplicate, branch ผิด, concurrent events และ failure/retry; ยืนยัน revision ที่รันจริง
5. Role regression: anonymous, Master, User ไม่มี org, Viewer, Operator, Maintainer, custom env-read/env-write, ผู้ใช้หลาย org สิทธิ์ต่างกัน, disabled/revoked session; ตรวจ API และ UI รวม job ที่ค้างตอนถูกถอนสิทธิ์
6. Restart Portal/helper/project และ reboot VM; ตรวจการกลับมาทำงาน, permissions, pending job recovery และการไม่ deploy revision ซ้ำ
7. Mail เป็น acceptance แยก: syntax, IMAP authentication, LMTP delivery, SMTP submission, TLS, DKIM และ non-relay ด้วย test accounts; ไม่เอาผล Dashboard health มาแทนผล Mail

คำสั่ง validation ที่ต้องเก็บผลใน lab: `systemd-analyze verify <portal-unit> <helper-unit>`, `nginx -t`, `doveconf -n`, `postfix check` และ `postconf -m`; ตัด secret ออกจาก log ก่อนแนบหลักฐาน ทดสอบทั้งเครื่องสะอาดและเครื่องที่มี Nginx sites เดิมเพื่อยืนยันว่าไม่ทำ config เดิมเสีย คำสั่งเหล่านี้ยังไม่ได้รันจากงานวางแผนครั้งนี้

**เกณฑ์ผ่าน:** clean install ซ้ำได้, reboot แล้วกลับมาครบ, feature acceptance ผ่าน และ failure paths เก็บ release/data เดิมไว้ได้

### ระยะ D — Upgrade และ rollback

- เริ่มจาก Portal v0.8.1 พร้อมหลาย org, memberships, encrypted settings, project releases และ mail fixture; สำรอง SQLite/config/keys แบบไม่แสดงค่า
- ทดสอบ Portal update ไป candidate และ recovery กลับ snapshot/backup โดยรักษา owner/users/session policy กับ encryption key
- ทดลอง OS upgrade 22.04→24.04 และ 24.04→26.04 เฉพาะเส้นทางที่ Ubuntu เปิดรองรับในวันที่ทดลองจริง; ห้ามใช้ผล fresh install แทนผล upgrade
- การถอย OS ใช้ restore VM snapshot/backup; ไม่ออกแบบให้ downgrade apt package ทั้งระบบเป็น rollback
- Dovecot 2.3→2.4 ต้องทดสอบ mail data/config migration แยก; คง storage format เท่าที่ rollback ยังรองรับก่อนเปลี่ยน irreversible format
- 20.04/25.x ทดสอบเพิ่มเฉพาะเมื่อมีเครื่องเก่าที่ต้องย้ายจริง โดยวางเส้นทางที่ Ubuntu รองรับหรือย้ายข้อมูลเข้าเครื่อง LTS ใหม่

### ระยะ E — ตัดสินใจ support และงานพัฒนาที่จะตามมา

งานพัฒนาที่คาดว่าจะต้องทำใน branch ทดลองระหว่าง B–D หลังอนุมัติแผน มีดังนี้ จากนั้นใช้ผล A–D เลือก feature ที่ผ่านจริงเพื่อกำหนด release scope:

- เพิ่ม OS capability profile แยก version/architecture/package/config ให้ installer, helper และ Doctor ใช้ข้อมูลตรงกัน
- แยก Dovecot 2.3/2.4 renderer พร้อม config validation ก่อนสลับไฟล์ และ restore เมื่อ validate/restart ไม่ผ่าน
- เพิ่ม module tests ของ platform detection/package plan/config compatibility รวม integration ที่ต้องใช้ VM
- UI แจ้ง feature ที่ใช้ได้/ต้องติดตั้งเพิ่ม/ยังไม่รองรับ โดยไม่อ้างว่า OS ผ่านทุก feature
- ปรับเอกสารและ support matrix เป็น “รุ่น + architecture + image/kernel + feature ที่ผ่าน” พร้อมวันที่หลักฐาน; จัด release หลัง review และ acceptance ผ่าน

ข้อเสนอขอบเขตรอบแรก: **22.04 + 24.04 + 26.04 amd64** สำหรับ Portal/deploy; Mail 26.04 จะประกาศรองรับเมื่อ migration/config tests ผ่านเท่านั้น ส่วน ARM64 ให้เป็นรอบแยกหลัง amd64 คงที่

## ส่วนขยาย: คำสั่งติดตั้งเดียว เลือกวิธีตาม OS

ข้อเสนอเพิ่มเติมตามคำถามผู้ใช้: ออกแบบให้มี installer entry point เดียว ตรวจเครื่องก่อนเปลี่ยนระบบ แล้วเลือก adapter และ profile ที่ตรงกับเครื่อง ความซับซ้อนหลักอยู่ที่ host integration และการทดสอบต่อเนื่อง ไม่ใช่การอ่านชื่อ OS

### โครงสร้างที่เสนอ

```text
dashboard-portal.sh
  → detect host
  → resolve supported profile
  → preflight + show installation plan
  → install using family adapter and version-specific configuration
  → validate + activate + health check
  → save installation metadata for helper/Doctor/updater
```

- **Detector:** ตรวจ kernel/OS family ก่อนใช้คำสั่งเฉพาะ Linux; บน Linux อ่าน `ID`, `VERSION_ID`, `ID_LIKE`, architecture, libc, init system, package manager และ virtualization/container environment
- **Profile registry:** ระบุ OS/version/architecture, สถานะ support, package names/repositories, runtime artifact/checksum, paths, service names และ feature prerequisites โดยใช้ข้อมูลต้นฉบับเดียวสำหรับ installer/helper/Doctor/updater
- **Family adapters:** แชร์ขั้นตอนของ apt/systemd ระหว่าง Ubuntu กับ Debian แต่มี profile แยกตาม distribution/version; เพิ่ม dnf/systemd ภายหลังเมื่อมีหลักฐานทดสอบ โดยไม่คัดลอก installer ทั้งไฟล์ให้แต่ละ OS
- **Feature configuration:** แยก Nginx layout และ Dovecot configuration ตาม capability/version จริง; การเลือก package manager ได้ไม่ได้แปลว่า configuration ใช้ร่วมกันได้
- **Bootstrap:** detector/preflight ต้องทำงานก่อนติดตั้ง Node; registry อาจ generate เป็นข้อมูล Bash และ JavaScript ตอน build release พร้อมตรวจ parity เพื่อให้ไม่มีรายการ support ที่แก้แยกกันด้วยมือ
- **Artifact trust:** adapter/profile อยู่ใน release ที่ตรวจสอบแล้วและจับคู่กับ version เดียวกัน ไม่เลือก URL แล้ว execute remote script ตามค่าที่อ่านจาก OS โดยตรง

ใช้ `ID_LIKE` เป็นข้อมูลช่วยจำแนกตระกูลเท่านั้น OS derivative ที่ไม่อยู่ใน registry ต้องไม่ถูกอนุมัติอัตโนมัติว่าเป็น Ubuntu/Debian ที่ผ่านการทดสอบแล้ว ดู [os-release specification](https://www.freedesktop.org/software/systemd/man/latest/os-release.html)

### พฤติกรรมก่อนติดตั้งที่เสนอ

คำสั่งด้านล่างเป็น **interface ที่เสนอ ยังไม่ได้ implement**:

```bash
./dashboard-portal.sh --check
./dashboard-portal.sh --dry-run --features=portal,deploy
sudo ./dashboard-portal.sh --domain=portal.example.com --email=admin@example.com
```

- `--check` อ่านข้อมูลและรายงานสิ่งที่ตรวจได้โดยไม่ติดตั้งหรือแก้ host config; ส่วนที่อ่านไม่ได้ให้ระบุ unknown และอธิบายสิทธิ์ที่ต้องใช้
- `--dry-run` แสดง profile, packages, runtime versions, paths, services และ feature blockers; ไม่ refresh repository หรือเปลี่ยนไฟล์เพื่อทำให้ผลดูครบ ให้ระบุข้อมูล package cache ที่อาจเก่า
- สถานะ `supported`: profile ผ่าน acceptance ตาม feature/image ที่บันทึกไว้; `experimental`: เข้า lab ได้เมื่อเลือกอย่างชัดเจน; `unsupported`: หยุดก่อน mutation พร้อมเหตุผล
- ไม่มีตัวเลือก force แบบข้ามทุกข้อจำกัด; experimental ยังต้องผ่าน architecture/libc/integrity/security checks และไม่ทำให้ feature ที่ไม่ผ่านกลายเป็น supported
- ถ้า Portal/deploy ผ่านแต่ Mail ไม่ผ่าน ให้เสนอชุด feature ที่ใช้ได้และบอกข้อจำกัดก่อนติดตั้ง; ถ้าผู้ใช้ระบุ Mail มาแล้วต้อง fail พร้อมเหตุผล ไม่ตัดทิ้งเงียบ ๆ
- การติดตั้งต้องใช้ lock ป้องกันรันซ้อน, เก็บ backup, validate config ก่อน activate และตรวจ health หลัง activate; rollback ระบุชัดว่าส่วนใดย้อนกลับได้ และ package/certificate ส่วนใดอาจคงอยู่
- การรันซ้ำและ update ต้องอ่าน metadata เดิมและตรวจ host ปัจจุบันใหม่ ถ้า OS ถูก upgrade จนเปลี่ยน profile ให้ผ่าน migration preflight ก่อนเปลี่ยนบริการ
- metadata และ adapter ที่ privileged helper ใช้ต้องเป็น root-owned; client ส่งได้เฉพาะ feature/action ที่อนุญาต ไม่ส่ง arbitrary command/package/profile ให้ root execute

### ลำดับขยาย OS ที่เสนอ

| รอบ | เป้าหมายทดลอง | เหตุผลและขอบเขต |
|---|---|---|
| 1 | Ubuntu Server 22.04/24.04/26.04 amd64 | ทำ registry/adapter และใช้ 3 VM จากแผนเดิม; รับรองราย feature หลังผ่านจริง |
| 2 | Debian 13 amd64; Debian 12 เมื่อมีความต้องการ | ประเมินว่าแชร์ apt/systemd adapter ได้มาก แต่ต้องสำรวจ package/config และทำ clean VM acceptance ใหม่ทั้งหมด |
| 3 | Rocky Linux / AlmaLinux / RHEL | สำรวจรุ่นที่ยังมี support ก่อนเลือก VM; ต้องเพิ่ม dnf package mapping, repo prerequisites, Nginx layout, SELinux และ firewall integration; ไม่ปิด SELinux เพื่อให้ tests ผ่าน |
| แยก | arm64 | เพิ่ม artifact/checksum ต่อ architecture และทดสอบบนเครื่อง ARM จริง |
| ยังไม่รวม | Alpine, Ubuntu Core, Windows/macOS native host | ต้องประเมิน runtime/init/service/privilege integration เป็นงานแยก; การรันเว็บแอปได้ไม่ได้พิสูจน์ว่า host manager ใช้งานได้ |

Debian 13 เป็น stable ในวันที่ตรวจ: [Debian releases](https://www.debian.org/releases/). RHEL มีข้อกำหนด SELinux สำหรับ reverse proxy ที่ต้องทดสอบ: [Red Hat Nginx guide](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/pdf/deploying_web_servers_and_reverse_proxies/setting-up-and-configuring-nginx_deploying-web-servers-and-reverse-proxies). Alpine ใช้ musl/apk/OpenRC จึงต้องมี adapter และ runtime plan ต่างออกไป: [Alpine overview](https://www.alpinelinux.org/about/). ลำดับข้างต้นเป็นข้อเสนอทางวิศวกรรม ยังไม่มีผลยืนยันว่า Portal ผ่านบน OS เพิ่มเติมเหล่านี้

### Test modules ที่ต้องเพิ่มเมื่อเริ่มพัฒนา

1. Host detection: metadata ขาด/ผิดรูปแบบ, unknown derivative, architecture aliases, libc/init ที่ไม่รองรับ และ container/WSL
2. Profile resolution: version ที่รู้จัก/ไม่รู้จัก, supported/experimental/unsupported และ feature combinations
3. Preflight/plan: หยุดก่อน mutation เมื่อมี blocker; `--check`/`--dry-run` ไม่มีผลเปลี่ยนระบบ
4. Package/service/config adapters: registry parity, package resolution และ syntax validation ด้วย binary จริงของ target
5. Install/update/recovery: clean install, rerun, interrupted install, update, OS migration, reboot, custom Nginx sites และ rollback
6. Privileged helper: profile/config ownership, client ไม่สามารถสั่ง package/command นอก allowlist และ regression สิทธิ์หลาย org เดิม

**ข้อสรุปการออกแบบ:** โครงสร้างนี้รองรับการเพิ่ม OS ได้โดยจำกัดจุดแก้ไว้ใน profile/adapter แต่จะประกาศรองรับเฉพาะรายการที่ผ่าน VM acceptance เท่านั้น รอบแรกควรทำ Ubuntu ให้ครบก่อนเพิ่ม Debian แล้วจึงขยายตระกูล Linux อื่น

## ขอบเขตงานรอบนี้

บันทึกแผนและหลักฐานเท่านั้น ไม่มีการแก้ installer/app/tests, เพิ่ม OS allowlist, ติดตั้ง package, สร้าง VM, deploy หรือ publish release จากเอกสารนี้ งานทดลองและโค้ดจริงเริ่มหลังผู้ใช้เลือกเดินตามแผน
