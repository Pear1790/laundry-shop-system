# 🧺 Laundry Shop System — ระบบร้านซักอบรีด

A full-stack order and tracking system for a neighbourhood laundry shop. Customers place and track orders online; the owner manages orders, pricing, delivery zones, and customers from an admin dashboard.

## Features
- **Customer side:** sign up / log in, place orders (per piece, by weight, or by machine load), choose home pickup and delivery, track order status
- **Admin dashboard:** order queue and status updates, delivery slips, configurable pricing rules, discount codes, loyalty points, delivery zones, CSV export
- **Pricing engine** (`priceOrder` in `server.js`) — minimum charges, express fees, discounts, points, and delivery fees, all configurable from the dashboard
- **LINE Messaging API** notifications with signed-webhook verification
- **Security:** scrypt password hashing, session cookies (secure flag behind HTTPS), server-side re-validation of every order

## Tech
Node.js 22.13+ with **zero npm dependencies** — built-in `node:http`, `node:sqlite`, and `node:crypto` · Vanilla HTML/CSS/JS front end · SQLite · Docker

## Quick start
```bash
node server.js
```
Open http://localhost:8080. Or with Docker: `docker build -t laundry . && docker run -p 8080:8080 -v laundry-data:/data laundry`

---

## คู่มือภาษาไทย

```
node server.js      (Node 22.13+ ไม่ต้อง npm install)
```
- หน้าแรก (เลือกบทบาท): http://localhost:8080/ → ลูกค้า (/order.html) หรือ เจ้าของร้าน (/admin)
- ลูกค้า: สมัคร/เข้าสู่ระบบ: /account.html · ติดตามสถานะ: /track.html
- เจ้าของร้าน: http://localhost:8080/admin (ครั้งแรกจะให้ตั้งชื่อผู้ใช้+รหัสผ่าน)
- ข้อมูล: data/laundry.db (SQLite) + data/photos/ — สำรองโดยคัดลอกโฟลเดอร์ data
- ขึ้นออนไลน์: ดู HOSTING.md

## ตรรกะคิดเงิน (server.js → priceOrder)
1. ราคารายการ: รายชิ้น = ราคา×จำนวน · ชั่งกิโล = max(กก., ขั้นต่ำ)×ราคา/กก. · ซักเครื่อง = (ราคาเครื่อง + ค่าชนิดผ้า + แอดออน)×รอบ
2. + ค่าซักคราบพิเศษ ต่อชิ้น
3. เติมให้ถึงยอดขั้นต่ำ (ไม่ปฏิเสธออเดอร์เล็ก)
4. + งานด่วน = max(ค่าด่วนขั้นต่ำ, ยอด×%)
5. − โค้ดส่วนลด (คิดจากยอดก่อนค่าด่วน/ค่าส่ง)
6. − แต้มสะสม (ต้องล็อกอิน, เป็นชุด, ไม่เกิน % ของยอด)
7. + ค่ารับ-ส่ง (ฟรีถ้ายอดถึงเกณฑ์)
8. ปัดเศษตาม roundTo, VAT (ถ้ามี) ถือว่ารวมในราคาแล้ว
ทุกตัวเลขตั้งค่าได้ในหน้า admin → ตั้งค่า → กติกาคิดเงิน

## พื้นที่รับ-ส่ง
admin → ตั้งค่า → 🛵 พื้นที่รับ-ส่งถึงบ้าน: กำหนดโซน ค่าส่ง ยอดส่งฟรี ยอดขั้นต่ำต่อโซน ช่วงเวลา และตัวเลือกวิธีส่งมอบ
ลูกค้าต้องเลือกโซนที่เปิดไว้ + กรอกบ้านเลขที่/ซอย-ถนน(หรือจุดสังเกต)/เวลา ถึงจะสั่งแบบรับ-ส่งได้ (เซิร์ฟเวอร์ตรวจซ้ำ)
พนักงานกดสถานะส่ง: รอไปรับผ้า → รับผ้าแล้ว → กำลังนำส่ง → ส่งถึงมือ และพิมพ์ "ใบส่ง" ได้
