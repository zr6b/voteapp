// server.js (V50 - 修復時區 + 延長彈幕時間)

// 遵囑: (修復時區問題 1/2) 設置 Node.js 運行的時區為 UTC+8
process.env.TZ = 'Asia/Taipei';

const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = 3007;

// ⚠️ 關鍵：請再次確認您的 MySQL 數據庫信息！
const dbConfig = {
    host: '127.0.0.1',         // 您的 MySQL 服務器地址
    user: 'voteApp',              // 您的 MySQL 用戶名
    password: '123456',      // 您的 MySQL 密碼
    database: 'voteapp',       // 您在上面創建的數據庫名稱
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
    // 遵囑: (修復時區問題 2/2) 告訴 MySQL 數據庫連接使用 UTC+8
    timezone: '+08:00'
};

let pool;

const ALL_REGIONS = [
    '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
    '基隆市', '新竹市', '嘉義市', '宜蘭縣', '新竹縣', '苗栗縣',
    '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '花蓮縣',
    '臺東縣', '澎湖縣', '金門縣', '連江縣'
];

// V38 新增: 服務器端 IP 冷卻緩存 (防止刷屏)
const danmakuIpCache = {};
// V49 新增: 服務器端 "每日一票" IP 緩存 (防止刷票)
const voteIpCache = {}; // 格式: { 'ip_address': 'YYYY-MM-DD' }

// ... (initializeDatabase 和 checkMidnightRollover 函數保持 V24 不變) ...
async function initializeDatabase() {
    try {
        console.log('正在檢查數據庫初始化...');
        const connection = await pool.getConnection();
        // 確保 meta 表有數據 (V24)
        await connection.query(
            "INSERT IGNORE INTO meta (id, lastResetDate) VALUES ('voteMeta', CURDATE())"
        );
        // V38: 確保 isDanmakuEnabled 欄位存在 (如果 SQL 沒運行)
        try {
            await connection.query("ALTER TABLE meta ADD COLUMN isDanmakuEnabled BOOLEAN DEFAULT true");
            console.log('成功添加 isDanmakuEnabled 欄位。');
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error(e);
        }

        for (const region of ALL_REGIONS) {
            // ⭐️ 安全: 這裡使用了參數化查詢 (?)，自動防止 SQL 注入
            await connection.query("INSERT IGNORE INTO votes (region) VALUES (?)", [region]);
        }
        await connection.query("CREATE TABLE IF NOT EXISTS danmaku_log (id INT PRIMARY KEY AUTO_INCREMENT, message VARCHAR(100) NOT NULL, timestamp DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3))");
        connection.release();
        console.log('數據庫初始化檢查完畢');
    } catch (err) { console.error('數據庫初始化失敗:', err); }
}
async function checkMidnightRollover() {
    const connection = await pool.getConnection();
    try {
        // 現在 CURDATE() 會是 UTC+8 的日期
        const [rows] = await connection.query("SELECT lastResetDate, CURDATE() AS today FROM meta WHERE id = 'voteMeta'");
        const lastReset = rows[0].lastResetDate;
        const todayString = rows[0].today;
        if (lastReset !== todayString) {
            console.log(`午夜翻轉 (UTC+8)：(DB: ${lastReset}, Today: ${todayString}) 正在重置...`);
            await connection.query("UPDATE votes SET todayVotes = 0");
            await connection.query("UPDATE meta SET lastResetDate = ? WHERE id = 'voteMeta'", [todayString]);
        }
    } catch (err) { console.error('午夜檢查失敗:', err); }
    finally { connection.release(); }
}

// --- 中間件 ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', true); // V38: 允許 req.ip 獲取真實 IP

// --- API 列表 ---

// (V24 API /api/stats - 不變)
app.get('/api/stats', async (req, res) => {
    try {
        await checkMidnightRollover();
        // ⭐️ 安全: 查詢沒有用戶輸入
        const [votesData] = await pool.query("SELECT * FROM votes");
        let totalVotes = 0, todayVotes = 0; const mapData = {};
        votesData.forEach(item => {
            totalVotes += item.totalVotes;
            todayVotes += item.todayVotes;
            mapData[item.region] = item.totalVotes;
        });
        res.json({ mapData, totalVotes, todayVotes });
    } catch (err) { console.error('API /stats 錯誤:', err); res.status(500).json({ message: '獲取數據失敗' }); }
});

