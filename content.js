// content.js - V47.0 (Observador de Mercado y UI de Consola)

if (window.top === window.self) {
    // =========================================================
    // --- PARTE 1: SCRIPT PADRE (PÁGINA PRINCIPAL) ---
    // =========================================================

    let logContainer = null;
    let logEntriesBox = null;
    let ttsBtn = null;
    let isTtsMuted = false;

    let ttsPreferences = {
        buy: true, sell: true, rate: true, transaction: true,
        new_exit: true, capacity_increase: true, unnecessary: true 
    };

    let panelCounts = {};
    let panelTransactionHistory = {};
    const MAX_HISTORY_ENTRIES = 20;

    let marketThrone = {}; 
    let globalTransactionCache = new Map(); 
    const GLOBAL_DEDUP_WINDOW_MS = 10000;
    let lastResetDate = null;

    // ✅ JERARQUÍA DE COLORES POR IMPORTANCIA
    const ALERT_COLORS = {
        prohibited: { bg: '#7f1d1d', border: '#dc2626', text: '#fecaca', icon: '🚨' },
        unnecessary: { bg: '#78350f', border: '#f59e0b', text: '#fcd34d', icon: '⚠️' },
        position_lost_high: { bg: '#7c2d12', border: '#ea580c', text: '#fed7aa', icon: '🔻' },
        position_lost_low: { bg: '#713f12', border: '#ca8a04', text: '#fde68a', icon: '⚠️' },
        rate_change: { bg: '#1e3a8a', border: '#3b82f6', text: '#bfdbfe', icon: '🔄' },
        transaction_buy: { bg: '#14532d', border: '#22c55e', text: '#bbf7d0', icon: '💰' },
        transaction_sell: { bg: '#14532d', border: '#22c55e', text: '#bbf7d0', icon: '💰' },
        capacity_increase: { bg: '#164e63', border: '#06b6d4', text: '#a5f3fc', icon: '📈' },
        new_entry: { bg: '#1e293b', border: '#64748b', text: '#cbd5e1', icon: '✅' },
        exit: { bg: '#1c1917', border: '#57534e', text: '#a8a29e', icon: '❌' },
        warning: { bg: '#713f12', border: '#f59e0b', text: '#fcd34d', icon: '⚠️' },
        info: { bg: '#1e3a8a', border: '#3b82f6', text: '#bfdbfe', icon: 'ℹ️' }
    };

    function initializeParentScript() {
        if (!document.body) { setTimeout(initializeParentScript, 100); return; }
        console.log("Monitor de Syklo Ops (v47.0 - Event-Driven Sync) iniciado.");

        loadPersistentData();
        checkDailyReset();
        
        createLogInterface(); 
        setupGlobalListeners();
        setupStorageListener();
        injectCustomStyles();
    }

    // =========================================================
    // --- MANEJO DE CAMBIOS EN IFRAMES (LÓGICA DEL TRONO) ---
    // =========================================================

    function handleIframeChange(url, changeInfo) {
        const { alert, data } = changeInfo;
        const iframes = document.querySelectorAll('iframe');
        let targetIframe = null;
        
        for (const iframe of iframes) {
            if (iframe.src === url) {
                targetIframe = iframe;
                const parentBox = iframe.closest('.grid-panel');
                if (parentBox) {
                    parentBox.classList.add('highlight-change');
                    setTimeout(() => parentBox.classList.remove('highlight-change'), 5000);
                }
                break;
            }
        }

        let title = "", body = "", alertType = null;
        let speechText = ""; 
        let shouldSpeak = false;

        const action = data.type === 'buy' ? 'Compra' : 'Venta';
        const method = (data.method || '').replace('Pago móvil', 'PMóvil');
        const ttsMethod = (data.method || '').replace('Pago móvil', 'Pago Móvil');
        
        const throneKey = `${method}|${data.type}`; 
        let currentThrone = marketThrone[throneKey];

        const epsilon = 0.0001;
        
        const isBetterRate = (rate1, rate2) => data.type === 'buy' ? rate1 > (rate2 + epsilon) : rate1 < (rate2 - epsilon);
        const isWorseRate = (rate1, rate2) => data.type === 'buy' ? rate1 < (rate2 - epsilon) : rate1 > (rate2 + epsilon);
        const isEqualRate = (rate1, rate2) => Math.abs(rate1 - rate2) <= epsilon;
        const calculateExceedPercent = (newRate, baseRate) => data.type === 'buy' ? ((newRate - baseRate) / baseRate) * 100 : ((baseRate - newRate) / baseRate) * 100;

        // CASO 9: DESCONEXIÓN
        if (alert === 'removed') {
            if (currentThrone && currentThrone.leader === data.trader) {
                delete marketThrone[throneKey];
                chrome.storage.local.set({ marketThrone });
                
                const exitTitle = `❌ DESCONEXIÓN \n(${method} - ${action})`;
                const exitBody = `<strong>${data.trader}</strong> salió de la tabla. Trono vacío inmediatamente.`;
                addAlertToLog(exitTitle, exitBody, ALERT_COLORS.exit);
                if (ttsPreferences.new_exit) speakAlert(`Salió ${data.trader}. Trono vacante.`);
            }
        }
        // CASOS 1-8, 10: ENTRADA O CAMBIO DE PRECIO
        else if (alert === 'new' || alert === 'rate_change') {
            const myRate = data.rate;
            const rivalRate = changeInfo.bestRivalRate;
            const oldRate = currentThrone ? currentThrone.rate : null;

            if (currentThrone && currentThrone.leader === data.trader) {
                const isBetterThanMarket = isBetterRate(myRate, rivalRate);
                const isEqualToMarket = isEqualRate(myRate, rivalRate);
                const isImprovement = isBetterRate(myRate, oldRate);
                const isRetraction = isWorseRate(myRate, oldRate);

                if (isBetterThanMarket && isImprovement) {
                    const unnecessaryTitle = `⚠️ ESCALADA INNECESARIA \n(${method} - ${action})`;
                    const unnecessaryBody = `<strong>${data.trader}</strong> ${data.type === 'buy' ? 'sube' : 'baja'} su tasa sin presión: <ins>${myRate}</ins>`;
                    addAlertToLog(unnecessaryTitle, unnecessaryBody, ALERT_COLORS.unnecessary);
                    if (ttsPreferences.unnecessary) speakAlert(`Aviso. Escalada innecesaria de ${data.trader}.`);
                    sendToTelegram(unnecessaryTitle, unnecessaryBody);
                    
                    marketThrone[throneKey].rate = myRate;
                    chrome.storage.local.set({ marketThrone });
                }
                else if (isBetterThanMarket && isRetraction) {
                    marketThrone[throneKey].rate = myRate;
                    chrome.storage.local.set({ marketThrone });
                }
                else if ((isRetraction && !isBetterThanMarket && !isEqualToMarket && !isWorseRate(myRate, rivalRate)) || isEqualToMarket || isWorseRate(myRate, rivalRate)) {
                    delete marketThrone[throneKey];
                    chrome.storage.local.set({ marketThrone });
                }
            }
            else {
                if (!(!currentThrone && isEqualRate(myRate, rivalRate))) {
                    let isWinningConquest = false;
                    let referenceRate = rivalRate;

                    if (!currentThrone) {
                        isWinningConquest = isBetterRate(myRate, rivalRate);
                        referenceRate = rivalRate;
                    } else {
                        isWinningConquest = isBetterRate(myRate, oldRate);
                        referenceRate = oldRate;
                    }

                    if (isWinningConquest && referenceRate !== null && referenceRate !== undefined) {
                        const exceedPercent = calculateExceedPercent(myRate, referenceRate);
                        const exceedStr = exceedPercent.toFixed(3);

                        if (exceedPercent > 2.000) {
                            const prohibTitle = `🚨 PRECIO PROHIBIDO \n(${method} - ${action})`;
                            const prohibBody = `<strong>${data.trader}</strong> ${!currentThrone ? 'ataca trono vacante' : 'conquista'} con agresión (<ins>+${exceedStr}%</ins>).<br>Tasa: <ins>${myRate}</ins> vs Mercado: <del>${referenceRate}</del>`;
                            
                            addAlertToLog(prohibTitle, prohibBody, ALERT_COLORS.prohibited);
                            speakAlert(`ALERTA precio prohibido. ${data.trader} tomó el trono agresivamente.`);
                            saveTransactionPersistent(url, { ...data, timestamp: Date.now(), alert: 'price_prohibited' });
                            sendToTelegram(prohibTitle, prohibBody);

                            chrome.runtime.sendMessage({ 
                                type: "CAPTURE_SPECIFIC_PANEL", 
                                url: url, // Enviamos la URL exacta del iframe infractor
                                text: `🚨 <b>EVIDENCIA: PRECIO PROHIBIDO</b>\n\n${prohibBody.replace(/<[^>]*>?/gm, '')}` 
                            });
                        } 
                        else {
                            const infoTitle = `✅ ${!currentThrone ? 'CONQUISTA ACTIVA' : 'NUEVA CONQUISTA'} \n(${method} - ${action})`;
                            const infoBody = `<strong>${data.trader}</strong> toma el trono. Tasa: <ins>${myRate}</ins>`;
                            addAlertToLog(infoTitle, infoBody, ALERT_COLORS.new_entry);
                            if (ttsPreferences.new_exit) speakAlert(`Nuevo líder en ${ttsMethod}: ${data.trader}.`);
                        }

                        marketThrone[throneKey] = { rate: myRate, leader: data.trader };
                        chrome.storage.local.set({ marketThrone });
                    }
                }
            }
        }
        
        // --- ALERTAS NORMALES ---
        if (alert === 'capacity_change' && data.max < data.oldMax) {
            const diff = Math.abs(data.max - data.oldMax);
            const globalKey = `${data.trader}|${diff.toFixed(2)}|${Math.floor((data.detectionTimestamp || Date.now()) / GLOBAL_DEDUP_WINDOW_MS)}`;
            if (globalTransactionCache.has(globalKey) && globalTransactionCache.get(globalKey) === url) return;
            globalTransactionCache.set(globalKey, url);
            setTimeout(() => globalTransactionCache.delete(globalKey), GLOBAL_DEDUP_WINDOW_MS);

            if (!panelCounts[url]) panelCounts[url] = { buys: 0, sells: 0, total: 0 };
            panelCounts[url].total++;
            if (data.type === 'buy') panelCounts[url].buys++; else panelCounts[url].sells++;

            const entry = { time: new Date().toLocaleTimeString('es-VE'), type: data.type, trader: data.trader, amount: diff.toFixed(2), timestamp: Date.now(), method: data.method, rate: data.rate, max: data.max, alert: 'capacity_change' };
            if (!panelTransactionHistory[url]) panelTransactionHistory[url] = [];
            panelTransactionHistory[url].unshift(entry);
            if (panelTransactionHistory[url].length > MAX_HISTORY_ENTRIES) panelTransactionHistory[url].pop();
            saveTransactionPersistent(url, entry);
            savePanelCounters();
            if (targetIframe) injectOrUpdateActivityBar(targetIframe);

            title = `💰 ${action} - ${data.trader} (${method})`;
            body = `Op: <ins>${diff.toFixed(2)}</ins> (Cap: <del>${data.oldMax}</del> ➔ <ins>${data.max}</ins>)`;
            alertType = data.type === 'buy' ? ALERT_COLORS.transaction_buy : ALERT_COLORS.transaction_sell;
            speechText = `Transacción: ${data.trader} en ${ttsMethod} por ${diff.toFixed(2).replace('.', ',')}`;
            shouldSpeak = ttsPreferences.transaction && ((data.type === 'buy' && ttsPreferences.buy) || (data.type === 'sell' && ttsPreferences.sell));
            addAlertToLog(title, body, alertType);
        }
        else if (alert === 'capacity_change' && data.max > data.oldMax) {
            const diff = (data.max - data.oldMax).toFixed(2);
            title = `📈 Aumento Cap. (${action}) - ${method}`;
            body = `<strong>${data.trader}</strong>: <del>${data.oldMax}</del> ➔ <ins>${data.max}</ins> (+${diff})`;
            alertType = ALERT_COLORS.capacity_increase;
            speechText = `${data.trader} aumentó su capacidad`;
            shouldSpeak = ttsPreferences.capacity_increase;
            saveTransactionPersistent(url, { ...data, timestamp: Date.now(), alert: 'capacity_increase' });
            addAlertToLog(title, body, alertType);
        }
        else if (alert === 'rate_change') {
            title = `🔄 Tasa (${action}) - ${method}`;
            body = `${data.trader}: <del>${data.oldRate}</del> ➔ <ins>${data.rate}</ins>`;
            saveTransactionPersistent(url, { ...data, timestamp: Date.now(), alert: 'rate_change' });
            speechText = `Cambio de tasa ${data.trader} a ${data.rate}`;
            shouldSpeak = ttsPreferences.rate && ((data.type === 'buy' && ttsPreferences.buy) || (data.type === 'sell' && ttsPreferences.sell));
            addAlertToLog(title, body, ALERT_COLORS.rate_change);
        }
        else if (alert === 'new') {
            title = `✅ Nuevo en ${method}`;
            body = `<strong>${data.trader}</strong> entró en ${data.rate} (${action})`;
            saveTransactionPersistent(url, { ...data, timestamp: Date.now(), alert: 'new' });
            speechText = `Nuevo ${data.trader} en ${ttsMethod}`;
            shouldSpeak = ttsPreferences.new_exit && ((data.type === 'buy' && ttsPreferences.buy) || (data.type === 'sell' && ttsPreferences.sell));
            addAlertToLog(title, body, ALERT_COLORS.new_entry);
        }
        else if (alert === 'removed') {
            title = `❌ Salió de ${method} (${action})`;
            body = `${data.trader} salió (Estaba en ${data.rate})`;
            saveTransactionPersistent(url, { ...data, timestamp: Date.now(), alert: 'removed' });
            speechText = `Salió ${data.trader}`;
            shouldSpeak = ttsPreferences.new_exit;
            addAlertToLog(title, body, ALERT_COLORS.exit);
        }

        if (shouldSpeak && speechText) speakAlert(speechText);
    }

    // =========================================================
    // --- LISTENERS GLOBALES ---
    // =========================================================

    function setupGlobalListeners() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            // --- NUEVO: EL GEÓGRAFO V3 (Por URL de la alerta) ---
            if (request.type === "GET_COORDS_BY_URL") {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    if (iframe.src === request.url) {
                        const panelPadre = iframe.closest('.grid-panel');
                        if (panelPadre) {
                            // Centra la pantalla en el panel antes de tomar la foto
                            panelPadre.scrollIntoView({ behavior: "instant", block: "center" });
                            
                            setTimeout(() => {
                                const rect = panelPadre.getBoundingClientRect();
                                const dpr = window.devicePixelRatio || 1;
                                sendResponse({
                                    found: true,
                                    rect: {
                                        x: Math.round((rect.left + window.scrollX) * dpr),
                                        y: Math.round((rect.top + window.scrollY) * dpr),
                                        width: Math.round(rect.width * dpr),
                                        height: Math.round(rect.height * dpr)
                                    }
                                });
                            }, 150);
                            return true;
                        }
                    }
                }
                sendResponse({ found: false });
                return true;
            }
            // --- FIN NUEVO GEÓGRAFO ---
            if (request.type === "HIGHLIGHT_IFRAME") { 
                handleIframeChange(request.url, request.changeInfo); 
                return true; 
            }
            if (request.type === "CLEAR_LOG") { 
                performFullSystemReset(); 
                return true; 
            }
            if (request.type === "TOGGLE_PANEL") { 
                if(request.isVisible && !document.body.contains(logContainer)) document.body.appendChild(logContainer); 
                else if(!request.isVisible && document.body.contains(logContainer)) document.body.removeChild(logContainer); 
                return true; 
            }
            if (request.type === "TOGGLE_TTS") { 
                isTtsMuted = request.isMuted; 
                if(ttsBtn) ttsBtn.textContent = isTtsMuted ? '🔇' : '🔈'; 
                if(isTtsMuted) window.speechSynthesis.cancel(); 
                return true; 
            }
            if (request.type === "POSITION_LOST_ALERT") {
                const competitor = request.competitor;
                const myRate = request.myRate;
                const severity = request.severity || 'high';
                const diffPercent = request.diffPercent || '0.00';
                
                chrome.storage.local.get(['myMarketData'], (result) => {
                    const myData = result.myMarketData || {};
                    const marketKey = `${competitor.method}|${competitor.type}`;
                    const currentMyRate = myData[marketKey]?.rate;
                    
                    if (currentMyRate && Math.abs(currentMyRate - myRate) > 0.001) {
                        const stillLosing = (competitor.type === 'buy' && competitor.rate > currentMyRate) || (competitor.type === 'sell' && competitor.rate < currentMyRate);
                        if (!stillLosing) return;
                    }
                    
                    const alertColor = severity === 'high' ? ALERT_COLORS.position_lost_high : ALERT_COLORS.position_lost_low;
                    const lostTitle = `${alertColor.icon} POSICIÓN PERDIDA \n(${competitor.method})`;
                    const lostBody = `<strong>${competitor.trader}</strong> te superó por <ins>+${diffPercent}%</ins>.<br>Su tasa: <ins>${competitor.rate}</ins> vs Tu tasa: <del>${myRate}</del>`;
                    
                    addAlertToLog(lostTitle, lostBody, alertColor);
                    speakAlert(`Alerta: ${competitor.trader} te superó en ${competitor.method}`);
                    sendToTelegram(lostTitle, lostBody);
                    
                    document.querySelectorAll('iframe').forEach(iframe => {
                        if(iframe.src === request.url) {
                            const p = iframe.closest('.grid-panel');
                            if(p) {
                                p.classList.add('highlight-lost-position');
                                setTimeout(() => p.classList.remove('highlight-lost-position'), 8000);
                            }
                        }
                    });
                });
                return true;
            }
        });
    }
    
    function setupStorageListener() { 
        chrome.storage.onChanged.addListener((c, a) => { 
            if (a !== 'local') return;
            if (c.persistentTransactions && !c.persistentTransactions.newValue) { if (logEntriesBox) logEntriesBox.innerHTML = ''; }
            if (c.marketThrone && c.marketThrone.newValue) marketThrone = c.marketThrone.newValue;
            if (c.autoTradeSettingsV2 && c.autoTradeSettingsV2.newValue !== undefined) {
                const isActive = c.autoTradeSettingsV2.newValue?.globalActive;
                const header = document.getElementById('syklo-log-header');
                if (header) {
                    header.style.borderBottom = isActive ? '2px solid #22c55e' : '2px solid #ef4444';
                    header.title = isActive ? '🟢 Bot ACTIVO' : '🔴 Bot PAUSADO';
                }
            }
        }); 
    }

    function sendToTelegram(title, message) {
        const cleanMsg = message.replace(/<del>(.*?)<\/del>/g, ' Antes: $1 ').replace(/<ins>(.*?)<\/ins>/g, ' Ahora: $1 ').replace(/<strong>(.*?)<\/strong>/g, '<b>$1</b>').replace(/<br>/g, '\n').replace(/<[^>]*>?/gm, ''); 
        chrome.runtime.sendMessage({ type: "SEND_TELEGRAM_ALERT", text: `<b>${title}</b>\n\n${cleanMsg}` });
    }

    // =========================================================
    // --- INTERFACE LATERAL (LOGS VISUALES) ---
    // =========================================================

    function injectCustomStyles() {
        if (document.getElementById('syklo-custom-styles')) return;
        const style = document.createElement('style');
        style.id = 'syklo-custom-styles';
        style.textContent = `
            #syklo-config-modal { position: absolute; top: 45px; right: 10px; background: rgba(15, 23, 42, 0.98); border: 1px solid #475569; border-radius: 8px; padding: 12px; width: 200px; box-shadow: 0 10px 25px rgba(0,0,0,0.8); display: none; z-index: 10000; }
            #syklo-config-modal.visible { display: block; }
            .config-header { font-size: 13px; font-weight: bold; color: #fff; margin-bottom: 8px; border-bottom: 1px solid #334155; padding-bottom: 5px; }
            .config-item { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12px; color: #cbd5e1; cursor: pointer; }
            .config-item:last-child { margin-bottom: 0; }
            .config-item input { cursor: pointer; accent-color: #3b82f6; }
            #syklo-log-config-btn { font-size: 16px; padding: 0 6px; }
        `;
        document.head.appendChild(style);
    }

    function createLogInterface() {
        logContainer = document.createElement('div');
        logContainer.id = 'syklo-alert-log-container';
        logContainer.innerHTML = `
            <div id="syklo-log-header">
                <strong>Historial</strong>
                <div class="syklo-header-buttons">
                    <button id="syklo-log-analytics-btn" title="Ver Análisis">📊</button>
                    <button id="syklo-log-config-btn" title="Configurar Voz">⚙️</button>
                    <button id="syklo-log-clear-btn" title="Borrar TODO y reiniciar" style="font-size:11px; font-weight:bold; background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#fca5a5;">Resetear</button>
                    <button id="syklo-log-toggle-btn" title="Min/Max">-</button>
                    <button id="syklo-log-tts-btn" title="Silenciar General">🔈</button>
                </div>
            </div>
            <div id="syklo-config-modal">
                <div class="config-header">Leer en Voz Alta:</div>
                <label class="config-item"><input type="checkbox" id="chk-tts-buy"> Compras</label>
                <label class="config-item"><input type="checkbox" id="chk-tts-sell"> Ventas</label>
                <label class="config-item"><input type="checkbox" id="chk-tts-rate"> Cambios de Tasa</label>
                <label class="config-item"><input type="checkbox" id="chk-tts-trans"> Transacciones</label>
                <label class="config-item"><input type="checkbox" id="chk-tts-new"> Entradas/Salidas</label>
                <label class="config-item"><input type="checkbox" id="chk-tts-cap"> Aumentos de Cap.</label>
                <label class="config-item"><input type="checkbox" id="chk-tts-unne"> ⚠️ Esc. Innecesaria</label>
            </div>
            <div id="syklo-log-entries"></div>`;

        chrome.storage.local.get(['isPanelVisible', 'ttsPreferences', 'isTtsMuted'], (result) => {
            if (result.isPanelVisible !== false) document.body.appendChild(logContainer);
            if (result.ttsPreferences) ttsPreferences = { ...ttsPreferences, ...result.ttsPreferences };
            isTtsMuted = result.isTtsMuted || false;
            updateConfigCheckboxes();
            const btn = logContainer.querySelector('#syklo-log-tts-btn');
            if (btn) btn.textContent = isTtsMuted ? '🔇' : '🔈';
        });
        
        logEntriesBox = logContainer.querySelector('#syklo-log-entries');

        logContainer.querySelector('#syklo-log-clear-btn').onclick = () => {
            if (confirm("ATENCIÓN: Se borrarán todos los datos y se recargará la página.\n¿Continuar?")) performFullSystemReset();
        };
        
        const toggleBtn = logContainer.querySelector('#syklo-log-toggle-btn');
        toggleBtn.addEventListener('click', () => {
            logContainer.classList.toggle('minimized');
            toggleBtn.textContent = logContainer.classList.contains('minimized') ? '+' : '-';
        });
        
        logContainer.querySelector('#syklo-log-analytics-btn').onclick = () => showAnalyticsPanel();
        
        const configBtn = logContainer.querySelector('#syklo-log-config-btn');
        const configModal = logContainer.querySelector('#syklo-config-modal');
        configBtn.onclick = (e) => { e.stopPropagation(); configModal.classList.toggle('visible'); };
        document.addEventListener('click', (e) => { if (!configModal.contains(e.target) && e.target !== configBtn) configModal.classList.remove('visible'); });

        const configMap = { 'chk-tts-buy': 'buy', 'chk-tts-sell': 'sell', 'chk-tts-rate': 'rate', 'chk-tts-trans': 'transaction', 'chk-tts-new': 'new_exit', 'chk-tts-cap': 'capacity_increase', 'chk-tts-unne': 'unnecessary' };
        Object.keys(configMap).forEach(id => {
            const chk = logContainer.querySelector('#' + id);
            if (chk) chk.addEventListener('change', (e) => { ttsPreferences[configMap[id]] = e.target.checked; chrome.storage.local.set({ ttsPreferences: ttsPreferences }); });
        });

        ttsBtn = logContainer.querySelector('#syklo-log-tts-btn');
        ttsBtn.addEventListener('click', () => {
            isTtsMuted = !isTtsMuted;
            chrome.storage.local.set({ isTtsMuted: isTtsMuted }, () => {
                ttsBtn.textContent = isTtsMuted ? '🔇' : '🔈';
                if (isTtsMuted) window.speechSynthesis.cancel();
            });
        });
    }

    function updateConfigCheckboxes() {
        if (!logContainer) return;
        const setChk = (id, val) => { const el = logContainer.querySelector('#'+id); if(el) el.checked = val; };
        Object.keys(ttsPreferences).forEach(key => {
            let id = '';
            if(key === 'buy') id = 'chk-tts-buy';
            else if(key === 'sell') id = 'chk-tts-sell';
            else if(key === 'rate') id = 'chk-tts-rate';
            else if(key === 'transaction') id = 'chk-tts-trans';
            else if(key === 'new_exit') id = 'chk-tts-new';
            else if(key === 'capacity_increase') id = 'chk-tts-cap';
            else if(key === 'unnecessary') id = 'chk-tts-unne';
            setChk(id, ttsPreferences[key]);
        });
    }

    // =========================================================
    // --- FUNCIONES AUXILIARES Y UTILIDADES ---
    // =========================================================

    function injectOrUpdateActivityBar(iframeElement) {
        const iframeUrl = iframeElement.src;
        if (!panelCounts[iframeUrl]) panelCounts[iframeUrl] = { buys: 0, sells: 0, total: 0 };
        if (!panelTransactionHistory[iframeUrl]) panelTransactionHistory[iframeUrl] = [];
        const counts = panelCounts[iframeUrl];
        const history = panelTransactionHistory[iframeUrl];
        const parentBox = iframeElement.closest('.grid-panel');
        if (parentBox) {
            let banner = parentBox.querySelector('.syklo-activity-banner');
            let historyContainer = parentBox.querySelector('.syklo-activity-history');
            if (!banner) {
                banner = document.createElement('div');
                banner.className = 'syklo-activity-banner';
                banner.innerHTML = `<span class="syklo-activity-summary">Wait...</span><button class="syklo-activity-toggle">+</button>`;
                historyContainer = document.createElement('div');
                historyContainer.className = 'syklo-activity-history';
                if (parentBox.firstChild) { parentBox.insertBefore(banner, parentBox.firstChild); banner.insertAdjacentElement('afterend', historyContainer); } 
                else { parentBox.appendChild(banner); parentBox.appendChild(historyContainer); }
                banner.addEventListener('click', (e) => { e.stopPropagation(); banner.classList.toggle('expanded'); banner.querySelector('button').textContent = banner.classList.contains('expanded') ? '-' : '+'; });
            }
            banner.querySelector('.syklo-activity-summary').innerHTML = `Órdenes: <span class="total-count">${counts.total}</span> | C: <span class="buy-count">${counts.buys}</span> | V: <span class="sell-count">${counts.sells}</span>`;
            if (historyContainer) {
                historyContainer.innerHTML = '';
                if (history.length > 0) history.forEach(entry => { historyContainer.innerHTML += `<div class="syklo-activity-entry ${entry.type}"><span class="time-trader">${entry.time} - ${entry.trader}</span><span class="amount">${entry.amount || '0'}</span></div>`; });
                else historyContainer.innerHTML = '<p>No hay actividad.</p>';
            }
        }
    }

    function performFullSystemReset() {
        panelCounts = {}; 
        panelTransactionHistory = {}; 
        marketThrone = {}; 
        globalTransactionCache.clear();
        chrome.storage.local.set({ 
            persistentTransactions: {}, panelCounters: {}, marketThrone: {}, myMarketData: {}, lastResetDate: new Date().toDateString() 
        }, () => {
            if (logEntriesBox) logEntriesBox.innerHTML = '';
            setTimeout(() => window.location.reload(), 500);
        });
    }

    function loadPersistentData() {
        chrome.storage.local.get(['persistentTransactions', 'panelCounters', 'lastResetDate', 'marketThrone'], (result) => {
            if (result.persistentTransactions) { 
                Object.keys(result.persistentTransactions).forEach(url => { 
                    if (Array.isArray(result.persistentTransactions[url])) panelTransactionHistory[url] = result.persistentTransactions[url].slice(0, MAX_HISTORY_ENTRIES); 
                }); 
            }
            if (result.panelCounters) panelCounts = result.panelCounters;
            if (result.marketThrone) marketThrone = result.marketThrone;
            if (result.lastResetDate) lastResetDate = result.lastResetDate;
            setTimeout(() => { document.querySelectorAll('iframe').forEach(iframe => { if (iframe.src.includes('explorer.syklo.io')) injectOrUpdateActivityBar(iframe); }); }, 1000);
        });
    }
    
    function saveTransactionPersistent(url, transaction) {
        chrome.storage.local.get(['persistentTransactions'], (result) => {
            const allTransactions = result.persistentTransactions || {};
            if (!allTransactions[url]) allTransactions[url] = [];
            if (!transaction.timestamp) transaction.timestamp = Date.now();
            allTransactions[url].unshift(transaction);
            if (allTransactions[url].length > 1000) allTransactions[url] = allTransactions[url].slice(0, 1000);
            chrome.storage.local.set({ persistentTransactions: allTransactions });
        });
    }
    
    function savePanelCounters() { chrome.storage.local.set({ panelCounters: panelCounts }); }
    
    function checkDailyReset() { 
        chrome.storage.local.get(['lastResetDate'], (result) => { 
            if (result.lastResetDate !== new Date().toDateString()) performFullSystemReset(); 
            else lastResetDate = result.lastResetDate; 
        }); 
    }
    
    function cleanTextForTTS(text) { 
        return text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').replace(/[🌐🌎🌍🌏]/g, '').replace(/\s+/g, ' ').trim(); 
    }
    
    function speakAlert(text) { 
        if (isTtsMuted) return; 
        if ('speechSynthesis' in window) { 
            window.speechSynthesis.cancel(); 
            const u = new SpeechSynthesisUtterance(cleanTextForTTS(text)); 
            u.lang = 'es-VE'; u.rate = 1.1; 
            window.speechSynthesis.speak(u); 
        } 
    }
    
    function addAlertToLog(title, body, colorConfig) { 
        if (!logEntriesBox) return;
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert-entry';
        alertDiv.style.background = colorConfig.bg;
        alertDiv.style.borderLeft = `4px solid ${colorConfig.border}`;
        alertDiv.style.color = colorConfig.text;
        alertDiv.innerHTML = `<div class="alert-header"><span class="alert-timestamp">[${new Date().toLocaleTimeString('es-VE')}]</span><strong class="alert-title">${title}</strong></div><div class="alert-body">${body}</div>`;
        logEntriesBox.prepend(alertDiv);
    }

    // =========================================================
    // --- ANALYTICS Y REPORTES ---
    // =========================================================
    
    function getAllTransactionsFlat(callback) { 
        chrome.storage.local.get(['persistentTransactions'], (result) => { 
            let flat = []; 
            const all = result.persistentTransactions || {}; 
            Object.keys(all).forEach(u => all[u].forEach(t => flat.push({...t, rawUrl: u}))); 
            callback(flat); 
        }); 
    }
    
    function showAnalyticsPanel() {
        let overlay = document.getElementById('syklo-analytics-overlay');
        if (overlay) { overlay.style.display = 'flex'; updateAnalyticsPanel(); updateMethodDropdowns(); return; }
        overlay = document.createElement('div');
        overlay.id = 'syklo-analytics-overlay';
        overlay.innerHTML = `
            <div id="syklo-analytics-panel">
                <div class="analytics-header"><h2>📊 Análisis</h2><button id="close-analytics">×</button></div>
                <div class="analytics-content">
                    <div class="analytics-section"><h3>🔍 Explorador</h3>
                        <div class="special-tools">
                            <div class="tool-group"><span class="tool-label">First Mover:</span><input type="number" id="tool-rate" class="search-input" placeholder="Tasa..." style="width:80px;"><select id="tool-first-method" class="search-select" style="width:140px;"><option value="">Todos</option></select><button id="btn-find-first" class="analytics-btn" style="padding:4px;">Buscar</button></div>
                            <span id="tool-result-display" style="color:#4ade80;font-weight:bold;font-size:13px;margin-left:10px;"></span>
                        </div>
                        <div class="search-grid">
                            <input id="filter-trader" class="search-input" placeholder="Trader...">
                            <select id="filter-method" class="search-select"><option value="">Métodos</option></select>
                            <select id="filter-type" class="search-select"><option value="">Tipos</option><option value="buy">Compra</option><option value="sell">Venta</option><option value="rate_change">Tasa</option><option value="capacity_change">Transacción</option></select>
                            <button id="btn-advanced-search" class="analytics-btn">Filtrar</button>
                        </div>
                        <div class="results-container"><table class="results-table"><thead><tr><th>Hora</th><th>Trader</th><th>Método</th><th>Tipo</th><th>Detalle</th></tr></thead><tbody id="search-results-body"><tr><td colspan="5" style="text-align:center">Resultados...</td></tr></tbody></table></div>
                    </div>
                    <div class="analytics-section"><h3>📈 Métricas (30 min)</h3><div id="general-metrics"></div></div>
                </div>
                <div class="analytics-footer"><button id="export-data-btn" class="analytics-btn">📥 Exportar Todo</button><button id="refresh-analytics-btn" class="analytics-btn">🔄 Actualizar</button></div>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById('close-analytics').onclick = () => overlay.style.display = 'none';
        document.getElementById('btn-advanced-search').onclick = runAdvancedSearch;
        document.getElementById('btn-find-first').onclick = findFirstMover;
        document.getElementById('refresh-analytics-btn').onclick = () => { updateAnalyticsPanel(); updateMethodDropdowns(); };
        document.getElementById('export-data-btn').onclick = exportDataToCSV;
        overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
        updateAnalyticsPanel(); updateMethodDropdowns();
    }
    
    function updateMethodDropdowns() {
        const selectFilter = document.getElementById('filter-method');
        const selectFirst = document.getElementById('tool-first-method');
        if (!selectFilter) return;
        getAllTransactionsFlat((allTxs) => {
            const unique = new Set(); 
            allTxs.forEach(tx => { if(tx.method) unique.add(tx.method); });
            const opts = '<option value="">Todos</option>' + Array.from(unique).sort().map(m => `<option value="${m}">${m}</option>`).join('');
            selectFilter.innerHTML = opts; selectFirst.innerHTML = opts;
        });
    }

    function findFirstMover() {
        const targetRate = parseFloat(document.getElementById('tool-rate').value);
        const method = document.getElementById('tool-first-method').value.toLowerCase();
        const display = document.getElementById('tool-result-display');
        if (isNaN(targetRate)) { display.textContent = "Tasa inválida"; return; }
        
        getAllTransactionsFlat((allTxs) => {
            const cutoff = Date.now() - (12 * 3600 * 1000);
            const histories = {};
            allTxs.forEach(tx => {
                if (tx.timestamp < cutoff) return;
                if (method && !(tx.method || '').toLowerCase().includes(method)) return;
                if (!histories[tx.trader]) histories[tx.trader] = [];
                histories[tx.trader].push(tx);
            });
            const candidates = [];
            Object.keys(histories).forEach(trader => {
                const h = histories[trader].sort((a,b) => b.timestamp - a.timestamp);
                const last = h[0];
                if (last.alert === 'removed') return;
                if (last.rate !== undefined && Math.abs(last.rate - targetRate) > 0.0001) return;
                let entry = last.timestamp;
                for(let i=0; i<h.length; i++) {
                    if (h[i].alert === 'removed' || (h[i].rate !== undefined && Math.abs(h[i].rate - targetRate) > 0.0001)) break;
                    entry = h[i].timestamp;
                }
                candidates.push({ trader, entry });
            });
            if (candidates.length === 0) { display.textContent = "Nadie activo."; return; }
            candidates.sort((a,b) => a.entry - b.entry);
            const d = new Date(candidates[0].entry);
            display.innerHTML = `🥇 <b>${candidates[0].trader}</b> (${d.toLocaleDateString()} ${d.toLocaleTimeString()})`;
        });
    }

    function runAdvancedSearch() {
        const tFilter = document.getElementById('filter-trader').value.toLowerCase();
        const mFilter = document.getElementById('filter-method').value.toLowerCase();
        const typeFilter = document.getElementById('filter-type').value;
        const tbody = document.getElementById('search-results-body');
        tbody.innerHTML = '<tr><td colspan="5">Buscando...</td></tr>';
        
        getAllTransactionsFlat((allTxs) => {
            const filtered = allTxs.sort((a,b)=>b.timestamp-a.timestamp).filter(tx => {
                const matchT = !tFilter || (tx.trader||'').toLowerCase().includes(tFilter);
                const matchM = !mFilter || (tx.method||'').toLowerCase().includes(mFilter);
                const matchType = !typeFilter || tx.alert === typeFilter || (tx.type === typeFilter && tx.alert !== 'rate_change');
                return matchT && matchM && matchType;
            });
            tbody.innerHTML = '';
            filtered.slice(0,100).forEach(tx => {
                let det = tx.alert === 'rate_change' ? `${tx.oldRate}➔${tx.rate}` : tx.alert === 'new' ? `Entró ${tx.rate}` : tx.alert === 'removed' ? `Salió` : `Info`;
                tbody.innerHTML += `<tr><td>${new Date(tx.timestamp).toLocaleTimeString()}</td><td>${tx.trader}</td><td>${tx.method}</td><td>${tx.type}</td><td>${det}</td></tr>`;
            });
        });
    }

    function updateAnalyticsPanel() {
        const div = document.getElementById('general-metrics');
        if(!div) return;
        getAllTransactionsFlat((allTxs) => {
            const recent = allTxs.filter(t => t.timestamp >= Date.now() - 1800000);
            const vol = recent.reduce((s, t) => s + parseFloat(t.amount||0), 0);
            div.innerHTML = `<div class="metric-row"><span class="metric-label">Volumen (30m):</span><span class="metric-value">${vol.toFixed(2)} USD</span></div>`;
        });
    }

    function exportDataToCSV() {
        getAllTransactionsFlat((flatTransactions) => {
            const csv = [['Timestamp', 'Fecha', 'Hora', 'Trader', 'Method', 'Type', 'Rate', 'Amount', 'Max', 'Alert Type', 'Panel URL'], ...flatTransactions.map(t => {
                const date = new Date(t.timestamp);
                return [t.timestamp, date.toLocaleDateString('es-VE'), date.toLocaleTimeString('es-VE'), t.trader || '', t.method || '', t.type || '', t.rate || '', t.amount || '', t.max || '', t.alert || '', t.rawUrl || ''];
            })].map(row => row.join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url; link.download = `syklo-data-${new Date().toISOString().slice(0,10)}.csv`; link.click();
        });
    }

    initializeParentScript();
} else {
    // =========================================================
    // --- PARTE 2: SCRIPT HIJO (IFRAME) ---
    // =========================================================
    let previousState = new Map();
    let isProcessing = false;
    let myTraderNameGlobal = '';
    let initialScanSent = false; 

    chrome.storage.local.get(['myTraderName'], (r) => { if(r.myTraderName) myTraderNameGlobal = r.myTraderName; });
    chrome.storage.onChanged.addListener((c, a) => { 
        if(a==='local') {
            if(c.persistentTransactions && !c.persistentTransactions.newValue) previousState = new Map();
            if(c.myTraderName) myTraderNameGlobal = c.myTraderName.newValue;
        }
    });

    function parseOfferRow(row) {
        try {
            let ctx = row.classList.contains('row-ask') ? 'sell' : row.classList.contains('row-bid') ? 'buy' : null;
            if (!ctx) return null;
            const cells = row.getElementsByTagName('td');
            if (cells.length < 5) return null;
            let m = (cells[0].textContent||'').replace(/\s*\(.*?\)/g,'').replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,'').replace(/\b(VE|VES|USDC|liquidity)\b|🇨🇴|🇻🇪|-/gi,'').trim();
            let t = (cells[4].textContent||'').replace('✅','').trim().split('.')[0].trim();
            if (!m || !t) return null;
            return { key: `${t}|${m}|${ctx}`, trader: t, method: m, rate: parseFloat(cells[1].textContent.replace(/,/g,'')), max: parseFloat(cells[3].textContent.replace(/,/g,'')), type: ctx };
        } catch(e) { return null; }
    }

    function getBestRivalRate(currentMap, method, type, myName) {
        let bestRival = null;
        for (const offer of currentMap.values()) {
            if (offer.method !== method || offer.type !== type) continue;
            if (offer.trader === myName) continue;
            if (bestRival === null) bestRival = offer.rate;
            else {
                if (type === 'buy' && offer.rate > bestRival) bestRival = offer.rate;
                else if (type === 'sell' && offer.rate < bestRival) bestRival = offer.rate;
            }
        }
        return bestRival;
    }

    function getMyCurrentBestData(currentMap, method, type, myName) {
        if (!myName) return null;
        let myBest = null;
        for (const offer of currentMap.values()) {
            if (offer.method !== method || offer.type !== type) continue;
            if (offer.trader === myName) {
                if (myBest === null) myBest = offer;
                else {
                    if (type === 'buy' && offer.rate > myBest.rate) myBest = offer;
                    else if (type === 'sell' && offer.rate < myBest.rate) myBest = offer;
                }
            }
        }
        return myBest ? { rate: myBest.rate, max: myBest.max } : null;
    }

    function getSykloSpread() {
        try {
            const tbody = document.querySelector('#book-table tbody');
            if (!tbody) return null;
            for (const row of tbody.getElementsByTagName('tr')) {
                const text = row.textContent || '';
                const match = text.match(/Syklo\s*([\d.]+)%/);
                if (match) return parseFloat(match[1]);
            }
        } catch(e) {}
        return null;
    }

    function processTableChanges() {
        if (isProcessing) return;
        isProcessing = true;
        try {
            const tbody = document.querySelector('#book-table tbody');
            if (!tbody) { isProcessing = false; return; }
            const current = new Map();
            for (const row of tbody.getElementsByTagName('tr')) {
                const d = parseOfferRow(row);
                if (d) current.set(d.key, d);
            }

            if (!initialScanSent && current.size > 0) {
                initialScanSent = true;
                chrome.runtime.sendMessage({
                    type: "INITIAL_MARKET_SCAN",
                    url: window.location.href,
                    offers: Array.from(current.values())
                });
            }

            if (previousState.size > 0) {
                for (const [k, old] of previousState.entries()) {
                    const nw = current.get(k);
                    if (!nw) { 
                        const myBestData = getMyCurrentBestData(current, old.method, old.type, myTraderNameGlobal);
                        const gapRival = getBestRivalRate(current, old.method, old.type, myTraderNameGlobal);
                        chrome.runtime.sendMessage({ 
                            type: "IFRAME_CHANGE_DETECTED", 
                            url: window.location.href, 
                            changeInfo: { alert: 'removed', data: old, gapRivalRate: gapRival, myBestRate: myBestData?.rate, myBestMax: myBestData?.max, currentSpread: getSykloSpread() } 
                        });
                    } else {
                        if (Math.abs(nw.rate - old.rate) > 0.0001) { 
                            const rival = getBestRivalRate(current, nw.method, nw.type, nw.trader);
                            const gapRival = getBestRivalRate(current, nw.method, nw.type, myTraderNameGlobal);
                            const myBestData = getMyCurrentBestData(current, nw.method, nw.type, myTraderNameGlobal);
                            chrome.runtime.sendMessage({ 
                                type: "IFRAME_CHANGE_DETECTED", 
                                url: window.location.href, 
                                changeInfo: { alert: 'rate_change', data: { ...nw, oldRate: old.rate }, bestRivalRate: rival, gapRivalRate: gapRival, myBestRate: myBestData?.rate, myBestMax: myBestData?.max, currentSpread: getSykloSpread() } 
                            });
                        }
                        else if (Math.abs(nw.max - old.max) > 0.01) { 
                            const myBestData = getMyCurrentBestData(current, nw.method, nw.type, myTraderNameGlobal);
                            chrome.runtime.sendMessage({ 
                                type: "IFRAME_CHANGE_DETECTED", 
                                url: window.location.href, 
                                changeInfo: { alert: 'capacity_change', data: { ...nw, oldMax: old.max }, myBestRate: myBestData?.rate, myBestMax: myBestData?.max, currentSpread: getSykloSpread() } 
                            });
                        }
                    }
                }
                for (const [k, nw] of current.entries()) {
                    if (!previousState.has(k)) { 
                        const rival = getBestRivalRate(current, nw.method, nw.type, nw.trader);
                        const myBestData = getMyCurrentBestData(current, nw.method, nw.type, myTraderNameGlobal);
                        chrome.runtime.sendMessage({ 
                            type: "IFRAME_CHANGE_DETECTED", 
                            url: window.location.href, 
                            changeInfo: { alert: 'new', data: nw, bestRivalRate: rival, myBestRate: myBestData?.rate, myBestMax: myBestData?.max, currentSpread: getSykloSpread() } 
                        });
                    }
                }
            }
            previousState = current;
        } catch(e) { console.error(e); } finally { isProcessing = false; }
    }
    const obs = new MutationObserver(() => processTableChanges());
    const init = () => { const t = document.querySelector('#book-table tbody'); if(t) { obs.observe(t, { childList: true, subtree: true, characterData: true }); processTableChanges(); } else setTimeout(init, 500); };
    init();

    // =========================================================
    // ESCANEO DE MÉTODOS DEL MERCADO (disparado desde consola)
    // Lee la tabla actual y extrae métodos únicos con su divisa.
    // Filtra filas de "Syklo" (spread row) y vacías.
    // =========================================================
    chrome.runtime.onMessage.addListener((request) => {
        if (request.type === "FIND_METHOD_FOR_PHOTO") {
            const tbody = document.querySelector('#book-table tbody');
            if (!tbody) return;

            const textoPanel = tbody.textContent.toLowerCase();

            if (textoPanel.includes(request.methodName)) {
                chrome.runtime.sendMessage({
                    type: "METHOD_FOUND_FOR_PHOTO",
                    url: window.location.href,
                    methodName: request.methodName
                });
            }
        }

        if (request.type !== "SCAN_MARKET_METHODS") return;

        try {
            const tbody = document.querySelector('#book-table tbody');
            if (!tbody) {
                chrome.runtime.sendMessage({ type: "MARKET_METHODS_SCANNED", methods: [], error: "Tabla no encontrada" });
                return;
            }

            const methodsMap = {}; // { "Banco Mercantil": "VES", "Syklo": "USDC", ... }

            for (const row of tbody.getElementsByTagName('tr')) {
                const cells = row.getElementsByTagName('td');
                if (cells.length < 2) continue;

                // Columna 0: "VES 🇻🇪 Banco Mercantil" o "USDC 🔵 Syklo"
                const rawCell = cells[0].textContent || '';

                // Extraer divisa (primera palabra)
                const currencyMatch = rawCell.match(/^\s*(VES|USDC|USDT|USD|BTC|ETH)/i);
                if (!currencyMatch) continue;
                const currency = currencyMatch[1].toUpperCase();

                // Extraer nombre del método (igual que parseOfferRow)
                let methodName = rawCell
                    .replace(/\s*\(.*?\)/g, '')
                    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '')
                    .replace(/\b(VE|VES|USDC|USDT|BTC|ETH|liquidity)\b|🇨🇴|🇻🇪|-/gi, '')
                    .trim();

                if (!methodName) continue;

                // Ignorar fila especial "Syklo" (es el spread, no un método real)
                if (methodName.toLowerCase() === 'syklo') continue;
                // Ignorar si parece porcentaje o está vacío
                if (/^\d+\.?\d*%?$/.test(methodName)) continue;

                methodsMap[methodName] = currency;
            }

            chrome.runtime.sendMessage({
                type: "MARKET_METHODS_SCANNED",
                methods: methodsMap,
                url: window.location.href
            });

        } catch(e) {
            chrome.runtime.sendMessage({ type: "MARKET_METHODS_SCANNED", methods: [], error: e.message });
        }
    });
}