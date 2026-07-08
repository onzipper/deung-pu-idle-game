# 🗺️ Roadmap & Task Tracker

> คู่กับ [GDD.md](./GDD.md) (vision — ถ้าขัดกันยึด GDD) · อัปเดต checkbox ที่นี่แทน ClickUp
> วิธีทำงาน: งานละ 1 commit ลง `develop` · จบ milestone → PR → `main` · balance เปลี่ยน = รัน sim เทียบ `balance-m4.md`

## ✅ เสร็จแล้ว

- **M1-M4.6** — engine (pure TS, deterministic) · Pixi render · React/Zustand HUD · MySQL+Prisma save · offline idle · balance harness · juice/animation/art/procedural characters
- **M4.7 i18n** — next-intl th/en (cookie, ไม่มี [locale] segment) · string extraction ครบ · `content.*` key pattern
- **M4.8 Onboarding** — step-registry framework + FTUE 7 step · contextual tips 5 ตัว · Codex 13 หัวข้อ + FTUE replay · mascot น้องดึ๋ง (SVG, 3 mood)
- **M5 (บางส่วน ก่อน pivot)** — per-hero XP/Level (SAVE v2) · tier evolution + UI/juice (SAVE v3) — ⚠️ จะถูก rework เป็นระบบตัวเดี่ยว + class change ผ่านเควสตอน M5 pivot

## ✅ M5 — Character Pivot ⭐ (เสร็จ 2026-07-05)

> เปลี่ยนจากทีม 3 ตัว → ตัวละครเดี่ยว — งานใหญ่ แตะทุก layer · SAVE v4→v7 · baseline ใหม่ `balance-m5.md`

- [x] **Engine pivot**: sim ตัวเดี่ยว (formation/targeting/wave ปรับ) + rebalance โซโล่ทั้งเกม + **ตัดสายอัปเกรด atk/speed/hp เดิม** — SAVE v4 (single character), solo respawn anti-stall, per-class solo balance S1→S10 (docs/balance-m5.md); multi-actor engine retained for M8 party. UI upgrade-panel/FTUE minimally patched (full UI redesign = later tasks)
- [x] **Character system**: สร้างตัว + เลือกอาชีพต้น (ดาบ/ธนู/เวท) + 3 slots/บัญชี — DB cutover live (backfill 36 saves), CRUD API + active-character cookie, หน้า /characters + class picker + server gate; save payload zod ย้ายเข้า engine (saveSchema.ts)
- [x] **Base stats**: แต้ม stat ตอนเวลอัป + จอแจกแต้ม + สูตร power รวม (ใช้กับ HOF ภายหลัง) — STR/DEX/INT/VIT 3 แต้ม/เวล, auto-allocate, `combatPower()` (แทน bossHint เดิม), SAVE v5, sim ±1% จาก baseline
- [x] **Mana + Skill framework v2**: mana pool/regen · สกิล 2-3 ต่อขั้นคลาส ปลดตามเวล · auto slot 1→3 ปลดตามเวล · สกิลนอก slot กดเอง — pool ผูก INT, kit 3 ใบ/คลาส (signature เดิม + ใหม่), SAVE v6, sim S1-S12 ทุกคลาส 0 walls
- [x] **Class change v1**: เควสอย่างง่าย (ฆ่าครบ/ไอเทม) → เปลี่ยนคลาสขั้น 2 (ต่อยอด tier ที่มี) — เควสเสนอที่ Lv15: ล่า 60 + บอส 1 แทนค่า gold, SAVE v7, จังหวะเปลี่ยนคลาส ~stage 5 ทุกคลาส
- [x] **FTUE/onboarding + codex rework** ให้ตรงเกมใหม่ (ของเดิมสอนกดสายอัปเกรดที่ถูกตัด) — FTUE 8 step (ทักตามคลาส/แจกแต้ม/จัดช่อง auto), tips 8 ตัว (เควส/แต้มค้าง/ช่องปลด), codex หมวด character ใหม่, กวาด copy ทีม/อัปเกรดหมดทั้ง repo

## ✅ M6 — World & Town (เสร็จ 2026-07-06)

- [x] Zone system: map → zones เดินถึงกัน (แตะขอบ/ลูกศร) + เงื่อนไขปลด zone + ย้อนฟาร์มอิสระ — engine zone/world layer (SAVE v8: location/unlockedZones/lastFarmZone), walk transit, unlock progression, town respawn + auto-return, boss-room gate; sim rebaselined per map/zone (docs/balance-m6.md); functional walk-controls UI. NPC shops = next task (zone kind "town" hook left)
- [x] ห้องบอสพิเศษท้าย map (ฉาก/การนำเสนอพิเศษ) — arena จริง (เสาประตู/vignette ค้างทั้งไฟต์) + entrance beat (สั่น/แฟลช/วงแหวน/drone) + biome *_BOSS แยกต่อ map
- [x] เมืองหลัก + NPC shops: ยาเลือด/ยามานา/ยันกลับเมือง (+ ของวาปปาร์ตี้ เปิดใช้ตอน M8) — ราคา scale ตามความลึก lastFarmZone, auto-use 35%HP/25%mana, gold sink แรกของเกม, SAVE v9; catalog ต่อขยายได้ (M8 warp = union append)
- [x] ตั้งค่าหลังตาย (auto กลับไปฟาร์ม / รอที่เมือง) — AutoReturnToggle + engine honor + auto-potion thresholds; ✔ ขยายเป็น settings panel เต็มแล้ว (SettingsPanel drawer, มากับ goal-ladder UI)
- [x] ธีม map + ฉากต่อ zone (ขยายระบบ biome เดิม) — biomeForZone ต่อ map family ไล่เข้ม/ระอุเข้าหาห้องบอส, เมืองอบอุ่น (หลังคา/ตะเกียง/ควันไฟ/เงา NPC), whoosh ตอนย้าย zone
- [x] **Combat rework "สนามล่ามอน"** (เคาะ 2026-07-05): มอนสุ่มเกิดกระจายใน zone (cap+respawn config), hero auto-hunt ไล่เป้า, มอน passive เป็นหลัก + aggressive (aggro radius) ใกล้ห้องบอส, กล้องนิ่งต่อ zone (เผื่อ config zone กว้าง), rebalance ใหม่ — aggro ไล่ระดับ 0→60% เข้าหาบอส, ความตายย้ายไป belt มอนดุ+บอสตามแผน, s15 wall อยู่, formation core เก็บไว้ให้ M8 · facing flip เสร็จแล้ว (b5e82d3)
- [x] Goal-ladder UI (ตาม ladder ใหม่: เวลถัดไป → เปลี่ยนคลาส/ผ่าน map → HOF → …) — pure rung-selection (goalLadder.ts + 14 tests) + breadcrumb 4 ขั้น (HOF = locked tail รอ M9), การ์ด core-loop แทน BossPanel เดิม (แถบเทียบพลัง แทนเลขดิบ 4 ตัว), แถบปลดโซนย้ายมารวม, FTUE anchors ครบ; แถม SettingsPanel drawer (auto-allocate/auto-return/เกณฑ์ยา/เสียง/ภาษา)
- [x] Hunt follow-up (engine): archer ตัน s13 — แก้ด้วย gradual re-entry fill (burst 0.35×maxAlive แล้ว trickle) + กติกา AoE-aggro (ปลุก ≤2 passive ใกล้จุดตกใน 0.6×radius, arrow rain ตัดสิน wake ครั้งเดียวตอน cast; deterministic ไม่ใช้ RNG) — sim: กำแพง archer ขยับ s13→s14, s15 soft-wall คงอยู่, map1+2 สะอาด, class change ยัง s5 (balance-m6.md "M6 task 5")
- [x] Hunt follow-up (engine): มอนซ้อนกัน — min-spacing placement แบบ best-candidate 5 draws (RNG bounded/deterministic)

