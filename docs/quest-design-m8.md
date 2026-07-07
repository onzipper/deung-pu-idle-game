# 📜 M8 Quest System เต็มรูป — Main / Daily / Board Design

> **สโคป**: ยกระบบเควสจาก v1 (เควสเปลี่ยนคลาสอย่างเดียว — `Hero.quest` ช่องเดียว)
> ให้เป็นระบบเต็ม 3 เสา ตาม GDD.md M8: **เควสหลัก (main line)** สอนโลก + **เควส
> รายวัน (daily)** ให้เหตุผลกลับมาเล่นแบบ cozy + **กระดานเควส (board)** ใน
> เมือง · บวก **เปลี่ยนคลาสสายถัดไป (tier 4) + สกิลชุดใหม่** — ซึ่งเอกสารนี้
> **แนะนำให้แยกเป็น M8.5** (เหตุผล §4).
>
> อ้างอิง: `src/engine/systems/quests.ts` (เควส v1 หลัง party P1b — multi-hero
> loop) · `src/engine/entities/index.ts` §Quest (จุดขยายที่เขียนเผื่อไว้:
> `QuestObjectiveType` union, rewards, chain id, quest LOG) · `docs/GDD.md`
> §🧍/§🗺️/§🏘️ · `docs/party-design-m8.md` (รูปแบบเอกสาร + กติกา save-per-hero /
> server-authoritative) · `state/version.ts` (SAVE ปัจจุบัน v16)
>
> ⚠️ เอกสารนี้ = **design**. ตัวเลข balance (จำนวน kill รายวัน, reward, gate
> เลเวล tier-4, ตัวเลขสกิล-5) เป็น **คำถามของ sim-harness** ไม่เคาะในนี้.

---

## 🎯 North-star

เควสต้อง **สอนโลกโดยไม่รู้สึกเป็นภาระ** และ **ให้เหตุผลกลับมาเล่นทุกวันโดยไม่มี
FOMO** — สอดคล้องกับจุดยืน cozy ของเกม (GDD: "ตาย→เมือง ไม่มีโทษ", automation ต้อง
โง่ ไม่เล่นแทนให้เก่งที่สุด, endgame friction ตั้งใจ). กติกาเหล็ก 3 ข้อ:

1. **เควสหลัก = สันหลังของ goal-ladder เดิม** ไม่ใช่ระบบซ้อนใหม่ที่ต้องซิงก์กับ
   progression สองชุด — ส่วนใหญ่ **derived** จาก state ที่มีอยู่แล้ว
   (`unlockedZones`/`level`/`tier`), persist เฉพาะ "เคลม reward ไปหรือยัง".
2. **รายวัน = presence ไม่ใช่ optimization** — reward ห้าม gate พลัง, ห้าม
   punishing-streak; พลาดวันได้โดยไม่เสียอะไร.
3. **server ตัดสินเวลา + การเคลม** (เหมือน HOF ingest / ระบบซื้อคืน) — client เดา
   วันเองไม่ได้; determinism + re-derive cap เป็นด่านสุดท้าย.

---

## 🔑 การตัดสินใจหลัก

### 1. เควสหลัก (Main quest line) — ห่อ goal-ladder เดิม ไม่แทนที่

**ตัดสินใจ**: เควสหลักเป็น **สายบท (chapter chain)** หนึ่งบทต่อ map, แต่ละบทมี
sub-objective แบบ **"ไปถึงโซน X → ฆ่ามอน N ตัว/สายพันธุ์ในแมพนี้ → เคลียร์บอส
ปิดแมพ"**. แต่มัน **ไม่ถือ persisted state ซ้ำกับ progression** — บทปัจจุบันและ
ความคืบหน้าของแต่ละ sub-objective เป็น **pure function ของ state ที่มีอยู่แล้ว**
(`effectiveUnlockedZones`, `zoneKills`, `level`, `tier3GateCleared` ฯลฯ) พอดีกับ
ที่ **goal card วันนี้คำนวณ "สิ่งที่ควรทำต่อไป" แบบ derived อยู่แล้ว** — เควสหลัก
แค่ทำให้มันเป็นทางการ + มี narrative + มี reward เคลมได้.

