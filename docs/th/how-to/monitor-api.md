# Monitor API สำหรับ AI

[เอกสาร API ภาษาอังกฤษ](../../en/how-to/monitor-api.md) · [สารบัญเอกสาร](../README-index.md)

เอกสาร API ภาษาอังกฤษเป็น reference ของ endpoint ปัจจุบันสำหรับ AI client: การอ่านสถานะ deployment ด้วย Monitor Logs Token, การสร้างและยกเลิก token ผ่าน session ของ Portal, รูปแบบผลลัพธ์ และรหัส HTTP

implementation ปัจจุบันส่งเฉพาะฟิลด์สถานะของ job โดยไม่ส่ง `failureLog` หรือฟิลด์ job อื่นที่ไม่ได้กำหนดไว้ ข้อความสรุปความล้มเหลวและเหตุการณ์ยังเป็นข้อมูล diagnostics ที่ควรตรวจขอบเขตก่อนส่งให้ AI ภายนอก อ่านรายละเอียดและตัวอย่างใน[เอกสาร API ภาษาอังกฤษ](../../en/how-to/monitor-api.md)
