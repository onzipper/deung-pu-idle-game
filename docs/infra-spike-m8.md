# M8 Infra Spike — Websocket relay สำหรับ Lockstep Party

> **สถานะ 2026-07-08:** ซัพพอร์ต Hostinger ตอบเป็นลายลักษณ์อักษรว่า Business/Cloud Node.js
> hosting **ไม่ proxy incoming WebSocket upgrade**, ไม่รองรับ inbound ค้างสาย 10+ นาที,
> ไม่การันตี single persistent instance (ชี้ไป VPS สำหรับงานแบบนี้) — แต่**เจ้าของขอ
> ทดลอง deploy probe บน hosting จริงก่อน** (เผื่อได้) · ถ้าผลจริง NO-GO ค่อยวางแผน VPS
> กันอีกรอบ — ยังไม่เคาะอะไรจนกว่าจะเห็นผล probe บน host จริง

คำถามที่ต้องตอบก่อนเริ่มพาร์ตี้จริง (GDD.md §3, ROADMAP.md M8): เกมนี้ต้องการ Node
websocket server รันต่อเนื่อง (persistent process, bind port, รับ incoming
connection จากผู้เล่นสูงสุด 3 คนต่อห้อง) เพื่อทำ lockstep input-sync บน
deterministic engine ที่มีอยู่แล้ว — **เจ้าของอยากลอง Hostinger shared/premium
hosting ก่อน จ่าย VPS เพิ่มค่อยว่ากัน** เอกสารนี้สรุปผลรีเสิร์ช + เครื่องมือ
ยืนยันผลจริง (probe) + คำแนะนำ

DB (MySQL) อยู่บน Hostinger อยู่แล้ว (`docs/persistence-m5.md`,
`docs/persistence-m7.md`) แต่ตัวแอป Next.js เองไม่มีบันทึกวิธี deploy ไว้ใน repo
เลย (README.md ที่มีอยู่เป็น boilerplate default ของ `create-next-app` ชี้ไปที่
Vercel) — สมมติฐานทำงาน: relay จะเป็น **process แยกต่างหาก** จากตัวแอปเว็บหลัก
ไม่ว่าจะ deploy คู่กันบน host เดียวกันหรือคนละที่ก็ได้ ไม่กระทบกับที่ตัวเว็บรันอยู่

## สรุปผลรีเสิร์ช (2026, ผ่าน WebSearch/WebFetch)

**Hostinger Web/Cloud hosting (รวมถึง "Business" ที่มีเมนู Node.js App ใน
hPanel) — WebSocket ขาเข้า (incoming) ไม่รองรับ ตามเอกสารทางการ:**