- **สิ่งเดียวที่ persist** = `hero.mainClaimed: string[]` (id ของบทที่ **เคลม
  reward แล้ว**) — กัน double-claim ตอน migrate-on-every-save. บทที่ "ทำเสร็จ"
  ยัง derived (progression บอกเอง); แค่ reward ต้องจำว่าให้ไปแล้ว.
- **อยู่ร่วมกับ goal-ladder UI**: goal card **กลายเป็น** ตัวแสดง "ขั้นเควสหลัก
  ปัจจุบัน" (title/desc/ปุ่ม guide-me เดิม reuse ทั้งหมด) — ไม่เพิ่ม HUD ใหม่.
- **อยู่ร่วมกับเควสเปลี่ยนคลาส (tier2 Lv15 / tier3 Lv40 / tier4 Lv70)**: เควส
  วิวัฒน์ = **โหนดพิเศษบนสันหลังเดียวกัน** ที่ขอบบท (จบ map ก่อนหน้า → บทถัดไป
  เปิดด้วยเควสเปลี่ยนคลาส). โครง `Hero.quest` ช่องเดียวเดิม **คงไว้** สำหรับเควส
  วิวัฒน์ (มันแยกกันตาม tier อยู่แล้ว mutually-exclusive) — เควสหลักไม่ยึดช่องนี้.

**เหตุผล**: หลีกเลี่ยง "สองแหล่งความจริงของ progression" (บั๊กคลาสหนักที่สุดของเกม
เกิดจาก state ซ้ำ). ทุกอย่างที่ derived ได้ = ไม่ bump SAVE, ไม่มี migrate เสี่ยง,
sim byte-identical โดยกำเนิด.

### 2. เควสรายวัน (Daily) — presence ไม่ใช่ optimal-play

**ตัดสินใจ — objective types ที่ปลอดภัย** (ให้เหตุผลกลับมาเล่น ไม่รางวัลการเล่น
เก่งสุด, idle-friendly):

| ปลอดภัย ✅ (reward presence) | ห้าม ❌ (สร้าง FOMO/optimal-play) |
|---|---|
| ฆ่ามอน N ตัวในโซน**ที่ฟาร์มได้อยู่แล้ว** (any unlocked) | "ฆ่าให้เร็วที่สุด" / จับเวลา |
| ตีบวก (refine) 1 ครั้ง · ย่อยของ N ชิ้น | "ฟาร์มของ rare สายพันธุ์เจาะจง" |
| ซื้อยา N ขวด · ใช้เงิน N ที่ NPC | "ไปถึงโซนใหม่" (ดัน progression = กดดัน) |
| เคลียร์บอสโซนไหนก็ได้ 1 ครั้ง | "เก็บ gear tier X" (ผูกกับดวง/เวลา) |
| กลับเข้าเมือง / คุย NPC (นุ่ม ๆ กึ่ง login) | อะไรที่ทำให้ "ต้องเล่นนานขึ้นวันนี้" |

- **จำนวน = 3 เควส/วัน** (echo ช่อง auto-cast 3), เล็กพอจบใน session ปกติ.
- **reward = gold / วัสดุตีบวก (stones) / ยา เท่านั้น** — **ห้าม** gear พลัง, ห้าม
  XP ที่ดัน gate progression, ห้ามอะไรที่ทำให้ "ไม่ทำ = ตามหลัง". รายวัน
  **optional 100%**.
- **ไม่มี streak ลงโทษ**: อย่างมากมี streak นุ่ม ๆ ให้ stones เพิ่มนิดหน่อย
  (cosmetic-adjacent) แต่ **พลาดวันแล้ว streak รีเซ็ตเฉย ๆ ไม่มี pop-up เร่ง ไม่มี
  นับถอยหลัง** — ตรงจุดยืน cozy. (แนะนำ v1 **ไม่มี streak เลย** ก่อน; เพิ่มทีหลัง
  ถ้าเจ้าของอยาก.)
- **รีเซ็ต = server-authoritative**: ขอบวันคิดจาก **server clock + timezone คงที่
  (แนะนำ Asia/Bangkok UTC+7)**, ไม่ใช่ client. roster ของวันนี้ **seed
  deterministic จาก `(serverDay, userId)`** → ทุกคนได้ชุดต่างกันแต่ reproduce ได้
  (audit ง่าย, กัน reroll).
