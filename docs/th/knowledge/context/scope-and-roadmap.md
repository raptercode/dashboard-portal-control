# ขอบเขตผลิตภัณฑ์และ roadmap

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/context/scope-and-roadmap.md)


เอกสารนี้อ้างอิง source candidate 1.0.0 ที่รวม fixes ของ v0.8.9 กับงาน v1 แยก implementation ออกจาก host acceptance รายการ Planned/Partial ใน English เป็น backlog ไม่ใช่ข้อบังคับก่อน 1.0.0 ทุกข้อ ดู [ลำดับงานก่อน 1.0.0](../plans/v1-readiness-plan.md) สำหรับ gates, priority และหลักฐานปิดงาน

ผลปัจจุบันอยู่ใน [acceptance record](../plans/v1-acceptance-record.md) งานเตรียมรุ่นยังเป็น dirty diff บน baseline ผู้ใช้ยืนยันเลื่อน operational Mail จาก readiness claim ของ 1.0.0 Installer recovery/shared host-operation leases อยู่ใน [ADR 0031](../adr/0031-maintenance-exclusion-and-install-recovery.md) Upgrade legacy ยังต้องยืนยันว่าไม่มีงานค้างและทดสอบบน host จริง

## เป้าหมายและ model

ควบคุม Linux host เดียวด้วย dashboard สำหรับ trusted repositories ดูสถานะ sync/build/deploy/rollback, logs, DNS/Nginx/TLS, tools และ audit Project มี repository/branch/runtime/environment/domain และ release ที่ผูก revision Organizations เป็น access scopes ไม่ใช่ tenant sandbox

Native deployment ใช้ candidate build/health ก่อน activation โดย helper จัด Unix users/systemd/managed Nginx Docker Compose เป็น optional trusted-project runtime ไม่ใช่ prerequisite ของ Portal ใช้ SQLite สำหรับ durable jobs/state พร้อม secret encryption Node/Bun/Go/Python/PHP และ Compose ต้องตาม contract ของแต่ละ runtime

Web/API ไม่ผูกโดเมนได้ และ Worker แบบ Node/Bun/Go/Python script ไม่มีพอร์ตที่ Portal กำหนด Worker build โดยไม่เริ่ม candidate consumer และตรวจ process หลัง activation ดู [คู่มือบริการภายใน](../../how-to/internal-services-and-workers.md)

## สถานะหลัก

v0.1 foundation มี owner login, CSRF, doctor, audit, privileged helper และ demo v0.2 native releases และ v0.3 domain/TLS ส่วนใหญ่ทำแล้ว v0.4 UI/logs/database connectors และ v0.5 operations/Compose ทำแล้ว v0.6 runtime discovery/guarded mail มี implementation ต่อมา v0.8.1 Master/User/grants, v0.8.2 organization credentials และ v0.8.3 selectable Node/SQLite adapter ดู ADR/changelog สำหรับรายละเอียดปัจจุบัน

Mail provisioning ใช้ encrypted relay/DKIM, helper-owned Postfix/Dovecot/OpenDKIM และ port-aware plan ต้องแยก SMTP egress/local UFW/provider firewall/external delivery Database connectors ไม่ใช่ host database installer

Node projects เลือก major 20/22/24/26 ได้และ rollback ใช้ major ของ release แต่ต้อง provision runtime นั้นบน host ก่อน Portal v0.8.5 รักษา major เดิมตอน update และมี CLI help/version ทั้ง Native และ Compose มี implementation แล้ว สมาชิก Master/User และ grants ตามองค์กรมีแล้ว แต่ organizations ไม่ใช่ process isolation

Repository credentials ไม่ส่งค่ากลับ browser ส่วน project ENV อ่าน plaintext ได้เฉพาะผู้มี environment-read grant ข้อมูล persisted เข้ารหัส; runtime ENV files ที่จำเป็นต้องถอดรหัสใช้ permissions จำกัด Node/Bun build และ candidate ยังรันในบริบทบัญชี Portal ส่วน activated Native service ใช้ Unix user ของโปรเจกต์

## พัฒนาต่อ

v0.8.4 แสดง phase และผล deploy บนการ์ด Projects อัตโนมัติ โดย Sync/Deploy/Rollback ไม่เปิด popup log เอง ผู้ใช้ยังเปิดรายละเอียดได้ตามสิทธิ์

ก่อนปล่อยให้ทำ P0 ตาม [readiness plan](../plans/v1-readiness-plan.md): scope/matrix → clean host install → deploy/failure/rollback/reboot → upgrade/restore → browser/permissions → Mail ตามขอบเขต → signed release ตรวจ state/key restore และรักษา Node major ด้วย ขอบเขต Nginx ที่ไม่ใช่ managed ต้องคง read-only และไม่ claim hostile-tenant isolation

P1 เรียง certificate expiry/renewal visibility, stop/restart, Nginx drift/diff, notification retries และ per-project backup automation ส่วน SSH keys, GitLab webhook, advanced logs/config/terminal และ OS expansion เป็น P2 ฟีเจอร์ P1 เป็นข้อเสนอ ไม่ใช่สิ่งที่ทำแล้วหรือ gate บังคับจนกว่าจะเพิ่มเข้า release scope

เป้าหมาย OS ใหม่และ platform registry อยู่ใน [Ubuntu plan](../plans/ubuntu-compatibility-plan.md) ต้องพิสูจน์ package/runtime/service/mail compatibility ก่อนเพิ่ม support ไม่เปลี่ยน OS gate จากผล container tests อย่างเดียว