// (V25 API /api/feed - 不變)
app.get('/api/feed', async (req, res) => {
    try {
        // ⭐️ 安全: 查詢沒有用戶輸入
        const [feed] = await pool.query(
            "SELECT id, surname, gender, region, timestamp FROM vote_log ORDER BY timestamp DESC LIMIT 20"
        );
        res.json(feed);
    } catch (err) { console.error('API /feed 錯誤:', err); res.status(500).json({ message: '獲取日誌失敗' }); }
});

// (V24 API /api/vote - V49 安全升級)
app.post('/api/vote', async (req, res) => {
    await checkMidnightRollover();
    const { region, surname, gender } = req.body;
    const ip = req.ip;

    // --- V49 關鍵: 服務器端防止刷票 ---
    // new Date() 現在是 UTC+8 時間
    const todayString = new Date().toISOString().split('T')[0]; // 格式: 'YYYY-MM-DD'
    const lastVoteDate = voteIpCache[ip];

    if (lastVoteDate === todayString) {
        return res.status(429).json({ success: false, message: '您今天已經投過了 (IP 限制)' });
    }
    // --- 刷票防護結束 ---

    // 原始驗證
    if (!region || !surname || !gender) {
        return res.status(400).json({ success: false, message: '信息不完整' });
    }

    // --- V49: 補充的服務器端輸入驗證 ---
    const validGenders = ['先生', '女士', '保密'];
    if (!validGenders.includes(gender)) {
        return res.status(400).json({ success: false, message: '性別參數無效' });
    }

    if (!ALL_REGIONS.includes(region)) {
        return res.status(400).json({ success: false, message: '地區參數無效' });
    }

    const surnameRegex = /^[\u4E00-\u9FA5A-Za-z]+$/; // 只允許中英文
    // 遵囑: 姓氏長度限制改為 4
    if (surname.length > 4 || surname.length === 0 || !surnameRegex.test(surname)) {
        return res.status(400).json({ success: false, message: '姓氏格式不正確 (1-4個中英文字)' });
    }
    // --- 驗證結束 ---


    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // ⭐️ 安全: 這裡使用了參數化查詢 (?)，自動防止 SQL 注入
        await connection.query(
            "UPDATE votes SET totalVotes = totalVotes + 1, todayVotes = todayVotes + 1 WHERE region = ?",
            [region]
        );

        // ⭐️ 安全: 這裡使用了參數化查詢 (?)，自動防止 SQL 注入
        // new Date() 現在會插入 UTC+8 的時間
        await connection.query(
            "INSERT INTO vote_log (surname, gender, region, timestamp) VALUES (?, ?, ?, ?)",
            [surname, gender, region, new Date()]
        );

        await connection.commit();

        // V49 關鍵: 投票成功，記錄 IP
        voteIpCache[ip] = todayString;

        res.status(200).json({ success: true, message: '投票成功！' });
    } catch (err) {
        await connection.rollback();
        console.error('API /vote 錯誤:', err);
        res.status(500).json({ success: false, message: '數據庫錯誤' });
    } finally {
        connection.release();
    }
});


// --- V38 升級: 彈幕 API ---

// API 4: 獲取自定義彈幕 (V38 升級: 檢查數據庫開關)
app.get('/api/danmaku', async (req, res) => {
    try {
        // ⭐️ 安全: 查詢沒有用戶輸入
        const [meta] = await pool.query("SELECT isDanmakuEnabled FROM meta WHERE id = 'voteMeta'");
        if (!meta[0].isDanmakuEnabled) {
            return res.json([]); // 開關關閉，返回空數組
        }

        // ⭐️ 安全: 查詢沒有用戶輸入
        // 遵囑: (修復彈幕時間問題) 將 3 HOUR 改為 24 HOUR
        // NOW() 函數現在也會返回 UTC+8 的時間
        const [danmaku] = await pool.query(
            "SELECT id, message, timestamp FROM danmaku_log WHERE timestamp >= NOW() - INTERVAL 720 HOUR ORDER BY timestamp DESC LIMIT 50",
            []
        );
        res.json(danmaku);
    } catch (err) { console.error('API /danmaku 獲取錯誤:', err); res.status(500).json({ message: '獲取彈幕失敗' }); }
});

