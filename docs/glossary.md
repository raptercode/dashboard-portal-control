# Glossary

| Term | Meaning |
| --- | --- |
| Active release | Release ที่รับ traffic อยู่ในขณะนั้น |
| Audit event | บันทึกว่าใคร/อะไรเรียก operation ใด เมื่อใด ผลเป็นอย่างไร โดยตัด secret ออกแล้ว |
| Candidate | Release ใหม่ที่ build และตรวจ health check ก่อนสลับเป็น active release |
| Build step | npm script ที่รันหลัง `npm ci`; Project สามารถตั้งเป็นไม่มีขั้น build ได้ แต่ยังต้องมี start script |
| Config drift | สภาพที่ไฟล์ config ที่ระบบเป็นเจ้าของไม่ตรงกับ desired state หรือ hash ที่บันทึกไว้ |
| Desired state | สภาพ Project/Domain ที่ตั้งใจให้ระบบสร้างและเก็บในฐานข้อมูล |
| Domain sync | การซิงก์ความสัมพันธ์ Project, Domain, Nginx และ SSL ภายใน host เท่านั้น ไม่ใช่การแก้ DNS provider |
| Domain activation | การตรวจ DNS, สร้าง Nginx managed file, ขอหรือขยาย ACME certificate และชี้ reverse proxy ไปยัง active project release |
| Credential reference | ชื่อ environment secret ที่ deployment service ใช้ resolve credential โดยไม่เก็บ secret value ใน Dashboard |
| Credential vault | ส่วนที่เข้ารหัส HTTPS token ก่อนเก็บ persistent state และไม่คืน token ผ่าน API |
| Deploy key | SSH key pair ที่ใช้ให้ host เข้าถึง repository หนึ่ง โดย UI ไม่เข้าถึง private key |
| Native mode | การรัน application บน host โดย systemd ไม่ได้อยู่ใน Docker container |
| Owned file | ไฟล์ที่ Host Manager สร้างและมีสิทธิ์แก้ ตาม ownership boundary |
| Privileged helper | service แยกที่ทำ operation สิทธิ์สูงแบบ allowlist หลังตรวจ input |
| Project user | Unix user ที่จำกัดสิทธิ์และใช้ build/run application ของ Project หนึ่ง |
| Release | ผลลัพธ์ deployment หนึ่งครั้งที่ผูกกับ commit และ metadata ของมัน |
| Rollback | การคืน traffic หรือ service กลับไปยัง Active release ที่ผ่านการตรวจแล้วก่อนหน้า |
| Update manifest | เอกสาร JSON ที่เซ็นด้วย Ed25519 ซึ่งระบุ version, archive HTTPS และ SHA-256 สำหรับอัปเดต Dashboard Portal |
| Install snapshot | Root-only timestamped copy of the Dashboard Portal files it owns before an installer change; used to restore managed files after a failed install. |
| TLS fail-closed | Production install does not report success or leave the login intentionally exposed over HTTP; a certificate and HTTPS health check must pass. |
| Session identifier hash | SHA-256 hash of the browser session cookie stored in persistent state; the raw cookie remains only in the browser. |