## 🎨 M6.5 — Art & Game-feel (ปิดการทดลอง 2026-07-06)

> ผลสรุป: ทดลอง pixel-MMX3 (v1-3) และตัวละคร SVG อนิเมะ/RO (v4-5) ใน /proto แล้ว **เจ้าของไม่ชอบทั้งคู่ → คงสไตล์ procedural เดิมของเกม (M4.5-4.6) ไว้** · /proto ถูกลบแล้ว · จุดว้าว "ของสวมใส่" ยังอยู่ — จะสร้างบนริกสไตล์เดิมตอน M7 (มี precedent: tier-2 gold accents ทำแล้วได้ผลดี)

- [x] ทดลอง art direction ใน /proto → ปิด: คงสไตล์เดิม (decision log 2026-07-06)
- [ ] ~~ตัวละครใหม่~~ ยกเลิก — gear visuals M7 ทำบนริกเดิม
- [ ] UI skin (title/หน้าเลือกตัว/HUD กรอบเกม + ฟอนต์) — ✔ เจ้าของหยิบกลับมาแล้ว (2026-07-06) → ย้ายไปทำเป็น **M6.5b** ด้านล่าง

## ✅ M7 — Gear & Drops ⭐ (เสร็จ 2026-07-06)

- [x] **Item-instance model** (unique ID + ownerId + audit) + server-authoritative — API claim/equip/unequip/inventory ครบตาม tx recipes + invariant 1-7,9 (persistence-m7.md; ข้อ 8 trade = M9), claimKey idempotent, rate-plausibility ceiling, boot payload คืน inventory+equipped (DB ชนะ save-blob cache)
- [x] Drop tables อาวุธ+ชุด ต่อ zone/บอส — catalog 27 ชิ้น (อาวุธ 3 คลาส × t1-6 + เกราะ) band ตาม stage ผ่าน tierForStage; farm = on-curve tier, boss = guaranteed roll on-curve+next tier; drop roll = stateless splitmix32(lootSalt, lootCounter) ไม่แตะ wave RNG stream; SAVE v10; sim: no-gear ตรง balance-m6 เป๊ะ, geared นุ่ม s13/s14 แต่ s15 wall อยู่ (balance-m7.md)
- [x] Inventory + equip/loadout UI — InventoryPanel + EquippedLoadout, equip = API ก่อนแล้วค่อย engine intent, ท่อ claim แบบ batch/idempotent บน autosave cadence + sendBeacon, DropFeed toasts
- [x] **Paper-doll บนริกเดิม** (ตามมติ M6.5 — ไม่ใช่ตัวละครอนิเมะ/RO): อาวุธโตตาม tier จน t6 อลัง+ออร่าเปลวไฟซุปเปอร์ไซย่า (solid บน normal blend กัน white-out), เกราะ trim/gem + t5+ ระยิบ; pooled/capped คุม GPU; rig tests ครอบ geared bounds
- [x] โยงเข้า codex/collection — หมวด gear ใน codex, grid 27 ชิ้น ยังไม่เจอ = เงาจาง (v1 derive จาก inventory ปัจจุบัน)

## ✅ M7.5 — Sell, Bots & Inventory UX (เสร็จ 2026-07-06)

> ดีไซน์ที่เคาะแล้ว: **ขายได้เฉพาะในเมือง** (บอทวาปขายจึงมีความหมาย) · บอทใช้ **ยันกลับเมือง** วาป (ไม่มีต่อคิวเดินกลับเอง; บอทตั้งซื้อยันสำรองได้) · **กระเป๋า 100 ช่อง** (trigger บอท + กัน DB โต) · บอททำงานเฉพาะออนไลน์ v1 (offline idle เดิม) — trigger เป็น deterministic ฝั่ง engine ตามแพทเทิร์น autoReturn/auto-potion, ตัว transaction ซื้อ/ขายเป็น server ยิงเมื่อถึงเมือง

- [x] ขายร้าน NPC (ในเมืองเท่านั้น): endpoint ขาย = destroyItem (soft) + credit ทอง ใน tx เดียว + ItemEvent destroyed(meta ราคา); ราคาตาม tier/rarity ต่ำกว่ารายได้ล่า (กันเฟ้อ) — sink ต่อจากยา
- [x] Auto-sell rules (ตั้งใน Settings): เช่น "ขาย common ต่ำกว่า tier ของที่ใส่" + ปุ่ม bulk "ขาย common ทั้งหมด" — ประมวลผลตอนตัวถึงเมือง
- [x] บอทวาปขาย: กระเป๋าเต็ม (100) → ใช้ยันวาปเมือง → ขายตามกฎ → กลับไปฟาร์ม (autoReturn เดิม); ตั้งค่าได้ว่าขายอะไรบ้าง
- [x] บอทซื้อยา: ตั้ง stock เป้าหมาย HP/มานา + งบสูงสุด → ยาใกล้หมดวาปไปเติม (รวมทริปกับขายของถ้า trigger พร้อมกัน) + ซื้อยันสำรองตามตั้งค่า
- [x] Inventory UX ยกเครื่อง: stack ของซ้ำ (badge ×N) + grid ช่องแบบ RO (ไอคอน CSS-drawn, ขอบสี tier, เรือง rarity) + เทียบ delta กับของที่ใส่ (เขียว/แดง) + tab weapon/armor + sort tier + toggle "คลาสฉันใส่ได้" + badge NEW + แถบ 100 ช่อง
- [x] Fast travel ข้าม zone (คำขอเจ้าของ 2026-07-06): หน้าเลือกโซน → วาปไปโซนที่**ปลดแล้ว**ได้เลย ฟรี แต่มี cast time สั้น + ห้ามมีมอน aggro ติดตัว (ยันกลับเมือง = วาปทันทีแม้โดนรุม จึงยังมีค่า + บอทใช้); เดินเท้าเดิมคงไว้สำหรับโซนติดกัน/ปลดโซนใหม่ — engine: transit แบบ instant หลัง cast, deterministic; อัปเดต GDD หัวข้อโลกและการเดินด้วย
- [x] **ประตูเป็นตัวกลางของการย้ายโซนทุกแบบ** (ฟีลที่เจ้าของอยากได้ 2026-07-06): ขอบ zone มีซุ้มประตูตามธีม biome — เดินเข้าประตู → whoosh/แฟลช → โผล่หน้าประตูฝั่งโซนถัดไป (แทนเดินตกขอบจอ) · fast travel = ประตูวาร์ปวูบขึ้นข้างตัว (cast time = ประตูเปิด) เดินเข้าไปแล้ววาร์ป · **ห้องบอส = ประตูพิเศษ** ใหญ่/ขลังตามธีม map ล็อกอยู่จนเงื่อนไข boss-gate ผ่านแล้วค่อยเปิดพร้อม beat (ต่อยอด entrance beat + เสาประตู arena เดิม) — งานหลักอยู่ render/environment (props ประตูต่อ biome + portal fx pooled) + engine hook สถานะ transit เล็กน้อย
- [x] (เพิ่มระหว่างทาง) ปุ่ม AUTO เปิด/ปิดตีมอนอัตโนมัติบน HUD — engine gate ที่ huntableTargets (ปิด = ไม่ไล่เป้าใหม่ แต่สวนตัวที่ engaged, ห้องบอสบังคับสู้), SAVE v12

