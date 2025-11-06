// app.js (V47 - "每日一票" 瀏覽器限制)

// V39: 恢復 DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {

    // 1. DOM 元素 (不變)
    const totalCountEl = document.getElementById('total-count');
    const todayCountEl = document.getElementById('today-count');
    const mapContainer = document.getElementById('map-container');
    const modalOverlay = document.getElementById('modal-overlay');
    const submitVoteButton = document.getElementById('submit-vote');
    const cancelVoteButton = document.getElementById('cancel-vote');
    const voteButton = document.getElementById('vote-button');
    const feedList = document.getElementById('feed-list');
    const toastContainer = document.getElementById('toast-container');
    const regionSelect = document.getElementById('region-select');
    const surnameInput = document.getElementById('surname-input');
    const genderSelect = document.getElementById('gender-select');
    const rankingList = document.getElementById('ranking-list');
    const danmakuContainer = document.getElementById('danmaku-container');
    const danmakuInput = document.getElementById('danmaku-input');
    const danmakuSendBtn = document.getElementById('danmaku-send-btn');
    const emojiBtn = document.getElementById('emoji-btn');
    const emojiPicker = document.getElementById('emoji-picker');
    const danmakuToggleBtn = document.getElementById('danmaku-toggle-btn');
    const currentDateEl = document.getElementById('current-date');
    const currentTimeEl = document.getElementById('current-time');

    // 2. 初始化 ECharts (不變)
    const myChart = echarts.init(mapContainer);

    // 3. 地區列表 (不變)
    const regions = [
        '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
        '基隆市', '新竹市', '嘉義市', '宜蘭縣', '新竹縣', '苗栗縣',
        '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '花蓮縣',
        '臺東縣', '澎湖縣', '金門縣', '連江縣'
    ];
    regions.forEach(region => {
        const option = document.createElement('option');
        option.value = region;
        option.textContent = region;
        regionSelect.appendChild(option);
    });

    // 4. 地圖配置 (不變)
    let mapOption = {
        tooltip: { trigger: 'item', formatter: (params) => `${params.name}: ${params.data ? params.data.value : 0} 票`, backgroundColor: '#ffffff', borderColor: '#D7000F', textStyle: { color: '#1a202c' } },
        visualMap: { min: 0, max: 100, left: '5%', bottom: '5%', text: ['高', '低'], calculable: true, inRange: { color: ['#ffebee', '#D7000F'] }, textStyle: { color: '#3a4b65' } },
        series: [{
            name: '祖国统一', type: 'map', map: 'TW', roam: true,
            label: { show: true, color: '#3a4b65', fontSize: 10 },
            itemStyle: { areaColor: '#d1d9e6', borderColor: '#F0F3F6', borderWidth: 1, },
            emphasis: { label: { color: '#1a202c' }, itemStyle: { areaColor: '#E53935', shadowBlur: 20, shadowColor: 'rgba(215, 0, 15, 0.5)' } },
            data: [],
            animationDuration: 1000, animationEasing: 'cubicOut'
        }]
    };

    // 5. 核心函數

    // (V40 彈幕系統 - 不變)
    let isDanmakuOn = true;
    let isDanmakuRateLimited = false;
    let danmakuQueue = [];
    const DANMAKU_TRACK_COUNT = 10;
    const DANMAKU_TRACK_HEIGHT = 30;
    const DANMAKU_DURATION_MS = 10000;
    const DANMAKU_SPAWN_GAP_MS = 3000;
    let danmakuTracks = new Array(DANMAKU_TRACK_COUNT).fill(0);

    // (V40 投票日誌 - 不變)
    let currentFeedData = [];
    const processedFeedIds = new Set();
    const processedDanmakuIds = new Set();
    const MAX_FEED_ITEMS = 20;

    // V47 新增: 本地存儲 KEY
    const VOTE_STORAGE_KEY = 'taiwanVoteAppLastVote';

    // (V28 函數 - 不變)
    function showToast(message) { const toast = document.createElement('div'); toast.className = 'toast-item'; toast.textContent = message; toastContainer.appendChild(toast); setTimeout(() => { toast.remove(); }, 3000); }
    function formatTimeAgo(timestamp) { const date = new Date(timestamp); const now = Date.now(); const seconds = Math.floor((now - date.getTime()) / 1000); if (seconds < 0) return "剛剛"; if (seconds < 10) return "剛剛"; if (seconds < 60) return `${seconds}秒前`; const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}分鐘前`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}小時前`; const days = Math.floor(hours / 24); return `${days}天前`; }
    function renderFeedItem(entry) { const li = document.createElement('li'); li.className = 'feed-item'; li.dataset.timestamp = entry.timestamp; li.innerHTML = `<span>${formatTimeAgo(entry.timestamp)}</span> <strong>${entry.surname}${entry.gender}</strong> 在 <strong>${entry.region}</strong> 参与投票`; feedList.appendChild(li); }

    // (V40) 創建彈幕 (不變)
    function createDanmakuElement(message, trackIndex) {
        if (!isDanmakuOn) return;
        const el = document.createElement('div');
        el.className = 'danmaku-item';
        el.textContent = message;
        el.style.top = (trackIndex * DANMAKU_TRACK_HEIGHT) + 10 + 'px';
        el.style.animationDuration = `${DANMAKU_DURATION_MS / 1000}s`;
        danmakuContainer.appendChild(el);
        el.addEventListener('animationend', () => { el.remove(); });
    }

    // (V40) 處理彈幕隊列 (不變)
    function processDanmakuQueue() {
        if (!isDanmakuOn || danmakuQueue.length === 0) return;
        const now = Date.now();
        let freeTrack = -1;
        for (let i = 0; i < danmakuTracks.length; i++) {
            if (danmakuTracks[i] < now) {
                freeTrack = i;
                break;
            }
        }
        if (freeTrack !== -1) {
            const message = danmakuQueue.shift();
            danmakuTracks[freeTrack] = now + DANMAKU_SPAWN_GAP_MS;
            createDanmakuElement(message, freeTrack);
        }
    }

    // (V20) 渲染投票日誌 (不變)
    function renderFeedList() {
        const isMobile = window.innerWidth < 1024;
        feedList.style.animation = 'none';
        feedList.innerHTML = '';
        if (currentFeedData.length > 0) {
            currentFeedData.forEach(entry => renderFeedItem(entry));
            if (!isMobile) {
                currentFeedData.forEach(entry => renderFeedItem(entry));
                setTimeout(() => {
                    const duration = currentFeedData.length * 2.5;
                    feedList.style.animation = `scroll-up ${duration < 20 ? 20 : duration}s linear infinite`;
                }, 100);
            }
        } else {
            feedList.innerHTML = '<li class="feed-item placeholder">暫無投票數據</li>';
        }
    }

    // (V40) 加載投票日誌/彈幕 (不變)
    async function loadFeed() { try { const res = await fetch('/api/feed'); const feedData = await res.json(); let hasNewData = false; for (const entry of feedData.reverse()) { if (!processedFeedIds.has(entry.id)) { processedFeedIds.add(entry.id); currentFeedData.unshift(entry); hasNewData = true; } } if (currentFeedData.length > MAX_FEED_ITEMS) { currentFeedData = currentFeedData.slice(0, MAX_FEED_ITEMS); } if (hasNewData) { renderFeedList(); } } catch (err) { console.error('加載投票日誌失敗:', err); } }
    async function loadDanmaku() { try { const res = await fetch('/api/danmaku'); const danmakuData = await res.json(); for (const entry of danmakuData.reverse()) { if (!processedDanmakuIds.has(entry.id)) { processedDanmakuIds.add(entry.id); danmakuQueue.push(entry.message); } } } catch (err) { console.error('加載彈幕失敗:', err); } }

    // (V21) 渲染排名 (不變)
    function updateFeedTimes() { const items = feedList.querySelectorAll('.feed-item[data-timestamp]'); items.forEach(item => { const timestamp = item.dataset.timestamp; const timeSpan = item.querySelector('span'); if (timeSpan) timeSpan.textContent = formatTimeAgo(timestamp); }); }
    function updateRanking(mapData) { rankingList.innerHTML = ''; const sortedData = Object.entries(mapData).sort((a, b) => b[1] - a[1]); const maxVotes = sortedData.length > 0 ? sortedData[0][1] : 0; sortedData.forEach((entry, i) => { const [region, count] = entry; const percentage = (maxVotes === 0) ? 0 : (count / maxVotes) * 100; let positionHTML = ''; switch (i) { case 0: positionHTML = '<span class="rank-position gold">🥇</span>'; break; case 1: positionHTML = '<span class="rank-position silver">🥈</span>'; break; case 2: positionHTML = '<span class="rank-position bronze">🥉</span>'; break; default: positionHTML = `<span class="rank-position">${i + 1}.</span>`; } const li = document.createElement('li'); li.className = 'rank-item'; li.innerHTML = `${positionHTML}<span class="rank-name" title="${region}">${region}</span><div class="rank-bar-wrapper"><div class="rank-bar-fill" style="width: ${percentage}%;"></div></div><span class="rank-count">${count}</span>`; rankingList.appendChild(li); }); }

    // (V15) 更新地圖和所有計數 (不變)
    async function updateMap() { try { const res = await fetch('/api/stats'); const stats = await res.json(); let maxVotes = 1; const mapDataForECharts = Object.keys(stats.mapData).map(key => { const value = stats.mapData[key]; if (value > maxVotes) maxVotes = value; return { name: key, value: value }; }); totalCountEl.textContent = stats.totalVotes.toLocaleString(); todayCountEl.textContent = `+${stats.todayVotes.toLocaleString()}`; myChart.setOption({ visualMap: { max: maxVotes }, series: [{ data: mapDataForECharts }] }); updateRanking(stats.mapData); } catch (err) { console.error('更新地圖失敗:', err); } }

    /**
     * (V47 升級) 處理投票 (增加 localStorage)
     */
    async function handleVote() {
        // V47 檢查
        if (voteButton.disabled) {
            showToast('您今天已經投過了');
            return;
        }

        const region = regionSelect.value;
        const surname = surnameInput.value.trim();
        const gender = genderSelect.value;

        // --- 遵囑: 補充前端驗證 ---
        if (!surname) { showToast('請填寫您的姓氏'); return; }
        // 遵囑: 姓氏長度限制改為 4
        if (surname.length > 4) { showToast('姓氏過長 (最多4個字)'); return; }
        const surnameRegex = /^[\u4E00-\u9FA5A-Za-z]+$/; // 只允許中英文
        if (!surnameRegex.test(surname)) { showToast('姓氏格式不正確 (僅中英文)'); return; }
        // --- 驗證結束 ---

        if (!region) { showToast('請選擇一個地區'); return; }

        submitVoteButton.disabled = true;
        submitVoteButton.textContent = '投票中...';

        try {
            const res = await fetch('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region, surname, gender }) });
            const result = await res.json();
            if (result.success) {
                modalOverlay.style.display = 'none';
                showToast('投票成功！');

                // --- V47 關鍵 ---
                // 1. 寫入本地存儲
                localStorage.setItem(VOTE_STORAGE_KEY, new Date().toISOString());
                // 2. 立即禁用按鈕
                disableVoteButton("您今天已經投過了");
                // --- 結束 V47 ---

                await loadFeed();
                await updateMap();
                surnameInput.value = '';
            } else {
                showToast(`投票失敗: ${result.message}`);
                // V49 新增: 如果是服務器端拒絕 (例如 IP 限制)，也禁用按鈕
                if (res.status === 429) {
                    localStorage.setItem(VOTE_STORAGE_KEY, new Date().toISOString());
                    disableVoteButton("您今天已經投過了");
                }
            }
        } catch (err) {
            console.error('投票時發生錯誤:', err);
            showToast('投票時發生網絡錯誤');
        } finally {
            submitVoteButton.disabled = false;
            submitVoteButton.textContent = '確認投票';
        }
    }

    // (V38) 處理自定義彈幕發送 (不變)
    async function handleDanmakuSend() {
        if (isDanmakuRateLimited) { showToast('操作過於頻繁，請 5 秒後再試'); return; }
        const message = danmakuInput.value.trim();

        // --- 遵囑: 補充前端驗證 ---
        if (!message) { showToast('彈幕內容不能為空'); return; }
        // 遵囑: 彈幕長度限制改為 30
        if (message.length > 30) { showToast('彈幕過長 (最多30字)'); return; }
        // --- 驗證結束 ---

        danmakuInput.value = '';
        danmakuSendBtn.disabled = true;
        danmakuSendBtn.textContent = '...';
        isDanmakuRateLimited = true;
        try {
            const res = await fetch('/api/danmaku', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: message }) });
            const result = await res.json();
            showToast(result.message);
            if (result.success) {
                danmakuQueue.push(result.newEntry.message);
                processedDanmakuIds.add(result.newEntry.id);
            }
        } catch (err) {
            console.error('發送彈幕時發生錯誤:', err);
            showToast('發送時發生網絡錯誤');
        } finally {
            setTimeout(() => {
                isDanmakuRateLimited = false;
                danmakuSendBtn.disabled = false;
                danmakuSendBtn.textContent = '發送';
            }, 5000);
        }
    }

    // (V28) 更新時鐘 (不變)
    function updateClock() { const now = new Date(); const dateOptions = { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Taipei' }; currentDateEl.textContent = now.toLocaleDateString('zh-TW', dateOptions); const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }; currentTimeEl.textContent = now.toLocaleTimeString('zh-TW', timeOptions); }

    // --- V47 新增函數 ---
    function isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
    }

    function disableVoteButton(message) {
        voteButton.disabled = true;
        // V47: .button-card 內的 .button-primary.large
        const buttonTextElement = voteButton.closest('.button-primary.large');
        if (buttonTextElement) {
            buttonTextElement.textContent = message;
        }
    }

    function checkVoteStatusOnLoad() {
        const lastVoteString = localStorage.getItem(VOTE_STORAGE_KEY);
        if (!lastVoteString) {
            return; // 從未投過，按鈕保持啟用
        }

        try {
            const lastVoteDate = new Date(lastVoteString);
            const today = new Date();

            if (isSameDay(lastVoteDate, today)) {
                // 是同一天！
                disableVoteButton("您今天已經投過了");
            }
            // 如果不是同一天，localStorage 裡的舊時間戳會被下一次投票覆蓋

        } catch (e) {
            console.error("解析本地存儲時間戳失敗:", e);
            localStorage.removeItem(VOTE_STORAGE_KEY); // 清理錯誤的數據
        }
    }
    // --- 結束 V47 新增 ---


    // 6. 事件監聽 (V39 不變)
    voteButton.addEventListener('click', () => { modalOverlay.style.display = 'flex'; });
    cancelVoteButton.addEventListener('click', () => { modalOverlay.style.display = 'none'; });
    submitVoteButton.addEventListener('click', handleVote);
    window.addEventListener('resize', () => {
        myChart.resize();
        renderFeedList();
    });
    danmakuSendBtn.addEventListener('click', handleDanmakuSend);
    danmakuInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleDanmakuSend(); });
    emojiBtn.addEventListener('click', () => { emojiPicker.classList.toggle('hidden'); });
    emojiPicker.querySelectorAll('span').forEach(emoji => { emoji.addEventListener('click', () => { danmakuInput.value += emoji.textContent; emojiPicker.classList.add('hidden'); danmakuInput.focus(); }); });
    danmakuToggleBtn.addEventListener('click', () => {
        isDanmakuOn = !isDanmakuOn;
        danmakuToggleBtn.classList.toggle('active', isDanmakuOn);
        danmakuContainer.classList.toggle('danmaku-hidden', !isDanmakuOn);
        if (isDanmakuOn) {
            danmakuToggleBtn.querySelector('span').textContent = 'ON';
            danmakuToggleBtn.title = '關閉彈幕';
        } else {
            danmakuToggleBtn.querySelector('span').textContent = 'OFF';
            danmakuToggleBtn.title = '開啟彈幕';
        }
    });

    // 7. 初始化 (V46 不變)

    async function initializeMap() {
        try {
            const response = await fetch('https://cdn.jsdelivr.net/gh/jason2506/Taiwan.TopoJSON@master/topojson/counties.json');
            if (!response.ok) throw new Error(`網絡錯誤: ${response.status}`);
            const topoData = await response.json();
            const layerName = Object.keys(topoData.objects)[0];
            if (!layerName) throw new Error("TopoJSON 文件格式不正確");
            const geoData = topojson.feature(topoData, topoData.objects[layerName]);
            echarts.registerMap('TW', geoData, { nameProperty: 'COUNTYNAME' });
            myChart.setOption(mapOption);

            // console.log("V40/V46 自定義彈幕系統已激活。");

            await updateMap();
            await loadFeed();
            await loadDanmaku();
            myChart.resize();

        } catch (err) {
            console.error('初始化失敗:', err);
            mapContainer.innerHTML = '地圖加載失敗。請檢查網絡連接或控制台錯誤。';
        }
    }

    // 啟動！
    initializeMap();
    checkVoteStatusOnLoad(); // V47 新增: 頁面加載時檢查
    updateClock();
    setInterval(updateFeedTimes, 10000);
    setInterval(loadFeed, 30000);
    setInterval(loadDanmaku, 30000);
    setInterval(processDanmakuQueue, 1500); // V40: 啟動彈幕處理器
    setInterval(updateClock, 1000);

}); // 結束 DOMContentLoaded 監聽
