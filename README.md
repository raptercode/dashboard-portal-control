# Dashboard Portal

แดชบอร์ดสำหรับจัดการแอปบน Linux server ของคุณ: เชื่อม Git, deploy, ดู logs, ผูกโดเมนและออก TLS certificate ผ่านหน้าเว็บ พร้อมแยกสมาชิกและสิทธิ์ตามองค์กร

[ดาวน์โหลด release](https://github.com/raptercode/dashboard-portal-control/releases/latest) · [ติดตั้งบน Ubuntu](docs/production-install.md) · [เลือกเวอร์ชัน Node.js](docs/node-versions.md) · [บันทึกการเปลี่ยนแปลง](CHANGELOG.md)

## ทำอะไรได้บ้าง

- Deploy แอป **Node.js, Bun, Go, Python, PHP และ Docker Compose** จาก repository ที่คุณเชื่อถือ
- เลือก Node.js **20, 22, 24 หรือ 26** แยกต่อแอป และเลือกเวอร์ชันที่ใช้รัน Portal ได้
- Sync source, ตั้งค่า environment, build, health check, activate และ rollback release
- จัดการโดเมน, Nginx และ Let's Encrypt ผ่าน helper ที่จำกัดคำสั่ง
- ดูสถานะเครื่อง, logs และประวัติการทำงาน พร้อมตั้ง auto deploy และ notification hooks
- จัดการ Master/User, องค์กร, คำเชิญ และสิทธิ์ของสมาชิก
- เก็บ repository credentials และ environment แบบเข้ารหัส พร้อมรับอัปเดต Portal ที่ตรวจลายเซ็นได้

**ขอบเขต:** Portal จัดการหนึ่งเครื่องและใช้กับ source ที่คุณเชื่อถือ การ build/start แอปคือการรันโค้ดจาก repository; ระบบนี้ไม่ได้เป็น sandbox สำหรับรับโค้ดจากบุคคลทั่วไป สิทธิ์องค์กรควบคุมการเข้าถึงใน Portal แต่ไม่ได้แยกเครื่องให้แต่ละองค์กร

## เริ่มทดลองบนเครื่องตัวเอง

ต้องมี Git และ Node.js ตามช่วงที่ระบุใน [package.json](package.json) แนะนำ Node 24 สำหรับเริ่มต้น

```bash
git clone https://github.com/raptercode/dashboard-portal-control.git
cd dashboard-portal-control
cp .env.example .env
```

บน PowerShell ใช้ `Copy-Item .env.example .env` แล้วแก้ไฟล์:

- `HOSTMGR_ADMIN_PASSWORD`: รหัสผ่านเฉพาะสำหรับการทดลอง
- `HOSTMGR_SECRET_KEY`: key ขนาด 32 bytes แบบ Base64 สร้างได้ด้วยคำสั่งด้านล่าง เก็บ key เดิมไว้เมื่อมีข้อมูลแล้ว

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npm ci
npm run demo
```

เปิด **http://localhost:3000** แล้วทำขั้นตอนตั้งค่าบัญชีแรก หน้าเว็บ local ใช้ HTTP ได้เพราะ `.env.example` ตั้ง demo mode และปิด secure cookie ไว้ อย่าใช้การตั้งค่านี้เปิด login สู่สาธารณะ

Node 20 ใช้ native dependency `better-sqlite3`; หากเครื่องไม่มี prebuilt binary ที่ตรงกัน ต้องมีเครื่องมือ compile C/C++ และ Python ส่วน Node 22.13+ ใช้ `node:sqlite` ในตัว อ่าน [วิธีสลับ Node ด้วย nvm](docs/node-versions.md#ติดตั้งหลายเวอร์ชันด้วย-nvm)

### ทดลองด้วย Docker Compose

เมื่อเตรียม `.env` แล้ว:

```bash
docker compose up --build
```

เปิด **http://localhost** โดย Compose เก็บ state ใน named volume ตัว image มี Node ตาม build argument (ค่าเริ่มต้น 24) และไม่ได้ติดตั้ง runtime ทุกชนิด การ clone/build repository สามารถรันโค้ดจริงได้; host activation, systemd และ TLS ต้องทดสอบบน Ubuntu จริง

## ติดตั้งใช้งานบน Ubuntu

ตัว installer รองรับ **Ubuntu 24.04 หรือ 25.04, amd64** ต้องมีโดเมนที่ resolve มายังเครื่อง และเปิด TCP 80/443 สำหรับ HTTPS

ดาวน์โหลดและตรวจ checksum ของ release ตาม [คู่มือติดตั้ง](docs/production-install.md) แล้วรันจากโฟลเดอร์ที่แตก archive:

```bash
sudo bash ./dashboard-portal.sh \
  --domain=portal.example.com \
  --email=admin@example.com \
  --node-major=24
```

Installer ติดตั้ง Nginx, Certbot, Git, Bun และ Node ทั้งสี่ major แบบตรวจ SHA-256 จากนั้นตั้ง Portal ที่ `127.0.0.1:3100` หลัง Nginx พร้อม HTTPS ค่า `--node-major` เลือก Node ของ Portal; แอปแต่ละตัวเลือกแยกกันได้

Runtime/เครื่องมือเสริม เช่น Go, Python, PHP และ Docker ต้องตรวจความพร้อมใน **Setup/Doctor** ก่อน deploy ดูรายละเอียดของแต่ละ runtime ในเอกสารด้านล่าง

## Deploy แอปแรก

1. สร้างองค์กร/สมาชิกตามต้องการ แล้วเพิ่ม repository credential หากใช้ private repository
2. เพิ่ม Project ด้วย repository URL และ branch เลือก runtime และ Node major สำหรับแอป Node.js
3. ตั้งชื่อ build/start script, working directory และ health check ให้ตรงกับแอป แล้ว sync source
4. ใส่ environment ผ่านหน้า Environment และเพิ่มโดเมนที่ DNS ชี้มาที่เครื่อง
5. สร้าง release ตรวจผล build/health check แล้ว activate ตรวจ HTTPS และ logs หลัง deploy

Node projects ใช้ `npm ci` เมื่อ lockfile ใช้งานได้; หากไม่มีหรือไม่เข้ากัน candidate จะ fallback เป็น `npm install` โดยไม่แก้ checkout ที่ sync มา แอปต้องฟังพอร์ตที่ Portal กำหนดให้ผ่าน environment และตอบ health endpoint ตามที่ตั้งไว้

ค่า environment ถูกเข้ารหัสในฐานข้อมูล ผู้มีสิทธิ์ `env.read` สามารถอ่านค่าจริงได้ และ `env.write` ใช้แก้ไขได้ การแก้ environment หรือ Node major มีผลเมื่อสร้าง deployment ใหม่ Release เก็บ Node major เพื่อใช้ซ้ำตอน rollback

คู่มือเพิ่มเติม: [สิทธิ์สมาชิก](docs/access-control.md), [auto deploy](docs/project-auto-deploy.md), [Go](docs/go-projects.md), [Python](docs/python-projects.md), [วิเคราะห์ deployment ที่ล้มเหลว](docs/context/deployment-diagnostics-and-health-checks.md)

## อัปเดต Portal

หน้าเว็บแจ้งอัปเดตได้ ผู้ดูแลใช้ SSH บน host เพื่ออัปเดต:

```bash
sudo dashboard-portal update --check
sudo dashboard-portal update
sudo systemctl is-active dashboard-portal hostmgr-deploy-helper nginx
curl -fsS https://portal.example.com/api/health
curl -fsSI https://portal.example.com/
```

Updater ตรวจ Ed25519 signature และ SHA-256 ก่อนติดตั้ง และคง Node major ของ Portal ตาม config เดิม ฐานข้อมูลยังเป็น SQLite ไฟล์เดิม การรองรับ Node 20 ไม่ต้องแปลงข้อมูล แต่ควรสำรอง **state พร้อม encryption key** ก่อนอัปเดต ดู [การสำรองและกู้คืน](docs/production-install.md#สำรองข้อมูลและกู้คืน)

## พัฒนาและทดสอบ

```bash
npm ci
npm test
node scripts/test-modules.mjs --list
bash -n dashboard-portal.sh
```

บน Windows ใช้ Git Bash สำหรับตรวจ shell script ผล unit/API tests บนเครื่องพัฒนาไม่ยืนยัน apt, systemd, Nginx, TLS หรือสิทธิ์ไฟล์บน Ubuntu ดู [แผนทดสอบ](docs/testing.md)

## เอกสาร

| หัวข้อ | เอกสาร |
| --- | --- |
| ติดตั้ง อัปเดต สำรอง และแก้ปัญหา | [Production installation](docs/production-install.md) |
| Node ของ Portal/แอป และ nvm | [Node.js versions](docs/node-versions.md) |
| สมาชิก องค์กร และสิทธิ์ | [Access control](docs/access-control.md) |
| สถาปัตยกรรมปัจจุบัน | [Architecture](docs/context/architecture.md) |
| ขอบเขตฟีเจอร์และแผนงาน | [Scope and roadmap](docs/context/scope-and-roadmap.md) |
| เหตุผลการตัดสินใจ | [Architecture Decision Records](docs/adr/README.md) |
| คำศัพท์ | [Glossary](docs/glossary.md) |
| ทดสอบและเผยแพร่ signed release | [Testing](docs/testing.md) · [Release guide](docs/releasing-and-ai-handoff.md) |

## License

โค้ดของโปรเจกต์ใช้ **[MIT License](LICENSE)** Dependencies และ [runtime logos](public/ui/runtime-logos/SOURCES.md) อยู่ภายใต้เงื่อนไขและสิทธิ์ของเจ้าของแต่ละรายการ