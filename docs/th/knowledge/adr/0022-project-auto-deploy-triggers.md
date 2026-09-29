# ADR 0022: Auto deploy มี trigger modes

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/adr/0022-project-auto-deploy-triggers.md)


- Status: Accepted
- Date: 2026-09-29

## บริบทและการตัดสินใจ

Polling ทุกห้านาทีไม่ต้อง external setup GitHub push เพิ่ม immediate trigger และ polling fallback Actions mode sync ได้แต่รอ authenticated CI hook ก่อน deploy GitHub ตรวจ raw-body HMAC และ exact repo/branch Actions ใช้ random bearer token ทั้งคู่ encrypted/display once ไม่ส่ง helper Fetch configured branch tip ไม่ให้ caller เลือก commit Revision ซ้ำไม่ deploy ซ้ำและ trigger ระหว่าง busy coalesce Missing Actions hook คง synced revision ไว้ undeployed ปิด hook หยุด auto deploy จนเปลี่ยน mode

## การใช้งานบันทึก

เก็บสถานะและวันที่ตามต้นฉบับ ไม่เปลี่ยนประวัติให้ตรง implementation ใหม่ เมื่อ policy เปลี่ยนให้สร้าง ADR ใหม่พร้อมอ้างบันทึกเดิม ตรวจ source และ ADR ที่ใหม่กว่าก่อนนำไปพัฒนาต่อ
