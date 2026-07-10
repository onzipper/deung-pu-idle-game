# UI Reference Map — mockup ของเจ้าของ → แผนงานจริง

> **ที่มา (2026-07-09):** เจ้าของส่ง reference image ชุดเต็ม (dashboard MMORPG ธีม Dark Fantasy) พร้อม design goals ในภาพ: อ่านง่าย · สวยงาม · สื่อสารชัดเจน · ใช้งานง่าย · อารมณ์ MMORPG · รองรับทุกขนาดจอ + spec ในภาพ: โทน Dark Fantasy + Gold + Purple · ฟอนต์ Kanit/Prompt · UI ทุกชิ้นมี animation 150-250ms · responsive PC+mobile
> เอกสารนี้คือ **brief ถาวร** สำหรับทุก wave ของ R2 และรอบถัดๆ ไป — mockup ชิ้นไหนลงรอบไหน เคาะอะไรไปแล้วบ้าง
> เงื่อนไข "งาน art ต้องเริ่มจาก reference ของเจ้าของ" **ผ่านแล้ว**สำหรับ UI chrome ทั้งชุดนี้ · **เฟสแรก = art จากโค้ดล้วน** (CSS/SVG/emoji — ห้ามเลียนไอคอนวาดสี/ภาพ painted ของ mockup จนกว่าจะมี asset pipeline ของเจ้าของ)

## Canonical owner visual reference (AI memory)

- **ชื่อไฟล์ต้นฉบับ:** `ตัวอย่าง Assets MMORPG 2.5D.png` (เจ้าของส่ง 2026-07-09; source image อยู่ใน owner-provided files — เอกสารนี้เป็น canonical text memory จนกว่าจะ commit binary เข้า repo)
- **ภาพรวม:** asset/concept board ของ MMORPG 2.5D บนเว็บ สไตล์ fantasy pixel + HD effects บนพื้นหลังเข้ม จัดเป็นชุดตัวอย่างโลก ตัวละคร มอนสเตอร์ UI ไอคอน และ VFX พร้อม gameplay HUD composition
- **1. World & Environment:** town · forest · dungeon · desert · snow field · hell gate, tileset grass/dirt/stone/water/wood และ props เช่นต้นไม้ หิน ลัง ถัง รั้ว ป้าย/โคม
- **2. Character & Animation:** player sprite ชุดเกราะดำ/ม่วงแต้มทอง + อาวุธพลังงาน, reference ระบุ 10 directions และ state idle/walk/attack/skill/damage/die
- **3. Monster & NPC:** family silhouettes ที่แยกอ่านง่าย เช่น slime/mushroom/skeleton/orc/beast/ent/demon และ NPC หลายบทบาทพร้อมภาษากล่องพูด
- **4. UI Elements:** HP/MP/EXP bars, button states normal/hover/press/disabled, menu icons, popup/item detail, tabs, toast/notification และกรอบ rarity
- **5. Skill Icons:** icon สีเรืองแสงแยก family ม่วง/ฟ้า/ไฟ/holy/dark; ต้องอ่านออกใน tile ขนาดเล็ก ไม่ใช่เพียงสวยตอนขยาย
- **6. Items & Equipment:** weapon · armor · accessory · consumable/material เป็นไอคอน fantasy pixel ที่ silhouette ชัดและแยก family ได้
- **7. Effects & VFX:** skill effects, buff icons, damage numbers และ CRITICAL แบบแรงแต่ยังอ่าน gameplay ได้; reference เป็น visual language ไม่ใช่คำสั่งให้แทน code-drawn 60fps FX ทั้งหมด
- **8. UI Layout Example:** gameplay 2.5D/town scene + portrait/HP/MP/EXP ซ้ายบน · quest/chat ซ้าย · minimap ขวาบน · menu rail ขวา · skill hotbar/AUTO ด้านล่าง
- **9. Bot UI:** แผงตั้งค่า BOT มี auto-skill 1–4, movement/map mode, attack/loot toggles, HP/MP potion thresholds และปุ่มบันทึก
- **Binding art direction:** Pixel + HD effect hybrid · colorful fantasy · detailed but readable · Dark Fantasy base · Gold + Purple identity · Thai-first readability (Kanit/Prompt)
- **Interpretation rule:** ใช้ภาพนี้เป็น direction/taxonomy/hierarchy reference — ห้าม pixel-copy หรือสร้าง painted imitation แบบ throwaway; implementation ปัจจุบันยังคง code-drawn + fallback จน owner เปิด asset-pipeline scope

