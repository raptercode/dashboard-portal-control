# คำศัพท์

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../en/knowledge/glossary.md)


| Term | ความหมาย |
| --- | --- |
| Active release | Release ที่รับ traffic อยู่ |
| Audit event | บันทึกผู้เรียก action เวลาและผล โดยปิด secrets |
| Candidate | Release ใหม่ที่ build/health ก่อน activate |
| Build step | Named package script หลังลง dependencies; Node/Bun เลือก skip ได้แต่ต้องมี start |
| Bun runtime | Native runtime ใช้ Bun ที่ตรวจ checksum และ bun install/run ภายใต้ systemd |
| Project port | Loopback port ที่ Portal จองและตรวจเทียบ projects/listeners |
| Release dependency cleanup | ลบ node_modules เฉพาะ release เก่ากว่า active และ immediate rollback หลัง activation สำเร็จ |
| Config drift | Managed config ต่างจาก desired state/hash |
| Desired state | Project/Domain state ที่ระบบต้องการและเก็บใน DB |
| Domain sync | Sync Project/Domain/Nginx/TLS บน host ไม่แก้ DNS provider |
| Domain activation | ตรวจ DNS สร้าง managed Nginx ขอ ACME และชี้ active upstream |
| Credential reference | ชื่อ environment secret ที่ service resolve โดยไม่เก็บค่า secret ใน Dashboard |
| Credential vault | Encrypted token storage ไม่ส่ง token กลับ API |
| Deploy key | SSH key สำหรับ repository เก็บ private key บน host |
| Docker Compose runtime | Runtime สำหรับ trusted repository helper ตรวจ bounded policy ไม่ใช่ tenant isolation |
| Runtime detection | อ่าน shallow metadata แนะนำ runtime โดยไม่รัน source และ override ได้ |
| Mail readiness | แยก SMTP egress กับ local inbound policy ไม่พิสูจน์ provider firewall |
| Mail hostname | Hostname DNS-only สำหรับ HELO/PTR/mail TLS เช่น mail.example.com |
| Native mode | รันแอปบน host ผ่าน systemd |
| Monitor Logs Token | Project bearer token อ่านสถานะและเหตุการณ์ deploy โดยไม่ส่ง runtime logs, build output, ENV/credential ที่เก็บไว้ หรือ repository URLs แต่ยังเห็นข้อความ diagnostics |
| Notification hook | Encrypted HTTPS endpoint รับ deployment result การส่งไม่เปลี่ยน deploy state |
| Owned file | ไฟล์ที่ระบบสร้างและมีสิทธิ์แก้ภายใน ownership boundary |
| Privileged helper | Service แยกสำหรับ validated allowlisted privileged operations |
| Project user | Unix user จำกัดสิทธิ์สำหรับ build/run project |
| Release | ผล deployment ที่ผูก commit/metadata |
| Rollback | คืน traffic/service ไป verified release เดิม |
| Update manifest | Ed25519-signed JSON ระบุ version/HTTPS archive/SHA-256 |
| Install snapshot | Root-only snapshot ของ managed files/SQLite ก่อนเปลี่ยน ไม่รวม workspaces/caches |
| TLS fail-closed | ติดตั้งไม่รายงาน success จน certificate/HTTPS health ผ่าน ไม่เปิด login plaintext |
| Session identifier hash | SHA-256 ของ cookie ที่เก็บใน state; raw cookie อยู่ใน browser |
