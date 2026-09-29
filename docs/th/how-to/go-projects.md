# Deploy โปรเจกต์ Go

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../en/how-to/go-projects.md)


เลือก Go ใน Runtime หรือให้ระบบตรวจ `go.mod` อัตโนมัติ Compose มีลำดับก่อน Go และต้องตรวจ Main package ก่อน deploy

1. ตั้ง Directory เป็นโฟลเดอร์ที่มี `go.mod`
2. Main package เป็น `.` หรือ local package เช่น `./cmd/api` ไม่รับชื่อไฟล์ wildcard หรือ shell command และต้องเป็น `package main`
3. Sync source ตั้ง Environment และ health path เช่น `/healthz`
4. Deploy ระบบดาวน์โหลด modules สร้าง candidate binary เริ่มบนพอร์ตชั่วคราวและตรวจ HTTP ก่อน activation หาก candidate ล้มเหลว active release เดิมยังอยู่

แอปต้องอ่าน `PORT` และใช้ `HOST=127.0.0.1` ซึ่ง Portal สงวนไว้ ไม่ต้องมี `package.json`, start script หรือ `go run` ใน production

## Build และ host contract

Installer pin Go 1.27.1 Linux amd64 พร้อมตรวจ SHA-256 เก็บใน `/opt/go1.27.1` และเผยแพร่ `go`/`gofmt` ที่ `/usr/local/bin` Host เดิมต้อง update/rerun installer ที่มี Go support Setup รายงาน version ที่มีจริง การเลือก Runtime หรือ tool card ไม่ติดตั้ง compiler อัตโนมัติ

```text
go mod download
go list -mod=readonly -f {{.Name}} ./cmd/api
go build -mod=readonly -trimpath -o hostmgr-app ./cmd/api
```

รัน fixed argument vectors ไม่ผ่าน shell Go build เสมอ Skip Build ใช้เฉพาะ Node/Bun Commit `go.mod` และ `go.sum` ที่สอดคล้องหลัง `go mod tidy` Cache แยกจาก release และใช้ `-modcacherw` เพื่อให้ลบ workspace ได้ ไม่แก้ synced checkout

ใช้ `CGO_ENABLED=0`, `GOWORK=off`, `GOTOOLCHAIN=local` สำหรับหนึ่ง module ไม่ดาวน์โหลด toolchain ใหม่อัตโนมัติ หาก `go.mod` ต้องการ compiler ใหม่กว่าจะ build ไม่ผ่าน Credentials สำหรับ clone ไม่ส่งต่อให้ private module downloads ใช้ Docker Compose เมื่อจำเป็นต้องมี cgo, workspace หลาย module, custom flags/code generation หรือ OS libraries

Helper รัน binary ด้วย Unix user ของ project ผ่าน systemd ใช้ logs, health, domain/TLS และ rollback ร่วมกับ native flow ต้องทดสอบ Ubuntu activation/rollback จริง ผล compiler integration test ไม่รับรอง host operations

อ้างอิง [Go command](https://pkg.go.dev/cmd/go), [toolchain selection](https://go.dev/doc/toolchain)
