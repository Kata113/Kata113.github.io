// แก้ไขฟังก์ชันโหลดให้มาอ่าน JSON ที่เราเตรียมมาจาก C++
async function loadQuiz() {
    const response = await fetch('quiz_data.json');
    const wordPool = await response.json();
    
    // ตรงนี้คือจุดสำคัญ: เราใช้ลำดับตาม JSON เป๊ะๆ โดยไม่มีการ shuffle
    qState.pool = wordPool; 
    startQuiz();
}