> "you can **initiate** a WebSocket request from your hosting to another server
> ... and upon successful handshake, a dual communication channel is
> established" — แต่ "**only allow for outgoing connections** via WebSocket" และ
> "**It is not allowed for clients to bind to local ports for incoming
> connections**"
> — [Are Sockets Supported at Hostinger?](https://www.hostinger.com/support/1583738-are-sockets-supported-at-hostinger)

พูดง่าย ๆ: แพลน shared/cloud ของ Hostinger ให้แอปเราเป็น **client** ต่อออกไปหา
websocket อื่นได้ (เช่น เรียก API ภายนอก) แต่ **เป็น server รับ connection เข้ามา
ไม่ได้** — ตรงข้ามกับสิ่งที่ relay ของปาร์ตี้ต้องการเป๊ะ (ผู้เล่น 3 คนต้องต่อ
*เข้ามา* หา relay)

Node.js App feature บน hPanel มีจริง แต่ต้องเป็นแพลน **Business (web) ขึ้นไป
หรือ Cloud hosting** — แพลน shared ราคาถูกสุดอาจไม่มีเมนูนี้เลย
([Node.js hosting options at Hostinger](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/)).
เอกสารไม่ได้ระบุชัดว่า HTTP long-lived process ที่ deploy ผ่านเมนูนี้ทำ
WebSocket **upgrade** ได้ไหม (คนละเรื่องกับ raw socket ข้างบน) — จุดนี้คือสิ่งที่
probe ต้องยืนยันจริง ไม่เดาเอาจากเอกสารอย่างเดียว

**โครงสร้าง process บนแพลนที่ไม่ใช่ VPS (CloudLinux LVE):**
- แต่ละเว็บถูกจำกัดด้วย LVE (CPU/RAM/entry-process quota) — process ที่ทำงาน
  "อยู่เฉย ๆ รอ event" (background worker) ไม่ตรงโมเดลที่ Passenger/LiteSpeed
  ออกแบบมาให้ ("Passenger expects to manage HTTP request handlers, not
  background workers") — [Node.js On Shared Hosting 2026 — webhostmost](https://blog.webhostmost.com/nodejs-hosting-2026-shared-hosting-problems/)
- เมื่อชน limit: CPU → คำขอถูก throttle/เข้าคิว (ไม่ kill ทันที), RAM/process
  เกิน → 503 บ่อยกว่า 508 — [What to do if plan limits are reached](https://www.hostinger.com/support/1583532-what-to-do-if-your-hosting-plan-limits-are-reached-in-hostinger/)
- LiteSpeed แนะนำ cron ทำความสะอาด idle/hanging process เป็นประจำ (นัยว่า
  process ที่ไม่ตายเองจะถูกไล่เก็บกวาดอยู่ดี) — [LiteSpeed shared-hosting tuning guide](https://docs.litespeedtech.com/lsws/tuning-shared/)

**สรุปจากรีเสิร์ชล้วน ๆ (ก่อนรัน probe): มีความเป็นไปได้สูงมากว่า shared/premium
ของ Hostinger ทำ persistent incoming websocket ไม่ได้** ตรงกับที่ GDD.md เขียนไว้
ล่วงหน้าแล้ว ("Hostinger shared hosting ไม่พอ") — เอกสารนี้ไม่ได้เปลี่ยนข้อสรุปนั้น
แค่หาหลักฐานมายืนยันและเตรียมเครื่องมือให้เจ้าของกดลองเองได้จริงในต้นทุนต่ำสุด
(ไม่ต้องซื้ออะไรเพิ่มเพื่อพิสูจน์)

**Hostinger VPS (KVM) — ทางเลือกสำรอง:**
ราคาเริ่มต้น (โปรโมชั่นปีแรก) KVM 1 ≈ $4.99/เดือน (1 vCPU / 4GB RAM / 50GB
NVMe), KVM 2 ≈ $6.99/เดือน (2 vCPU / 8GB RAM) ไปจนถึง KVM 8 ≈ $19.99/เดือน (8
vCPU / 32GB RAM) — ทุกแพลนได้ root เต็ม (bind port อะไรก็ได้ + Nginx reverse
proxy รองรับ WebSocket upgrade ปกติ) **แต่ราคาต่ออายุจริงพุ่งขึ้น 140-232% จาก
ราคาโปรโมชั่นปีแรก** ต้องคิดที่ราคาต่ออายุ ไม่ใช่ราคาป้ายแรกเข้า —
[Hostinger VPS Hosting](https://www.hostinger.com/vps-hosting) ·
[Hostinger VPS Pricing 2026 — smarthostfinder](https://smarthostfinder.com/hostinger-vps-pricing/) ·
[Hostinger VPS Pricing — hostadvice (ราคาต่ออายุจริง)](https://hostadvice.com/hosting-company/hostinger-reviews/vps-pricing/)

## เครื่องมือยืนยันผล: `scripts/ws-probe/`

ชุดโพรบ zero-dependency (ไม่มี npm package เลย ใช้ Node core module ล้วน)
อัปโหลดขึ้น host ไหนก็รันได้ทันที:

- `scripts/ws-probe/server.js` — HTTP server + WebSocket server ที่ implement
  RFC 6455 handshake/frame parsing เอง (text echo, native ping/pong control
  frame, broadcast แบบแบ่งห้อง) เสิร์ฟหน้าเว็บทดสอบที่ `GET /`, อ่าน `PORT` จาก
  env (ให้ host กำหนดเองได้)
- `scripts/ws-probe/client.html` — หน้าเว็บภาษาไทยที่ต่อ websocket แล้ววัด/
  รายงานสด: connect success, RTT sampling 30 วิแรก (median/p95/jitter),
  heartbeat ทุก 15 วิต่อเนื่อง ≥10 นาที (เทียบ RTT ต้น-ท้าย), auto-reconnect +
  log เวลา/code ตอนหลุด, multi-tab broadcast test (จำลอง 3 คนเห็นกัน), ปุ่ม
  คัดลอกผลสรุปเป็น JSON
- `scripts/ws-probe/README-th.md` — ขั้นตอนอัปโหลด/รันบน Hostinger hPanel
  (Node.js App) และบน local/VPS + ตาราง go/no-go

**Smoke test ผ่านแล้วบนเครื่อง local (Node v24, ก่อนส่งมอบ):** handshake 101
ผ่าน, RTT echo ผ่าน (roundtrip ~1ms local), join room + broadcast ผ่าน (2
client จำลอง เห็น peer-count และข้อความกระจายถึงกันถูกต้อง รวม self-echo),
raw PING control frame (0x9) ได้ PONG (0xA) กลับตรง payload — ปิด process
ทดสอบเรียบร้อย ไม่มีของค้าง ไม่ commit สคริปต์ทดสอบชั่วคราว (อยู่ใน scratchpad
เท่านั้น)

### เกณฑ์ go/no-go (ดูละเอียดใน README-th.md ของโพรบ)

| เงื่อนไข | สรุป |
|---|---|
| ต่อไม่ติด / หลุดถี่ภายในไม่กี่วินาที | **NO-GO** — ตรงกับที่รีเสิร์ชคาดไว้ |
| ต่อติดแต่หลุดก่อนครบ 1-2 นาทีซ้ำ ๆ | **NO-GO** — idle-process reaping/proxy timeout |
| ต่อติดต่อเนื่อง ≥10 นาที + RTT p95 jitter < ~150ms ทั้ง 2 ช่วง | **GO** |
| ต่อติดครบ ≥10 นาทีแต่ jitter สูง (>300ms) หรือแกว่งขึ้นเรื่อย ๆ | **GO แบบมีเงื่อนไข** — ลด tick rate หรือพิจารณา VPS |

## Decision matrix

| ตัวเลือก | ต้นทุน | Incoming WS | Bind port เอง | เหมาะกับ lockstep 3 คน |
|---|---|---|---|---|
| **Hostinger shared/Business (hPanel Node.js App)** | รวมอยู่ในแพลนเว็บที่มีอยู่แล้ว (~ฟรีส่วนเพิ่ม) | ไม่รองรับตามเอกสาร (ยืนยันด้วย probe) | ไม่ได้ (host กำหนด PORT ให้เอง ผ่าน proxy) | ไม่ผ่าน เว้นแต่ probe ขัดกับเอกสาร |
| **Hostinger VPS KVM 1** (~$5-10/เดือนหลังต่ออายุ) | ต่ำสุดในกลุ่มที่ทำได้จริง | รองรับเต็ม (root, Nginx reverse proxy ปกติ) | ได้ | ผ่าน — เพียงพอสำหรับห้อง 3 คนหลายห้อง |
| **คง polling-only ต่อไป** (ของที่มีอยู่แล้ว: friends/presence ผ่าน `lastSeen`) | ศูนย์ | ไม่ต้องมี | ไม่ต้องมี | ใช้ได้กับ presence/friend request เท่านั้น — **ทำ real-time party ไม่ได้** (ผู้เล่นเห็นกันแบบ lockstep ต้องมี push ทันที ไม่ใช่ poll) |

## คำแนะนำ

1. **รัน probe บนแพลน Hostinger ที่ใช้อยู่จริงก่อนตัดสินใจ** (ต้นทุนเวลาแค่
   อัปโหลด 2 ไฟล์ + เปิดเบราว์เซอร์ทิ้งไว้ 10+ นาที) — ถ้าผลออกตรงกับที่รีเสิร์ช
   คาดไว้ (ต่อไม่ติด/หลุดเร็ว) ให้ปิดตัวเลือก shared hosting ทันทีโดยไม่ต้อง
   ลองอย่างอื่นเพิ่ม
2. ถ้า probe ยืนยัน NO-GO (มีโอกาสสูงสุด): ไปที่ **Hostinger VPS KVM 1**
   ตัวเล็กสุดก็พอสำหรับห้องละ ≤3 คน หลาย ๆ ห้องพร้อมกัน (Node เดี่ยว + Nginx
   reverse proxy ทำ WS upgrade ได้ปกติ) — คิดงบที่ราคาต่ออายุจริง ไม่ใช่ราคาปี
   แรก
3. **Friends/presence MVP ไม่ต้องรอผลนี้** — ทำต่อด้วย polling บน `lastSeen`
   ที่มีอยู่แล้วได้เลย (ตามที่ ROADMAP.md ระบุไว้) แยกจาก decision นี้โดยสิ้นเชิง
   ผลของ spike นี้กระทบเฉพาะ "party จริงแบบ lockstep" เท่านั้น
4. ถ้างบยังไม่พร้อมสำหรับ VPS ตอนนี้ — เลื่อน M8 lockstep ไปก่อน ทำ friends/
   party-invite ผ่าน polling ให้ครบตามที่วางแผนไว้ แล้วค่อยกลับมาเปิด VPS ตอนที่
   ฟีเจอร์อื่นของเกมโตพอจะคุ้มค่าใช้จ่ายรายเดือน

## Sources

- [Are Sockets Supported at Hostinger?](https://www.hostinger.com/support/1583738-are-sockets-supported-at-hostinger)
- [Node.js hosting options at Hostinger](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/)
- [What to do if your hosting plan limits are reached (Hostinger)](https://www.hostinger.com/support/1583532-what-to-do-if-your-hosting-plan-limits-are-reached-in-hostinger/)
- [Node.js On Shared Hosting 2026 — webhostmost](https://blog.webhostmost.com/nodejs-hosting-2026-shared-hosting-problems/)
- [LiteSpeed Shared-Hosting Server Tuning Guide](https://docs.litespeedtech.com/lsws/tuning-shared/)
- [Hostinger VPS Hosting (official)](https://www.hostinger.com/vps-hosting)
- [Hostinger VPS Pricing 2026 — smarthostfinder](https://smarthostfinder.com/hostinger-vps-pricing/)
- [Hostinger VPS Pricing (real renewal costs) — hostadvice](https://hostadvice.com/hosting-company/hostinger-reviews/vps-pricing/)