## การเคาะของเจ้าของ (2026-07-09 — ตัดสินแล้ว อย่ารื้อ)

| เรื่อง | เคาะ |
|---|---|
| ฟอนต์ | เปลี่ยน Chakra Petch → **Kanit 600/800** (display/เลข/ปุ่ม) + **Prompt 400** (เนื้อความ) — 3 น้ำหนักเท่านั้น |
| สี epic | **คงทอง** (ผู้เล่นถูก train แล้ว) — ม่วง = สี chrome/UI (หัวแผง/active tab/ปุ่มรอง) ไม่ใช่สีของดรอป |
| Joystick เสมือน | **ไม่เอา** — tap-to-move + AUTO ครอบคลุม; ทบทวนใหม่ได้ตอนโลกแกน x,y (R4) |
| ปุ่มร้านค้า/ภารกิจบน HUD | ~~ไม่เอา — คงกติกา NPC~~ **แก้ไข (2026-07-09 R2.5, เคาะทับของเดิม): ครบชุด + ปุ่ม NPC = สั่งเดินไปหา** — ปุ่ม ร้านค้า/ตีบวก/ภารกิจ ขึ้น HUD ได้ โดยมีเงื่อนไขเดียว: ปุ่มต้อง**สั่งเดินไปหา NPC เท่านั้น** (`startNpcTrip`, fast-travel+walk ผ่าน seam tap-to-talk เดิม) **ห้ามเปิดแผงทางไกล** — กติกา "โลกคือสถานที่จริง" ยังอยู่ครบ แค่สั่งเดินได้เร็วขึ้นจากเมนู (`NpcTripButtons.tsx`, R2.5-W3) |
| แผงตีบวก | **โชว์โอกาสสำเร็จ %** ตาม mockup + **คง suspense** เฉลยผลตอนตีค้อนจังหวะสุดท้าย (สองอย่างไม่ขัดกัน) |
| ทอง = ตัวเลข/ขอบ/CTA เท่านั้น | เนื้อความเป็น `--ddp-ink` เสมอ (กันอ่านยาก) · font ≥11px |

## แมป mockup ทีละชิ้น

### ✅ R1 (ลงแล้ว 2026-07-09)
- Token กรอบทองเรือง + พาเลต + ปุ่ม 3 ระดับ + toast/popup base → `src/app/globals.css` + `src/ui/components/primitives/`
- ฟอนต์ Kanit/Prompt → `src/app/layout.tsx`
- ไอคอน SVG เส้นทอง 8 ตัว → `src/ui/components/icons.tsx`
- นำร่อง 2 แผง: FastTravelPicker + InventoryPanel (shell swap)
- **ประตูแตะได้** แทนปุ่ม ◀▶ (mockup ไม่มีข้อนี้ตรงๆ แต่เป็นคำสั่งเจ้าของรอบเดียวกัน) → gateLockOverlay + hitTestGate
- **แผนที่โลก** (ก้าวแรกของ minimap) → WorldMapPanel + relay `/presence/counts`

