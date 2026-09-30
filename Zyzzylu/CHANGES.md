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

## 11. การปรับปรุง Quiz (Part of Speech & Floating Tile Drag) และหลอด Loading %
- **Part of Speech ใน Quiz**: เปลี่ยนจากเดิมที่แสดงคะแนนตัวอักษร (${score}pts) ใต้คำ มาเป็นการแสดง Part of Speech เช่น `(v.)`, `(n.)`, `(adv.)` ดึงจาก metadata ของ CSW24 และปรับหัวตารางเป็น `Word · POS · #Prob`
- **หลอดบอก % ในหน้า Loading**: ปรับปรุงหน้าจอเริ่มต้น `#loadingScreen` จาก spinner เดี่ยวๆ เป็นหลอดความคืบหน้า (Progress Bar) ที่สวยงาม พร้อมแสดง % ตัวเลขขนาดใหญ่ และสถานะขั้นตอนการประมวลผล (ดาวน์โหลด, ประมวลผลคำศัพท์, สร้าง Probability Cache) คำนวณแบบแม่นยำ
- **ระบบลากเบี้ย Quiz ลอยตามมือ (Floating Drag Tile)**:
  - ขณะเริ่มลาก มีตัวเบี้ยลอยขึ้นมาตามปลายนิ้ว/เคอร์เซอร์เมาส์ 1:1 (`is-floating` พร้อม lift shadow)
  - ตำแหน่งเดิมในแร็คจะแสดงเป็น slot เส้นประโปร่งแสง (`is-placeholder`) และขยับสลับช่องตามการเลื่อนมือแบบ smooth
  - เมื่อปล่อยมือ ตัวเบี้ยลอยจะดูดกลับเข้าช่องที่เลือกอย่างนุ่มนวล
  - แก้ไขปัญหา pointer capture หลุด และบัคการกระตุกบนจอสัมผัส (Mobile Touch) และเมาส์

## 12. ระบบเสียงเตือนนาฬิกา Chess Clock และฟีเจอร์พิเศษ Overtime Sound
- **เสียงเตือน 10 วินาทีสุดท้าย**: เตือนเมื่อเวลาของฝั่งที่กำลังเดินเหลือ 00:10 วิ (เลือกเสียง High Beep, Chime, Two-Tone ได้)
- **เสียงนับถอยหลัง 00:05 – 00:01 วิ**: มีเสียงเตือนทุกวินาที 5, 4, 3, 2, 1 ก่อนหมดเวลา (เลือกเสียง Tick, Beep, Wood Click ได้)
- **เสียงหมดเวลา 00:00 วิ (ลากยาว)**: เมื่อเวลาหมดลงสู่ 00:00 จะมีเสียงบัซเซอร์ลากยาวต่อเนื่อง
- **การหยุดเสียงลากยาว**: เสียงจะหยุดทันทีเมื่อผู้เล่นกดข้ามไปฝั่งตรงข้าม (Switch Side) หรือเมื่อเวลาเดินถึง `-00:01` วินาที หรือเมื่อกดหยุด/รีเซ็ต
- **ฟีเจอร์พิเศษ: Custom เสียงเมื่อเวลาติดลบ (-1 ถึง -10 นาที)**:
  - ค่าเริ่มต้น: ปิด/ไม่มีเสียง ตามที่กำหนด
  - เมื่อเปิดใช้งาน: สามารถเลือกเสียง Custom (Double Beep, Triple Beep, Low Bell, Alarm Pulse) และเลือกระยะนาทีที่ต้องการเตือน (-1 ถึง -10 นาที)
  - มีปุ่มทดสอบเสียง (▶) ให้ลองฟังทุกรูปแบบในหน้าต่างตั้งค่า
- **Web Audio API**: ทำงานแบบ Offline 100% ไม่ต้องโหลดไฟล์ภายนอก ไม่ดีเลย์ พร้อมบันทึกค่าลง `localStorage`

## ไฟล์ที่เปลี่ยน
| ไฟล์ | สาเหตุ |
|------|--------|
| index.html | หลอดความคืบหน้า % ใน loadingScreen, UI ปรับแต่งเสียงใน Modal ตั้งเวลา, asset versions (v=13, v=10, v=2) |
| core.js | ฟังก์ชัน `formatWordPos()`, ฟังก์ชัน `setLoadingProgress()` ควบคุมหลอด %, อัปเดตการอ่านไฟล์และ parse CSW24 |
| quiz_bridge.js | แสดง POS แทนคะแนนใต้คำและหัวตาราง, ระบบลากเบี้ยแบบ floating ghost tile ลอยตามมือและ smooth placeholder reorder |
| clock.js | ระบบเสียงสังเคราะห์ Web Audio API, ตัวตรวจจับเวลา 10s, 5s-1s, 00:00 ลากยาว, หยุดที่ -00:01 หรือข้ามฝั่ง, Custom Overtime Sound (-1 ถึง -10 นาที) |
| styles.css | เพิ่ม styling สำหรับ `.quiz-tile.is-floating`, `.quiz-tile.is-placeholder`, `touch-action: none`, และหน้าต่างตั้งค่าเสียงนาฬิกา |
| sw.js | อัปเดต cache version เป็น v29 และ query strings ของ assets |

## ไฟล์ที่ต้องเก็บจาก Zip เดิม (ไม่เปลี่ยน)
- CSW24.txt
