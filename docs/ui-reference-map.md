# UI Reference Map — mockup ของเจ้าของ → แผนงานจริง

> **ที่มา (2026-07-09):** เจ้าของส่ง reference image ชุดเต็ม (dashboard MMORPG ธีม Dark Fantasy) พร้อม design goals ในภาพ: อ่านง่าย · สวยงาม · สื่อสารชัดเจน · ใช้งานง่าย · อารมณ์ MMORPG · รองรับทุกขนาดจอ + spec ในภาพ: โทน Dark Fantasy + Gold + Purple · ฟอนต์ Kanit/Prompt · UI ทุกชิ้นมี animation 150-250ms · responsive PC+mobile
> เอกสารนี้คือ **brief ถาวร** สำหรับทุก wave ของ R2 และรอบถัดๆ ไป — mockup ชิ้นไหนลงรอบไหน เคาะอะไรไปแล้วบ้าง
> เงื่อนไข "งาน art ต้องเริ่มจาก reference ของเจ้าของ" **ผ่านแล้ว**สำหรับ UI chrome ทั้งชุดนี้ · **เฟสแรก = art จากโค้ดล้วน** (CSS/SVG/emoji — ห้ามเลียนไอคอนวาดสี/ภาพ painted ของ mockup จนกว่าจะมี asset pipeline ของเจ้าของ)

## การเคาะของเจ้าของ (2026-07-09 — ตัดสินแล้ว อย่ารื้อ)

| เรื่อง | เคาะ |
|---|---|
| ฟอนต์ | เปลี่ยน Chakra Petch → **Kanit 600/800** (display/เลข/ปุ่ม) + **Prompt 400** (เนื้อความ) — 3 น้ำหนักเท่านั้น |
| สี epic | **คงทอง** (ผู้เล่นถูก train แล้ว) — ม่วง = สี chrome/UI (หัวแผง/active tab/ปุ่มรอง) ไม่ใช่สีของดรอป |
| Joystick เสมือน | **ไม่เอา** — tap-to-move + AUTO ครอบคลุม; ทบทวนใหม่ได้ตอนโลกแกน x,y (R4) |
| ปุ่มร้านค้า/ภารกิจบน HUD | **ไม่เอา — คงกติกา NPC**: ร้านค้า/ตีบวก/กระดานเควสเปิดจากเดินไปคุย NPC เท่านั้น (เข้าทาง open world) · ปุ่ม HUD มีเฉพาะของไม่ผูกโลก: กระเป๋า สกิล จัดอันดับ เพื่อน ตั้งค่า แผนที่โลก |
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
| Quest tracker ซ้อนซ้ายบน ([หลัก]/[รอง]/[รายวัน] + progress) | quest card / GoalLadder | ทำเป็น overlay panel บนจอเกม (desktop ก่อน) |
| Portrait + Lv + HP/MP/EXP + พลังต่อสู้ มุมซ้ายบน | HUD มีข้อมูลครบ | StatBar primitive + จัดเป็นบล็อค portrait ตาม mockup |
| แถบเงิน/เพชรขวาบน | ทอง + หินเสริมพลัง | CurrencyChip primitive |
| Skill bar เลขกำกับ 1-5 + AUTO + ยาด่วน x99 | SkillBar + auto-potion | reskin + ช่องยาด่วนแบบ mockup |
| จอเกมใหญ่ + HUD ซ้อน | จอเกม 900×300 กรอบ | **desktop/แนวนอน**: จอสูงขึ้น ~16:9 + HUD overlay (มี scrim มืดรอง — กันจมบน biome สว่าง) · **มือถือแนวตั้ง: คงกรอบเดิม** (overlay บังเกม) |
| Toast/notification + popup ยืนยัน + tab | NoticeToast / useConfirmGuard / tab strips | Toast/ConfirmPopup/Tab primitives |

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