### R2 — sweep แผงตาม mockup (รายชิ้น)
| mockup | ของเรา | งาน |
|---|---|---|
| INVENTORY grid กรอบ rarity + qty + 95/100 + ขายทั้งหมด/จัดเรียง | InventoryPanel (ฟังก์ชันครบแล้ว) | ItemTile primitive + reskin grid |
| EQUIPMENT paper-doll + STR/DEX/INT/VIT/AGI + พลังต่อสู้ | paper-doll ใน InventoryPanel | จัด layout ตาม mockup (การ์ดตัวละครกลาง + ช่องอุปกรณ์ข้าง + stat block) |
| RANKING โพเดียม 2-1-3 + มงกุฎ + แถวอันดับ + "อันดับของคุณ" | HOF (โพเดียมมีแล้ว ใกล้ mockup มาก) | จูน token ทอง/ม่วง ให้เข้าชุด |
| ENHANCE การ์ด +10→+11 + ATK 70→77 + **โอกาสสำเร็จ 65%** + วัสดุ chips + ราคา | RefinePanel (ลุงดึ๋ง) | reskin + **เพิ่มบรรทัด %** (เคาะแล้ว) — ระวัง state machine reveal-on-final-strike ห้ามพัง (migrate ท้ายสุดของ R2) |
| SKILL UI รายการสกิล + detail pane (ภาพใหญ่ คำอธิบาย MP คูลดาวน์) | skill ⓘ inspector (skillStats.ts) | ยกเป็น detail pane เต็มตาม mockup — **ไม่มีเลเวลสกิล** (นั่นคือ backlog ระบบใหม่) |
| BOT UI แผงจริงจัง (สกิลออโต้ติ๊กเลือก + เกณฑ์ยา HP/MP + โหมดเดิน + โซนที่กำหนด) | ตัวเลือกมี**ครบแล้ว**ใน Settings (บอท per-hero M8.6) | ยกออกมาเป็นแผง Bot ของตัวเอง จัดหน้าตาม mockup |
| Quest tracker ซ้อนซ้ายบน ([หลัก]/[รอง]/[รายวัน] + progress) | quest card / GoalLadder | **ทำแล้ว R2.6**: แท็บ [เควส\|ปาร์ตี้] (เคาะ 2 แท็บ) + tag [หลัก]/[รอง]/[รายวัน] ([รายวัน] อ่านอย่างเดียว — รับรางวัลที่ผู้ใหญ่บ้านเหมือนเดิม) + **หุบได้ทุกจอ เหลือชิปเล็ก** (เคาะ 2026-07-10, localStorage per-device) — breadcrumb rung เดิมถูกตัด (HoF เปิดจาก menu row) |
| Portrait + Lv + HP/MP/EXP + พลังต่อสู้ มุมซ้ายบน | HUD มีข้อมูลครบ | StatBar primitive + จัดเป็นบล็อค portrait ตาม mockup |
| แถบเงิน/เพชรขวาบน | ทอง + หินเสริมพลัง | CurrencyChip primitive |
| Skill bar เลขกำกับ 1-5 + AUTO + ยาด่วน x99 | SkillBar + auto-potion | **ทำแล้ว R2.6**: SkillDock แถวเดียวตาม ref (tile สกิลเลขกำกับ + AUTO + ยาด่วน badge จำนวน) + **หุบเหลือแถบบาง AUTO ค้างไว้ + ลูกศรกลาง** (เคาะ 2026-07-10, localStorage per-device); ExpClockStrip โชว์ตลอด |
| จอเกมใหญ่ + HUD ซ้อน | จอเกม 900×300 กรอบ | **desktop/แนวนอน**: จอสูงขึ้น ~16:9 + HUD overlay (มี scrim มืดรอง — กันจมบน biome สว่าง) · **มือถือแนวตั้ง: คงกรอบเดิม** (overlay บังเกม) |
| Toast/notification + popup ยืนยัน + tab | NoticeToast / useConfirmGuard / tab strips | Toast/ConfirmPopup/Tab primitives |

### ✅ R2.7 Wave A (2026-07-10, issue #55 — จาก audit #54)
- EXP % readout บน `ExpClockStrip` (ตัวเลขทอง ขอบซ้าย คู่กับนาฬิกาขวา)
- เลขดาเมจ/ทอง มี stroke ดำ (`floatingText.ts` — `TextStyle.stroke` ครั้งแรกใน repo, ตั้งครั้งเดียวตอน construct, per-spawn cost ศูนย์)
- Scrim gradient ขอบบนจอ ชั้น z-5 คู่ vignette (`GameHud.tsx`) — กัน HUD มุมบนจมบน biome สว่าง
- แผงตีบวก: ชิป cost เป็นเศษ มี/ต้องใช้ (เช่น 42/30) + ย้อมแดงเมื่อไม่พอ (state machine เฉลยค้อนสุดท้ายไม่แตะ)
- Toast info = ม่วง chrome (แก้ `VARIANT_CLASS.info` จุดเดียว)
- INVENTORY tab "ทั้งหมด" (default, รวม weapon+armor; "ใช้/อื่นๆ" ติด economy — ยังไม่ทำ)
- gap ที่เหลือจาก audit #54: Wave B (menu-row/action rail/chat) รอ owner เคาะ · Wave C ตาม R3/R4-R5 · Wave D รอ asset pipeline

