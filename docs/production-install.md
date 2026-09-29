# ติดตั้ง Dashboard Portal บน Ubuntu

คู่มือนี้ใช้กับ **Ubuntu Server 24.04 หรือ 25.04, amd64** ที่ผ่านเงื่อนไข installer การติดตั้งจริงใช้ systemd และ Nginx; Docker Compose ใน repository ใช้ทดลองบนเครื่องพัฒนา

## เตรียมเครื่อง

- มีสิทธิ์ sudo และโดเมน เช่น `portal.example.com`
- ตั้ง A/AAAA ให้ถูกต้อง แล้วตรวจจาก host ด้วย `getent ahosts portal.example.com`
- เปิด TCP 80 และ 443; Let's Encrypt ใช้ HTTP-01 challenge
- หากใช้ CDN ให้ใช้ DNS only ระหว่างออก certificate ครั้งแรก ตรวจ origin HTTPS ให้ผ่านก่อนเปิด proxy แบบ Full (strict)
- พอร์ต loopback 3100 ต้องว่าง และมีพื้นที่สำหรับ Node ทั้งสี่เวอร์ชัน, Bun, source และ backup
- สำรอง Nginx และบริการเดิมก่อนเริ่ม ใช้ staging host สำหรับทดสอบการติดตั้งครั้งแรก

Installer จัดการไฟล์ Nginx ของ Portal และ managed projects รวมถึงแทนที่ symlink ของ Ubuntu default site เมื่อยังชี้ default เดิม เพื่อใช้ reject catch-all ไม่แก้ virtual host อื่น

## ดาวน์โหลด release

ตัวอย่างนี้เลือก v0.8.3 ชัดเจน ตรวจ release ที่ต้องการจาก [GitHub Releases](https://github.com/raptercode/dashboard-portal-control/releases) ก่อนใช้งาน:

```bash
REPO=raptercode/dashboard-portal-control
TAG=v0.8.3
VERSION=${TAG#v}
mkdir "dashboard-portal-${VERSION}"
cd "dashboard-portal-${VERSION}"
curl -fSLO "https://github.com/${REPO}/releases/download/${TAG}/dashboard-portal-${VERSION}.tar.gz"
curl -fSLO "https://github.com/${REPO}/releases/download/${TAG}/dashboard-portal-${VERSION}.tar.gz.sha256"
sha256sum --check "dashboard-portal-${VERSION}.tar.gz.sha256"
tar --extract --gzip --file "dashboard-portal-${VERSION}.tar.gz"
```

หยุดหากดาวน์โหลดหรือ checksum ไม่ผ่าน Archive ไม่มีโฟลเดอร์ครอบ จึงต้องแตกใน directory เฉพาะ Checksum ตรวจความสมบูรณ์ของไฟล์ที่ดาวน์โหลดจาก release ที่เชื่อถือ ส่วนการอัปเดตผ่าน CLI จะตรวจลายเซ็นด้วย public key ที่ติดตั้งไว้ด้วย

## ติดตั้ง

```bash
sudo bash ./dashboard-portal.sh \
  --domain=portal.example.com \
  --email=admin@example.com \
  --node-major=24
```

`--domain` และ `--email` จำเป็น ส่วน `--node-major` เลือก 20/22/24/26 และ default เป็น 24 Installer ติดตั้ง Node ทั้งสี่ major โดยตรวจ SHA-256 รวมถึง Bun, Nginx, Certbot และ Git หากเลือก Portal บน Node 20 จะเตรียม native SQLite dependency ใน staging ก่อนสลับแอป อ่าน [Node versions](node-versions.md) สำหรับเวอร์ชันที่ pin และวิธีใช้ nvm

การติดตั้งแรกจะถามรหัสผ่าน ใช้อย่างน้อย 12 ตัวอักษร เก็บใน password manager และอย่าใส่รหัสผ่านใน command line จากนั้น installer จะตั้ง Portal ที่ `127.0.0.1:3100`, ออก certificate, บังคับ HTTPS/HSTS และตรวจ HTTPS health ก่อนรายงานสำเร็จ เปิดโดเมนเพื่อทำขั้นตอนสร้างบัญชีแรก

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

ผู้ดูแล repository ที่ต้องการสร้าง release: [Release guide](releasing-and-ai-handoff.md)