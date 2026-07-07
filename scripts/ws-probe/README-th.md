# ws-probe — เครื่องมือทดสอบ Websocket ค้างสาย (M8 infra spike)

เครื่องมือนี้ตอบคำถามเดียว: **"host ที่จะใช้รัน websocket relay ของปาร์ตี้ (lockstep) รับ connection ค้างสายได้จริงหรือไม่ นานแค่ไหน latency นิ่งแค่ไหน"**

ไม่มี npm dependency เลย (แค่ Node.js core modules) — อัปโหลดไปที่ไหนก็รันได้ทันทีโดยไม่ต้อง `npm install`

## ไฟล์ในชุดนี้

- `server.js` — HTTP + WebSocket server (implement RFC 6455 เอง, ไม่พึ่ง `ws` package), เสิร์ฟหน้าเว็บทดสอบที่ `GET /`
- `client.html` — หน้าเว็บที่ต่อ websocket แล้วรายงานผลสด ๆ (ภาษาไทย)
- `README-th.md` — ไฟล์นี้

## วิธีรัน (Hostinger hPanel — ถ้าแพลนมี "Node.js App")

Hostinger ให้ฟีเจอร์ Node.js App บนแพลน **Business (Web hosting)** หรือ **Cloud hosting** ขึ้นไปเท่านั้น (แพลน shared ราคาถูกสุดอาจไม่มีเมนูนี้เลย — เช็คใน hPanel ก่อน) ดู [Node.js hosting options ของ Hostinger](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/)

1. เข้า hPanel → มองหาเมนู **Node.js** (อยู่ใต้ "Advanced" หรือ "Website" section แล้วแต่เวอร์ชัน UI)
2. สร้าง Node.js App ใหม่:
   - Application root: อัปโหลดโฟลเดอร์ `scripts/ws-probe/` ทั้งหมด (2 ไฟล์: `server.js`, `client.html`) ขึ้นไปที่ root ของแอป
   - Application startup file: `server.js`
   - Node.js version: เลือกตัวล่าสุดที่มี (18/20/22 ก็รันได้ ไม่ใช้ syntax ใหม่พิเศษ)
   - Port: **ปล่อยให้ hPanel กำหนด env `PORT` ให้เอง** (อย่า hardcode) — `server.js` อ่านจาก `process.env.PORT` อยู่แล้ว
3. กด **Run** / **Start** ให้แอปสถานะเป็น "Running"
4. เปิด URL ที่ hPanel ให้มา (มักจะเป็น subdomain หรือ path proxy ผ่าน 443/80) ด้วยเบราว์เซอร์
5. ถ้าหน้าเว็บโหลดขึ้นแต่สถานะค้างที่ "กำลังเชื่อมต่อ..." หรือขึ้น "หลุดการเชื่อมต่อ" ทันที — นั่นคือสัญญาณว่า reverse proxy ของ host **บล็อก/ไม่ทำ WebSocket upgrade** ให้ (ดูหัวข้อ "ผลลัพธ์ที่คาดไว้" ด้านล่าง — จากเอกสารทางการของ Hostinger มีโอกาสสูงมากว่าจะเจอแบบนี้)

> ถ้าไม่เจอเมนู Node.js เลยในแพลนที่ใช้อยู่ — แปลว่าแพลนนั้นรัน Node.js persistent process ไม่ได้ตั้งแต่ต้น ข้ามไปสรุปผลว่า "shared ไม่พอ" ได้เลยโดยไม่ต้องเสียเวลาลองต่อ

## วิธีรันบนเครื่อง local (Windows/Mac/Linux) หรือ VPS

ต้องมีแค่ Node.js (18+) ติดตั้งไว้ ไม่ต้อง `npm install` ใด ๆ

```bash
cd scripts/ws-probe
PORT=8080 node server.js
```

Windows PowerShell:

```powershell
cd scripts\ws-probe
$env:PORT = 8080
node server.js
```

แล้วเปิด `http://localhost:8080/` (หรือ `http://<VPS-IP>:8080/` ถ้ารันบน VPS — อย่าลืมเปิด port ใน firewall/security group)

รันค้างยาว ๆ แนะนำใช้ `pm2` หรือ `nohup node server.js &` เพื่อกันหลุดตอนปิด terminal (บน VPS)

## วิธีอ่านผล (go/no-go สำหรับ lockstep party)

หน้าเว็บจะรายงาน 6 ส่วน:

