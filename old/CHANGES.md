# Zyzzylu v2 — Changes

## 1. เพิ่มฟิลเตอร์ Number of Vowels (num_vowels)
- ใช้ได้ทั้งใน Search และ Quiz
- กำหนด min–max จำนวนสระ (A E I O U) ในคำ
- บันทึก/โหลด .zzq เป็น `<condition type="Number of Vowels" min="X" max="Y"/>`
  ซึ่งตรงกับ format ที่ Zyzzyva ใช้

## 2. ระบบ Analyze ปรับปรุงใหม่
- ตอบผิดครั้งใด → เก็บลง sessionIncorrect ทันทีผ่าน trackWrongGuess()
- แสดง 3 ส่วนแยกชัดเจน:
  - **Missed** — คำถูกที่หาไม่เจอในข้อนี้
  - **Wrong Guesses This Question** — คำผิดที่พิมพ์ในข้อนี้
  - **All Session Wrong Guesses** — สะสมทุกข้อ แสดงจำนวนครั้ง (×N) บันทึกใน .zzq ด้วย
- แก้ bug "Invalidated" ที่เดิมทำให้คำถูกทุกคำโดนติด Invalidated
- แสดง badge CLEAN / HAD WRONG GUESSES ต่อข้อ

## 3. Session incorrect persists ใน .zzq
- บันทึกเป็น `<zyzzylu-session><all-incorrect-responses>` พร้อม count
- โหลดกลับมาได้จาก .zzq ที่บันทึกโดย Zyzzylu
- สำหรับไฟล์จาก Zyzzyva (ไม่มี zyzzylu-session) จะ seed จาก incorrect-responses ของข้อปัจจุบัน

## 4. MWC RNG — แก้ให้ตรงกับ Zyzzyva
- สูตร: `return ((z << 16) + (w & 0xffff)) >>> 0`  (เดิมใช้ `+ w` ซึ่งผิด)
- Shuffle: `i + (rng() % limit)`  (เดิมใช้ division ซึ่งให้ผลต่างกัน)
- seed2: `new Date().getMilliseconds()` (0–999)  แทน random 1–65535

## 5. บันทึก missed-responses ใน .zzq
- เมื่อข้อถูก check แล้ว จะบันทึก `<missed-responses>` ด้วย
  ทำให้ไฟล์ compatible กับ Zyzzyva อย่างสมบูรณ์

## 6. เพิ่ม Part of Speech ใน Quiz, หลอด Loading % และ Floating Tile Drag (คง UI เดิม 100%)
- **Part of Speech ใน Quiz**: แสดง POS เช่น `(v.)`, `(n.)`, `(adv.)` แทนคะแนนตัวอักษรใต้คำ และปรับหัวตารางเป็น `Word · POS · #Prob`
- **หลอดบอก % ในหน้า Loading**: มี Progress bar สีเขียวธีมเดิมของ old พร้อมเปอร์เซ็นต์นับความคืบหน้า 0% - 100%
- **เบี้ยตัวอักษรใน Quiz ลอยตามมือ (Floating Drag Tile)**: ลากจัดเรียงสลับตำแหน่งได้ ลอยตามนิ้ว/เมาส์แบบไม่มีบัค โดยรักษา styling สี่เหลี่ยมสีเทาดั้งเดิมของ old
- **คง UI เดิม**: ไม่เปลี่ยนแท็บ, ไม่เปลี่ยนเลย์เอาต์, และคงหน้าตาเดิมของ old ไว้ทุกประการ

## ไฟล์ที่เปลี่ยน
| ไฟล์ | สาเหตุ |
|------|--------|
| index.html | หลอด % ใน loadingScreen, styling สำหรับ floating drag tile |
| core.js | ฟังก์ชัน `formatWordPos()`, `setLoadingProgress()`, อัปเดต parsing metadata |
| quiz_bridge.js | แสดง POS แทนคะแนนใต้คำและหัวตาราง, ระบบลากเบี้ย Quiz แบบ floating drag tile |
| sw.js | อัปเดต cache version เป็น v4 |

## ไฟล์ที่ต้องเก็บจาก Zip เดิม (ไม่เปลี่ยน)
- CSW24.txt
- zyzzylu_cpp_engine.js
- zyzzylu_cpp_engine.wasm
