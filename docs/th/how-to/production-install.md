# ติดตั้ง Dashboard Portal บน Ubuntu

[English](../../en/how-to/production-install.md)

หลังติดตั้งใช้ `strckro -h` หรือ `--help` ดูคำสั่ง CLI ทั้งหมด และ `strckro -v` หรือ `--versions` ดู Portal/runtime versions โดยไม่ต้อง sudo ใช้ `dashboard-portal update --help` ดูคู่มือได้เช่นกัน ส่วน update, configure-update และ reset password ยังต้อง sudo


คู่มือนี้ใช้กับ **Ubuntu Server 24.04 หรือ 25.04, amd64** ที่ผ่านเงื่อนไข installer การติดตั้งจริงใช้ systemd และ Nginx; Docker Compose ใน repository ใช้ทดลองบนเครื่องพัฒนา

## เตรียมเครื่อง

- มีสิทธิ์ sudo และโดเมน เช่น `portal.example.com`
- ตั้ง A/AAAA ให้ถูกต้อง แล้วตรวจจาก host ด้วย `getent ahosts portal.example.com`
- เปิด TCP 80 และ 443; Let's Encrypt ใช้ HTTP-01 challenge
- หากใช้ CDN ให้ใช้ DNS only ระหว่างออก certificate ครั้งแรก ตรวจ origin HTTPS ให้ผ่านก่อนเปิด proxy แบบ Full (strict)
- พอร์ต loopback 3100 ต้องว่าง และมีพื้นที่สำหรับ Node major ที่เลือก, Bun, source และ backup
- สำรอง Nginx และบริการเดิมก่อนเริ่ม ใช้ staging host สำหรับทดสอบการติดตั้งครั้งแรก

Installer จัดการไฟล์ Nginx ของ Portal และ managed projects รวมถึงแทนที่ symlink ของ Ubuntu default site เมื่อยังชี้ default เดิม เพื่อใช้ reject catch-all ไม่แก้ virtual host อื่น

## ติดตั้งด้วยคำสั่งเดียว

ติดตั้ง latest stable ด้วยคำสั่งเดียว:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash
```

### ระบุเวอร์ชัน

ถ้าไม่ระบุ `--version` จะใช้ latest stable ที่เผยแพร่บน GitHub หากต้องการติดตั้งรุ่นที่แน่นอน เช่น v1.1.0 ใช้คำสั่งบรรทัดเดียวนี้:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash -s -- --version v1.1.0
```

