# 🤝 M8 Party — Lockstep Architecture Design

> **สโคป**: real-time co-op ปาร์ตี้สูงสุด 3 คน ในโซนเดียวร่วมกัน บน deterministic
> engine ที่มีอยู่ (`step(state, input)` @ `FIXED_DT` 1/60) — เทคนิค **lockstep
> input-sync** ผ่าน websocket relay ที่ "โง่" (order + broadcast input เท่านั้น
> ไม่มี game logic) · sim รันฝั่ง **client ทั้ง 3 เครื่อง** ให้ผลตรงกัน byte-identical
> · server ตรวจย้อนหลังด้วย replay (ทำทีหลัง)
>
> อ้างอิง: GDD.md §👥 (เพื่อน & ปาร์ตี้) · `docs/infra-spike-m8.md` (verdict:
> shared hosting host ws relay ไม่ได้ → สมมติ Hostinger VPS KVM1 รัน Node ws
> relay ล้วน zero-dep) · `src/engine/state/index.ts` (heroes[] + `initHeroes`
> loop คงไว้เพื่อ M8) · M7.8 manual intents (`moveTo`/`attackTarget`/
> `cancelCommand`) = ราง lockstep ที่วางไว้แล้ว
>
> ⚠️ เอกสารนี้ = **design**. ตัวเลข balance ทั้งหมด (mob density / killGoal ต่อ
> จำนวนคนในปาร์ตี้) เป็น **คำถามของ sim-harness** ไม่ตัดสินในนี้.

---

## 🎯 North-star ของ M8 sim architecture

การเล่นด้วยกันต้องรู้สึก "เห็นเพื่อนตีจริง ๆ ช่วยกันจริง ๆ" โดย **ไม่ส่ง state
ทั้งสนาม** ผ่านเน็ต — ส่งแค่ **intent** (กดสกิล/สั่งเดิน/สั่งตี) แล้วให้ทุกเครื่อง
คำนวณสนามเดียวกันเองจาก deterministic engine. relay ถูกออกแบบให้ **โง่ที่สุด**
(cheap บน VPS ตัวเล็ก) และ **server-authoritative economy** ยังอยู่ครบ (ตรวจ
ย้อนหลัง). ทุกอย่างในนี้ต้อง **เทสต์ headless ได้โดยไม่มี relay จริง** ผ่าน
in-memory relay ที่ขับ 2-3 simulated client ใน vitest.

---

## 🔑 การตัดสินใจหลัก (Design Decisions)

### 1. Lockstep model: **turn-based (bucket) lockstep**, ไม่ใช่ per-frame 60Hz

