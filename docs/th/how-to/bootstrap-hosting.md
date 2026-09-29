# เผยแพร่ bootstrap URL

[English](../../en/how-to/bootstrap-hosting.md)


ไฟล์ [install.sh](../../../install.sh) ต้องถูกเสิร์ฟเป็น `https://dashboard-portal.cloud/install.sh` ด้วย HTTP 200, HTTPS และ script body จริง (ไม่ใช่ HTML, auth page หรือ redirect ไป raw source ที่เปลี่ยนตลอด) ตั้ง Content-Type เป็น text/plain หรือ application/x-sh ตรวจ LF และ `bash -n` ก่อน publish ใช้ source จาก commit ที่ผ่าน tests แล้ว อย่าเปลี่ยนสาม release assets เดิมเพื่อเพิ่ม bootstrap

## ตรวจหลัง publish

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh -o /tmp/dashboard-portal-install.sh
bash -n /tmp/dashboard-portal-install.sh
sha256sum /tmp/dashboard-portal-install.sh
```

เทียบ SHA-256 กับไฟล์จาก release commit แล้วรันคำสั่งใน [คู่มือติดตั้ง](production-install.md) บน clean staging Ubuntu ผ่าน interactive SSH ตรวจ pinned v0.8.3, latest resolution, prompts/sudo, checksum failure, services/HTTPS และ temporary cleanup

การ commit เอกสารหรือ installer ไม่ publish domain โดยอัตโนมัติ และ v0.8.3 archive ที่เผยแพร่ก่อนมี bootstrap ยังเรียก internal installer ได้ ไม่ต้องแทน assets ใต้ tag เดิม เรื่อง OS ใหม่ยังเป็น [แผน](../knowledge/plans/ubuntu-compatibility-plan.md)