## ✅ M7.7 — Skill Spectacle & World Heat (เสร็จ 2026-07-06)

> ปัญหา: สกิลคล้ายกันหมด รัศมีกองกัน 85-120px ไม่มีท่าไม้ตาย · เคาะแล้ว: **สกิลเบิ้ม ดาเมจแรง ภาพอลัง** + cooldown ไม่ยาว โดย **มานา = ตัวคุมจังหวะ** (ยิงรัวได้แต่ถังแห้งเร็ว → ยามานากลายเป็น sink หลักคู่ยาเลือด) · โลกโหดขึ้นชดเชย: **มอน 15-20+ ต่อสนาม**, killGoal เพิ่มเพื่อ pacing (ความยากมาจาก belt มอนดุ ไม่ใช่โควตา) · **บัพบอส = ไว้ก่อน** (เจ้าของสั่งพัก) · กฎ AoE-aggro เปลี่ยนเป็น **"โดนสกิลแล้วรอด = ลุกมาสู้"** (แทนกฎปลุก ≤2) · เอกลักษณ์คลาส: ดาบ=บุกประชิดหมุนกลางวง / ธนู=ปืนใหญ่คลุมแถบ / เวท=นุกหนักจอสั่น · tier-2 = ultimate ระดับทั้งจอ

- [x] Engine: ยกเครื่องตาราง SKILL_LIST (รัศมี/ดาเมจ/มานา/cd แยกชั้นชัด, tier-2 = screen-wide), กฎ survivor-retaliation, มอนหนาแน่นขึ้น + killGoal + จูน mana economy — sim เทียบ balance-m6/m7 (คุม: เควสเปลี่ยนคลาส ~s5, s15 soft-wall อยู่, 0 stall)
- [x] Render: ภาษาภาพต่อคลาส (ดาบแดงกว้าง/ธนูห่าฝนแถบยาว/เวทอุกกาบาตจอมืด+สั่น), fx ตาม tier สกิล, perf pass สนาม 20 ตัว (pooled/capped, มือถือ)
- [x] UI เล็ก: readout มานา/ยามานาเด่นขึ้นตามบทบาทใหม่ (แถบใหญ่ขึ้น + เตือนต่ำกว่า 25% + badge จำนวนยามานา)
- [x] **Auto-allocate v2 (ต่อท้าย — เคาะ 2026-07-07)**: เปลี่ยนจาก "เทหมดลง primary" เป็น**สัดส่วนตายตัวต่อคลาส** (distributor "ให้แต้มถัดไปกับ stat ที่ต่ำกว่าเป้า `stats[s]/weight[s]` สุด" วัดจาก stat ปัจจุบัน — self-correct กับการแจกมือ, ไม่ต้องเก็บ counter). ผล sim M7.7 **คว่ำร่างเดิม**: **ดาบ 4 STR:1 VIT** (ตาย 183→24, บอสไวป์ 162→2), **ธนู PURE DEX** (VIT ทุกสัดส่วนแย่ลง — 2:1→263+กำแพงใหม่ s15-farm, pure→238 เคลียร์ครบ; ธนูเป็น DPS-race กิน DEX ทั้งดาเมจ+สปีด), **เวท 3 INT:1 VIT** (ตาย 50→20, บอสไวป์ 34→0 — เวทรอดด้วย uptime สกิล/มานาซึ่งโต INT ไม่ใช่ HP). Gate ครบ: เปลี่ยนคลาส s5, กำแพง s15-boss คงอยู่ (0/5), ไม่มี stall (farm 5/5 ทุกคลาส). ไม่แตะ SAVE_VERSION. รายละเอียด: docs/balance-m7.md "Auto-allocate v2"

## ✅ M7.6 — ตีบวก (Refine, RO แท้) (เสร็จ 2026-07-07)

> เคาะแล้ว: **มีลุ้นแตก** — +1-3 ปลอดภัย / +4-7 พลาดลดขั้น / +8-10 พลาดแตก (ItemEvent destroyed) · ย่อยของซ้ำเป็นวัสดุ → ใช้วัสดุ+ทองตีบวก · DB: เพิ่มคอลัมน์ `refineLevel` (additive db push) + ItemEvent `refined`/`salvaged` · SAVE v14 (equipped ต้องพก refine — โน้ตเดิมเขียน v11 ตอนเคาะ แต่ v11-13 ถูกใช้ไปกับ bots/auto-hunt/zoneKills แล้ว) · วัสดุ v1 = ชนิดเดียว yield ตาม tier/rarity (ต่อขยายเป็นหลายชนิดได้ภายหลัง) · stat ต่อบวกและอัตราพลาดต้องผ่าน sim + คิดผลต่อ HOF power