- **Trust model = เหมือน economy วันนี้** (client-authoritative + เพดาน): engine
  นับ progress ลง per-hero counter (deterministic เหมือน `advanceQuestObjective`
  วันนี้); ปุ่ม **เคลม** ยิงไป server; server เช็ค (ก) วันตรง (ข) ยังไม่เคลม questId
  นี้วันนี้ (unique constraint) (ค) progress ≥ target (เชื่อ save เหมือน gold) แล้ว
  credit reward ผ่าน choke point เดิม + re-derive plausibility เป็นด่านหลัง.

**เหตุผล**: reward-presence + no-streak-punish = ให้เหตุผลเปิดเกมโดยไม่ทรยศ cozy
tone; server-day + seed = ไม่มีทาง reroll/ปลอมวัน; นับ progress ใน engine =
determinism เดิม, ไม่มี RNG combat draw.

### 3. กระดานเควส (Board) — NPC ที่ 3 ในเมือง, reuse tap-to-talk

**ตัดสินใจ**: เพิ่ม **NPC ที่ 3** ในเมือง (ผู้ให้เควส — แนะนำ "ผู้ใหญ่บ้าน" หรือ
เจ้าหน้าที่กระดาน) anchor ผ่าน `CONFIG.townNpcs` (เป็น array อยู่แล้ว — เพิ่มแถว
เดียว `{ id: "npc:board", x: …, radius: 42 }`). เปิดแผงด้วย **tap-to-talk เดิม
เป๊ะ** (round-3: แตะนอกระยะ→เดินไปหา, แตะในระยะ→คุย+เปิด panel ผ่าน ModalPortal;
เดินออก→ปิดอัตโนมัติ). ไม่ทำ panel ลอยแบบใหม่ — ใช้ TownNpcPanelHost ที่มีอยู่.

- **เนื้อในแผง**: (ก) tracker เควสหลักบทปัจจุบัน (read-only, ปุ่ม guide-me) (ข)
  รายวัน 3 อัน + progress bar + ปุ่มเคลม (ค) [ภายหลัง] bounty หมุนเวียน.
- **town-only** (เหมือน refine/shop) — บอทแตะได้เฉพาะ flavor bubble, **ห้ามเปิด
  panel/เคลมแทน** (กติกา automation โง่).
- **จำนวน concurrent = 3 รายวัน**; board ไม่ถือ quest slot ของ engine.

**เหตุผล**: pattern NPC-tap-to-talk พิสูจน์แล้วใน round-3 + mobile-safe ผ่าน
ModalPortal; `townNpcs` array ทำให้เพิ่ม NPC เป็น config change ล้วน.

### 4. ⚠️ เปลี่ยนคลาส tier-4 + สกิลชุดใหม่ — **แนะนำแยกเป็น M8.5**