`bash -s` ให้อ่าน script จาก pipe และ `--` แยก arguments ที่ส่งให้ installer ระบุ tag แบบ `v<major>.<minor>.<patch>` เช่น `v1.1.0` ไม่ใช่ `0.8.3` เลือกเฉพาะ release ที่มี archive และ checksum เผยแพร่แล้ว หากไม่พบเวอร์ชันหรือดาวน์โหลดไม่ได้จะหยุด ไม่เปลี่ยนไปใช้ latest แทน ดูรุ่นที่มีใน [GitHub Releases](https://github.com/raptercode/dashboard-portal-control/releases)

### ต้องใส่อีเมลและข้อมูลอะไรบ้าง

รันบน server ผ่าน interactive SSH ด้วยบัญชี root หรือบัญชีที่ใช้ sudo ได้ ระบบถามข้อมูลใน terminal จึงไม่ต้องใส่อีเมลหรือ domain ใน command line:

| ข้อมูล | จำเป็นไหม | ใส่อะไร |
| --- | --- | --- |
| Portal domain | จำเป็น | เช่น `portal.example.com` โดย A/AAAA ต้องชี้ server นี้ และ host ต้อง resolve ได้ |
| TLS email | จำเป็น | อีเมลจริงที่ติดต่อได้ เช่น `admin@example.com` สำหรับ Let's Encrypt/Certbot ใช้ขอและดูแล HTTPS certificate ไม่ใช่ SMTP credential |
| sudo password | ถ้าบัญชีต้องใช้ | รหัสผ่านของบัญชี SSH สำหรับยกระดับสิทธิ์; บัญชี root ไม่ต้องใช้ sudo |
| Initial Portal password | การติดตั้งแรก | อย่างน้อย 12 ตัวอักษร ระบบถามผ่าน terminal ไม่ควรใส่รหัสผ่านใน command line |

ปล่อย TLS email ว่างไม่ได้ อีเมลนี้แยกจากอีเมลบัญชี login ซึ่งตั้งตอนสร้างบัญชีแรกในเว็บ ไม่ต้องติดตั้ง mail server เพื่อใช้อีเมลนี้ คำสั่งปกติใช้ Node 24 สำหรับ Portal ระบบอ่าน prompts ผ่าน `/dev/tty` จึงทำงานได้แม้ stdin เป็น pipe ไม่ต้องดาวน์โหลดหรือแตก release เอง

Bootstrap ดาวน์โหลด archive และ checksum ของ release จาก GitHub ผ่าน HTTPS ตรวจ SHA-256 แล้วเรียก installer จาก directory ชั่วคราว หยุดเมื่อดาวน์โหลดหรือ checksum ไม่ผ่าน การตรวจ checksum ของ bootstrap อาศัยความเชื่อถือใน HTTPS/GitHub; signed updater หลังติดตั้งตรวจ Ed25519 เพิ่มด้วย

Installer เตรียม Node major ที่เลือกพร้อมตรวจ checksum โดยไม่ติดตั้ง major ที่ไม่ได้ใช้ Runtime ของ project ที่มีอยู่ยังคงไว้ ตรวจเครื่องมือที่พร้อมจริงอีกครั้งใน Setup/Doctor และอ่าน [Node versions](node-versions.md) สำหรับ runtime และ nvm

การติดตั้งแรกถามรหัสผ่านอย่างน้อย 12 ตัวอักษรผ่าน terminal เก็บใน password manager จากนั้นตั้ง Portal ที่ `127.0.0.1:3100`, ออก certificate, บังคับ HTTPS/HSTS และตรวจ HTTPS health ก่อนรายงานสำเร็จ เปิด domain แล้วสร้างบัญชีแรก

รายละเอียดการเผยแพร่ URL bootstrap อยู่ใน [Bootstrap hosting](bootstrap-hosting.md) การเพิ่มไฟล์ใน repository ไม่ได้ทำให้ URL สาธารณะอัปเดตอัตโนมัติ

## ไฟล์และบริการที่ดูแล

| ตำแหน่ง/บริการ | หน้าที่ |
| --- | --- |
| `/opt/dashboard-portal` | Source ของ Portal, root เป็นเจ้าของ |
| `/opt/node-v<version>` | Node runtimes ที่ตรวจ checksum แล้ว |
| `/etc/dashboard-portal/dashboard-portal.env` | Config และ encryption key; root:dashboardportal, 0640 |
| `/var/lib/dashboard-portal` | SQLite state และ project workspaces |
| `/srv/hostmgr/projects` | Releases ที่ helper เตรียมสำหรับ host activation |
| `/etc/hostmgr/projects` | Config/environment ของ services โปรเจกต์ |
| `/var/backups/dashboard-portal` | Snapshot ก่อน installer เปลี่ยน managed files |
| `/etc/nginx/conf.d/strckro-realip.conf` | ให้ Nginx รายงาน IP ของผู้เยี่ยมชมเมื่ออยู่หลัง Cloudflare Proxy เขียนใหม่ทุกครั้งที่ติดตั้งและอัปเดต |
| `/etc/nginx/conf.d/strckro-limits.conf` | zone จำกัดอัตราคำขอต่อ address ที่ไซต์ Portal ใช้ เขียนทับทุกครั้งที่ติดตั้งและอัปเดต |
| `/etc/nginx/snippets/strckro-proxy.conf` | ความลับที่ Nginx ประทับบนทุกคำขอที่ proxy อ่านได้เฉพาะ root (0600) ค่าเดียวกับ `HOSTMGR_PROXY_TOKEN` ในไฟล์ environment ของ Portal |
| `dashboard-portal` | Portal ที่รันด้วย service account ไม่มีสิทธิ์ root |
| `hostmgr-deploy-helper` | Root-owned Unix-socket helper สำหรับคำสั่งที่อนุญาต |

## IP ของผู้เยี่ยมชมหลัง Cloudflare Proxy

Nginx ใช้ IP จาก `CF-Connecting-IP` เฉพาะเมื่อการเชื่อมต่อมาจากช่วง IP ที่ Cloudflare เผยแพร่ (`set_real_ip_from` โดยใช้ช่วงจาก `scripts/domain-dns.mjs`) ผู้ที่เข้า origin ตรงจึงเลือก IP ที่ Nginx บันทึกและส่งต่อเองไม่ได้ เมื่ออยู่หลัง Cloudflare Proxy ขีดจำกัดการ login ของ Portal, การรับคำเชิญ และคำขอ login ของ CLI จึงนับแยกตามผู้เยี่ยมชม และทุกโปรเจกต์ได้ IP ของผู้เยี่ยมชมใน `X-Real-IP` แทน IP ของ Cloudflare

loopback อย่างเดียวพิสูจน์ไม่ได้ว่าคำขอผ่าน Nginx เพราะทุก process บนโฮสต์ รวมถึงโปรเจกต์ที่ deploy ไว้ เปิด `127.0.0.1` แล้วส่ง `X-Real-IP` อะไรก็ได้ Nginx จึงประทับ `X-Strckro-Proxy-Token` บนทุกคำขอที่ proxy ด้วย เป็นความลับสุ่มที่ installer สร้างครั้งเดียว (คงไว้ตอนอัปเดต) เก็บใน `HOSTMGR_PROXY_TOKEN` และใน snippet ของ Nginx ที่อ่านได้เฉพาะ root ซึ่งไม่อยู่ในไฟล์ site ที่ทุกคนอ่านได้ Portal เชื่อ `X-Real-IP` เฉพาะการเชื่อมต่อ loopback ที่ส่ง token ตรงกัน ผู้เรียกในเครื่องรายอื่น และทุกคำขอเมื่อไม่มี token ที่ใช้ได้ จะใช้ bucket loopback ร่วมกันอันเดียว process ในเครื่องจึงรีเซ็ตขีดจำกัดด้วยการปลอม IP ไม่ได้ หมุนความลับได้โดยลบบรรทัด `HOSTMGR_PROXY_TOKEN` แล้วรัน `sudo strckro update` หากไม่ได้ใช้ Cloudflare Proxy IP ที่ Nginx เห็นก็เป็นผู้เยี่ยมชมอยู่แล้ว และไฟล์ real-IP ไม่เปลี่ยนอะไร ช่วง IP ของ Cloudflare มากับ release ซึ่ง Cloudflare แทบไม่เปลี่ยน และการอัปเดตจะเขียนไฟล์ใหม่ หาก Nginx ของคุณตั้ง `real_ip_header` หรือ `real_ip_recursive` ระดับ `http` ไว้แล้ว ไม่ว่าใน `nginx.conf`, `conf.d`, `sites-enabled` หรือไฟล์ที่ include มา Nginx จะปฏิเสธสำเนาที่สอง installer ให้ Nginx เป็นผู้ตัดสิน: เมื่อ `nginx -t` ล้มเหลวเพราะ directive ซ้ำเท่านั้น จะลบไฟล์ real-IP ของตัวเอง เก็บของคุณไว้ แสดงคำเตือนที่อ้างข้อความของ Nginx (ซึ่งบอกชื่อไฟล์ที่ชน) แล้วทดสอบอีกครั้ง ขีดจำกัดของ Portal จะนับ address ตามที่ config ของคุณรายงาน `real_ip_header` ที่อยู่ในบล็อก `server` ของไซต์อื่นไม่ถือว่าชน ส่วนความล้มเหลวอื่นของ `nginx -t` ยังหยุดการอัปเดตและย้อนกลับเหมือนเดิม หลัง proxy หรือ CDN ที่ไม่ใช่ Cloudflare ให้ตั้ง `real_ip_header` และ `set_real_ip_from` ของมันเอง มิฉะนั้นผู้เยี่ยมชมทุกคนจะมาจาก address ของ proxy และใช้โควตาคำขอกับโควตา login ร่วมกัน

## จำกัดอัตราคำขอและการลองรหัสผ่าน

Nginx ให้ผู้เยี่ยมชมแต่ละคนได้ 40 คำขอต่อวินาที พร้อม burst 200 (`strckro-limits.conf` กำหนด zone และไซต์ Portal เป็นผู้ใช้) ผู้เยี่ยมชม IPv4 นับตาม address ส่วนผู้เยี่ยมชม IPv6 นับทั้ง /64 เพราะผู้ใช้หนึ่งรายใช้ address ใหม่ในช่วงนั้นได้ทุกคำขอ เกินจากนั้น Nginx ตอบ HTTP 429 โดยไม่ปลุก Portal ค่านี้สูงกว่าที่คนหรือ CLI ใช้มาก หากจำเป็นต้องปรับให้แก้ในสองไฟล์ที่ Strckro ดูแล และการอัปเดตครั้งถัดไปจะเขียนทับ

ภายใน Portal ปลายทางที่ไม่ต้อง login ถูกทำให้เบาโดยโครงสร้าง คำขอที่ไม่มี credential ที่ Portal รู้จักได้คำตอบโดยไม่คัดลอกหรือเขียน state การลอง login นับต่อผู้เยี่ยมชม (5 ครั้งใน 15 นาที ผู้เยี่ยมชม IPv6 คือทั้ง /64) และต่อบัญชี (10 ครั้งใน 15 นาที รวมทุกผู้เยี่ยมชม ไม่ว่าอีเมลนั้นจะมีบัญชีหรือไม่ การเดาที่กระจายหลาย address จึงยังถูกจำกัดที่บัญชี) การลองแต่ละครั้งถูกนับตั้งแต่เริ่ม แล้วคืนให้เมื่อรหัสผ่านถูก คำขอเดาที่มาพร้อมกันจึงลอดผ่านทั้งหมดไม่ได้ และการ login สำเร็จไม่ล้างความล้มเหลวก่อนหน้าของผู้เยี่ยมชม ขีดจำกัดต่อบัญชีหมายความว่าคนแปลกหน้าที่เดาอีเมลของคุณซ้ำๆ ล็อกบัญชีได้นานสุด 15 นาที ยกเว้นผู้เยี่ยมชมที่เคย login บัญชีนั้นสำเร็จนับแต่ Portal เริ่มล่าสุด จะไม่ถูกขีดจำกัดต่อบัญชีปฏิเสธ คุณจึงยังเข้าได้จากที่ที่ login เป็นประจำ (ขีดจำกัดต่อผู้เยี่ยมชมยังใช้ และการ restart ลืมข้อยกเว้นนี้) session ที่ถืออยู่และ CLI token ยังใช้ได้ ตัวนับอยู่ในหน่วยความจำเท่านั้น การ restart Portal จึงล้างทุกตัวทันที (`sudo systemctl restart dashboard-portal` และ `sudo strckro --reset-pwd` ก็ restart ให้) ซึ่งเป็นทางกลับเข้าระบบเมื่อถูกล็อกจากเครือข่ายใหม่ นี่เป็นการแลกเปลี่ยนที่ตั้งใจ: ขีดจำกัดการเดาต่อบัญชีใช้ล็อกบัญชีนั้นได้ และเป็นราคาของการจำกัดการเดาที่กระจายหลาย address เนื่องจากการ login สำเร็จคืนเฉพาะความพยายามของตัวเอง ความล้มเหลวรวม 5 ครั้งจาก address ที่ใช้ร่วมกัน (สำนักงาน หรือ NAT ของค่ายมือถือ) จึงล็อก address นั้นตลอดช่วงเวลา ไม่ว่าใครจะเป็นคนทำ อีเมลที่ผิดก็ต้องจ่ายค่า hash รหัสผ่านหนึ่งครั้ง เวลาตอบจึงไม่บอกว่าบัญชีไหนมีอยู่ การตรวจรหัสผ่านรันบน thread pool ทีละสอง พร้อมคิวสั้นๆ (กันที่ไว้สิบหกที่สำหรับผู้เยี่ยมชมที่เป็นที่รู้จักของบัญชีนั้น) การเดารัวๆ จึงทำให้ Portal ค้างไม่ได้ เกินคิวจะถูกปฏิเสธด้วย 429 ทุก address ใน 127.0.0.0/8 ถือเป็นผู้เยี่ยมชมในเครื่องคนเดียว โปรเจกต์บนโฮสต์จึงขอโควตาใหม่ด้วยการ bind loopback address อื่นไม่ได้ การ login ที่ล้มเหลวเขียน audit ได้ไม่เกินหนึ่งรายการต่อวินาที และรายการถัดไปบอกว่ามีอีกกี่ครั้ง ตอน bootstrap ครั้งแรก รหัสผ่านของ installer ที่ผิดนับต่อผู้เยี่ยมชม (5) และรวมทั้งหมด (200) ในช่วงเวลาเดียวกัน การ poll CLI login จำกัดต่อผู้เยี่ยมชม

## การจำกัดวงของโปรเจกต์ที่ deploy

โปรเจกต์เป็นโค้ดที่ Portal ไม่ได้เขียน unit systemd จึงเพิ่มข้อจำกัดนอกเหนือจากการรันเป็น user ของตัวเองด้วย `NoNewPrivileges`, `PrivateTmp`, `ProtectHome` และ `ProtectSystem=strict`: `MemoryMax=85%` กับ `TasksMax=4096` เก็บโปรเจกต์ที่รันหลุดหรือประสงค์ร้ายไว้ใน control group ของตัวเองแทนที่จะแย่งทรัพยากรจาก Portal และโปรเจกต์อื่น ส่วน `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectKernelLogs`, `ProtectControlGroups`, `LockPersonality`, `RestrictSUIDSGID` และ `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK` ปิดช่องทางเคอร์เนลที่แอปไม่ต้องใช้ ไม่ได้เพิ่มการแยกเครือข่ายโดยตั้งใจ เพราะ Nginx คุยกับโปรเจกต์ผ่าน loopback และแอปบน cloud อาจต้องใช้ metadata service โปรเจกต์ที่ต้องการหน่วยความจำหรือ task มากกว่านี้ตั้งค่าเฉพาะตัวได้ใน systemd drop-in (`sudo systemctl edit hostmgr-project-<slug>`) ซึ่งอยู่รอดข้าม deploy ต่างจากการแก้ไฟล์ unit โดยตรง โปรเจกต์ที่มีอยู่จะได้ข้อจำกัดเหล่านี้เมื่อ deploy ครั้งถัดไป

## ตรวจหลังติดตั้งหรืออัปเดต

```bash
sudo systemctl is-active dashboard-portal hostmgr-deploy-helper nginx
sudo nginx -t
curl -fsS https://portal.example.com/api/health
curl -fsSI https://portal.example.com/
```

ตรวจทั้ง API และหน้าเว็บ/static assets แล้ว login ทดสอบสร้าง project, environment, deploy, health และ rollback บน host จริง ตรวจ persistence หลัง reboot ในช่วงเวลาที่อนุญาตให้หยุดบริการ การทดสอบ local หรือ container ไม่ยืนยัน systemd, TLS และสิทธิ์ไฟล์บนเครื่องจริง

ก่อน deploy แอป ให้เพิ่มโดเมนใน Project และตรวจ DNS/HTTP-01 เช่นเดียวกับ Portal แอป Docker Compose ต้องมี Docker Engine + Compose จาก Setup และใช้ repository ที่เชื่อถือ Helper ตรวจ privileged mode, host namespaces และ host bind mounts แต่ไม่ได้ให้ sandbox สำหรับ untrusted code

## สำรองข้อมูลและกู้คืน

เก็บ backup แบบเข้ารหัสและจำกัดสิทธิ์ โดยสำรอง **ทั้งสองส่วนพร้อมกัน**:

1. `/etc/dashboard-portal/dashboard-portal.env` ซึ่งมี `HOSTMGR_SECRET_KEY`
2. `/var/lib/dashboard-portal` ซึ่งมี state และ workspaces

ห้ามสร้าง encryption key ใหม่แทน key เดิมเมื่อมี encrypted credentials/environment แล้ว สำรองไฟล์ SQLite ให้เป็นชุดที่สอดคล้องกัน: ใช้ SQLite backup หรือหยุดบริการที่เขียน state ระหว่างทำ snapshot ตามแผน downtime ของคุณ อย่าคัดลอกเฉพาะ `.sqlite` ระหว่างที่ WAL ยังเปลี่ยนอยู่

แอปที่ deploy แล้วอาจมีข้อมูลเพิ่มเติมใต้ `/srv/hostmgr/projects`, `/etc/hostmgr/projects`, Docker volumes หรือ external database ต้องสำรองตามระบบนั้นด้วย รวมถึง Nginx และ `/etc/letsencrypt` เมื่อต้องการกู้ host ทั้งเครื่อง

Snapshot ของ installer เก็บ managed config/service/application และ SQLite state ขนาดเล็ก แต่ **ไม่ใช่ backup เต็ม**: ไม่รวม project workspaces, release directories, dependencies และ caches การ rollback installer ไม่ถอน apt packages หรือ certificate ที่ออกแล้ว

ทดสอบ restore บน staging ก่อนพึ่งพา backup: คืน state พร้อม key เดิม ตรวจ ownership/permissions, เริ่ม services, ตรวจ login/ข้อมูล/การอ่าน encrypted values และทดสอบแอป

## อัปเดตผ่าน SSH

```bash
sudo strckro update --check
sudo strckro update
sudo strckro update --check
```

Updater ตรวจ signed manifest และ SHA-256 แล้วใช้ installer ตามขั้นตอนปกติ พร้อมคง Node major จาก config หน้าเว็บตรวจและแจ้งเวอร์ชันได้ แต่ไม่สั่งอัปเดต Portal หลังอัปเดตให้ทำ health/static checks ด้านบนและตรวจ project เดิม

การรองรับ Node 20 ใช้ SQLite driver อีกตัวที่อ่านไฟล์/schema เดิม ไม่ต้องแปลง DB เพื่อสลับ driver อย่างไรก็ตามควรมี backup ก่อนอัปเดตและทดสอบกับข้อมูล staging ของคุณ

Stable feed ตั้งอัตโนมัติเป็น [latest stable manifest](https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json) ใช้ `configure-update` เฉพาะ custom feed:

```bash
sudo strckro configure-update \
  --manifest=https://releases.example.com/dashboard-portal/stable.json \
  --public-key=/secure/download/dashboard-portal-update-public.pem
```

### เครื่องเก่าที่ใช้ signing key ก่อน v0.7.0

หากตรวจพบว่า installed public key เป็นรุ่นเก่าจริง ให้ยืนยัน fingerprint นี้จาก release ที่เชื่อถือก่อนเปลี่ยน key อย่าเปลี่ยน key เพียงเพื่อข้าม signature error:

```bash
tmp="$(mktemp)"
curl -fsSL \
  https://raw.githubusercontent.com/raptercode/dashboard-portal-control/v0.7.0/scripts/dashboard-portal-update-public.pem \
  -o "$tmp"
printf '%s  %s\n' \
  e8435cb6c3763930158b458821021e89a4b92041c7c71b493e414fb8d70af715 "$tmp" |
  sha256sum -c - &&
  sudo install -m 0644 -o root -g root "$tmp" /etc/dashboard-portal/update-public-key.pem
rm -f "$tmp"
```

## แก้ปัญหาเบื้องต้น

```bash
sudo journalctl -u dashboard-portal -u hostmgr-deploy-helper --since '30 minutes ago' --no-pager
sudo nginx -t
getent ahosts portal.example.com
```

- **DNS/TLS ไม่ผ่าน:** ตรวจจาก host, A/AAAA, port 80 และ CDN redirect แล้วแก้เหตุให้ชัดก่อน retry
- **API ผ่านแต่หน้าเว็บ 500:** ตรวจสิทธิ์อ่าน/traverse ของ application root และ static assets
- **Node 20 dependency ไม่พร้อม:** อ่านขั้น staging dependency install; ตรวจ network และ compiler prerequisite ก่อน retry
- **Signature/checksum ไม่ผ่าน:** หยุดและตรวจแหล่ง release, asset และ public key
- **ลืมรหัสผ่าน:** ใช้ `sudo strckro --reset-pwd` ผ่าน SSH คำสั่งแสดงรหัสใหม่ครั้งเดียวและยกเลิก sessions เดิม

อย่าเปิด port 3100 สู่สาธารณะเพื่อข้ามปัญหา HTTPS เก็บ logs โดยปิดบัง secrets ก่อนส่งให้ผู้อื่น

ผู้ดูแล repository ที่ต้องการสร้าง release: [Release guide](../../en/how-to/releasing-and-ai-handoff.md)
