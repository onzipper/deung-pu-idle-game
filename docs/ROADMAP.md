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

## M6 — World & Town

- [x] Zone system: map → zones เดินถึงกัน (แตะขอบ/ลูกศร) + เงื่อนไขปลด zone + ย้อนฟาร์มอิสระ — engine zone/world layer (SAVE v8: location/unlockedZones/lastFarmZone), walk transit, unlock progression, town respawn + auto-return, boss-room gate; sim rebaselined per map/zone (docs/balance-m6.md); functional walk-controls UI. NPC shops = next task (zone kind "town" hook left)
- [x] ห้องบอสพิเศษท้าย map (ฉาก/การนำเสนอพิเศษ) — arena จริง (เสาประตู/vignette ค้างทั้งไฟต์) + entrance beat (สั่น/แฟลช/วงแหวน/drone) + biome *_BOSS แยกต่อ map
- [x] เมืองหลัก + NPC shops: ยาเลือด/ยามานา/ยันกลับเมือง (+ ของวาปปาร์ตี้ เปิดใช้ตอน M8) — ราคา scale ตามความลึก lastFarmZone, auto-use 35%HP/25%mana, gold sink แรกของเกม, SAVE v9; catalog ต่อขยายได้ (M8 warp = union append)
- [x] ตั้งค่าหลังตาย (auto กลับไปฟาร์ม / รอที่เมือง) — AutoReturnToggle + engine honor + auto-potion thresholds; จะขยายเป็น settings panel เต็มตอน goal-ladder UI
- [x] ธีม map + ฉากต่อ zone (ขยายระบบ biome เดิม) — biomeForZone ต่อ map family ไล่เข้ม/ระอุเข้าหาห้องบอส, เมืองอบอุ่น (หลังคา/ตะเกียง/ควันไฟ/เงา NPC), whoosh ตอนย้าย zone
- [x] **Combat rework "สนามล่ามอน"** (เคาะ 2026-07-05): มอนสุ่มเกิดกระจายใน zone (cap+respawn config), hero auto-hunt ไล่เป้า, มอน passive เป็นหลัก + aggressive (aggro radius) ใกล้ห้องบอส, กล้องนิ่งต่อ zone (เผื่อ config zone กว้าง), rebalance ใหม่ — aggro ไล่ระดับ 0→60% เข้าหาบอส, ความตายย้ายไป belt มอนดุ+บอสตามแผน, s15 wall อยู่, formation core เก็บไว้ให้ M8 · เหลือ cosmetic: facing flip (คิวงาน render)
- [ ] Goal-ladder UI (ตาม ladder ใหม่: เวลถัดไป → เปลี่ยนคลาส/ผ่าน map → HOF → …)

## 🎨 M6.5 — Art & Game-feel (ปิดการทดลอง 2026-07-06)

> ผลสรุป: ทดลอง pixel-MMX3 (v1-3) และตัวละคร SVG อนิเมะ/RO (v4-5) ใน /proto แล้ว **เจ้าของไม่ชอบทั้งคู่ → คงสไตล์ procedural เดิมของเกม (M4.5-4.6) ไว้** · /proto ถูกลบแล้ว · จุดว้าว "ของสวมใส่" ยังอยู่ — จะสร้างบนริกสไตล์เดิมตอน M7 (มี precedent: tier-2 gold accents ทำแล้วได้ผลดี)

- [x] ทดลอง art direction ใน /proto → ปิด: คงสไตล์เดิม (decision log 2026-07-06)
- [ ] ~~ตัวละครใหม่~~ ยกเลิก — gear visuals M7 ทำบนริกเดิม
- [ ] UI skin (title/หน้าเลือกตัว/HUD กรอบเกม + ฟอนต์) — แขวนไว้ รอเจ้าของอยากหยิบขึ้นมาอีกครั้ง

## M7 — Gear & Drops ⭐ (+ visual gear)

- [ ] **Item-instance model** (unique ID + ownerId + audit) + server-authoritative — schema + anti-dupe รากฐานตลาดกลาง (DB เสร็จแล้ว — persistence-m7.md)
- [ ] Drop tables อาวุธ+ชุด ต่อ zone/บอส
- [ ] Inventory + equip/loadout UI
- [ ] **Paper-doll + ตัวละครอนิเมะ/RO**: เรนเดอร์ชุด/อาวุธจริงบนตัว, อาวุธใหญ่อลัง, tier สูง = ชุดระยิบ + ออร่าอาวุธซุปเปอร์ไซย่า (คุม GPU มือถือ)
- [ ] โยงเข้า codex/collection

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