- [x] Salvage: ย่อยของเป็นวัสดุตาม tier/rarity (server tx: destroy + mint material — โมเดลวัสดุเป็น counter ต่อ character ไม่ใช่ instance) — `POST /api/items/salvage` batch tx เดียว กัน double-credit, yield = tier × {common 1, rare 2, epic 4}, UI ย่อยรายชิ้น + bulk พร้อม preview
- [x] Refine core: server-authoritative roll (crypto ฝั่ง server, engine ไม่ทอย), ItemEvent `refined`/`salvaged` ทุกครั้ง, engine รับ refineLevel เข้า stat/power — `refinedStat = base×(1+N×8%)`, SAVE v14, สำเร็จ +1-3 การันตี / +4-7 = .85-.55 / +8-10 = .45-.25, compare-and-set กันกดซ้อน, แตก = destroy+unequip
- [x] UI ตู้ตีบวกในเมือง + จังหวะลุ้น/แตก (juice เต็ม) + โชว์ +N บน paper-doll/ชื่อของ — ตอกค้อน ~1s → สำเร็จ "+N!" เด้ง/ลดขั้นทึบ/แตกกระจาย+แฟลชขอบจอ (CSS+synth SFX), ตัวนับวัสดุใน HUD, stack แยกตาม +N, ออร่า step-up ที่ +7, desktop+mobile
- [x] (เพิ่มตามคำขอเจ้าของ 2026-07-07) บอท auto-ย่อยของ: กฎ auto-sell เดิมยกเป็น v2 ต่อ rarity 3 ทาง **ปิด/ขาย/ย่อย** (common/rare; epic ห้ามแตะเหมือนเดิม), sweep เดียวได้ทั้งสองลิสต์ (keepBetterStat guard คุ้มครองทั้งขายและย่อยเท่ากัน), บอททริปเมือง ขาย→ย่อย ตามลำดับ + toast "ย่อยแล้ว N ชิ้น +M วัสดุ", migrate ค่าที่ตั้งไว้เดิมอัตโนมัติ
- [x] Sim ผลต่อ curve: **เลขร่างผ่านทุกเกตโดยไม่แก้** — s15 wall อยู่ 0/15 แม้ refine-stress, เปลี่ยนคลาส s5, วัสดุ sink จริง (ของใส่วน +1~4 ไม่นั่ง +10), ตี +10 ~359 ครั้ง, แตก ~1% ของดรอป; knobs REFINE=1/sweep/STRESS ใน balance-sim (ตาราง: balance-m7.md "M7.6 — Refine")

## ✅ M7.8 — Manual Play (เสร็จ 2026-07-07)

> เจ้าของอยากให้ผู้เล่นเล่นเองได้บ้าง — สไตล์ **RO แท้: แตะ/คลิกพื้นเดิน, แตะ/คลิกมอนตี** (ไม่ใช่ WASD) · ต่อยอดปุ่ม AUTO เดิม (M7.5): AUTO ปิด = ผู้เล่นสั่งเอง · ทุก input เป็น intent ผ่าน `pendingInput` (deterministic, ปูทาง lockstep M8 ฟรี) · **ต้องเล่นสะดวกทั้ง desktop และ mobile** (touch target ใหญ่, แตะเป็น input หลัก)

- [x] Engine: intent `moveTo(x)` / `attackTarget(id)` / `cancelCommand` — Hero.command transient (ไม่ bump SAVE), boss บังคับสู้ชนะทุกคำสั่ง, ถึงโซนใหม่คำสั่งเคลียร์, AUTO เปิด = เสร็จคำสั่งกลับไปล่าต่อ, เส้นทาง auto เดิม byte-identical; events moveOrdered/targetLocked/commandCancelled ให้ render (13 tests)
- [x] UI/Render: `hitTestPointer` ผ่าน baseTransform (กันจอสั่นทำเป้าเพี้ยน), มอนชนะพื้นเมื่อซ้อน + hit radius ใหญ่บนนิ้ว, ping วงแหวนจุดแตะ + reticle ค้างใต้เป้าที่ล็อก (pooled/flat-alpha), ชิพ "✕ ยกเลิกคำสั่ง" ข้าง AUTO — เมาส์+นิ้วเท่าเทียม · หมายเหตุ: ปุ่มกดสกิลเองยกไป backlog (สกิลยัง auto-cast; ทับซ้อน mana governor ต้องคิดต่อ)
- [x] ขัดเกลา game-feel: tip สอนครั้งแรกที่ปิด AUTO ("แตะพื้นเพื่อเดิน แตะมอนเพื่อโจมตี"), cursor crosshair บน desktop, แตะพื้นระหว่างล็อกเป้า = สลับคำสั่งลื่น ๆ ไม่ต้องยกเลิกก่อน

## ⏸️ M6.5b — UI Skin (พักอีกรอบ 2026-07-07)

> ลองรอบสอง: wave 1 (tokens + ฟอนต์ Charm/Mitr + หน้า title โทนไม้/ทองเหลือง-ฟ้าพลบ) ทำเสร็จแล้ว **เจ้าของไม่ชอบ → revert ออก** (commit d64d31c → revert 4c856df) · นับเป็น art attempt ที่โดนคว่ำครั้งที่ 3 (pixel-MMX3, SVG อนิเมะ/RO, warm-fantasy title) · **บทเรียน: รอบหน้าอย่าเริ่มจากงานสร้าง — เริ่มจากเก็บ reference ที่เจ้าของชอบก่อน** (ภาพเกม/UI จริงที่เจ้าของชี้ว่า "แบบนี้แหละ") แล้วค่อยลงมือ · แขวนไว้จนเจ้าของหยิบขึ้นมาเอง

- [ ] (แขวน) เก็บ reference รสนิยมจากเจ้าของ → tokens + title → เคาะ → roll out หน้าเลือกตัว + HUD

## ✅ UAT polish batch (2026-07-07 — จาก playtest เจ้าของ + เตรียมขึ้น UAT)

- [x] fix: บอทวาปแล้วไม่ขาย/ไม่ย่อย — ท่อ auto-equip ล้มแล้วกลืนขั้นขายเงียบ ๆ + POST ล้มไม่มี log (แก้ทั้งคู่, เจ้าของยืนยันหาย)
- [x] fix: ธนู/เวทตัวเด้งตอนหนีมอน — branch ถอยหนีคำนวณแบบ hero-relative lunge (ตัวเดียวที่ไม่ servo เทียบเป้า) → stutter ~20Hz; แก้บรรทัดเดียว + เทสต์กันเด้ง, sim ไม่ขยับ
- [x] balance (คำขอเจ้าของ): ดาบ/ธนูได้ INT — ดาบ 4STR:1VIT:1INT, ธนู 4DEX:1INT → ยามานา −55%/−56% ต่อรอบ, เกตครบ (ธนู s15 เร็วขึ้นด้วยซ้ำ)
- [x] +8/+9/+10 prestige ladder (คำขอเจ้าของ): ออร่าไล่ระดับบน paper-doll — +8 วงนอกหนาแน่น / +9 ประกายแวบเป็นจังหวะ / +10 เสา ember+halo โคจร+พื้นระยิบ เห็นข้ามสนาม (แยกชัดจากออร่า t6, pooled/capped พิสูจน์ด้วยเทสต์)
- [x] UAT patch-notes modal: "มีอะไรใหม่!" เด้งครั้งเดียวต่อ release id ภาษาผู้เล่น th/en, ผู้เล่นใหม่ไม่โดนซ้อน FTUE, เพิ่มรอบหน้าแค่ append entry เดียว
- [x] Tab-return catch-up: สลับ tab/พับจอกลับมา >5s → replay เวลาที่หายผ่านท่อ offline เดิม (cap 8 ชม., budget 250ms, กัน fx/toast ทะลัก) — มือถือล็อกจอ = ได้ progress ย้อนหลังแบบเดียวกับ offline idle

