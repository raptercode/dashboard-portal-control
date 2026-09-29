# ติดตั้ง Dashboard Portal บน Ubuntu

[English](../../en/how-to/production-install.md)


คู่มือนี้ใช้กับ **Ubuntu Server 24.04 หรือ 25.04, amd64** ที่ผ่านเงื่อนไข installer การติดตั้งจริงใช้ systemd และ Nginx; Docker Compose ใน repository ใช้ทดลองบนเครื่องพัฒนา

## เตรียมเครื่อง

- มีสิทธิ์ sudo และโดเมน เช่น `portal.example.com`
- ตั้ง A/AAAA ให้ถูกต้อง แล้วตรวจจาก host ด้วย `getent ahosts portal.example.com`
- เปิด TCP 80 และ 443; Let's Encrypt ใช้ HTTP-01 challenge
- หากใช้ CDN ให้ใช้ DNS only ระหว่างออก certificate ครั้งแรก ตรวจ origin HTTPS ให้ผ่านก่อนเปิด proxy แบบ Full (strict)
- พอร์ต loopback 3100 ต้องว่าง และมีพื้นที่สำหรับ Node ทั้งสี่เวอร์ชัน, Bun, source และ backup
- สำรอง Nginx และบริการเดิมก่อนเริ่ม ใช้ staging host สำหรับทดสอบการติดตั้งครั้งแรก

Installer จัดการไฟล์ Nginx ของ Portal และ managed projects รวมถึงแทนที่ symlink ของ Ubuntu default site เมื่อยังชี้ default เดิม เพื่อใช้ reject catch-all ไม่แก้ virtual host อื่น

## ติดตั้งด้วยคำสั่งเดียว

ติดตั้ง latest stable ด้วยคำสั่งเดียว:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash
```

### ระบุเวอร์ชัน

ถ้าไม่ระบุ `--version` จะใช้ latest stable ที่เผยแพร่บน GitHub หากต้องการติดตั้งรุ่นที่แน่นอน เช่น v0.8.3 ใช้คำสั่งบรรทัดเดียวนี้:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash -s -- --version v0.8.3
```

`bash -s` ให้อ่าน script จาก pipe และ `--` แยก arguments ที่ส่งให้ installer ระบุ tag แบบ `v<major>.<minor>.<patch>` เช่น `v0.8.3` ไม่ใช่ `0.8.3` เลือกเฉพาะ release ที่มี archive และ checksum เผยแพร่แล้ว หากไม่พบเวอร์ชันหรือดาวน์โหลดไม่ได้จะหยุด ไม่เปลี่ยนไปใช้ latest แทน ดูรุ่นที่มีใน [GitHub Releases](https://github.com/raptercode/dashboard-portal-control/releases)

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

ติดตั้ง Node ทั้งสี่ major ที่ pin และ Bun, Go, Python/venv, Nginx, Certbot, Git ตาม installer ตรวจเครื่องมือที่พร้อมจริงอีกครั้งใน Setup/Doctor และอ่าน [Node versions](node-versions.md) สำหรับ runtime และ nvm

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
| `dashboard-portal` | Portal ที่รันด้วย service account ไม่มีสิทธิ์ root |
| `hostmgr-deploy-helper` | Root-owned Unix-socket helper สำหรับคำสั่งที่อนุญาต |

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
sudo dashboard-portal update --check
sudo dashboard-portal update
sudo dashboard-portal update --check
```

Updater ตรวจ signed manifest และ SHA-256 แล้วใช้ installer ตามขั้นตอนปกติ พร้อมคง Node major จาก config หน้าเว็บตรวจและแจ้งเวอร์ชันได้ แต่ไม่สั่งอัปเดต Portal หลังอัปเดตให้ทำ health/static checks ด้านบนและตรวจ project เดิม

การรองรับ Node 20 ใช้ SQLite driver อีกตัวที่อ่านไฟล์/schema เดิม ไม่ต้องแปลง DB เพื่อสลับ driver อย่างไรก็ตามควรมี backup ก่อนอัปเดตและทดสอบกับข้อมูล staging ของคุณ

Stable feed ตั้งอัตโนมัติเป็น [latest stable manifest](https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json) ใช้ `configure-update` เฉพาะ custom feed:

```bash
sudo dashboard-portal configure-update \
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
- **ลืมรหัสผ่าน:** ใช้ `sudo dashboard-portal --reset-pwd` ผ่าน SSH คำสั่งแสดงรหัสใหม่ครั้งเดียวและยกเลิก sessions เดิม

อย่าเปิด port 3100 สู่สาธารณะเพื่อข้ามปัญหา HTTPS เก็บ logs โดยปิดบัง secrets ก่อนส่งให้ผู้อื่น

ผู้ดูแล repository ที่ต้องการสร้าง release: [Release guide](../../en/how-to/releasing-and-ai-handoff.md)
