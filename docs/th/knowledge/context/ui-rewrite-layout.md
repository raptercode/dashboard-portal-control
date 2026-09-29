# Layout ของ UI (2026-08)

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/context/ui-rewrite-layout.md)


บันทึกแบบออกแบบ UI ใช้เป็นบริบทพัฒนาต่อ ไม่ใช่หลักฐาน browser acceptance ปัจจุบัน

Layout ใช้ navigation และ content ของแต่ละ route พร้อม visual system เดียวกัน ต้องรักษาลำดับข้อมูล status/action, spacing, typography, responsive และ overlay states ดู route/สี/ขนาดต้นฉบับใน English ก่อนแก้ implementation

Routes ครอบคลุม dashboard, projects, domains, logs, tools/setup, credentials, mail, databases และ settings หน้าที่แสดงข้อมูลจริงต้องแยก demo/simulation placeholders การจัดสิทธิ์ใน UI สอดคล้อง server grants แต่ซ่อนปุ่มไม่แทน API authorization

พัฒนาต่อโดยตรวจ mobile/desktop, keyboard focus, dialog loading/error/empty states และ confirm ที่มีผลกับ host ใช้ Thai-first copy ที่อ่านง่าย Runtime logs ต้อง scope project และปิด secrets ตรวจ browser flows จริงแยกจาก static tests และทบทวน [architecture](architecture.md) ก่อนเพิ่ม host operations
