# Bootstrap บัญชีและ database connectors

คู่มือภาษาไทยเรียบเรียงตามหัวข้อ ดูรายละเอียดต้นฉบับและตัวอย่างเพิ่มเติมใน [English](../../../en/knowledge/context/owner-auth-and-db-connectors.md)


เมื่อยังไม่มี owner record หน้าแรกใช้ `POST /api/bootstrap` หากมี installer/env password ต้องส่ง `currentPassword` Login ใช้ email/password เก็บ password เป็น scrypt hash และบังคับ strong password Tests ที่ใช้ `createApplication({ password })` seed `owner@local.test` รายละเอียด Master/User ปัจจุบันอยู่ใน [Access control](../../how-to/access-control.md)

หน้า `/databases` รองรับ MongoDB, PostgreSQL, MySQL และ Redis เป็น client connectors เก็บ secrets เข้ารหัสและ TCP probe ไม่ติดตั้ง DB packages บน host และไม่มี installer flags API ได้แก่ `GET/POST /api/databases`, `POST /api/databases/:id/check`, `DELETE /api/databases/:id`
