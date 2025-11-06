**演示：https://www.reunification.top**

# 🇨🇳祖國統一 臺灣當歸·實時數據儀表盤

這是一個功能豐富的全棧 Web 應用程序，旨在實時可視化投票數據。它利用 ECharts 繪製動態地圖，並配備了一個完整的後端系統（Node.js + MySQL）來處理數據持久化和實時交互，包括一個自定義的 CSS 彈幕系統。

該項目已為電腦端和手機端進行了完美的響應式佈局適配。

## ✨ 項目特色

  * **全棧架構**：使用 Node.js/Express 處理後端邏輯，使用原生 JS/CSS/HTML 處理前端交互。
  * **數據持久化**：所有投票、排名和彈幕數據均永久存儲在 **MySQL** 數據庫中。
  * **動態地圖**：使用 ECharts 實時渲染臺灣地圖的票數熱力圖。
  * **豐富的儀表盤**：
      * **實時投票動態**：電腦端自動滾動，手機端手動滾動。
      * **地區票數排名**：帶有 🥇🥈🥉 圖標和百分比進度條。
      * **實時統計**：顯示「總票數」和「今日新增」（每日午夜自動重置）。
      * **實時時鐘**：以 `Asia/Taipei` 時區每秒更新。
  * **自定義彈幕系統**：
      * 用戶可發送**自定義內容 + Emoji** 的彈幕，彈幕會在地圖上實時飄過。
      * **智能軌道系統** (`V40+`)：彈幕在 10 條軌道上依次發射，**永不重疊**。
      * **前端冷卻** (`V38+`)：前端 UI 限制 5 秒發送一次。
      * **後端防刷屏** (`V38+`)：服務器端對 IP 進行 5 秒冷卻。
      * **後端總開關** (`V38+`)：可通過修改數據庫 `meta` 表中的 `isDanmakuEnabled` 值，一鍵開啟或關閉全站彈幕。
  * **安全與驗證**：
      * **每日一票** (`V47+`)：基於瀏覽器 `localStorage` 限制每個用戶每天只能投票一次。
      * **字數限制** (`V48+`)：前端和後端雙重驗證姓氏（≤4 字）和彈幕（≤20 字）。
      * **蜜罐 (Honeypot)** (`V48+`)：投票表單中包含對機器人可見、對用戶隱藏的陷阱字段，防止機器人提交。
      * **內容過濾** (`V48+`)：後端自動拒絕包含 `http`, `www.`, `.com` 等鏈接的彈幕。
  * **完美適配**：
      * **電腦端**：全屏浮動卡片式儀表盤佈局，左右分欄。
      * **手機端**：單列自然滾動佈局，所有元素完美堆疊。

-----

## 💻 技術棧

  * **前端 (Frontend)**:
      * HTML5
      * CSS3 (Flexbox, @media 響應式佈局, CSS 動畫)
      * 原生 JavaScript (ES6+, DOM, Fetch API)
      * ECharts (地圖可視化)
  * **後端 (Backend)**:
      * Node.js
      * Express.js
  * **數據庫 (Database)**:
      * MySQL (使用 `mysql2` 驅動)

-----

## 🚀 如何運行 (Running the Project)

### 1\. 準備工作：數據庫 (MySQL)

在啟動服務器之前，您**必須**先設置好 MySQL 數據庫。

1.  登錄您的 MySQL 服務器（例如使用寶塔面板或命令行）。

2.  執行以下 SQL 腳本來創建數據庫和所有需要的表：

    ```sql
    -- 1. 創建數據庫
    CREATE DATABASE IF NOT EXISTS voteApp;
    USE voteApp;

    -- 2. 創建 'votes' 表 (存儲總數)
    CREATE TABLE IF NOT EXISTS votes (
        region VARCHAR(50) PRIMARY KEY,
        totalVotes INT DEFAULT 0,
        todayVotes INT DEFAULT 0
    );

    -- 3. 創建 'vote_log' 表 (存儲投票記錄)
    CREATE TABLE IF NOT EXISTS vote_log (
        id INT PRIMARY KEY AUTO_INCREMENT,
        surname VARCHAR(50) NOT NULL,
        gender VARCHAR(10) NOT NULL,
        region VARCHAR(50) NOT NULL,
        timestamp DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
    );

    -- 4. 創建 'meta' 表 (存儲“今日”和“彈幕開關”)
    CREATE TABLE IF NOT EXISTS meta (
        id VARCHAR(50) PRIMARY KEY,
        lastResetDate DATE,
        isDanmakuEnabled BOOLEAN DEFAULT true -- 彈幕總開關
    );

    -- 5. 創建 'danmaku_log' 表 (存儲彈幕)
    CREATE TABLE IF NOT EXISTS danmaku_log (
        id INT PRIMARY KEY AUTO_INCREMENT,
        message VARCHAR(100) NOT NULL,
        timestamp DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
    );

    -- 6. 初始化 meta 表
    INSERT IGNORE INTO meta (id, lastResetDate) VALUES ('voteMeta', CURDATE());

    -- 7. 初始化所有地區
    INSERT IGNORE INTO votes (region) VALUES
        ('臺北市'), ('新北市'), ('桃園市'), ('臺中市'), ('臺南市'),
        ('高雄市'), ('基隆市'), ('新竹市'), ('嘉義市'), ('宜蘭縣'),
        ('新竹縣'), ('苗栗縣'), ('彰化縣'), ('南投縣'), ('雲林縣'),
        ('嘉義縣'), ('屏東縣'), ('花蓮縣'), ('臺東縣'), ('澎湖縣'),
        ('金門縣'), ('連江縣');
    ```

### 2\. 安裝後端依賴

在您的項目根目錄 (`map-vote/`) 中打開終端，運行：

```bash
# 安裝 Express 和 MySQL2 驅動
npm install express mysql2
```

### 3\. 配置後端

打開 `server.js` 文件，定位到頂部的 `dbConfig` 對象 (約第 15 行)。

**⚠️ 關鍵：** 將 `host`, `user`, `password` 和 `database` 替換為您自己的 MySQL 數據庫信息。

```javascript
// server.js
const dbConfig = {
    host: 'localhost',         // 您的 MySQL 服務器地址
    user: 'root',              // 您的 MySQL 用戶名
    password: 'password',      // 您的 MySQL 密碼
    database: 'voteApp',       // 您的數據庫名稱
    // ...
};
```

### 4\. 啟動服務器

在終端中運行：

```bash
node server.js
```

如果一切順利，您將看到：

```
成功連接到 MySQL 數據庫 (連接池)
正在檢查數據庫初始化...
數據庫初始化檢查完畢
服務器已啟動，請訪問 http://localhost:3000
```

### 5\. 訪問應用

打開您的瀏覽器，訪問 `http://localhost:3000` 即可開始使用。
