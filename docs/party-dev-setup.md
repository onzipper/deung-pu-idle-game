# 🧑‍🤝‍🧑 M8 Party P4b — คู่มือรันทดสอบบนเครื่อง dev

> อ้างอิง: `docs/party-relay-protocol.md` (wire protocol) · `docs/party-design-m8.md`
> (สถาปัตยกรรม lockstep) · `src/app/(game)/partySession.ts` +
> `src/app/(game)/partyHandshake.ts` (ฝั่ง client) · `scripts/party-relay/server.js`
> (relay). เอกสารนี้ = **การรันจริงด้วยมือ** (3 browser tab/profile) — เทสต์ headless
> ของส่วน pure logic อยู่ที่ `src/app/(game)/__tests__/party{Handshake,Session}.test.ts`
> อยู่แล้ว (รันด้วย `pnpm test`).

---

## 1. รัน relay ในเครื่อง (terminal แยก)

Relay เป็นสคริปต์ Node เปล่า (`scripts/party-relay/server.js`) ไม่มี dependency,
ไม่ build, รันตรงได้เลย:

```bash
PARTY_RELAY_SECRET=dev PORT=8090 pnpm relay
```

(บน PowerShell ให้ตั้ง env แยกบรรทัดก่อน หรือใช้ `cross-env`/WSL/Git Bash — โปรเจกต์นี้
รัน bash tool อยู่แล้วก็ใช้บรรทัดเดียวข้างบนได้ตรง ๆ)

เช็คว่า relay ตื่นแล้ว:

```bash
curl http://localhost:8090/health
# -> {"status":"ok","rooms":0,"sockets":0,"uptimeSec":...}
```

## 2. ตั้งค่า `.env.local` ของแอปเกม (terminal อีกอัน, รัน `pnpm dev`)

เพิ่มใน `.env.local` (ห้าม commit ไฟล์นี้ — ดู `.env.example`):

```bash
PARTY_RELAY_SECRET=dev          # ต้องตรงกับที่สั่ง relay ไว้ข้อ 1 เป๊ะ
PARTY_RELAY_URL=ws://localhost:8090
```

**สำคัญ**: ค่าเดิม `PARTY_RELAY_SECRET` ต้องเหมือนกันทั้งสองฝั่ง (แอปเกม + relay) —
ไม่งั้น `POST /api/party/ticket` จะยังมินต์ตั๋วได้ (แอปเกมไม่รู้ว่า relay ตรวจผ่านไหม)
แต่การ join จริงจะถูก relay ปฏิเสธด้วย close code `4001` เงียบ ๆ (คนเข้าปาร์ตี้ไม่เห็น
กัน, เช็ค console ของ browser หา `[GameClient]`/WebSocket close event).

ถ้า `.env.local` ไม่มี `PARTY_RELAY_URL` เลย — ปาร์ตี้ยังใช้ invite/leave/แชร์สถานะได้
ปกติ (M8 Phase 1 เดิม) แต่ระบบ lockstep cohort จะ**ปิดเงียบ** (ticket route ตอบ 503
`relay_not_configured`, `PartySession` ไม่เปิด socket เลย) — เจตนา, ไม่ใช่บั๊ก.

รีสตาร์ท `pnpm dev` หลังแก้ `.env.local` (Next ไม่ hot-reload env vars).

## 3. เซ็ตอัพ 3 โปรไฟล์ browser / 2 บัญชี (อย่างน้อย 2 คนเพื่อเห็น cohort)

ต้อง**บัญชีที่สมัครแล้ว** (ไม่ใช่ guest) ถึงจะใช้ friends/party ได้ (`account_required`).

1. เปิด 2-3 โปรไฟล์ Chrome/Edge แยกกัน (หรือ 1 ปกติ + Incognito/private อีกอัน — คุกกี้
   ไม่ปนกัน) ชี้ไปที่ `http://localhost:3000` ทุกอัน.
2. แต่ละโปรไฟล์: สมัครบัญชี (Settings > บัญชีของฉัน) แล้วสร้างตัวละคร.
3. เพิ่มเพื่อนกัน: เปิดปุ่ม 👥 ใส่โค้ดเพื่อน (หรือชื่อตัวละคร) ของอีกฝั่ง แล้วกด
   "ส่งคำขอ" — อีกฝั่งกด "ยอมรับ".
4. คนหนึ่งกด "ชวนเข้าปาร์ตี้" ที่แถวเพื่อน อีกฝั่งกด "ยอมรับ" ที่การ์ดคำเชิญ.
5. **เดินตัวละครทั้งสองไปโซนเดียวกัน** (mapId + zoneIdx ตรงกัน — ดูได้จากแถวปาร์ตี้ใน
   panel เพื่อน หรือใช้ปุ่ม "วาปไปหา" ถ้ามียันวาป/ปีนถึงแล้ว).

## 4. พฤติกรรมที่ควรเห็น

