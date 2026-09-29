# Deploy Python ด้วย venv ของแต่ละ release

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../en/how-to/python-projects.md)


เลือก Python ใน Runtime ระบบตรวจ `requirements.txt`, `pyproject.toml` หรือ `main.py` อัตโนมัติ แต่ Compose/Go มีลำดับก่อน ตรวจ entry point ก่อนใช้งาน

แต่ละ release มี `/srv/hostmgr/projects/<slug>/releases/<release-id>/.venv` Installer ลง Ubuntu `python3` และ `python3-venv` Helper ลดสิทธิ์เป็น Unix uid/gid ของ project ก่อนสร้าง venv, pip, build backend และ interpreter checks โดยปฏิเสธ uid/gid zero ไม่มี sudo pip, global/user pip, system-site-packages หรือ break-system-packages

## เลือกตัวเริ่มแอป

| Run type | Entry point | Dependencies |
| --- | --- | --- |
| Script | `main.py`, `src/server.py` | Packages ของ script |
| ASGI | `app.main:app` | uvicorn และ framework |
| WSGI | `app:app`, `project.wsgi:application` | gunicorn และ framework |

Script ใช้ `.venv/bin/python -E -s -u <entry>` และอ่าน `PORT`/`HOST` จาก environment ส่วน ASGI/WSGI ใช้ interpreter ของ venv พร้อม loopback/port arguments คงที่ ไม่รับ shell string หรือ activation script และไม่ใช้ ambient Python paths/user-site

Dependency source เลือก Requirements (เช่น `requirements/production.txt`), Install project (`pip install .` จาก installable `pyproject.toml`) หรือ No dependencies สำหรับ standard-library script Pin versions ใน repository ระบบรัน `pip check` หลังติดตั้ง Private indexes, native OS libraries, Poetry/uv-specific lock installers และ migration/pre-start commands ยังไม่อยู่ใน runtime นี้ ใช้ Docker Compose สำหรับ custom OS environment

## Deployment และ rollback

Portal คัดลอก source/ENV โดยไม่เอา repository venv/cache/readiness markers Host helper วาง source ที่ final release path และตั้ง ownership ก่อนสร้าง venv เพื่อไม่ทำ absolute console-script shebangs เสีย การติดตั้งเกิดก่อนเปลี่ยน active symlink จากนั้น systemd ใช้ user เดียวกันเริ่มแอปและตรวจ HTTP

หาก start/health/TLS ล้มเหลว คืน symlink, unit และ environment เดิม Release เก่าเก็บ venv ของตัวเองและ rollback ได้โดยไม่ดาวน์โหลดใหม่ Entry settings snapshot ในแต่ละ release ไม่ใช้ค่าที่แก้ภายหลัง Host ที่ไม่มี helper หยุดที่ source preflight ไม่อ้าง HTTP success ส่วน demo จำลอง deployment ตาม runtime อื่น

Host เดิมต้อง update installer ที่มี Python support Setup เห็น Python พร้อมเมื่อทั้ง interpreter กับ venv module ใช้งานได้ Tool card ไม่ติดตั้ง packages ให้เอง

## ตรวจสอบ

`node --test test/python-project.test.mjs` ใช้ offline wheel ตรวจ venv จริง, dependency isolation, HTTP, rollback reuse และ failed release Linux ใช้ nonzero uid/gid ตั้ง `HOSTMGR_PYTHON_PATH` ได้สำหรับ interpreter บนเครื่องพัฒนา ส่วน production ใช้ `/usr/bin/python3` ผล local ไม่แทน systemd/Nginx/TLS acceptance

อ้างอิง [venv](https://docs.python.org/3/library/venv.html), [pip](https://pip.pypa.io/en/stable/cli/pip_install/), [Uvicorn](https://uvicorn.dev/settings/), [Gunicorn](https://gunicorn.org/quickstart/)