## M7.9 — Grand Expansion ⭐ (ดีไซน์เคาะกับเจ้าของ 2026-07-07)

> **โลก ×2 + คลาสขั้น 3 + gear t7-10 + บอสหลากหน้า** — ก้อนเดียวที่ทุบกำแพง s15 และวาง endgame ใหม่ที่ s30 · เคาะแล้ว: ธีมชุด A (**ทุนดราน้ำแข็ง s16-20 → ทะเลทรายซากอารยธรรม s21-25 → นครนรก s26-30**) · **กุญแจทุบ s15 = เควสคลาส 3** (ฟาร์ม map3 → Lv40 → เควส → power spike → ล้มบอส s15 → เข้า map4) · บอส: หน้าตาเฉพาะตัวทั้ง 6 + **ท่าใหม่ต่อบอสแมพใหม่** (พุ่งชน / เรียกลูกน้อง / คลื่นอันตรายเต็มสนาม) · **levelCap 60→90** · s30 = soft-wall ตัวใหม่

- [x] **Engine world**: map4/5/6 (แมพละ 5 ฟาร์ม + ห้องบอส, data-driven ตามสูตร M6), hunt knobs + aggro belt ต่อแมพ, levelCap 90 + xp curve ต่อ, kill/gold curve ต่อ — sim rebaseline เต็ม (เกต: จังหวะเดิม s1-15 ต้องไม่ขยับ ✓ byte-identical, s30 wall ใหม่ ✓, ไม่มี stall ✓)
- [x] **คลาสขั้น 3** (ร่างชื่อ: จอมอัศวิน / ราชันพราน / อาร์คเมจ — เจ้าของ rename ได้): เควสเสนอ Lv40 (ล่า map3 + บอส map2 ซ้ำ; ไม่มีเงื่อนไขตีบวก), tier 1|2|3 + SAVE v15, **สกิลที่ 4** (sword_skyfall / archer_storm ~4.0 วิจริง / mage_apocalypse ×8) — reuse กลไกเดิมทั้งหมด (ไม่มี ProjectileKind ใหม่), มานา 120 + tier3PoolBonus 90, **auto slot 4 ปลดด้วย tier 3 เท่านั้น** (tierRequired=[1,1,1,3])
- [x] **Gear t7-t10**: band t7(s16-18) t8(s19-22) t9(s23-26) t10(s27-30) — 46 templates, drop table + ราคาขาย + refine interplay ผ่าน sim (t10+10 = เพดาน 126 atk), paper-doll silhouette + apex ornament ต่อ tier ต่อยอดบันไดออร่า +8-10
- [x] **บอสหลากหน้า**: silhouette/palette เฉพาะตัวทั้ง 6 บนริกเดิม (bossThemes.ts); map4 = พุ่งชน / map5 = เรียกลูกน้อง / map6 = คลื่นเต็มสนาม — deterministic + telegraph fx/sfx ครบ (5 events ใหม่), บอสเก่า 3 ตัว byte-identical
- [x] **Render world**: biome family ×3 (น้ำแข็ง/ทะเลทราย/นรก) + ซุ้มประตู + ประตูบอส + arena ต่อธีม, สกิล 4 spectacle (time-freeze 0.16s / ม่านพายุ+ฝูงธนูบังฟ้า+finale beat / ฟ้ามืดค้าง 2.6s) — pool caps audit แล้ว
- [x] **UI**: ช่อง auto slot 4 (ปลดพร้อม tier 3), codex หมวดโลก/คลาส 3/บอสใหม่, FTUE tips (tier3QuestOffered @Lv40 + skill4Unlocked), i18n th/en ครบ (19 item keys ใหม่), patch-notes 2026-07-07c
- [x] **Balance close**: sim เต็ม 3 คลาส × gear × refine → docs/balance-m79.md (เกตทั้ง 6 ผ่าน: class2 ~s5 เดิม, s15 แตกด้วยคลาส 3, s16-29 ไต่ไม่ stall, s30 soft-wall boss-iso ชนะ 3/3 ที่ t10+10, mana sink จริง 23/52/53 ขวด/รอบ, บอสชนะได้บน autoplay) — ธง: ธนู s26-30 friction สูง (follow-up class design)

> **หมายเหตุปิด M7.9 (2026-07-07):** in-browser visual pass ยังไม่ได้ทำ — แนะนำ owner playtest: หน้าตาบอส 6 ตัว (เขากว้าง map2/map6 vs HP bar), spectacle สกิล 4 ทั้ง 3, ความรู้สึกไต่ s16-30 (โดยเฉพาะธนู)

> **แก้ดีไซน์เควสคลาส 3 (option ข, เจ้าของเคาะ 2026-07-08):** เปลี่ยนจาก "ล่า map3 + ล้มบอส map2 ซ้ำ" → **objective เดียว: ล่า 90 ตัวใน map4 โซน 1 (ทุ่งหน้าด่านทุนดรา s16)** ไม่มี boss objective, ไม่มีเงื่อนไขตีบวก · **รับเควส (Lv40 tier2) → ปลดล็อกพรีวิว map4 โซน 1 เท่านั้น** (โซน 2+ และห้องบอสยังล็อกหลังบอส s15) — สิทธิ์เข้าโซนเป็น *derived จาก hero.quest ไม่ persist* (`systems/world.questGrantsZoneAccess`; ดรอป/จบเควสแล้วสิทธิ์หาย เว้นแต่ล้มบอส s15 แล้ว) · flow: tier2 fast-travel เข้าฟรอนเทียร์ → ฟาร์มเก็บคิล → evolve tier3 → กลับมาทุบบอส s15 → unlock ปกติเทคโอเวอร์ · sim (5 seed × 3 คลาส): tier3@s16 ครบ, ถึง map6/s30 ครบ, ไม่มี stall, mana sink คงเดิม, s1-15 byte-identical · **ไม่ต้อง bump SAVE** (id/shape เดิม; เควสเก่ากลางคัน 2-objective รีเซ็ตเป็น re-offer อัตโนมัติ) · i18n: ต้องแก้คำอธิบายเควส tier3 th/en (ดู note ส่งต่อ) · details = docs/balance-m79.md "Appendix — Tier-3 quest REDESIGN"

## M7.95 — Hall of Fame 🏆 (สเปกเคาะกับเจ้าของ 2026-07-08 · ดึงขึ้นมาก่อน M8 ได้ ไม่พึ่ง websocket · ประมาณ ~4.5-5.5 ชม.)