### ✅ R2.9 Codegen Asset Phase 1A (2026-07-10, issue #60 — จาก Asset Bible #57)
- **ภาษาภาพไอคอนใหม่** (silhouette ทึบ + gradient + family glow ตาม GAME ASSET OVERVIEW) เริ่ม 9 id: item 5 (`w_sword_t1_rusty`/`w_bow_t1_short`/`w_sword_t10_apocalypse`/`a_cloth_t1_tunic`/`fort_weapon`) + skill 4 (`sword_whirl`/`mage_meteor`/`mage_frostnova`/`archer_rain`)
- โครง: `src/ui/components/icons/` (iconBase/itemIcons/skillIcons/gameIcons) — registry id→SVG component + `ItemIcon`/`SkillIcon` seam; **glyph เดิมจาก `labels.ts` = fallback เสมอ** (id นอก slice เห็นของเดิมเป๊ะ) · SVG ล้วน ไม่มีไฟล์ภาพ ไม่มี filter · gradient id กันชนด้วย useId
- id ที่เหลือ = Phase 1B หลัง owner eye-test slice นี้ · **มาตรฐาน icon ใหม่ต่อจากนี้ = ภาษาภาพนี้** (เส้นทอง 2px ใน `icons.tsx` ยังเป็นของ chrome/เมนู — คนละหน้าที่)

### ✅ R2.8 Wave B ชุด safe (2026-07-10, issue #58)
- BOT auto-skill picker → tile row เลขกำกับสไตล์ SkillBar (64px, ✓ emerald ตาม convention ใน modal; semantics automation เดิมทุกอย่าง)
- Mobile HUD tuning: menu-row มือถือ 3→2 แถว (grid-cols-5 + tile 40px ต่ำกว่า sm) · SkillDock/quest-slot รัดแนวตั้งบนจอเตี้ย · แก้ bug กล่อง ExpClockStrip เตี้ยกว่าข้อความ (text ล้นชน dock)
- ค้างจาก Wave B ชุดเคาะ (owner-decision ใน #54): menu-row regroup · action rail · chat overlay — ไม่อยู่ใน #58 โดยตั้งใจ

### R3 — Presence คนจริง
- ฉาก gameplay ของ mockup ที่คนเยอะๆ ออร่า/เลขดาเมจของคนอื่น = ghost action stream (8Hz combat + snapshot-on-join + tap ดูโปรไฟล์)

### R4-R5 — โลกแกน x,y
- มุมมอง top-down isometric + เดินทั้งระนาบ = engine 1D→2D + promote ภาพ M8.7
- **Minimap มุมจอ** (แบบ "Prontera" ใน mockup) — ทำหลังโลกเป็น x,y จริง (แผนที่โลก R1 เป็น surface ชั่วคราว)

### Backlog (เจ้าของรับเข้า 2026-07-09 — ทำหลัง arc)
- **เลเวลสกิล อัปด้วยทอง** (mockup: Lv.10 MAX / Lv.8 200/300 + ปุ่มอัป 50,000) — gold sink ถาวรที่หาอยู่ (หนี้เงินเฟ้อ flat pricing)
- **คอลเลคชัน** (tab ในแผง EQUIPMENT ของ mockup) — สะสมครบชุดได้โบนัส

### ❌ พักไว้ (เจ้าของไม่รับเข้า ณ 2026-07-09)
- กิลด์ · สัตว์เลี้ยง · เซ็ตอุปกรณ์ 1/2 · อารีน่า (PvP ตัดไปแล้ว 2026-07-05) · channel "CH.1" (ขัดกับ presence โลกเดียว)

## ความเสี่ยงยืนพื้น (จาก design consult)
1. ทองบนพื้นเข้ม contrast ต่ำ — ทองห้ามใช้กับเนื้อความ
2. ฟอนต์ไทยหนัก — ห้ามเกิน 3 น้ำหนัก, next/font subset, display:swap
3. HUD overlay บน biome สว่าง (ทะเลทราย/หิมะ/กลางวัน) — ต้องมี scrim มืดรองเสมอ
