# 🗺️ Roadmap & Task Tracker

> คู่กับ [GDD.md](./GDD.md) (vision — ถ้าขัดกันยึด GDD) · อัปเดต checkbox ที่นี่แทน ClickUp
> วิธีทำงาน: งานละ 1 commit ลง `develop` · จบ milestone → PR → `main` · balance เปลี่ยน = รัน sim เทียบ `balance-m4.md`

## ✅ เสร็จแล้ว

- **M1-M4.6** — engine (pure TS, deterministic) · Pixi render · React/Zustand HUD · MySQL+Prisma save · offline idle · balance harness · juice/animation/art/procedural characters
- **M4.7 i18n** — next-intl th/en (cookie, ไม่มี [locale] segment) · string extraction ครบ · `content.*` key pattern
- **M4.8 Onboarding** — step-registry framework + FTUE 7 step · contextual tips 5 ตัว · Codex 13 หัวข้อ + FTUE replay · mascot น้องดึ๋ง (SVG, 3 mood)
- **M5 (บางส่วน ก่อน pivot)** — per-hero XP/Level (SAVE v2) · tier evolution + UI/juice (SAVE v3) — ⚠️ จะถูก rework เป็นระบบตัวเดี่ยว + class change ผ่านเควสตอน M5 pivot

## 🚧 M5 — Character Pivot ⭐ (ถัดไป)

> เปลี่ยนจากทีม 3 ตัว → ตัวละครเดี่ยว — งานใหญ่ แตะทุก layer

- [x] **Engine pivot**: sim ตัวเดี่ยว (formation/targeting/wave ปรับ) + rebalance โซโล่ทั้งเกม + **ตัดสายอัปเกรด atk/speed/hp เดิม** — SAVE v4 (single character), solo respawn anti-stall, per-class solo balance S1→S10 (docs/balance-m5.md); multi-actor engine retained for M8 party. UI upgrade-panel/FTUE minimally patched (full UI redesign = later tasks)
- [ ] **Character system**: สร้างตัว + เลือกอาชีพต้น (ดาบ/ธนู/เวท) + 3 slots/บัญชี — save schema ใหม่ account → characters (SAVE v4 + Prisma)
- [ ] **Base stats**: แต้ม stat ตอนเวลอัป + จอแจกแต้ม + สูตร power รวม (ใช้กับ HOF ภายหลัง)
- [ ] **Mana + Skill framework v2**: mana pool/regen · สกิล 2-3 ต่อขั้นคลาส ปลดตามเวล · auto slot 1→3 ปลดตามเวล · สกิลนอก slot กดเอง
- [ ] **Class change v1**: เควสอย่างง่าย (ฆ่าครบ/ไอเทม) → เปลี่ยนคลาสขั้น 2 (ต่อยอด tier ที่มี)
- [ ] **FTUE/onboarding + codex rework** ให้ตรงเกมใหม่ (ของเดิมสอนกดสายอัปเกรดที่ถูกตัด)

## M6 — World & Town

- [ ] Zone system: map → zones เดินถึงกัน (แตะขอบ/ลูกศร) + เงื่อนไขปลด zone + ย้อนฟาร์มอิสระ
- [ ] ห้องบอสพิเศษท้าย map (ฉาก/การนำเสนอพิเศษ)
- [ ] เมืองหลัก + NPC shops: ยาเลือด/ยามานา/ยันกลับเมือง (+ ของวาปปาร์ตี้ เปิดใช้ตอน M8)
- [ ] ตั้งค่าหลังตาย (auto กลับไปฟาร์ม / รอที่เมือง)
- [ ] ธีม map + ฉากต่อ zone (ขยายระบบ biome เดิม)
- [ ] Goal-ladder UI (ตาม ladder ใหม่: เวลถัดไป → เปลี่ยนคลาส/ผ่าน map → HOF → …)

## M7 — Gear & Drops ⭐

- [ ] **Item-instance model** (unique ID + ownerId + audit) + server-authoritative — schema + anti-dupe รากฐานตลาดกลาง
- [ ] Drop tables อาวุธ+ชุด ต่อ zone/บอส
- [ ] Inventory + equip/loadout UI
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