// API 5: 發送自定義彈幕 (V38 升級: 檢查開關 + IP 5秒冷卻)
app.post('/api/danmaku', async (req, res) => {
    const { message } = req.body;
    const ip = req.ip; // 獲取 IP 地址
    const now = Date.now();

    // 1. 驗證
    if (!message || message.trim().length === 0) {
        return res.status(400).json({ success: false, message: '彈幕不能為空' });
    }
    // 遵囑: 彈幕長度限制改為 30
    if (message.length > 30) {
        return res.status(400).json({ success: false, message: '彈幕過長 (最多30字)' });
    }

    try {
        // 2. 檢查總開關
        const [meta] = await pool.query("SELECT isDanmakuEnabled FROM meta WHERE id = 'voteMeta'");
        if (!meta[0].isDanmakuEnabled) {
            return res.status(403).json({ success: false, message: '彈幕功能已暫時關閉' });
        }

        // 3. V38 關鍵: 檢查 IP 5秒冷卻
        const lastPostTime = danmakuIpCache[ip];
        if (lastPostTime && (now - lastPostTime) < 5000) {
            return res.status(429).json({ success: false, message: '操作過於頻繁，請 5 秒後再試' });
        }

        // 4. 清理舊緩存 (1 分鐘前)
        for (const key in danmakuIpCache) {
            if (now - danmakuIpCache[key] > 60000) {
                delete danmakuIpCache[key];
            }
        }

        // V49 新增: 順帶清理舊的投票緩存 (非今日的)
        // new Date() 現在是 UTC+8 時間
        const todayString = new Date().toISOString().split('T')[0];
        for (const key in voteIpCache) {
            if (voteIpCache[key] !== todayString) {
                delete voteIpCache[key];
            }
        }


        // 5. 寫入數據庫
        const messageToSave = message.trim();
        // new Date() 現在會插入 UTC+8 的時間
        const timestamp = new Date();

        // ⭐️ 安全: 這裡使用了參數化查詢 (?)，自動防止 SQL 注入
        const [insertResult] = await pool.query(
            "INSERT INTO danmaku_log (message, timestamp) VALUES (?, ?)",
            [messageToSave, timestamp]
        );
        const newId = insertResult.insertId;

        // 6. 更新 IP 緩存
        danmakuIpCache[ip] = now;

        // 7. 返回 (V31 樂觀更新邏輯)
        res.status(200).json({
            success: true,
            message: '彈幕已發送!', // V49: 簡化提示
            newEntry: {
                id: newId,
                message: messageToSave,
                timestamp: timestamp
            }
        });
    } catch (err) {
        console.error('API /danmaku 發送錯誤:', err);
        res.status(500).json({ success: false, message: '數據庫錯誤' });
    }
});

// (V24 啟動服務器 - 不變)
async function startServer() {
    try {
        pool = mysql.createPool(dbConfig);
        await pool.query('SELECT 1');
        console.log('成功連接到 MySQL 數據庫 (連接池)');

        // 測試時區
        const [rows] = await pool.query("SELECT NOW() as now, CURDATE() as today");
        console.log(`數據庫當前時間 (應為 UTC+8): ${rows[0].now}`);
        console.log(`數據庫當前日期 (應為 UTC+8): ${rows[0].today}`);

        await initializeDatabase();
        app.listen(PORT, () => {
            console.log(`服務器已啟動 (時區: ${process.env.TZ})，請訪問 http://localhost:${PORT}`);
        });
    } catch (err) { console.error('啟動服務器失敗:', err); process.exit(1); }
}

startServer();
