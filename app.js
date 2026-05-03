/**
 * @file app.js
 * @description OBSIDIAN_CORE 시스템의 상태 관리 및 실시간 시각화 엔진
 */

// =============================================================================
// SESSION 1. GLOBAL STATE & CONFIG (전역 상태 및 설정)
// =============================================================================
const store = {
    sensors: {},        // 센서별 히스토리 및 상태 데이터 저장소
    activeIdx: null,    // 현재 사용자 선택 센서 글로벌 인덱스 (0-127)
    chart: null,        // Chart.js 인스턴스 전역 참조
    idToIndexMap: {},   // (m, t, i) -> globalIndex 맵
    indexToInfoMap: {}  // globalIndex -> {mName, tName, unitIdx} 맵
};

/** 시스템 구성 상수 (sensor_id_system.md 기준) */
const CONFIG = {
    SENSOR_LAYOUT: [
        { m: 0, mName: "Bond Head", types: [
            { t: 0, tName: "Temp", qty: 6 }, { t: 2, tName: "Force", qty: 6 },
            { t: 3, tName: "US Pwr", qty: 4 }, { t: 8, tName: "Vib", qty: 4 }
        ]},
        { m: 1, mName: "Stage", types: [
            { t: 4, tName: "Pos", qty: 14 }, { t: 5, tName: "Curr", qty: 6 },
            { t: 6, tName: "Volt", qty: 4 }, { t: 7, tName: "Speed", qty: 4 },
            { t: 8, tName: "Vib", qty: 4 }
        ]},
        { m: 2, mName: "Heater", types: [
            { t: 0, tName: "Temp", qty: 8 }, { t: 15, tName: "Power", qty: 4 }
        ]},
        { m: 3, mName: "Vacuum", types: [
            { t: 9, tName: "Press", qty: 8 }, { t: 10, tName: "Flow", qty: 4 }
        ]},
        { m: 4, mName: "Motor", types: [
            { t: 5, tName: "Curr", qty: 10 }, { t: 6, tName: "Volt", qty: 6 },
            { t: 7, tName: "Speed", qty: 6 }, { t: 8, tName: "Vib", qty: 4 }
        ]},
        { m: 5, mName: "Vision", types: [
            { t: 11, tName: "Align", qty: 5 }, { t: 12, tName: "Defect", qty: 5 }
        ]},
        { m: 6, mName: "Env", types: [
            { t: 0, tName: "Temp", qty: 5 }, { t: 13, tName: "Hum", qty: 2 },
            { t: 14, tName: "Air", qty: 3 }
        ]},
        { m: 7, mName: "Power", types: [
            { t: 15, tName: "Power", qty: 6 }
        ]}
    ],
    MAX_HISTORY: 50,
    WS_URL: "ws://localhost:9000"
};

// =============================================================================
// SESSION 2. SYSTEM INITIALIZER (시스템 초기화)
// =============================================================================

/** 애플리케이션 진입점 */
function main() {
    buildMappingTables(); // 매핑 테이블 선행 구축
    initSensorGrid();     // 대시보드 타일 생성
    initChartEngine();    // 차트 라이브러리 설정
    initWebSocket();      // 서버 통신 시작
}

/** 128개 센서에 대한 글로벌 인덱스 매핑 테이블 구축 */
function buildMappingTables() {
    let globalIdx = 0;
    CONFIG.SENSOR_LAYOUT.forEach(module => {
        const mId = module.m;
        if (!store.idToIndexMap[mId]) store.idToIndexMap[mId] = {};
        
        module.types.forEach(type => {
            const tId = type.t;
            if (!store.idToIndexMap[mId][tId]) store.idToIndexMap[mId][tId] = {};
            
            for (let i = 0; i < type.qty; i++) {
                store.idToIndexMap[mId][tId][i] = globalIdx;
                store.indexToInfoMap[globalIdx] = {
                    mName: module.mName,
                    tName: type.tName,
                    unitIdx: i,
                    mId: mId,
                    tId: tId
                };
                globalIdx++;
            }
        });
    });
    console.log(`✅ Mapping initialized: ${globalIdx} sensors mapped.`);
}

