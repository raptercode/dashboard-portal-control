# Git, signed release และส่งต่องาน

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../en/how-to/releasing-and-ai-handoff.md)


คู่มือนี้ใช้เผยแพร่ Dashboard Portal การ deploy project และการ update production host เป็นคนละงาน

## ข้อตกลง

Repository คือ [raptercode/dashboard-portal-control](https://github.com/raptercode/dashboard-portal-control) Stable feed คือ latest/download/stable.json ทุก release มี archive `dashboard-portal-<VERSION>.tar.gz`, `.sha256` และ signed `stable.json` รวมสาม assets ใช้เวอร์ชันเพิ่มขึ้นและห้ามแทน asset ใต้ tag เดิม สร้างจาก clean committed tagged checkout และเก็บ private signing key/token นอก Git, archive, logs และ arguments Host รับเฉพาะ public key `package.json` เป็น private ไม่ publish npm

## 1. ตรวจและเตรียม

```powershell
git status --short
git remote -v
git branch --show-current
git log -1 --oneline
git fetch origin
gh release list --repo raptercode/dashboard-portal-control --limit 5
```

ตรวจ integration branch จริง (เดิม master) remote HEAD และเวอร์ชันที่ publish แล้ว Stage เฉพาะงานที่ต้องการ ใช้ patch สำหรับ compatible change และอัปเดต package/lock/changelog ให้ตรงกัน การเปลี่ยน architecture/security ที่มีผลควรมี ADR พร้อมปรับ context เก็บ boundary ของ Portal/helper, managed Nginx และ encrypted secrets

## 2. Validate

```powershell
npm ci
npm test
bash -n install.sh dashboard-portal.sh
git diff --check
```

ใช้ Git Bash บน Windows ตรวจ driver/runtime ที่ได้รับผล ดู installer/updater/helper diff และ behavioral tests ตรวจ links, versions, staged files และ secrets บันทึกข้อจำกัด Ubuntu/browser acceptance แยกจาก local tests

## 3. Commit, tag และ push

```powershell
$version = node -p "require('./package.json').version"
$branch = git branch --show-current
git diff --cached --stat
git commit -m "release: v$version"
git tag -a "v$version" -m "Dashboard Portal v$version"
git push origin $branch
git push origin "v$version"
```

สร้าง artifact จาก clean checkout ของ tag ตรวจ package/lock/tag ตรงกันและไม่มี untracked/modified files อย่ารวมงานอื่นเพื่อทำให้ status สะอาด

## 4. Sign นอก repository

ใช้ Ed25519 key เดิมใต้ `$HOME/.dashboard-portal/release-signing` ตรวจ derived public key ตรงกับ `scripts/dashboard-portal-update-public.pem` ห้ามแสดง private key หรือสร้างใหม่สำหรับ release ธรรมดา ตั้ง `DASHBOARD_PORTAL_UPDATE_PRIVATE_KEY_PATH` แบบ process-local แล้วเรียก `npm run release:prepare -- --out=<outside-repo> --archive-url=https://github.com/raptercode/dashboard-portal-control/releases/download/v<VERSION>/dashboard-portal-<VERSION>.tar.gz --notes=<description>` ลบ environment variable ใน finally

Script ใช้ `git archive HEAD` รักษา LF ของ shell scripts ตรวจ `parseSignedManifest`, nested `payload` version/channel/archiveUrl/archiveSha256 และ checksum จริง ตรวจ archive มี source, lock, LICENSE, docs, installers แต่ไม่มี .env, state, dependencies หรือ key ห้ามแก้ signed manifest ด้วยมือ

## 5. Publish และตรวจ downloaded assets

ใช้ `gh release create` พร้อมทั้งสาม assets, `--verify-tag`, title และ `--notes-file` ที่อยู่นอก checkout จากนั้นดู release ดาวน์โหลดใหม่และตรวจ signature/hash ซ้ำ ตรวจ stable feed ชี้ immutable tag archive, remote branch/tag SHA และไม่เป็น draft/prerelease รายละเอียด PowerShell แบบเต็มในฉบับ English

เผยแพร่ [public bootstrap](bootstrap-hosting.md) แยกจาก release assets เมื่อมีการแก้ `install.sh` ต้องตรวจ public bytes/shell syntax และคำสั่งติดตั้งบน staging การมีไฟล์ใน Git ไม่ยืนยัน URL live แล้ว

## 6. Host verification และ handoff

สิทธิ์ release ไม่ใช่สิทธิ์ update production Host ที่อนุญาตแล้วให้ backup state+key, update/check และตรวจ services/API/static/login/project ตาม [คู่มือติดตั้ง](production-install.md) ส่งต่อ branch, commit, tag, URL, tests, signature/hash และข้อจำกัด ระบุ installed version เฉพาะเมื่อมีหลักฐานจาก host การ publish Portal ไม่ activate customer apps