> **Top 10 ต่อหมวด** + ฟิลเตอร์อาชีพ (ดาบ/ธนู/เวท) บนทุกบอร์ด · หมวด: ① Level สูงสุด (tiebreaker = ใครถึงก่อน, เก็บ timestamp แตะ 90) ② Power สูงสุด (สูตรคำนวณฝั่ง server จาก save blob เท่านั้น) ③ **ยอดเงินหาได้รวม (total gold earned)** — ผลรวมทองที่*เคยได้รับ*ทั้งหมดตั้งแต่สร้างตัวละคร (ฆ่ามอน+ขายของ) ใช้จ่ายแล้วไม่ลด; ไม่ใช่เงินคงเหลือ และไม่เกี่ยวกับเวลาออนไลน์ (เจ้าของเคาะชื่อ 2026-07-08 — เดิมเรียก "เงินสะสม lifetime" แล้วชวนสับสน) ④ เวลาเคลียร์บอสดีที่สุดต่อโซน (6 บอร์ดย่อย s5-s30, ตัดค่าที่เร็วกว่า "พื้นความเป็นไปได้" จาก sim อัตโนมัติ) ⑤ **เวลาออนไลน์รวม** (เพิ่ม 2026-07-08 — server สะสมจากส่วนต่าง lastSeen ระหว่าง save ที่ < เกณฑ์ ~5 นาที: นับเฉพาะตอนเปิดเกมจริงรวม AFK, ไม่นับ offline idle, server-clock ล้วนจึงโกงไม่ได้ ไม่ต้องรอ re-derive, ไม่มี SAVE bump) · **หน้าโปรไฟล์กดดูได้** (paper-doll + ออร่า + ชื่อทอง prestige) · เก็บ timestamp ทุกสถิติเผื่อซีซันในอนาคต · ปุ่ม 🏆 บนการ์ดเป้าหมายเปิดแผงนี้ · ยังไม่ทำ: รางวัลอันดับ/ซีซัน/ของตกแต่งโปรไฟล์

- [x] Engine/SAVE v16: counter ยอดเงินหาได้รวม (creditGold choke point, ใช้จ่ายไม่ลด) + best boss-clear time ต่อโซน (นับ step deterministic, timestamp ฝั่ง server) + level-90 timestamp + migrate v15→v16 — sim byte-identical
- [x] **Anti-cheat re-derive (หนี้ M5 ปิดแล้ว):** judgePlausibility เพดาน ×2 จาก balance-m79 (เลเวล/เงิน/พลัง/levelCapAt ที่ใช้ server clock ล้วน) — เกินเพดาน = suspect ซ่อนจากบอร์ด ไม่แบน ไม่บล็อกเซฟ
- [x] Server/DB: LeaderboardEntry + BossRecord (db push แล้ว), ingest ตอน /api/save (power คำนวณ server จาก makeHero+DB loadout), GET /api/hof top-10 + my-rank + class filter, พื้นเวลาบอส 0.5× boss-iso, onlineSeconds accumulator (delta < 300s), **ลบตัวละคร = purge แถวบอร์ดใน tx เดียว + orphan sweep** (เจ้าของขอ 2026-07-08)
- [x] UI: แผงทำเนียบ 5 บอร์ด + 6 บอร์ดย่อยบอส + แถวอันดับตัวเอง + โปรไฟล์ paper-doll + ปุ่ม 🏆 (เลิกหน้าตาโดนล็อก) + i18n ครบ
- [x] ประกาศ server-wide: คนแรกแตะ 90 (exactly-once ผ่าน singleton unique) / แซงอันดับ 1 power (dedupe 24 ชม.) + patch notes 2026-07-08
- [x] QA + sim sanity: บอร์ด read-only จาก save ยืนยันแล้ว (sim byte-identical ทุกเวฟ) — 930/930

