# ADR 0002: Native mode supports one Node.js major version

- Status: Accepted
- Date: 2026-08-03

## Context

Native mode ตั้งใจให้ใช้ทรัพยากรต่ำและหลีกเลี่ยงการจัดการ runtime หลายเวอร์ชันบน host ในรุ่นแรก

## Decision

Native mode รองรับ Node.js **24 LTS** เพียงหนึ่ง major version บน host ต่อหนึ่ง release ของ Host Manager ไม่มี UI สำหรับเลือกหรือสลับ Node.js ราย project

## Consequences

- project ที่ต้องใช้ Node.js คนละ major ให้ใช้ Docker mode หรืออยู่นอกขอบเขตรุ่นแรก
- deployment validation ต้องตรวจ Node.js major 24 เดียวกันทั้ง UI และ CLI
- เอกสารไม่กล่าวอ้างว่ารองรับ PHP หรือ native runtime อื่นจนกว่าจะมี ADR เพิ่ม