- **โซนเดียวกัน** → แถวสมาชิกในปาร์ตี้ panel ขึ้นบรรทัด "อยู่โซนเดียวกัน — เห็นตัวกันแล้ว"
  (ui/friends/FriendsPanel.tsx's `sameZoneHint`) และชิป HUD (ใต้ HudBar) ขึ้น
  "เล่นกับ <ชื่อ> ในโซนนี้" (สีเขียว) — ทั้งสองจอควรเห็นฮีโร่อีกฝั่งเดินสู้อยู่ในสนามเดียวกัน
  จริง ๆ (ไม่ใช่แค่สถานะ).
- **ย้ายโซนแยกกัน** (คนหนึ่งเดินออกจากโซน) → cohort สลาย, ชิป HUD หายไป (กลับเป็น solo
  เงียบ ๆ) — ทั้งคู่กลับไปฟาร์มของตัวเองปกติ, ไม่มี error.
- **ปิดแท็บ/รีเฟรชฝั่งหนึ่งกลางเกม** → relay รอ grace ~5 วิ แล้วอีกฝั่งเห็นฮีโร่ของคนที่หลุด
  กลายเป็น "ร่างเงา" (ยังสู้อยู่แบบ auto, จางลง — render juice ยังไม่ได้ทำในรอบนี้ ดู
  `docs/party-design-m8.md` §9) — ไม่ค้าง ไม่ error.
- **กลับเข้ามาใหม่ในโซนเดิม** → cohort re-seed ใหม่ (handshake รอบใหม่), ร่างเงากลับมา
  เป็นฮีโร่จริงของเจ้าของ.

## 5. Troubleshooting

| อาการ | สาเหตุที่เป็นไปได้ | วิธีเช็ค |
| --- | --- | --- |
| ชิป HUD ค้างที่ "กำลังเชื่อมต่อปาร์ตี้…" นานผิดปกติ | relay ยังไม่ตื่น (cold start จริงบน Render — โลคัลไม่ควรเกิด) หรือ `PARTY_RELAY_URL` ผิด | `curl <url>/health`; เช็ค `.env.local` ตรงกับพอร์ต relay จริง |
| join ไม่สำเร็จเงียบ ๆ (ไม่มีชิปขึ้นเลย) | `PARTY_RELAY_SECRET` สองฝั่งไม่ตรงกัน (relay ปิด join ด้วย `4001`) | เทียบค่าทั้งสอง `.env`/terminal env ทุกตัวอักษร |
| ปาร์ตี้ join ได้แต่ cohort ไม่เกิดทั้งที่อยู่โซนเดียวกัน | `state.location` (mapId/zoneIdx) จริง ๆ ไม่ตรงกัน (ดูจาก HUD zone label ทั้งสองจอ) | เดินให้ชนกันจริง ๆ ที่ zoneIdx เดียวกัน ไม่ใช่แค่แมพเดียวกัน |
| ticket หมดอายุ / relay ปฏิเสธหลังค้างนาน | ตั๋วอยู่ได้ 60 วิ (`TICKET_TTL_MS`) — ถ้า handshake/reconnect ช้ากว่านั้นตั๋วเก่าใช้ไม่ได้แล้ว | ปกติ ไคลเอนต์มินต์ตั๋วใหม่ทุกครั้งที่ (re)connect อยู่แล้ว (`PartySession.connect()`) — ถ้ายังค้าง เช็ค `/api/party/ticket` response ใน network tab |
| แก้ `.env.local` แล้วยังไม่มีผล | Next ไม่ hot-reload env vars | รีสตาร์ท `pnpm dev` |
| อยากดู log ฝั่ง relay | `server.js` print เฉพาะ error รุนแรง (fail-loud ตอน secret หาย) ไม่มี access log ละเอียด (relay ตั้งใจให้ "โง่") | ใช้ `/health` เช็คนับ `rooms`/`sockets` เป็นระยะแทน |

## 6. ขอบเขตที่ตั้งใจไม่ทำในรอบนี้ (P4b)

- HUD ยังไม่ render ฮีโร่คนอื่นเป็น "ของฉันเอง" ถ้าฉันไม่ใช่ slot 0 ของ cohort — แผง
  HUD ส่วนใหญ่ (สกิลบาร์/สเตตัสบาร์) ยังอ่าน `heroes[0]` เป็น "ฮีโร่ของฉัน" เสมอ ซึ่งถูก
  เฉพาะตอนฉันเป็น slot ต่ำสุดในสนาม — งาน render 3 ฮีโร่แบบเต็ม (paper-doll+ออร่า) เป็น
  **M8 Phase 6** แยกต่างหาก (ดู `docs/party-design-m8.md`), ไม่ใช่ scope ของ P4b (seam
  ระหว่าง engine กับ React/Pixi เท่านั้น).
- อีโคโนมีระหว่าง cohort (gold/materials/consumables) ยึดตาม "seed authority" (สมาชิก
  slot ต่ำสุด) ชั่วคราวระหว่างอยู่ร่วมกัน — ตัวเลข balance/แบ่งรางวัลที่แท้จริงยังเป็น
  คำถามของ sim-harness (ดู `partyHandshake.ts`'s module doc "KNOWN LIMITATION").
- อินเทอร์โพเลชันการเคลื่อนไหวของฮีโร่เพื่อน (ให้ลื่นข้ามความหน่วงเน็ต) ยังไม่ทำ — ทิ้งไว้
  เป็น polish รอบหน้าตามที่ระบุในบรีฟ.