> **M7.95 CLOSED (2026-07-08)** + UAT round-2 polish ในรอบเดียวกัน: เควสคลาส 3 โฉมใหม่ (ทุ่งทุนดรา 90 + Glacial Sovereign ร่างเยาว์) · บอทสวิตช์เดียว + ตั้งค่ารวม + config ติดตัวละคร (Character.uiConfig) · มอน 12 สายพันธุ์แมพ 4-6 · aim-driven facing · ตีบวก tap-to-skip · เมนูวาปธีม · inventory unstack+sort · การ์ดเควสรวมปุ่ม · ⓘ ทุกสกิล · war-cry aura+chip (บัฟทั้งทีม party-ready) · กวาดซาก wave (state.wave/waveGap/waveLabel ตาย, waves.ts→hunt.ts) · UX-fix 10 ข้อจาก audit เต็ม · /proto-shaders ทดลองแล้วเจ้าของไม่เอา (ลบแล้ว กู้ได้จาก history) — merge เข้า main แล้ว (PR #12, 2026-07-08) + เจ้าของรัน `prisma db push` แล้ว (schema sync ครบ)

> **UAT round-3 CLOSED (2026-07-08, หลัง PR #12):** เมือง NPC ครบวงจร (ป้าปุ๊/ลุงดึ๋ง, แตะซ้ำเพื่อคุย, panel เปิดผ่าน NPC เท่านั้น, บอทเดินไปหาเอง ~3.5 วิ/ทริป, anchors ใน CONFIG.townNpcs) · วาปง่าย (ตัด aggro block + damage interrupt, ตายกลางร่ายเท่านั้นที่ยกเลิก, บอสยังล็อก) · เควสคลาส 3 กติกาไต่ก่อน (tier3GateCleared = ต้องปลดห้องบอสแมพ 3 เอง, ไม่มีข้ามโซน, strand guard ตอน boot, guide-me พาไปหน้าด่านจริงระหว่างไต่) · เควสนำทุกเส้นทางบอท (botFarmTarget) · auto-advance เฉพาะ fresh unlock (free-farm โซนเก่าไม่โดนลาก) · แก้ softlock หลังล้มบอสเควส (returnToQuestFrontier) · การ์ดเควสอันดับ 1 เหนือประตูบอส · แบนเนอร์ "มีแพตช์ใหม่" (build id พ่วง /api/save, เซฟก่อน reload) · patch notes 2026-07-08b — 984/984, sim canonical เกตครบ (บอสเควสชนะ 3/3 คลาส)

> **UAT round-4 CLOSED (2026-07-08, playtest สดหลัง PR #13 — merged PR #14–16):**
>
> - [x] แก้บั๊กเดินเอง/คุย NPC ในเมืองไม่ได้ (owner report): early-return โซนเมืองใน `step()` ข้าม `applyManualCommand`+`updateHeroes` — moveTo หายเงียบทั้งเมือง → เพิ่ม `tickTownManualWalk` (walk-only, botWalk มี priority, ร่ายวาปยืนนิ่ง) + regression 5 ตัววิ่งผ่าน `step()` ในเมืองจริง (PR #14)
> - [x] ร้านป้าปุ๊ 3 แท็บ [ซื้อของ|ขาย·ย่อย|ซื้อคืน]: แท็บขาย reuse flow กระเป๋าเป๊ะ (แยก `sortRank.ts`+`useConfirmGuard` ใช้ร่วม, InventoryPanel พฤติกรรมเดิม, กดรัวได้ไม่ปิด panel) (PR #15)
> - [x] ระบบซื้อคืน (owner request): ตาราง `SoldItem` additive, ขายบันทึกใน tx เดียวกัน, GET/POST `/api/items/buyback` — หน้าต่าง 3 วัน server ตัดสินเวลา, atomic restore (+N คงเดิม, `origin:buyback` ไม่นับเพดาน drop, `boughtBack` ItemEvent), ของย่อยซื้อคืนไม่ได้ (กันปั๊มวัสดุ), manual เท่านั้นบอทห้ามเรียก, เช็คทอง = MVP gap เดิมแบบตีบวก (PR #16)
> - [x] patch notes 2026-07-08c (แก้เมือง+แท็บขาย) + 2026-07-08d (ซื้อคืน)
> - หมายเหตุ: บอทขาย/ย่อยของตำนาน owner ถามหา — **มีอยู่แล้ว** (v3 "option A": ตั้งค่าบอท→Drops→ของตำนาน, keep-guard บังคับ, ของใส่กันสองชั้น) ไม่ต้องแก้
> - [x] เจ้าของรัน `prisma db push` แล้ว (2026-07-08, ยืนยันตาราง `SoldItem` ขึ้นจริงผ่าน information_schema) — DB sync ครบ พร้อม deploy
> - ⚠ ค้างอย่างเดียว: playtest แท็บใหม่ใน browser (desktop+mobile) — 1009/1009, tsc/eslint/next build เขียว, engine แตะแค่ nav ไม่ต้อง sim

## M8 — Party & Friends (ปรับสโคป 2026-07-08: เจ้าของขอเพิ่มระบบเพื่อน + ระบบ account จริง)

> **กติกาหลักจากเจ้าของ:** เพื่อน**ผูกกับ account ไม่ใช่ตัวละคร** — สร้างตัวใหม่/สลับตัวเล่น friend list ต้องอยู่ครบเหมือนเดิม → ต้องมี **account จริง (login)** มาก่อน friend graph · ฟีเจอร์เพื่อนชุดแรก: เห็น online/offline · เห็นว่าอยู่โซนไหน · เล่นตัวละครตัวไหนอยู่ · ขอปาร์ตี้ · ส่ง emoji หากัน
>
> โชคดีที่ schema เป็น `User → Character(≤3)` อยู่แล้ว — friend = ตาราง `User↔User` ได้ทันที และ `lastSeen` ก็ server-stamp ต่อ save อยู่แล้ว (HOF ใช้อยู่) = ฐาน presence ฟรี · **Friends MVP ไม่ต้องรอ websocket** (polling พอ) — websocket ค่อยมาอัปเกรดเป็น push + ทำ party จริง

- [x] **Phase 0 — Account system** (เสร็จ 2026-07-08): /welcome 3 ทาง Login/Register/**เล่นเลย (Guest)** · guest สมัครทีหลังที่ Settings → My Account ผูกเข้า User แถวเดิม save ไม่หาย · ไม่ verify email ไม่มีกฎ password — validation เดียว = email ห้ามซ้ำ (scrypt hash, timing-safe) · friend code 8 ตัว + display name · login ข้ามเครื่อง = repoint cookie
- [x] **Phase 1 — Friends MVP** (เสร็จ 2026-07-08): ปุ่ม 👥 + panel — ขอเป็นเพื่อนด้วย friend code/ชื่อตัวละคร (ขอสวนกัน = auto-accept), online/ตัวที่เล่น/โซน (lastZone stamp ตอนเซฟ ไม่แกะ blob), emoji 12 แบบ Win10-safe + rate limit, poll เดียวรวมทุกอย่าง (เปิด 20s/ปิด 60s/พักตอน hidden), guest โดน 403 account_required ทุกจุด
- [x] Websocket infra spike (เสร็จ 2026-07-08): ผล research = **Hostinger shared รับ incoming ws ไม่ได้** (นโยบายทางการ) · ส่งมอบ probe zero-dep `scripts/ws-probe/` + คู่มือไทย + เกณฑ์ go/no-go — **รอเจ้าของรันบน host จริงเพื่อเคาะ VPS ก่อนเริ่ม P4**
- [x] **Party request ผ่าน friend panel** (เสร็จ 2026-07-08): ตาราง Party+PartyMember (1 คน 1 ตี้ บังคับที่ DB), ชวน/รับ/ปฏิเสธ/ออก, cap 3 กันแข่งกดที่ tx, หัวห้องออก = โอนให้คนเก่าสุด, แผงปาร์ตี้ปักบน FriendsPanel — เฟสแรก = social container (เห็นสถานะกัน) รอ cohort sim
- [x] **Lockstep engine ครบ (P1a/P1b/P2/P3)** (เสร็จ 2026-07-08): dmath กัน float desync ข้ามเบราว์เซอร์ (+guard test) · multi-hero 1-3 ตัว/เลน per-hero config ผ่าน intent เดียว (solo byte-identical, sim identical) · ร่างเงา (shadowed flag + lane policy, AI เล่นต่อด้วยของจริง, รายได้ = offline-idle ปกติแบบ ก) · lockstep harness พิสูจน์ no-desync 2-3 client หลายพันเทิร์น + join กลางคัน + divergence canary — **เหลือ P4 relay + P5 replay + P6 render (บล็อกด้วยการเคาะ infra)**
- [x] **Lockstep party P4-P6 (โค้ดครบ 2026-07-08)**: infra = **Render free tier Singapore** (เจ้าของ deploy probe จริง: RTT p95 42ms, 0 หลุด; Hostinger ยืนยัน outgoing-only) · P4a relay zero-dep (`scripts/party-relay/`, seq stream เดียว game+control = ลำดับการันตี, HMAC ticket, grace 5s→ร่างเงา, /health pre-wake) · P4b client (partySession/partyHandshake: cohort ตามโซน, seed authority = slot ต่ำสุด, เริ่มเทิร์น 0 เมื่อ ack ครบทุกคน, seq-gap = rejoin, เซฟของใครของมัน, HUD chip + hint โซนเดียวกัน, `pnpm relay` + docs/party-dev-setup.md) · P6 render (เพื่อนเต็มยศ+ป้ายชื่อ, ร่างเงาจาง+ป้ายออฟไลน์ state-driven, juice เข้า/ออกโซน) · cohort balance (share 0.6 + buff ×1.04-1.08 + spawn ×1.5-2.0 → xp/hr ต่อหัว ×1.25-1.46, โซโล่ byte-identical) — **ค้าง: เทสจริง 3 แท็บ + ตั้ง relay service บน Render + เคาะ 3 flag balance (มอนกระจุก/บอสละลายตอนรุม/รูปแบบ buff) + P5 replay validation (เลื่อนไป follow-up)**
- [x] ไอเทมวาปหาสมาชิก (เสร็จ 2026-07-08): ยันวาปหาเพื่อน 🌀 ขายที่ป้าปุ๊ (ฐาน 200) · ปุ่ม "วาปไปหา" ในแผงปาร์ตี้ (เช็ค online + มียัน + **โซนต้องปีนถึงเองแล้ว** — วาปไม่มีวันปลดโซน กฎไต่ก่อน) · ใช้ channel fast-travel เดิม · บอทห้ามใช้
- [x] **Quest system เต็มรูป** (เสร็จ 2026-07-08, ดีไซน์ = docs/quest-design-m8.md): เควสหลักรายบทห่อ goal-ladder (persist แค่ mainClaimed ไม่มี state ซ้ำ, migration คนเก่า = นับจบไม่จ่ายย้อนหลัง) · เดลี่ 3 ใบ/วัน 5 ประเภทสาย "แวะมาเล่น" รางวัลทอง/หิน/ยาเท่านั้น รีเซ็ตเที่ยงคืนไทย server-authoritative + DailyClaim กันซ้ำที่ DB · กระดานเควสที่ NPC ใหม่ **ผู้ใหญ่บ้าน** (x=400, ! เด้งเมื่อมีของให้รับ, เคลมในเมืองเท่านั้น บอทห้ามแตะ) · SAVE v17
- [ ] ~~Class change สายถัดไป (tier 4) + สกิลชุดใหม่~~ → **เสนอแยกเป็น M8.5** (ก้อนขนาด M7.9: Lv70 + ไต่เอง s30 + สกิล 5 + balance เต็มรอบ) — รอเจ้าของเคาะ

> **งานแทรกระหว่าง M8 (เจ้าของขอ 2026-07-08, เสร็จหมด):** บัฟมานา (ดาบ −48%/ธนู −47% ยา/รอบ, เกตครบ, balance-m79 "Mana relief pass") · **หินเสริมพลัง** แทนการย่อย (ดรอปจากมอน เข้าตัวนับเดิม ของเก่าอยู่ครบ, แท็บย่อยหาย, บอทขายอย่างเดียว, ยอด/รอบ ±5% ของยุคย่อย) · sprite sandbox (`scripts/sprite-sandbox/`) + **หน้า /lab** (ทดลอง art 6 โหมด, อัปโหลดเก็บถาวร public/lab-assets, ซ่อนบน prod) + **ลามะเมือง** (ภาพวาดเจ้าของ, แตะแล้วกระโดด+หัวใจ, ไม่มีไฟล์ = เงียบ) — ดีเทลใน commit log

## ✅ M8.6 — World Layer: Ghost Presence + World Chat + Party UX (เสร็จ 2026-07-09, ดีไซน์ = docs/ghost-presence-design.md, เจ้าของอนุมัติทุกข้อ)

> **วิสัยทัศน์เจ้าของ:** "อยากได้ open world ที่เห็นคนอื่นด้วยเลย" + กติกาเหล็ก "ระวังเรื่องไป control คนอื่นให้มากๆ" → ghost = render-only มี invariant 6 ข้อ + guard test ยัดข้อมูลขยะแล้ว hash lockstep ต้องไม่ขยับ

- [x] **แก้บัคปาร์ตี้ 4 ตัว (รายงานจากเล่นจริง)**: เมืองไม่ตั้งวง lockstep แล้ว (บอทวาปซื้อยาไม่ค้าง) · จำตำแหน่งตอน collapse/reconnect · ปุ่มบอทหลักติดจริงในตี้ (wish latch) · เกจปลดโซนไม่รีเซ็ต — ตีในตี้เครดิตเต็มทุกคน (settle-then-rebase)
- [x] **Relay world layer** (additive, redeploy ครั้งเดียว): ห้อง presence ต่อโซน (pub/sub ไม่มี seq, last-value cache, cap 12) · world chat ห้องเดียว (ring buffer 30 นาที, 120 ตัวอักษร, 1 ข้อความ/2 วิ, ชื่อจาก HMAC ticket ปลอมไม่ได้) · ping→pong ตรงตัว · POST /api/presence/ticket (kind แยกจาก party ticket ทั้งสองทาง)
- [x] **Ghost layer** (ท่าเดิน/ยืนเท่านั้น ทุกโซน, เจ้าของตัดท่าตี): world socket แยกจาก party socket เด็ดขาด · ghostStore lerp 350ms/prune 10s/cap 12 + fps valve 12→6→0 · rig เต็มตัว+ป้ายชื่อ วาดใต้ฮีโร่จริง อยู่นอก hitTest · toggle ในตั้งค่า
- [x] **World chat UI**: ปุ่ม 💬 ลอย + badge ยังไม่อ่าน + แผง ModalPortal (มือถือ bottom sheet/เดสก์ท็อป 360px) · เก็บ 30 นาที client-side
- [x] **ชิปสัญญาณปาร์ตี้** แทนแถบ "เล่นกับ xxx ในโซนนี้": ขีด 4 ระดับสีตาม RTT มุมขวาบนสนาม + แตะดู lane lag รายคน (ping 5s + EMA, perSlotLag จาก turn engine)
- [x] **DropFeed จัดระเบียบ**: ของธรรมดา/หินย้ายมุมขวาล่างสนาม ยุบรวม cap 3 + ตัวนับ +N · epic เด้งกลางจอเหมือนเดิม
- [ ] **ค้างตรวจ**: เทสมือ 2 แท็บ (ghost/chat) + มือถือ (ชิป/แผงแชท) · เจ้าของเล่นจริงก่อน merge · **deploy: redeploy relay (จำเป็น — presence/chat/ping) + web, ไม่มี db push**

## M9 — Economy & Competition

- [ ] ตลาดกลาง: ลงขาย/ซื้อด้วยเงินในเกม + atomic transaction + audit trail + anti-dupe
- [ ] Backoffice โครงแรก (admin) — tax/ค่าธรรมเนียม **ท้ายสุด**
- [ ] Hall of Fame หลายหมวด: เวลสูงสุด / พลังต่อสู้ / แยกอาชีพต้น + server re-derive กันโกง
- [ ] Events / daily-login retention
- [ ] Open-world visibility (เห็นคนแปลกหน้าใน map — ต่อยอดจาก party infra)

## ⏸️ พักไว้ / ❌ ตัดออก

- ⏸️ Prestige / reset loop — ตัดสินใจหลัง M9
- ❌ PvP arena — ตัดออก (2026-07-05)
- ❌ Conditional auto-cast (เลือกสกิลตามสถานการณ์ เช่น AoE ต้องมีมอน ≥3) — เจ้าของตัด (2026-07-08): "ช่วยเหลือมากเกินไป" — auto-play ต้องเล่นแบบซื่อ ๆ ความสูญเสีย/การตายที่ endgame คือ friction ที่ตั้งใจ อย่าเสนอ automation ที่เล่นเก่งแทนผู้เล่นอีก
