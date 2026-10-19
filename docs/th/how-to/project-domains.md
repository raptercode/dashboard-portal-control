# โดเมนของโปรเจค

เปิด **จัดการ domain** ของโปรเจค Web ส่วน Worker ไม่มี HTTP domain

1. กรอก hostname เช่น `api.example.com` แล้วกด **Add** เพิ่มได้แม้ DNS ยังไม่พร้อม ไม่รองรับ URL, path หรือ wildcard
2. ตั้ง A record ตามค่าที่แสดงกับผู้ให้บริการ DNS ส่วน AAAA เป็นทางเลือกเมื่อมี A record ให้ใช้เฉพาะเมื่อ origin รับ IPv6 สาธารณะได้ ค่า IP เป็นของ host เครื่องนี้ ไม่มี CNAME ของ Vercel ที่ระบบสร้างให้
3. กด **Verify** ที่โดเมนหรือ **Verify ทั้งหมด** เมื่อ DNS พร้อม รวมถึงโดเมนที่เปิด Cloudflare Proxy ระบบจะตั้ง Nginx/TLS ให้ เก็บโดเมนเดิมที่ใช้งานอยู่ไว้ระหว่างรอโดเมนใหม่
4. **Valid Configuration** ต้องผ่านทั้ง DNS, managed proxy และ certificate ของ origin ที่เชื่อถือได้และตรง hostname พร้อมแสดงวันหมดอายุแยกต่างหาก

**Refresh** อ่าน DNS และสถานะ origin อย่างเดียว ไม่เขียน Nginx หรือออก certificate ส่วน Verify เป็นการเปิดใช้งานและกดซ้ำได้หลังแก้ error โดเมนที่เพิ่งเพิ่มและยังไม่ Verify จะไม่ทำให้ deploy แอปรอบถัดไปต้องรอ certificate ของโดเมนนั้น

เปิด Cloudflare Proxy ไว้ได้ ระบบอนุมานจาก DNS สาธารณะ IPv4/IPv6 ที่อยู่ในช่วง IP ของ Cloudflare ไม่สามารถอ่าน IP origin ที่ซ่อนอยู่หรือรับรอง Proxy ของ CDN ทุกราย ให้ตรวจ Origin ใน Cloudflare เทียบกับ IP ที่แสดง การออก TLS ยังต้องให้ `/.well-known/acme-challenge/` วิ่งถึง host ผ่าน redirect, cache และ firewall ส่วน TLS ของ origin ไม่ใช่ผลตรวจ certificate ที่ CDN แสดงให้ผู้เข้าชม

การลบโดเมนอัปเดต managed route ด้วย หากลบไม่ผ่าน รายการที่บันทึกกับ route ที่ยังทำงานอาจไม่ตรงกัน หน้าต่างจะเก็บ error และมีปุ่มลองลบจาก Nginx อีกครั้งแม้ลบโดเมนสุดท้ายแล้ว แอปยังทำงานที่พอร์ตเดิม

ใช้ลำดับ Add / configure / Verify ตามแนวทาง [Vercel](https://vercel.com/docs/domains/working-with-domains/add-a-domain) แต่ใช้ DNS และ certificate ของ host นี้ ขอบเขตรอบนี้ไม่รวม redirect, เพิ่ม www อัตโนมัติ, wildcard, แก้ DNS ผ่าน provider หรือจัดการ registrar
