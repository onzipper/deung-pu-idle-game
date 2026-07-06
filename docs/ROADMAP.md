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
- [ ] UI skin (title/หน้าเลือกตัว/HUD กรอบเกม + ฟอนต์) — แขวนไว้ รอเจ้าของอยากหยิบขึ้นมาอีกครั้ง

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

## M7.7 — Skill Spectacle & World Heat (เคาะกับเจ้าของ 2026-07-06)

> ปัญหา: สกิลคล้ายกันหมด รัศมีกองกัน 85-120px ไม่มีท่าไม้ตาย · เคาะแล้ว: **สกิลเบิ้ม ดาเมจแรง ภาพอลัง** + cooldown ไม่ยาว โดย **มานา = ตัวคุมจังหวะ** (ยิงรัวได้แต่ถังแห้งเร็ว → ยามานากลายเป็น sink หลักคู่ยาเลือด) · โลกโหดขึ้นชดเชย: **มอน 15-20+ ต่อสนาม**, killGoal เพิ่มเพื่อ pacing (ความยากมาจาก belt มอนดุ ไม่ใช่โควตา) · **บัพบอส = ไว้ก่อน** (เจ้าของสั่งพัก) · กฎ AoE-aggro เปลี่ยนเป็น **"โดนสกิลแล้วรอด = ลุกมาสู้"** (แทนกฎปลุก ≤2) · เอกลักษณ์คลาส: ดาบ=บุกประชิดหมุนกลางวง / ธนู=ปืนใหญ่คลุมแถบ / เวท=นุกหนักจอสั่น · tier-2 = ultimate ระดับทั้งจอ

- [ ] Engine: ยกเครื่องตาราง SKILL_LIST (รัศมี/ดาเมจ/มานา/cd แยกชั้นชัด, tier-2 = screen-wide), กฎ survivor-retaliation, มอนหนาแน่นขึ้น + killGoal + จูน mana economy — sim เทียบ balance-m6/m7 (คุม: เควสเปลี่ยนคลาส ~s5, s15 soft-wall อยู่, 0 stall)
- [ ] Render: ภาษาภาพต่อคลาส (ดาบแดงกว้าง/ธนูห่าฝนแถบยาว/เวทอุกกาบาตจอมืด+สั่น), fx ตาม tier สกิล, perf pass สนาม 20 ตัว (pooled/capped, มือถือ)
- [ ] UI เล็ก: readout มานา/ยามานาเด่นขึ้นตามบทบาทใหม่
- [ ] **Auto-allocate v2 (ต่อท้าย — เคาะ 2026-07-07)**: เปลี่ยนจาก "เทหมดลง primary" เป็น**สัดส่วนตายตัวต่อคลาส** (ร่าง: ดาบ 3 STR / ธนู 2 DEX:1 VIT / เวท 2 INT:1 VIT) — ตัวเลขจริงต้องรอผล sim M7.7 ก่อน (โลกโหดขึ้น + มานาเป็นตัวคุมจังหวะ ตัวกระจกต้องการ VIT/INT มากขึ้น) แล้วจูนจากข้อมูลตาย/stall จริง; ห้ามจูนพร้อม M7.7 (สองตัวแปรพันกัน)

## M7.6 — ตีบวก (Refine, RO แท้)

> เคาะแล้ว: **มีลุ้นแตก** — +1-3 ปลอดภัย / +4-7 พลาดลดขั้น / +8-10 พลาดแตก (ItemEvent destroyed) · ย่อยของซ้ำเป็นวัสดุ → ใช้วัสดุ+ทองตีบวก · DB: เพิ่มคอลัมน์ `refineLevel` (additive db push) + ItemEvent `refined`/`salvaged` · SAVE v11 (equipped ต้องพก refine) · stat ต่อบวกและอัตราพลาดต้องผ่าน sim + คิดผลต่อ HOF power

- [ ] Salvage: ย่อยของเป็นวัสดุตาม tier/rarity (server tx: destroy + mint material — โมเดลวัสดุเป็น counter ต่อ character ไม่ใช่ instance)
- [ ] Refine core: server-authoritative roll (กันโกง — ห้าม client ทอย), ItemEvent ทุกครั้ง, engine รับ refineLevel เข้า stat/power
- [ ] UI ตู้ตีบวกในเมือง + จังหวะลุ้น/แตก (juice เต็ม) + โชว์ +N บน paper-doll/ชื่อของ
- [ ] Sim ผลต่อ curve: ของ +10 ต้องไม่ทะลุ s15 wall เร็วกว่าที่ตั้งใจ; อัตราแตกคุมเงินเฟ้อวัสดุ

## M8 — Party

- [ ] Websocket infra spike: ประเมิน VPS/Node server + ห้องปาร์ตี้ (ตัดสินใจ infra ก่อนเริ่ม)
- [ ] Lockstep party สูงสุด 3 คน: เห็นตัวกันจริง แชร์ exp+เงิน ของดรอปจอใครจอมัน + server replay validation
- [ ] ร่างเงา offline (AI ใช้สแตต/สกิลจริง + ป้ายออฟไลน์ + เข้า offline-idle cap)
- [ ] ไอเทมวาปหาสมาชิก (ขายที่ NPC)
- [ ] Quest system เต็มรูป (main/daily/board) + class change สายถัดไป + สกิลชุดใหม่

## M9 — Economy & Competition

- [ ] ตลาดกลาง: ลงขาย/ซื้อด้วยเงินในเกม + atomic transaction + audit trail + anti-dupe
- [ ] Backoffice โครงแรก (admin) — tax/ค่าธรรมเนียม **ท้ายสุด**
- [ ] Hall of Fame หลายหมวด: เวลสูงสุด / พลังต่อสู้ / แยกอาชีพต้น + server re-derive กันโกง
- [ ] Events / daily-login retention
- [ ] Open-world visibility (เห็นคนแปลกหน้าใน map — ต่อยอดจาก party infra)

## ⏸️ พักไว้ / ❌ ตัดออก

- ⏸️ Prestige / reset loop — ตัดสินใจหลัง M9
- ❌ PvP arena — ตัดออก (2026-07-05)
