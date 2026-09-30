# ขอบเขตผลิตภัณฑ์และ roadmap

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/context/scope-and-roadmap.md)


เอกสารนี้รวม feature scope และทิศทางพัฒนา แยกสิ่งที่มีใน source ออกจากข้อเสนอ รายละเอียด roadmap เดิมอยู่ใน English และต้องตรวจ source/host ก่อนอ้างสถานะ live

## เป้าหมายและ model

ควบคุม Linux host เดียวด้วย dashboard สำหรับ trusted repositories ดูสถานะ sync/build/deploy/rollback, logs, DNS/Nginx/TLS, tools และ audit Project มี repository/branch/runtime/environment/domain และ release ที่ผูก revision Organizations เป็น access scopes ไม่ใช่ tenant sandbox

Native deployment ใช้ candidate build/health ก่อน activation โดย helper จัด Unix users/systemd/managed Nginx Docker Compose เป็น optional trusted-project runtime ไม่ใช่ prerequisite ของ Portal ใช้ SQLite สำหรับ durable jobs/state พร้อม secret encryption Node/Bun/Go/Python/PHP และ Compose ต้องตาม contract ของแต่ละ runtime

## สถานะหลัก

v0.1 foundation มี owner login, CSRF, doctor, audit, privileged helper และ demo v0.2 native releases และ v0.3 domain/TLS ส่วนใหญ่ทำแล้ว v0.4 UI/logs/database connectors และ v0.5 operations/Compose ทำแล้ว v0.6 runtime discovery/guarded mail มี implementation ต่อมา v0.8.1 Master/User/grants, v0.8.2 organization credentials และ v0.8.3 selectable Node/SQLite adapter ดู ADR/changelog สำหรับรายละเอียดปัจจุบัน

Mail provisioning ใช้ encrypted relay/DKIM, helper-owned Postfix/Dovecot/OpenDKIM และ port-aware plan ต้องแยก SMTP egress/local UFW/provider firewall/external delivery Database connectors ไม่ใช่ host database installer

## พัฒนาต่อ

v0.8.4 แสดง phase และผล deploy บนการ์ด Projects อัตโนมัติ โดย Sync/Deploy/Rollback ไม่เปิด popup log เอง ผู้ใช้ยังเปิดรายละเอียดได้ตามสิทธิ์

ทบทวนรายการ Planned ในต้นฉบับก่อนนำมาทำ Acceptance ต้องมี clean host install, health/static/login, deployment failure/rollback, certificate failure/recovery, backup/restore และ reboot พร้อม evidence ขอบเขต Nginx ที่ไม่ใช่ managed ต้องคง read-only ห้ามเพิ่ม raw shell UI หรือ claim hostile-tenant isolation

เป้าหมาย OS ใหม่และ platform registry อยู่ใน [Ubuntu plan](../plans/ubuntu-compatibility-plan.md) ต้องพิสูจน์ package/runtime/service/mail compatibility ก่อนเพิ่ม support ไม่เปลี่ยน OS gate จากผล container tests อย่างเดียว
