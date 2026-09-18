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

## 6. Probability รองรับ blank 2 ตัวและจัดอันดับรายคำ
- คำนวณจำนวนวิธีหยิบจากถุง 100 ตัว โดยรวมกรณีใช้ blank 0, 1 และ 2 ตัว
- แต่ละคำมี Probability Order ของตัวเอง แม้เป็น anagram กัน โดยเรียงตามตัวอักษรภายในแร็คเดียวกัน
- คำ 5 ตัวใน CSW24 ครบ 8,710 alphagram sets (เดิมสูตรไม่มี blank เหลือ 8,587 sets)
- ใช้สูตร blank เดียวกันทั้ง JavaScript และ C++/WASM

## 7. เบี้ยคำถาม Quiz แบบลากเรียงได้
- เปลี่ยน rack คำถามเป็นเบี้ยสีฟ้าพร้อมคะแนนตัวอักษร
- ลากสลับตำแหน่งด้วย mouse, touch และ pen ผ่าน Pointer Events
- ใช้ปุ่มลูกศรซ้าย/ขวา รวมถึง Home/End เพื่อเรียงด้วยคีย์บอร์ด
- เก็บลำดับที่ผู้ใช้จัดไว้เมื่อ Quiz UI render ใหม่ในข้อเดิม

## 8. Probability Order เป็นอันดับรายคำ
- แยกอันดับตามความยาวคำ เรียงจากจำนวน combination ที่จั่วได้มากไปน้อย
- แร็คเดียวกันขยายเป็นคำรายตัวและเรียงตามตัวอักษร จึงได้เลข #Prob ต่อเนื่อง
- ส่ง Probability Order เข้า WASM แบบ PreserveOrder เพื่อไม่ให้ถูกเรียงทับ

## 9. Calculator และ Chess Clock
- ถอดหมวด Saved Words ออกจากเมนูหลัก และเลื่อน Calculator มาแทนตำแหน่งเดิม
- เพิ่ม Chess Clock แบบสองฝั่ง ค่าเริ่มต้น 25 นาที ปรับเวลาเพิ่ม/ลดได้
- การแตะฝั่งผู้เล่นจะสลับไปเริ่มนับเวลาของอีกฝั่งแบบ chess clock จริง
- ตั้งเวลาแยก Player 1/Player 2 ผ่านป๊อปอัป
- Mobile แนวตั้งจัดเป็นนาฬิกาบน–ล่างพร้อมปุ่มกลางและพื้นที่กดเต็มฝั่ง
- Tablet/หน้าจอแนวนอนใช้เลย์เอาต์สามคอลัมน์ซ้าย–กลาง–ขวา โดยปุ่มนาฬิกาเต็มคอลัมน์
- ป๊อปอัปตั้งเวลารองรับทั้งนาทีและวินาทีแยกกันในแต่ละฝั่ง (วินาที 0–59)
- เมื่อเวลาฝั่งใดหมด จะแสดงโอเวอร์ไทม์และนับเพิ่มขึ้นต่อเนื่อง
- ปรับ Quiz rack ให้ลากข้ามหลายเบี้ยได้ในครั้งเดียว และหยุด timer ทันทีเมื่อจบข้อ/จบ quiz

## 10. ระบบ Save & Load ทางเลือกระหว่าง .zzq กับ Local Storage
- สร้าง `buildZzqXmlString()` ใช้งานร่วมกันทั้งการดาวน์โหลดไฟล์ .zzq และการบันทึกลง Local Storage
- ปรับ UI ปุ่มเป็น "Save" และ "Load" (แทน Save 💾 / Load .zzq)
- Save Flow: แสดง Modal ทางเลือกระหว่าง "บันทึกลงเครื่อง (Local)" กับ "ดาวน์โหลดไฟล์ (.zzq)"
- Load Flow: แสดง Modal ทางเลือกระหว่าง "โหลดจากเครื่อง (Local)" กับ "เปิดไฟล์ (.zzq)"
- Performance Optimization สำหรับ Local Storage:
  - แยก Header Metadata น้ำหนักเบา (`zyz_quiz_saves_meta`) ออกจาก Data Payload (`zyz_quiz_save_<id>`) ทำให้โหลดและเปิด Pop-up รายการเซฟได้ทันที ไม่เกิดอาการค้างหรือกระตุก
  - การ์ดรายการเซฟแสดงชื่อ, วันที่เวลา, ประเภท Quiz, ความคืบหน้า (ข้อ X/Y, ถูก, ตกหล่น)
  - ปุ่มโหลด (Load) อ่านเฉพาะข้อมูล id นั้น และเข้าสู่ Quiz ทันที
  - ปุ่มลบ (Delete) พร้อม confirm dialog และอัปเดตหน้าจอทันที
  - มี Empty state เมื่อยังไม่มีเซฟในเครื่อง และรองรับ QuotaExceededError
  - Keyboard a11y: Esc เพื่อปิด, ปิดเมื่อคลิกพื้นหลัง, ไม่ยัด HTML/CSS ลง index.html แต่ inject ผ่าน JS ด้วย Design Tokens จาก styles.css

## ไฟล์ที่เปลี่ยน
| ไฟล์ | สาเหตุ |
|------|--------|
| index.html | ปรับปุ่ม Load .zzq เป็น Load เรียก handleLoadQuizClick() |
| quiz_bridge.js | ระบบ Save & Load (.zzq + Local Storage), buildZzqXmlString(), metadata optimization, dynamic modal injection |
| sw.js | อัปเดต cache version เป็น v2 |

## ไฟล์ที่ต้องเก็บจาก Zip เดิม (ไม่เปลี่ยน)
- CSW24.txt