/** 128개 센서 그리드 동적 생성 (Performance Optimized) */
function initSensorGrid() {
    const container = document.getElementById("sensorContainer");
    if (!container) return;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 128; i++) {
        const info = store.indexToInfoMap[i];
        const tile = document.createElement("div");
        tile.id = `tile-${i}`;
        tile.className = "sensor-tile flex flex-col items-center justify-center p-1 rounded bg-black/40 border border-white/10 cursor-pointer transition-all hover:border-[#9ecaff]/50";
        
        const label = info ? `${info.mName.split(' ')[0]}-${info.tName}-${info.unitIdx}` : `N/A-${i}`;
        
        tile.innerHTML = `
            <span class="text-[7px] opacity-40 font-mono leading-tight text-center">${label}</span>
            <div class="value-text text-[10px] font-bold mt-0.5">-</div>
        `;
        tile.onclick = () => handleSensorSelect(i);
        fragment.appendChild(tile);
    }
    container.appendChild(fragment);
}

/** Chart.js 엔진 설정 및 인스턴스화 */
function initChartEngine() {
    const ctx = document.getElementById("chartCanvas")?.getContext("2d");
    if (!ctx) return;

    store.chart = new Chart(ctx, {
        type: "line",
        data: { datasets: [] },
        options: {
            animation: false,          // 실시간 렌더링 성능 최적화
            maintainAspectRatio: false, // 컨테이너 크기에 유연하게 대응[cite: 1]
            scales: {
                x: { type: 'linear', display: false }, // 타임스탬프 기반 정렬[cite: 1]
                y: {
                    grid: { color: "rgba(255,255,255,0.05)" },
                    ticks: { color: "#89919d", font: { size: 10 } }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// =============================================================================
// SESSION 3. DATA FLOW & SYNC (데이터 수집 및 동기화)
// =============================================================================

/** WebSocket 통신 관리 */
function initWebSocket() {
    const ws = new WebSocket(CONFIG.WS_URL);

    ws.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            processIncomingData(payload);
        } catch (err) {
            console.error("Payload Sync Fail:", err);
        }
    };
}

/** 수신된 데이터 패킷 처리 로직 */
function processIncomingData(payload) {
    // 1. 네트워크 지연시간 실시간 업데이트[cite: 1]
    if (payload.timestamp) {
        const latency = Date.now() - payload.timestamp;
        const latencyEl = document.querySelector("#latencyDisplay span:last-child");
        if (latencyEl) latencyEl.textContent = `${latency}ms`;
    }

    // 2. 센서 리스트 순회 및 상태 동기화
    payload.sensors.forEach(sensorData => {
        // [개선] 룩업 테이블을 사용하여 정확한 인덱스 산출
        const m = sensorData.m;
        const t = sensorData.t;
        const i = sensorData.i;

        if (store.idToIndexMap[m] && store.idToIndexMap[m][t] && store.idToIndexMap[m][t][i] !== undefined) {
            const globalIdx = store.idToIndexMap[m][t][i];
            syncInternalStore(globalIdx, sensorData);
            updateTileVisual(globalIdx, sensorData);
        }
    });

    // 3. 현재 선택된 센서가 있다면 상세 분석창 갱신
    if (store.activeIdx !== null) renderDetailPanel();
}

/** 내부 데이터 저장소(Store) 업데이트 */
function syncInternalStore(idx, data) {
    if (!store.sensors[idx]) {
        store.sensors[idx] = {
            id: data.id, m: data.m, history: [], anomaly: false
        };
    }

    const sensor = store.sensors[idx];
    const isAnomaly = (data.anomaly === 1);

    // [신규] 이상값 감지 시 로그 추가
    if (isAnomaly) {
        addAnomalyLog(idx, data.value);
    }

    sensor.anomaly = isAnomaly;

    // 시계열 히스토리 누적 (이제 서버에서 계산된 avg를 직접 사용)
    sensor.history.push({ x: Date.now(), y: data.avg });
    if (sensor.history.length > CONFIG.MAX_HISTORY) sensor.history.shift();
}

/** [신규] 화면 하단에 이상값 로그 추가 */
function addAnomalyLog(idx, value) {
    const logContainer = document.getElementById("logContainer");
    if (!logContainer) return;

    // 초기 대기 메시지 제거
    const placeholder = logContainer.querySelector(".italic");
    if (placeholder) placeholder.remove();

    const info = store.indexToInfoMap[idx];
    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    
    const entry = document.createElement("div");
    entry.className = "log-entry p-2 bg-red-500/5 rounded border-l-2 border-red-500 flex justify-between items-center transition-all hover:bg-red-500/10";
    entry.innerHTML = `
        <div class="flex gap-3 items-center">
            <span class="opacity-30">[${time}]</span>
            <span class="text-red-500 font-bold">⚠️ ANOMALY</span>
            <span class="opacity-80">${info.mName} / ${info.tName}-${info.unitIdx}</span>
        </div>
        <div class="font-bold text-red-500">Value: ${value.toFixed(2)}</div>
    `;
    
    // 최대 100개 로그 유지
    if (logContainer.children.length > 100) {
        logContainer.lastElementChild.remove();
    }
    
    // flex-col-reverse이므로 prepend로 최상단(화면상 하단)에 추가
    logContainer.prepend(entry);
}

// =============================================================================
// SESSION 4. UI RENDERING (시각적 출력 및 상호작용)
// =============================================================================

/** 센서 타일 시각적 갱신 (이벤트 리스너 보호를 위해 classList 사용)[cite: 1] */
function updateTileVisual(idx, data) {
    const tile = document.getElementById(`tile-${idx}`);
    if (!tile) return;

    const valEl = tile.querySelector(".value-text");
    if (valEl) valEl.textContent = data.avg.toFixed(1);

    // 이상 징후 발생 여부에 따른 스타일 분기
    if (data.anomaly === 1) {
        tile.classList.add("bg-red-600/60", "animate-pulse", "border-red-400/50", "glow-red");
        tile.classList.remove("bg-green-900/20", "bg-black/40", "border-white/10");
    } else {
        tile.classList.remove("bg-red-600/60", "animate-pulse", "border-red-400/50", "glow-red");
        tile.classList.add("bg-green-900/20", "border-white/10");
    }
}

/** 타일 클릭 핸들러: 상세 뷰 전환 */
function handleSensorSelect(idx) {
    if (!store.sensors[idx]) return;
    store.activeIdx = idx;

    // 대시보드 하이라이트 UI 처리
    document.querySelectorAll(".sensor-tile").forEach(t => t.classList.remove("border-[#9ecaff]"));
    document.getElementById(`tile-${idx}`)?.classList.add("border-[#9ecaff]");

    renderDetailPanel();
}

/** 우측 Detailed Analysis 패널 렌더링[cite: 1] */
function renderDetailPanel() {
    const sensor = store.sensors[store.activeIdx];
    const info = store.indexToInfoMap[store.activeIdx];
    if (!sensor || sensor.history.length === 0 || !info) return;

    const lastData = sensor.history[sensor.history.length - 1];

    // 1. 텍스트 정보 업데이트 (모듈 명칭 - 센서 타입 - 번호)
    document.querySelector("#currentSensor h2").textContent =
        `${info.mName} / ${info.tName} - ${info.unitIdx}`;
    
    const avgEl = document.getElementById("currentAvg");
    if (avgEl) avgEl.textContent = lastData.y.toFixed(3);

    // 단위 텍스트 업데이트 (예시)
    const unitEl = document.getElementById("unitText");
    if (unitEl) unitEl.textContent = info.tName === "Temp" ? "°C" : (info.tName === "Volt" ? "V" : "");

    // 2. 진단 상태 메시지 및 인디케이터 갱신
    const statusEl = document.getElementById("currentStatus");
    const indicatorEl = document.getElementById("statusIndicator");
    
    if (statusEl) {
        statusEl.textContent = sensor.anomaly ? "CRITICAL ALERT" : "SYSTEM STABLE";
        statusEl.className = `text-sm font-bold mt-1 ${sensor.anomaly ? "text-red-500" : "text-green-400"}`;
    }
    
    if (indicatorEl) {
        indicatorEl.className = `w-3 h-3 rounded-full transition-all duration-500 ${sensor.anomaly ? "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]" : "bg-green-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]"}`;
    }

    // 3. 차트 엔진 업데이트
    store.chart.data.datasets = [{
        label: 'Moving Average',
        data: sensor.history,
        borderColor: "#9ecaff",
        backgroundColor: "rgba(158, 202, 255, 0.1)",
        fill: true,
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0, // 주기적 데이터이므로 포인트는 숨기고 선만 강조
        hoverRadius: 5,
        pointBackgroundColor: "#9ecaff"
    }];
    store.chart.update("none"); 
}

// 시스템 부팅
main();