**ตัดสินใจ**: จัด sub-step 60Hz เป็น **turn ละ 100ms = 6 sub-steps**; แต่ละ client
ส่ง `TurnInput` **หนึ่งข้อความต่อ turn** (ว่างเปล่าก็ต้องส่ง = ack "ฉันไม่ทำอะไร
turn นี้"); execute turn N **ต่อเมื่อได้ครบทั้ง 3 คนสำหรับ turn N**; **input delay
= 2 turns** (intent ที่ผู้เล่นกด ณ ตอนนี้ถูก schedule ไปลงที่ turn `current+2`
≈ 200ms).

**เหตุผล**:
- per-frame 60Hz lockstep บน 50-200ms latency = ต้องรอ packet ทุก 16ms → กระตุก
  ทันทีที่ jitter เกิน 1 เฟรม. bucket 100ms + delay 2 turns ทำให้ ณ ต้น turn N
  ทุกเครื่อง **มี input ของ N ครบแล้ว** (มันมาถึงช่วง N-2/N-1) → sim ไม่เคยหยุดรอ
  เว้นแต่ packet สายจริง >200ms.
- เกม idle = ส่วนใหญ่ turn **ไม่มี input** เลย → เน็ตแทบเงียบ (3 คน × 10 msg/s =
  30 msg/s/ห้อง จิ๋วมาก). ack ว่างเปล่ายังจำเป็นเพื่อบอกเพื่อนว่า "เดินหน้าได้".
- 100ms turn = ปรับ **adaptive** ได้ทีหลัง (ยืด turn ตาม p95 RTT ที่วัดจาก probe)
  โดยไม่แตะ engine.
- **local render ลื่น**: engine deterministic + local client sim turn ที่ตกลง
  แล้วล่วงหน้าได้เรื่อย ๆ; renderer/UI ยัง real-time (เหมือน timeDirector วันนี้).

Packet สาย/หาย ณ เวลา execute → **soft-pause** ("รอผู้เล่น…") พร้อม grace ~3-5s →
ถ้าไม่กลับ เข้าสู่ shadow-body takeover (ข้อ 9).

### 2. Input schema: อะไร replicate / อะไร local

**Replicate (เข้าสนามร่วม — เป็นส่วนหนึ่งของ `TurnInput`, routed ด้วย `playerSlot`)**:
ทุก `FrameInput` ที่ **เปลี่ยน state ที่แชร์กัน**:
`moveTo` · `attackTarget` · `cancelCommand` · `castSkills` · `setAutoSlots` ·
`allocateStat` · `evolveHero` · `acceptQuest` · `useConsumable` · `buyShopItem` ·
`useReturnScroll` · `equip` · `materialsDelta` · `goldCredit` · `setBotSettings` ·
`setAutoHunt` · การเดินโซนระดับปาร์ตี้ (ข้อ 3).

**Local-only (ไม่ replicate, ไม่แตะ shared sim)**: กล้อง, sound mute, panel ที่เปิด
อยู่, การเรนเดอร์จอดรอปของตัวเอง (ข้อ 5).

⚠️ **กับดักสำคัญ — pattern "UI-owned toggle mirror ลง GameState ทุกเฟรม" พังใน
shared sim**: วันนี้ `autoCast`/`autoAllocate`/`autoReturn`/`autoHpPotion`/
`autoManaPotion`/thresholds เป็น store field ที่ถูก copy ลง `GameState` ทุกเฟรม
และ **มีผลต่อ sim** (auto-cast ยิงสกิล, auto-allocate แจกแต้ม, auto-potion กินยา).
ใน solo ไม่มีปัญหา; ใน sim ร่วม **มันทำ sim แตกทันที** (เครื่อง A เปิด autoCast ให้
ฮีโร่ตัวเอง แต่เครื่อง B ไม่รู้ → ฮีโร่ A ยิงบน A แต่ไม่ยิงบน B → desync).
**ทางแก้**: ย้าย automation config ทั้งชุดให้เป็น **per-hero field ใน shared
state** (`hero.config.autoCast` ฯลฯ) เปลี่ยนผ่าน replicated intent `setHeroConfig`;
ผู้เล่นแก้ได้เฉพาะฮีโร่ตัวเอง; shadow body ใช้ config ล่าสุดของเจ้าของ.

### 3. โซนแบบ free-roam + "same-zone cohort" (เจ้าของ OVERRULE ดราฟต์แรก 2026-07-08)

> ดราฟต์แรกเสนอ "ทั้งปาร์ตี้ล็อกโซนเดียวกัน ย้ายพร้อมกัน" — **เจ้าของไม่เอา**:
> อยากได้ free style สมาชิกใครอยากฟาร์มโซนไหนก็ไป.

**ตัดสินใจ (ตามเจ้าของ)**: ปาร์ตี้ = **social container** (สถานะ/emoji/invite ไหล
ผ่านห้องตลอด) แต่ **shared sim เกิดเฉพาะ "cohort" = สมาชิกที่อยู่โซนเดียวกัน**:

- สมาชิกที่อยู่คนเดียวในโซน → รัน **solo sim ปกติทุกประการ** (โค้ดเดิม ไม่มี
  lockstep overhead, ไม่มี input delay) — คนเล่นเดี่ยวในตี้ไม่รู้สึกอะไรเลย.
- สมาชิก ≥2 คนในโซนเดียวกัน → โซนนั้นเป็น **cohort sim ร่วม** (lockstep ตาม
  ข้อ 1): เห็นตัวกันจริง ช่วยกันตี. เกิด/เลิก cohort เมื่อสมาชิกเข้า/ออกโซน →
  **deterministic re-seed** ที่ zone boundary (กลไกเดียวกับ join ข้อ 4).
- **รางวัลปาร์ตี้ได้เฉพาะใน cohort เดียวกัน**: exp buff + แชร์ exp (ดูข้อ 5).
  อยู่คนละโซน = ไม่มี buff ไม่มีรางวัลร่วมใด ๆ — เป็นแรงจูงใจให้มาฟาร์มด้วยกัน
  โดยไม่บังคับ.

**เหตุผล**: โครงนี้เก็บ solo path เดิมไว้ byte-identical (ลดความเสี่ยง regression
มหาศาล), lockstep จ่ายราคาเฉพาะตอนได้ของแลก (เห็นเพื่อน+buff), และ re-seed
boundary เดิมรองรับ cohort เกิด/สลายได้โดยไม่ต้องมี snapshot transfer.

### 4. Join / leave / mid-session join: **join-at-zone-boundary, ไม่มี snapshot transfer**

**ตัดสินใจ**: **ไม่โอน live state ข้ามเน็ต**. ตอนมีคนเข้าห้อง (หรือย้ายโซน) ทำ
**coordinated re-seed**: leader (หรือ slot เลขต่ำสุด) เลือก room-seed + starting
tick; ทุกเครื่อง `initGameState`/`initHeroes` สนามใหม่จาก (ก) progression payload
ของฮีโร่แต่ละคน (เล็ก — server-authoritative จาก boot payload) + (ข) seed ที่ตกลง.
สนามรบ (enemies/projectiles) เป็น transient อยู่แล้ว rebuild จาก progression ได้
→ **ไม่ต้องส่งสนามเลย**. Mid-combat join = เลื่อนไปลงที่ zone boundary ถัดไป.

**เหตุผล**: engine ออกแบบมาให้ rebuild battlefield จาก progression อยู่แล้ว
(`initHeroes` loop เขียนเผื่อ party ไว้). re-seed = จุด re-sync ที่ deterministic
โดยกำเนิด, กันปัญหา snapshot ไม่ตรง/หนัก.

### 5. Save + gold/exp duplication: **แต่ละคนเซฟฮีโร่ตัวเอง; ไม่มี cross-credit**

**ตัดสินใจ**:
- shared sim credit **exp + gold แบบ deterministic ให้ทุกฮีโร่ที่ present** เท่ากัน
  ทุกเครื่อง (ทุก client คำนวณเลขเดียวกัน).
- **แต่ละ client `POST /api/save` เฉพาะ `heroes[myPlayerSlot]` ของตัวเอง** — คนหนึ่ง
  เขียน save ของอีกคน**ไม่ได้** → ไม่มีทาง dupe ข้ามบัญชี.
- **drop = per-player, อยู่นอก shared sim**: ปัจจุบัน drop roll ใช้ `lootHash(salt,
  counter)` แบบ stateless แยกจาก wave RNG อยู่แล้ว. ย้าย `lootSalt`/`lootCounter`/
  การ roll ออกจาก shared `GameState` ไปเป็น **local drop ledger ต่อ client**: shared
  sim ปล่อย kill event → แต่ละ client roll ดรอปของ **ฮีโร่ตัวเอง** จาก salt/counter
  ของตัวเอง, claim ที่ server ด้วย `${characterId}:${rollId}` เหมือนวันนี้เป๊ะ →
  "ของดรอปจอใครจอมัน" + ดวงใครไม่กระทบ sim ร่วม.

**เหตุผล**: shared = ทุกคนได้เต็ม (co-op ใจกว้าง) หรือหาร (balance flag, ข้อ 11) —
**กฎต้องเป็น pure function ของ "ใคร present"** เพื่อให้ทุกเครื่องเห็นตรงกัน. server
re-derive (ข้อ 10) ตรวจ gold/level ของแต่ละคนเทียบเพดาน + transcript.

### 6. RNG discipline กับ 3 ฮีโร่

- **wave RNG stream (`rngState`) เป็นของห้อง** seed ตอนสร้างห้อง, เดินหน้าโดย shared
  `step()` เหมือนกันทุกเครื่อง. combat/skills **ไม่ดึงจากมัน** (กติกาเดิม) → เพิ่ม
  ฮีโร่ไม่เพิ่ม draw. `spawnMob` draw order ต้องคง fixed (kind → temperament →
  placement → makeEnemy 2 draws) — การ scale mob ต่อจำนวนคนทำผ่าน `maxAlive`/
  killGoal ที่เป็น pure function ของ `partySize` (shared) → draw sequence ตรงกัน.
- **loot salt/counter ออกจาก shared sim** (ข้อ 5) → per-client ล้วน.

### 7. Desync detection + resync

- ทุก turn boundary (100ms) แต่ละ client แนบ **32-bit state hash** ของ turn ที่
  เพิ่ง execute ไปใน `TurnInput` ถัดไป (canonical fields: ต่อฮีโร่ hp/x/level/stats/
  mana, enemies count + ตำแหน่ง quantized, `rngState`, tick). relay broadcast; ทุก
  client เทียบ hash ของเพื่อนกับของตัวเองที่ tick เดียวกัน.
- **mismatch = ควรเป็น BUG ไม่ใช่เหตุปกติ** (sim pure/deterministic). hash =
  canary จับ determinism bug ให้ QA + safety net.
- **resync**: ไม่มี snapshot → resync = **re-seed ที่ zone boundary ถัดไป** (เหมือน
  join); worst case ประกาศ 1 เครื่องเป็น authority แล้ว force re-init จาก
  progression payloads.

### 8. ⚠️ ความเสี่ยง float-determinism ข้าม JS engine (ต้อง audit ใน Phase 1)

`combat.ts` ใช้ **`Math.sin`** (mob wander, บรรทัด 164) และ **`Math.hypot`**
(projectile, 453/477); `config/index.ts` มี `Math.pow`/`sqrt` ในเคิร์ฟ.
IEEE-754 **ไม่บังคับ** correct-rounding ของ sin/cos/hypot/pow → ผลอาจ **ต่างกัน
ข้าม V8 (Chrome) / JavaScriptCore (iOS Safari) / SpiderMonkey (Firefox)** →
lockstep desync ข้ามเบราว์เซอร์. owner กติกา desktop+mobile first-class = ต้อง
รองรับ Safari. **ต้องแก้**: แทน transcendental ในเส้นทาง sim ด้วย lookup table /
fixed-point / พหุนามที่ deterministic (config curve คำนวณครั้งเดียวตอน init ก็พอ
ถ้าไม่อยู่ใน hot sim path). +/−/*/÷ ของ double เป็น deterministic ข้ามเอนจิน ปลอดภัย.

### 9. Disconnect → shadow-body takeover

หยุดส่ง `TurnInput` → soft-pause grace ~3-5s → ฮีโร่คนนั้นกลายเป็น **shadow body**:
AI ขับด้วย **deterministic policy ใน shared sim** (reuse `bots.ts` เป็น pure
function ของ shared state — **ไม่ต้องมี input จากเครื่องไหน** → ทุกเครื่องคำนวณ
เหมือนกัน) ใช้ stat/skill/autocast config ล่าสุดของเจ้าของ (มีใน shared state แล้ว).
**รายได้ของ shadow body = cosmetic สำหรับคนที่ยังอยู่เท่านั้น** — เจ้าของที่หลุด
**ไม่ถูก cross-credit** จากเครื่องอื่น (นั่นคือ dupe); เจ้าของ bank ผ่าน
**offline-idle catch-up ปกติ** (capped pool เดิม) ตอน login ครั้งหน้า. สมาชิกที่
offline ตั้งแต่ต้น (ถูกชวนแต่ไม่ออนไลน์) = shadow body แบบเดียวกัน.

### 10. Relay โง่แค่ไหน + replay validation

**relay (VPS KVM1, Node core ws / hand-roll RFC6455 จาก probe, zero game import)**
รับผิดชอบแค่ 2 อย่าง: (ก) **membership** (create/join/leave, cap 3, แจก `playerSlot`
+ room-seed), (ข) **ordered fan-out** ของข้อความ **opaque** `{roomId, fromSlot,
tick, payload}` — broadcast ให้สมาชิกที่เหลือ. **ไม่ parse game, ไม่รัน step(), ไม่
เก็บ game state, ไม่ validate input**. เก็บแค่ last-seen ต่อ member (จับ grace timer)
+ ส่ง control "member left". ไม่กี่ร้อยบรรทัด.

**replay validation (ทำทีหลังตาม GDD)**: relay/validator job **log transcript**
(ordered `TurnInput` + room-seed + progression payload เริ่มต้น). งาน async passive
**re-run pure `step()` headless** (engine เป็น pure TS รันบน Node ได้) แล้วเทียบ
level/gold/kills ที่แต่ละคน **save** กับผลจาก transcript + **เพดาน plausibility**
(max xp/gold ต่อนาทีจริง ต่อโซน). deterministic → server reproduce ผลจาก input ล้วน.

**Anti-cheat surface**: (ก) save ปลอม → จับด้วย re-derive เทียบ transcript; (ข)
input ที่ผ่าน guard แต่ไม่ควรเกิด → engine guard no-op เองอยู่แล้ว (เช่นร่ายสกิลที่
ยังไม่เรียน) → re-derive ปฏิเสธโดยธรรมชาติ; (ค) รวมหัวฟาร์มโซนอ่อนเร็วผิดปกติ →
เพดาน per-zone จับ. transcript = audit trail. v1 เริ่มด้วยเพดานบน save (เหมือน
วันนี้) ก่อน; transcript re-derive เติมทีหลัง.

---

## 🧱 อะไรเปลี่ยนที่ไหน (engine / server / ui) — เป็น phase ให้ orchestrator แจกงาน

> ทุก engine phase **เทสต์ headless ได้โดยไม่มี relay จริง**: in-memory relay +
> LockstepRoom driver ขับ 2-3 simulated client ใน vitest.

**Phase 1 — engine: multi-hero state refactor (ใหญ่สุด, `engine/**`)**
- ย้าย economy/config **ต่อฮีโร่**: `gold`/`materials`/`consumables`/`goldEarned`/
  `xp` + automation config (`autoCast`/`autoAllocate`/`autoReturn`/`autoHunt`/
  `autoHpPotion`/`autoManaPotion`/thresholds) จาก global `GameState` → `Hero`.
- เหลือ **shared-only** บน `GameState`: `location`/`traveling`/`fastTravelCast`/
  `enemies`/`boss`/`projectiles`/spawn pool/`rngState`/`nextId`/`time`/`stage`/
  `phase`/`unlockedZones`.
- **ลบ** `lootSalt`/`lootCounter`/drop-roll ออกจาก shared sim → local ledger (ข้อ 5).
- `step()` รับ **per-hero input map** (`Record<playerSlot, FrameInput>`) แทน 1
  FrameInput; ทุก system iterate ทุกฮีโร่; `applyManualCommand`/`processSkills`/
  ฯลฯ route ตาม slot.
- **คง solo (1 ฮีโร่) byte-identical** (SAVE ไม่ต้อง bump ถ้า solo save ยังดึง hero 0);
  รัน `pnpm sim` ยืนยันทุก gate.
- **audit + แก้ float-determinism** (ข้อ 8): `Math.sin`/`hypot` ใน sim path.
- เทสต์: 2-3 ฮีโร่โซนเดียว, `rngState` ร่วม, สองรัน independent ให้ผล byte-identical.

**Phase 2 — engine: party sim rules (`engine/systems/**`)**
- shared exp/gold credit ต่อฮีโร่ present (กฎ pure; multiplier = balance flag).
- spawn `maxAlive`/killGoal scale ด้วย `partySize` (knob, **balance-flagged** —
  ปล่อยให้ sim-harness เคาะ).
- deterministic shadow-body AI policy (reuse `bots.ts` เป็น pure fn ของ shared state).
- `setHeroConfig` replicated intent.

**Phase 3 — engine harness: lockstep (`engine/__tests__/**`)**
- in-memory relay + `LockstepRoom` (bucket per-hero `TurnInput` เป็น turn 100ms/6
  sub-steps, execute เมื่อครบ 3 คน, คำนวณ state hash).
- vitest: 2 simulated client → state hash ตรงทุก turn + final state ตรง; inject
  bundle สาย/หาย → assert soft-pause; inject divergence → assert hash จับได้.

**Phase 4 — server: relay + rooms (`server/**`, VPS)**
- Node ws relay โง่ (membership + fan-out, ข้อ 10) บน KVM1 + Nginx WS upgrade.
- account/friends มาจาก M8 Phase 0 (polling) แล้ว → invite → room create/join,
  warp-to-member, presence/grace. แต่ละ client เซฟฮีโร่ตัวเองผ่าน `/api/save` เดิม.

**Phase 5 — server: replay validation (ทีหลัง)**
- transcript logging + passive re-derive job + เพดาน plausibility ต่อโซน (ข้อ 10).

**Phase 6 — ui/render (`app/**`, `ui/**`, `render/**`)**
- เรนเดอร์ 3 ฮีโร่ (paper-doll + ออร่า = จุดว้าวของ party ตาม GDD), จอดรอป per-player,
  party HUD (hp/mana เพื่อน), emoji, overlay "รอผู้เล่น", warp-to-member flow,
  shadow-body (จาง + ป้าย offline), กล้องโซนร่วม. touch + desktop เท่ากัน.

---

## ❌ ตัดออกจาก M8 party v1 (cut lines)

- **open-world เห็นคนแปลกหน้าในแมพ** (party-only rooms เท่านั้น)
- **cross-zone party** (สมาชิกอยู่คนละโซน) — v1 โซนเดียวร่วมกัน
- **เดินข้ามโซนอิสระรายคนระหว่างอยู่ปาร์ตี้** (การย้ายโซน = party action + re-seed)
- **mid-combat join** (เข้าได้เฉพาะ zone boundary)
- **spectating**, **voice/chat** เกินกว่า emoji
- **ปาร์ตี้ >3 คน**
- **authoritative real-time server sim** (คง client-side lockstep; server ตรวจ
  ย้อนหลังเท่านั้น)

---

## ✅ คำตอบเจ้าของ (2026-07-08)

1. **ย้ายโซน**: ไม่มีคำสั่งกลาง — **free-roam** ใครอยากไปไหนไป (ดูข้อ 3 ฉบับแก้).
   ประตูห้องบอสยังกติกาเดิมรายคน; ตี bosses ด้วยกันได้เมื่ออยู่ cohort เดียวกัน.
2. **รางวัล**: อยู่โซนเดียวกัน = **exp buff + แชร์ exp กัน**; คนละโซน = ไม่มี
   buff/รางวัลร่วมเลย. (ตัวเลข buff/สูตรแชร์ = คำถาม sim-harness, ยังไม่ตั้งเลข —
   รวมถึง mob density/killGoal ต่อหัวใน cohort.)
3. **turn length 100ms** — เจ้าของ ok.
4. **shadow-body income** — เจ้าของยังไม่เข้าใจคำถาม; อธิบายใหม่แล้วรอเคาะ
   (ประเด็น: ตัวเงา AI ที่ตีต่อหลังเราหลุด/ออฟไลน์ ควรได้รายได้แบบไหน —
   เข้า pool offline-idle ที่มี cap เดิม หรือได้เต็มเหมือนออนไลน์).