1. **สถานะการเชื่อมต่อ** — ต่อติดไหม, อายุการเชื่อมต่อสด ๆ, หลุดกี่ครั้ง
2. **RTT sampling 30 วิแรก** — ยิง ping ทุก 500ms เก็บ 60 ตัวอย่าง คำนวณ median / p95 / jitter
3. **Heartbeat ระยะยาว** — ยิงทุก 15 วิ ต่อเนื่อง (ปล่อยแท็บทิ้งไว้ ≥10 นาที) เทียบ RTT ช่วงต้นกับช่วงหลังว่าคงที่ไหม
4. **หลายแท็บ / broadcast** — เปิดหน้าเดียวกัน 2+ แท็บ (หรือคนละเครื่อง) ใส่ room เดียวกัน กด "ส่งข้อความกระจาย" แล้วดูว่าอีกแท็บเห็นข้อความไหม (จำลอง 3 คนในปาร์ตี้เห็นกันจริง)
5. **เหตุการณ์** — log ทุกครั้งที่ connect/disconnect/reconnect พร้อม code และเวลาอยู่ได้ก่อนหลุด
6. **สรุปผล JSON** — กดคัดลอกแล้วส่งกลับมาให้ทีมได้เลย (มีตัวเลขทั้งหมดในนั้น)

### เกณฑ์ตัดสิน (go / no-go)

| ผลที่เจอ | สรุป |
|---|---|
| ต่อไม่ติดเลย (สถานะค้าง "กำลังเชื่อมต่อ" นานเกิน ~10 วิ แล้วหลุด, หรือหลุดถี่ทุกไม่กี่วินาที) | **NO-GO** — host นี้ไม่รองรับ incoming websocket จริง (ตรงกับที่เอกสาร Hostinger ระบุไว้สำหรับแพลน shared/cloud) |
| ต่อติด แต่หลุดก่อนครบ ~1-2 นาที ซ้ำ ๆ (ดู "จำนวนครั้งที่หลุด" และ log เหตุการณ์) | **NO-GO** — เข้าข่าย idle-process reaping / proxy timeout (พบได้บ่อยบน shared hosting ที่ตั้งใจไม่ให้ background process อยู่นาน) |
| ต่อติดครบ ≥10 นาทีต่อเนื่อง (ไม่หลุดเลย หรือหลุด reconnect ได้เร็ว) **และ** RTT p95 jitter < ~150ms ตลอดทั้ง 2 ช่วง (sampling กับ heartbeat ใกล้เคียงกัน ไม่ขยับขึ้นเรื่อย ๆ) | **GO** — ใช้ทำ lockstep ได้จริง (150ms เป็นเกณฑ์หยาบ ๆ ที่ยังรู้สึก responsive พอสำหรับ input-sync จังหวะเกมนี้) |
| ต่อติดครบ ≥10 นาที แต่ jitter สูง (>300ms) หรือแกว่งขึ้นเรื่อย ๆ ตามเวลา | **GO แบบมีเงื่อนไข** — พอใช้ได้แต่ควรลด tick rate ของ input-sync ลง หรือพิจารณา VPS แทน |
| หลายแท็บไม่เห็นข้อความกระจายกัน (ข้อ 4 ล้มเหลว) | เช็คก่อนว่าเปิด room เดียวกันจริง — ถ้ายังไม่เห็นอีก แปลว่า process ของ host อาจ spawn หลาย instance แยกกัน (ไม่ share memory ระหว่าง request) ซึ่งเป็นปัญหาคนละเรื่องกับ websocket แต่ก็เป็น NO-GO สำหรับ relay เดี่ยวเช่นกัน (ต้องมี sticky session / single instance) |

## ผลลัพธ์ที่คาดไว้ล่วงหน้า (จากการรีเสิร์ช ก่อนรันจริง)

ตามเอกสารทางการของ Hostinger ("[Are Sockets Supported at Hostinger?](https://www.hostinger.com/support/1583738-are-sockets-supported-at-hostinger)") แพลน **Web/Cloud hosting อนุญาตแค่ WebSocket ขาออก (outgoing)** เท่านั้น — "It is not allowed for clients to bind to local ports for incoming connections" ซึ่งตรงข้ามกับสิ่งที่ relay ต้องการ (ต้องรับ incoming connection จากผู้เล่น 3 คน) ดังนั้น **มีความเป็นไปได้สูงว่าผลจะออก NO-GO ตั้งแต่ข้อ 1 (ต่อไม่ติดเลย หรือ handshake ผ่านแต่หลุดทันที)** — โพรบตัวนี้มีไว้เพื่อ "ยืนยันด้วยต้นทุนต่ำสุด" ไม่ใช่เพื่อคาดหวังว่าจะผ่าน ดูรายละเอียดเพิ่มเติมและตารางตัดสินใจเต็มใน `docs/infra-spike-m8.md`