**FLAG (ต้องเจ้าของเคาะ)**: อันนี้เป็น **content + balance wave เต็มตัวของมันเอง**
ขนาดเท่า M7.9 (ซึ่งใช้ทั้ง PR #10-11): 3 คลาสใหม่ + สกิล-5 มี spectacle + อาจต้อง
gear tier/aura ขั้นใหม่ + **sim gate ใหม่ทั้งชุด**. M8 core (account→friends→
websocket→lockstep party) ใหญ่และเสี่ยงมากอยู่แล้ว. **แนะนำ: M8 ส่งเฉพาะ
"framework เควส (main/daily/board)"; tier-4 คลาสไปเป็น M8.5** — framework เควสไม่
พึ่ง websocket จึงดึงขึ้นก่อน/คู่ขนาน party ได้ (เหมือน M7.95 HOF).

**รูปทรง (high-level, ตัวเลข sim ทีหลัง)** — ตามบทเรียน tier-3 ที่เจ้าของรัก
(**ไต่เองก่อน ห้ามข้ามโซน**):

- **Gate เลเวล = Lv70** (cap 90 → เหลือ 20 เลเวล endgame; ช่วง gate กว้างขึ้น
  15→40→70 = endgame friction ตั้งใจ).
- **เงื่อนไขไต่ก่อน**: ต้อง **เคลียร์บอส map6 (s30) ด้วยตัวเอง** ก่อน access
  (persist-unlock เหมือน `tier3GateCleared`); quest = kill grind ใน frontier
  map6 + บอส quest-scaled — reuse `tier3QuestBossScale`/access-grant pattern.
- **ชื่อคลาส (เสนอ, รอเจ้าของ)**:
  - ดาบ: นักดาบ→อัศวิน→จอมอัศวิน→**"จอมพลอมตะ" / EN Warlord (หรือ Sword Saint)**
  - ธนู: นักธนู→ราชาพราน→ราชันพราน→**"เทพศรอมตะ" / EN Stormlord (หรือ Astral Ranger)**
  - เวท: นักเวท→จอมเวท→อาร์คเมจ→**"เทพเวท / EN Archon (หรือ Grand Sorcerer)"**
- **สกิล-5 (signature ต่อคลาส, spectacle ระดับ M7.9 skill-4)**: ดาบ = ฟันแยกพื้น
  execution วงกว้าง · ธนู = ห่าธนูมืดฟ้าถล่มสนาม · เวท = ฉีกมิติ/หลุมดำ. คาด
  spectacle เทียบ time-freeze 0.16s ของ skyfall (ผ่าน timeDirector).
- **⚠️ ประเด็นต้องเคาะ — auto slot**: GDD เขียน "auto-cast สูงสุด 3" แต่ tier-3
  เพิ่ม **auto slot 4** ไปแล้ว (M7.9). สกิล-5 จะได้ **slot 5** ไหม? หรือ tier-4
  ไม่เพิ่ม auto slot (สกิล-5 เป็น manual-only signature)? — เจ้าของเคาะ; เอกสารนี้
  แนะนำ **manual-only** (คุม endgame friction + ไม่ให้ automation เก่งเกิน).

### 5. Data model

**Engine state (SAVE bump → v17)**:

- ขยาย `QuestObjectiveType` union: `+ "reach" | "refine" | "salvage" | "spendGold"
  | "buyPotion" | "clearAnyBoss" | "talk"` — เพิ่ม counting hook ที่ **emission
  site เดิม** ของแต่ละ action (เหมือน kill/killBoss วันนี้ hook ใน combat resolve;
  **ห้ามอ่าน `state.events`**). objective เพิ่ม optional scope fields ได้
  (`mapId` มีแล้ว; อาจเพิ่ม `zoneScope: "unlockedAny"`).
- per-hero **daily block**: `hero.dailies = { day: number /*serverDay epoch*/,
  progress: Record<string, number>, claimed: string[] }` — reset เมื่อ `day`
  เปลี่ยน (server แจ้ง roster + day ตอน boot/save response).
- per-hero **`hero.mainClaimed: string[]`** (บทเควสหลักที่ credit reward แล้ว).
- **คง `Hero.quest` ช่องเดียว** สำหรับเควสวิวัฒน์ — ยังไม่ต้องทำ quest-log array
  ทั่วไป (เลื่อนไปตอน board bounty ซ้ำ ๆ มาจริง).

**Migration v16→v17 (จุด load-bearing)**: pre-v17 backfill `dailies` ว่าง +
`mainClaimed`. **⚠️ กับดัก**: ตัวละครที่เล่นไปไกลแล้ว ถ้า backfill
`mainClaimed=[]` จะกลายเป็น "ค้างเคลม reward ทุกบทที่ทำเสร็จไปแล้ว" — ผิด. **ทางแก้
(mirror วินัย v16 goldEarned=0 "ไม่จ่ายย้อนหลัง")**: ตอน migrate ให้ **มาร์ค
`mainClaimed` = ทุกบทที่ progression ปัจจุบันบอกว่าเสร็จแล้ว โดยไม่ให้ reward** →
ผู้เล่นเก่าเริ่มนับ reward จากบทถัดไปเท่านั้น. idempotent สำหรับ migrate-on-
every-save. dailies ว่าง = ปลอดภัย (ยังไม่ทำวันนี้).

**Server tables**:

- **`DailyClaim`** (audit + กัน double-claim ข้ามเครื่อง): `(userId, characterId,
  questId, serverDay, claimedAt, reward)` **unique (characterId, questId,
  serverDay)** — server-authoritative เหมือน `SoldItem`/HOF ingest. เคลมผ่าน
  `/api/quest/daily` (atomic check-and-set) → credit ผ่าน save choke เดิม.
- **เควสหลัก = ไม่มีตารางใหม่** — reward credit เป็น client-authoritative +
  re-derive cap เหมือน gold วันนี้ (`mainClaimed` กัน dup ใน save เอง). ถ้าต้องการ
  เข้ม เพิ่ม endpoint เคลมภายหลังได้แต่ MVP ไม่ต้อง.

**Events (render/UI juice, transient เดิม)**: `+ questRewardClaimed` ·
`dailyProgress` · `dailyClaimed` · `mainChapterComplete` — flow ออกทางเดียว
เหมือน `questObjectiveProgress`.

**i18n (โครง key ให้ content scale ไม่แตะโค้ด)**:
`quest.main.<chapterId>.{title,desc}` · `quest.daily.<templateId>.{title,desc}` ·
`quest.objective.<type>` (templated `{count}`/`{zone}`/`{map}`) ·
`quest.reward.<kind>`. Content ใหม่ = เพิ่ม key + config entry, ไม่แก้ logic.

### 6. Phasing (agent-sized · engine → server → ui · cut line M8 vs M8.5)

**M8 — Quest framework (ไม่พึ่ง websocket, ดึงคู่ขนาน party ได้)**

- **A. engine (`engine/**`)** — ขยาย `QuestObjectiveType` + counting hooks ที่
  emission site (reach/refine/salvage/spendGold/buyPotion/clearAnyBoss/talk);
  daily roster generator (deterministic `(serverDay,userId)` seed, นอก wave RNG);
  per-hero `dailies` + `mainClaimed`; **SAVE v17 migrate (มาร์ค-done-ไม่จ่าย)**;
  main-quest chapter model = **derived wrapper** รอบ goal-ladder. เทส + `pnpm sim`
  byte-identical ทุก gate.
- **B. server (`server/**`,`api/**`)** — ตาราง `DailyClaim` (db push) +
  `/api/quest/daily` (roster ตาม server-day, เคลม atomic unique, plausibility
  cap); credit reward ผ่าน save choke; roster + day พ่วง save response (เหมือน
  build-id banner) = zero extra request.
- **C. ui (`ui/**`,`render/**`)** — NPC ที่ 3 (config + rig) + board panel (reuse
  tap-to-talk/ModalPortal/TownNpcPanelHost); goal card → main-quest tracker;
  รายวัน 3 + progress + เคลม; i18n th/en; desktop+mobile.

**M8.5 — Class tier-4 (content+balance wave แยก, รอ M8 stable)**

- engine: tier-4 evolution quest def + สกิล-5 ต่อคลาส + SAVE domain-widen (tier 4,
  อาจ v18) + boss-scale/access-grant reuse + auto-slot decision.
- balance: sim gate ใหม่ทั้งชุด (Lv70 wall, class balance, potion burn).
- render: spectacle สกิล-5 + aura/paper-doll tier-4 + boss looks ใหม่.
- i18n / FTUE / codex / patch-notes.

---

## ❌ ตัดออกจาก M8 quest v1

- **class tier-4 + สกิล-5** (→ M8.5).
- **quest-log array ทั่วไป / เควสรับพร้อมกันหลายอัน** (main=derived, daily=block,
  evolution=ช่องเดียว → ยังไม่ต้อง).
- **board bounty หมุนเวียนแบบเลือกรับ** (เฟสถัดไป).
- **streak ลงโทษ / นับถอยหลัง / FOMO pop-up** (ขัด cozy — ห้ามถาวร).
- **reward รายวันที่เป็นพลัง/gear/gate progression** (ห้ามถาวร).

---

## ✅ ต้องเจ้าของเคาะ (sign-off)

1. **tier-4 → แยก M8.5** (แนะนำ) · **gate = Lv70** · **3 ชื่อคลาส** (เสนอไว้ §4) ·
   **สกิล-5 manual-only ไม่มี auto slot 5** (แนะนำ — GDD "max 3 auto" ถูกแตะไป
   แล้วที่ tier-3 slot 4, ต้องตัดสินทิศทาง).
2. **Daily reset timezone** = Asia/Bangkok UTC+7 คงที่ (แนะนำ).
3. **รายวัน reward ห้าม gate พลัง + ไม่มี streak ลงโทษ** — ยืนยันจุดยืน cozy/no-FOMO.
4. **NPC กระดานที่ 3** — ตัวตน/ชื่อ (เสนอ "ผู้ใหญ่บ้าน").
5. **Migration เควสหลัก = "มาร์ค-done-ไม่จ่ายย้อนหลัง"** สำหรับตัวละครเก่า — ยืนยัน
   ว่าไม่จ่าย reward ย้อนหลัง (mirror v16 goldEarned=0).
