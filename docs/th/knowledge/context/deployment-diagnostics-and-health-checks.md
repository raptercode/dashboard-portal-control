# Diagnostics และ health checks ของ deployment

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/context/deployment-diagnostics-and-health-checks.md)


ดู release log ก่อน Runtime logs อ่านจาก helper เฉพาะ systemd unit ของ project ใน demo แสดง placeholder การ Released บอกว่า process ทำงาน แต่ไม่ยืนยัน Nginx/domain routing ถูกต้อง

## Candidate และ edge

ดู stage ของ source/dependencies/build/start/health/activation แยกกัน Health path ต้องเป็น HTTP endpoint ของแอป หากเลือก skip จะเป็น `skipped` และไม่ได้ยืนยัน readiness แอปที่มี managed domain ยังต้องผ่าน upstream/edge checks

หลัง Nginx reload retry upstream ทุก 500 ms ใน window 30 วินาที Probe ที่เริ่มแล้วอาจจบหลัง window Structural Nginx failure หยุดทันที Timeout เก็บ attempts, elapsed, upstream port/path และ failed checks ทั้ง service-start และ edge failure เก็บ candidate runtime logs ก่อน rollback พร้อม redact secrets และจำกัด UI 48 KiB Candidate ที่ล้มเหลวไม่แทน active release

## Host boundary

Root helper ใช้ typed Unix socket requests สร้าง project account/unit/environment, managed Nginx, ACME และ runtime ภายใต้ `ProtectSystem=full` และ paths ที่จำเป็น `ReadWritePaths=/etc` กว้างๆ ไม่ลบ protected mount บน systemd ที่รองรับ ห้ามส่ง raw journal ที่มี ENV กลับ UI

```bash
sudo journalctl -u hostmgr-deploy-helper -n 100 --no-pager
sudo nginx -t
```

Domains dialog ตรวจ managed file, enabled symlink, `nginx -T` server_name/proxy_pass, loopback Host-header HTTP และ application port หน้า Ubuntu default บอกว่า request ไป default_server

## หลัง update

ต้อง daemon-reload และ restart helper/Portal `enable --now` ไม่ restart process ที่ active อยู่ ตรวจ PID/start timestamp, `/api/health` และ static page ด้วย เพราะ API อาจ healthy แต่ permissions ทำหน้าเว็บ 500 ดู [ติดตั้งและตรวจ host](../../how-to/production-install.md)
