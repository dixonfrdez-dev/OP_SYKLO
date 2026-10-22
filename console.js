// console.js - V5.0 (Sincronización completa: métodos del mercado + tarjetas)
//
// ARQUITECTURA:
// ─────────────────────────────────────────────────────────────────
// marketMethods  = { "Banco de Venezuela": "VES", "Bitget": "USDC" }
//                  Escaneado del iframe de explorer.syklo.io
//                  Es la fuente de verdad de qué métodos existen
//
// cardUrlMap     = { "VENEZUELA": "/settings/7741", "BG WINDER": "/settings/171372" }
//                  Escaneado de webapp.syklo.io/settings (Mis Ofertas)
//
// settings.methods = configuración del usuario:
//                  clave = toKey(nombre del mercado)
//                  valor = { marketMethod, buy: { cardName, active... }, sell: ... }
//
// La asociación "Banco de Venezuela" → "VENEZUELA" la hace el usuario
// escribiendo el cardName en el campo correspondiente.
// ─────────────────────────────────────────────────────────────────

class AutoTradeConsole {
    constructor() {
        this.root = null;
        this.settings = { globalActive: false, methods: {} };
        this.cardUrlMap = {};
        this.marketMethods = {}; // { "Banco de Venezuela": "VES", ... }
        this.prefs = {};
        this.showHidden = false;
        this.heartbeatInterval = null;
        this.syncState = 'idle'; // idle | scanning_market | scanning_cards | done
    }

    init() {
        if (document.getElementById('at-console-root')) return;
        this.loadAll(() => {
            this.purgeObsoleteSettings();
            this.buildUI();
            this.setupListeners();
            this.startHeartbeat();
            this.log('info', 'Centro de Control V5.0 iniciado');
        });
    }

    // ─────────────────────────────────────────────────────────────
    // CARGA
    // ─────────────────────────────────────────────────────────────
    loadAll(callback) {
        chrome.storage.local.get(
            ['autoTradeSettingsV2', 'cardUrlMap', 'cardDisplayPrefs', 'marketMethods'],
            (result) => {
                if (result.autoTradeSettingsV2) this.settings = result.autoTradeSettingsV2;
                if (result.cardUrlMap) this.cardUrlMap = result.cardUrlMap;
                if (result.cardDisplayPrefs) this.prefs = result.cardDisplayPrefs;
                if (result.marketMethods) this.marketMethods = result.marketMethods;
                if (callback) callback();
            }
        );
    }

    savePrefs() { chrome.storage.local.set({ cardDisplayPrefs: this.prefs }); }

    saveSettings() {
        chrome.storage.local.set({ autoTradeSettingsV2: this.settings });
        chrome.runtime.sendMessage({ type: "UPDATE_AUTOTRADER_STATE", settings: this.settings });
        this.updateGlobalLed(this.settings.globalActive);
    }

    // ─────────────────────────────────────────────────────────────
    // LIMPIEZA DE SETTINGS OBSOLETOS
    // Elimina métodos en settings que NO existen en marketMethods
    // y no tienen configuración activa.
    // Esto limpia los residuos de versiones anteriores.
    // ─────────────────────────────────────────────────────────────
    purgeObsoleteSettings() {
        if (Object.keys(this.marketMethods).length === 0) return; // sin datos del mercado, no purgar
        const validKeys = new Set(Object.keys(this.marketMethods).map(m => this.toKey(m)));
        let purged = 0;
        Object.keys(this.settings.methods || {}).forEach(key => {
            const cfg = this.settings.methods[key];
            const isActive = cfg.buy?.active || cfg.sell?.active;
            if (!validKeys.has(key) && !isActive) {
                delete this.settings.methods[key];
                purged++;
            }
        });
        if (purged > 0) {
            this.saveSettings();
            console.log(`[Console] Purgados ${purged} métodos obsoletos`);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // LISTA DE MÉTODOS
    // Fuente primaria: marketMethods (escaneado del mercado real)
    // Fuente secundaria: settings activos (configurados por el usuario)
    // ─────────────────────────────────────────────────────────────
    getMethodList() {
        const list = new Map(); // key → { name, currency }

        // 1. Métodos del mercado real (fuente principal)
        Object.entries(this.marketMethods).forEach(([name, currency]) => {
            list.set(this.toKey(name), { name, currency });
        });

        // 2. Métodos con config activa que no están en el mercado
        //    (por si acaso el mercado no se ha escaneado aún)
        Object.keys(this.settings.methods || {}).forEach(key => {
            if (!list.has(key)) {
                const cfg = this.settings.methods[key];
                const isActive = cfg.buy?.active || cfg.sell?.active;
                if (isActive) {
                    list.set(key, {
                        name: cfg.marketMethod || cfg.name || key,
                        currency: cfg.currency || '?'
                    });
                }
            }
        });

        return list;
    }

    getSortedMethods() {
        const all = this.getMethodList();
        const favorites = [], normal = [];
        all.forEach((info, key) => {
            const p = this.prefs[key] || {};
            if (p.hidden) return;
            if (p.favorite) favorites.push({ key, ...info });
            else normal.push({ key, ...info });
        });
        favorites.sort((a, b) => a.name.localeCompare(b.name));
        normal.sort((a, b) => a.name.localeCompare(b.name));
        return { favorites, normal };
    }

    getHiddenMethods() {
        const all = this.getMethodList();
        const hidden = [];
        all.forEach((info, key) => {
            if (this.prefs[key]?.hidden) hidden.push({ key, ...info });
        });
        return hidden.sort((a, b) => a.name.localeCompare(b.name));
    }

    // ─────────────────────────────────────────────────────────────
    // UI
    // ─────────────────────────────────────────────────────────────
    buildUI() {
        const existing = document.getElementById('at-console-root');
        if (existing) existing.remove();

        const cacheCount = Object.keys(this.cardUrlMap).length;
        const marketCount = Object.keys(this.marketMethods).length;
        const syncLabel = marketCount > 0
            ? `<span style="color:#4ade80;font-size:10px;">✅ ${marketCount} métodos · ${cacheCount} tarjetas</span>`
            : `<span style="color:#f59e0b;font-size:10px;">⚠️ Sin sincronizar</span>`;

        const html = `
            <div id="at-console-root">
                <div class="at-header" id="at-toggle-min">
                    <div class="at-title">
                        <div id="at-global-led" class="at-status-led"></div>
                        <span>🎮 Centro de Control</span>
                    </div>
                    <button style="background:none;border:none;color:#cbd5e1;cursor:pointer;">_</button>
                </div>
                <div class="at-tabs">
                    <button class="at-tab-btn active" data-target="tab-logs">📜 Registros</button>
                    <button class="at-tab-btn" data-target="tab-config">⚙️ Configuración</button>
                </div>
                <div class="at-content">
                    <div id="tab-logs" class="at-pane active">
                        <div class="at-log-controls">
                            <span style="color:#94a3b8;font-size:11px;">Estado: <strong id="at-bot-status">En Espera</strong></span>
                            <span id="queue-counter" style="color:#facc15;font-size:11px;margin-left:15px;display:none;">
                                📋 Cola: <strong id="queue-count">0</strong>
                            </span>
                            <button id="at-clear-logs" style="background:none;border:1px solid #475569;color:#f87171;font-size:10px;border-radius:3px;cursor:pointer;margin-left:auto;">Limpiar</button>
                        </div>
                        <div id="at-log-container" class="at-log-list"></div>
                    </div>
                    <div id="tab-config" class="at-pane">
                        <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">
                            <strong style="color:#60a5fa;font-size:13px;">INTERRUPTOR MAESTRO</strong>
                            <label class="at-switch">
                                <input type="checkbox" id="at-global-switch">
                                <span class="at-slider"></span>
                            </label>
                        </div>

                        <!-- PANEL DE SINCRONIZACIÓN -->
                        <div style="margin-bottom:12px;padding:8px;background:rgba(15,23,42,0.8);border:1px solid #334155;border-radius:6px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                                <span style="font-size:11px;color:#94a3b8;">🔄 Sincronización</span>
                                <span id="at-sync-status">${syncLabel}</span>
                            </div>
                            <button id="at-sync-all" style="width:100%;padding:7px;background:#1e3a8a;border:1px solid #3b82f6;color:#93c5fd;font-size:12px;border-radius:4px;cursor:pointer;font-weight:bold;">
                                🔄 Sincronizar Métodos y Tarjetas
                            </button>
                            <div id="at-sync-msg" style="font-size:10px;color:#94a3b8;margin-top:4px;text-align:center;min-height:14px;"></div>
                        </div>

                        <div id="at-methods-container"></div>
                    </div>
                </div>
            </div>`;

        const div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        this.root = document.getElementById('at-console-root');
        this.renderMethodsConfig();
    }

    renderMethodsConfig() {
        const container = document.getElementById('at-methods-container');
        if (!container) return;
        container.innerHTML = '';

        const { favorites, normal } = this.getSortedMethods();
        const hidden = this.getHiddenMethods();
        const total = favorites.length + normal.length;

        if (total === 0 && hidden.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;padding:20px;color:#64748b;font-size:12px;">
                    Sin métodos aún.<br><br>
                    Presiona <strong style="color:#3b82f6;">🔄 Sincronizar</strong> para importar<br>
                    los métodos del mercado y tus tarjetas.
                </div>`;
        } else {
            if (favorites.length > 0) {
                container.innerHTML += `<div class="at-section-label">⭐ Favoritos</div>`;
                favorites.forEach(m => { container.innerHTML += this.renderMethodGroup(m.key, m.name, m.currency, true); });
            }
            if (normal.length > 0) {
                if (favorites.length > 0) container.innerHTML += `<div class="at-section-label" style="margin-top:10px;">📋 Métodos</div>`;
                normal.forEach(m => { container.innerHTML += this.renderMethodGroup(m.key, m.name, m.currency, false); });
            }
            if (hidden.length > 0) {
                container.innerHTML += `
                    <button id="at-toggle-hidden" class="at-hidden-toggle">
                        ${this.showHidden ? '🙈 Ocultar' : `👁 Mostrar ocultos (${hidden.length})`}
                    </button>`;
                if (this.showHidden) {
                    container.innerHTML += `<div class="at-section-label" style="color:#64748b;">🚫 Ocultos</div>`;
                    hidden.forEach(m => { container.innerHTML += this.renderMethodGroup(m.key, m.name, m.currency, false, true); });
                }
            }
        }

        const sw = document.getElementById('at-global-switch');
        if (sw) sw.checked = this.settings.globalActive || false;
        this.updateGlobalLed(this.settings.globalActive);
        this.setupMethodControlListeners();
    }

    renderMethodGroup(key, marketName, currency, isFavorite, isHidden = false) {
        if (!this.settings.methods[key]) {
            this.settings.methods[key] = this.getDefaultConfig(marketName, currency);
        }
        const config = this.settings.methods[key];
        const isCrypto = currency !== 'VES';
        const typeLabel = isCrypto
            ? `<span style="font-size:9px;color:#a78bfa;" title="${currency}">🔷${currency}</span>`
            : `<span style="font-size:9px;color:#38bdf8;" title="VES">🇻🇪VES</span>`;

        // Verificar caché para cada tarjeta
        const buyCard = config.buy?.cardName || '';
        const sellCard = config.sell?.cardName || '';
        const buyInCache = buyCard && !!this.cardUrlMap[buyCard];
        const sellInCache = sellCard && !!this.cardUrlMap[sellCard];
        const anyConfigured = buyCard || sellCard;
        const cacheIcon = !anyConfigured
            ? `<span style="font-size:9px;color:#64748b;" title="Sin tarjetas configuradas">○</span>`
            : (buyInCache || sellInCache)
                ? `<span style="font-size:9px;color:#4ade80;" title="Tarjeta en caché">⚡</span>`
                : `<span style="font-size:9px;color:#f59e0b;" title="Tarjeta no encontrada en caché">⚠️</span>`;

        const favBtn = `<button class="at-ctrl-btn at-fav-btn ${isFavorite ? 'active' : ''}" data-key="${key}">${isFavorite ? '⭐' : '☆'}</button>`;
        const hideBtn = isHidden
            ? `<button class="at-ctrl-btn at-show-btn" data-key="${key}">↩</button>`
            : `<button class="at-ctrl-btn at-hide-btn" data-key="${key}" title="Ocultar">🙈</button>`;

        return `
            <div class="at-method-group ${isFavorite ? 'at-favorite' : ''} ${isHidden ? 'at-hidden-method' : ''}">
                <div class="at-method-header">
                    <span>${marketName} ${typeLabel} ${cacheIcon}</span>
                    <div style="display:flex;gap:4px;">${favBtn}${hideBtn}</div>
                </div>
                <div class="at-method-body">
                    ${this.renderSideConfig(key, 'buy', 'COMPRA', config.buy)}
                    ${this.renderSideConfig(key, 'sell', 'VENTA', config.sell)}
                </div>
            </div>`;
    }

    renderSideConfig(methodKey, sideKey, label, config) {
        const isBattle = config.mode === 'battle';
        const colorClass = sideKey === 'buy' ? 'at-buy-text' : 'at-sell-text';
        const minCapital = config.minCapital !== undefined ? config.minCapital : 10;
        return `
            <div class="at-side-config">
                <div class="at-side-title">
                    <span class="${colorClass}">${label}</span>
                    <label class="at-switch">
                        <input type="checkbox" class="at-config-input"
                            data-m="${methodKey}" data-s="${sideKey}" data-f="active"
                            ${config.active ? 'checked' : ''}>
                        <span class="at-slider"></span>
                    </label>
                </div>
                <div class="at-form-row">
                    <span title="Nombre exacto de tu tarjeta en Syklo (Mis Ofertas)">Nombre Tarjeta:</span>
                    <input type="text" class="at-input at-config-input"
                        data-m="${methodKey}" data-s="${sideKey}" data-f="cardName"
                        value="${config.cardName || ''}" placeholder="Ej: VENEZUELA">
                </div>
                <div class="at-form-row">
                    <span>Modo:</span>
                    <select class="at-select at-config-input" data-m="${methodKey}" data-s="${sideKey}" data-f="mode">
                        <option value="sentinel" ${config.mode === 'sentinel' ? 'selected' : ''}>🛡️ Centinela</option>
                        <option value="battle" ${config.mode === 'battle' ? 'selected' : ''}>⚔️ Batalla</option>
                    </select>
                </div>
                <div class="at-form-row battle-options" style="display:${isBattle ? 'flex' : 'none'};background:rgba(0,0,0,0.2);padding:4px;border-radius:4px;">
                    <span>Incremento:</span>
                    <input type="number" step="0.01" class="at-input at-config-input" style="width:60px;"
                        data-m="${methodKey}" data-s="${sideKey}" data-f="battleStep" value="${config.battleStep}">
                </div>
                <div class="at-form-row">
                    <span title="Ignorar rivales con menos capital">Ignorar &lt; (USDC):</span>
                    <input type="number" step="1" class="at-input at-config-input" style="width:60px;"
                        data-m="${methodKey}" data-s="${sideKey}" data-f="minCapital" value="${minCapital}">
                </div>
            </div>`;
    }

    // ─────────────────────────────────────────────────────────────
    // SINCRONIZACIÓN
    // ─────────────────────────────────────────────────────────────
    syncAll() {
        this.syncState = 'scanning_market';
        this.updateSyncUI('⏳ Leyendo tabla del mercado...', '#facc15');
        chrome.runtime.sendMessage({ type: 'SYNC_ALL' });

        // Timeout de seguridad
        setTimeout(() => {
            if (this.syncState !== 'idle' && this.syncState !== 'done') {
                this.syncState = 'idle';
                this.updateSyncUI('❌ Timeout. ¿Está abierta la tabla del mercado?', '#f87171');
                this.enableSyncBtn();
            }
        }, 25000);
    }

    onMarketMethodsReady(methods) {
        this.marketMethods = methods;
        this.syncState = 'scanning_cards';
        const count = Object.keys(methods).length;
        this.updateSyncUI(`✅ ${count} métodos encontrados. Escaneando tarjetas...`, '#4ade80');
        this.purgeObsoleteSettings();
        this.renderMethodsConfig();
    }

    onCacheUpdated(count, cards, error) {
        this.syncState = 'done';
        const btn = document.getElementById('at-sync-all');
        if (error) {
            this.updateSyncUI(`❌ Error en tarjetas: ${error}`, '#f87171');
            this.enableSyncBtn();
            return;
        }
        if (cards) this.cardUrlMap = cards;

        const marketCount = Object.keys(this.marketMethods).length;
        const syncEl = document.getElementById('at-sync-status');
        if (syncEl) syncEl.innerHTML = `<span style="color:#4ade80;font-size:10px;">✅ ${marketCount} métodos · ${count} tarjetas</span>`;

        this.updateSyncUI(`✅ Sincronización completa. ${count} tarjetas importadas.`, '#4ade80');
        this.enableSyncBtn();
        this.renderMethodsConfig();
        this.log('success', `🔄 Sincronización completa: <strong>${marketCount}</strong> métodos · <strong>${count}</strong> tarjetas.`);
    }

    updateSyncUI(msg, color) {
        const el = document.getElementById('at-sync-msg');
        if (el) { el.textContent = msg; el.style.color = color || '#94a3b8'; }
    }

    enableSyncBtn() {
        const btn = document.getElementById('at-sync-all');
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizar Métodos y Tarjetas'; }
    }

    // ─────────────────────────────────────────────────────────────
    // DATOS
    // ─────────────────────────────────────────────────────────────
    getDefaultConfig(marketName, currency) {
        return {
            name: marketName,
            marketMethod: marketName,
            currency: currency || 'VES',
            buy:  { active: false, cardName: '', mode: 'sentinel', battleStep: 0.01, minCapital: 10 },
            sell: { active: false, cardName: '', mode: 'sentinel', battleStep: 0.01, minCapital: 10 }
        };
    }

    toKey(text) { return text.replace(/\s+/g, '-').toLowerCase(); }

    // ─────────────────────────────────────────────────────────────
    // LISTENERS
    // ─────────────────────────────────────────────────────────────
    setupListeners() {
        document.getElementById('at-toggle-min').onclick = (e) => {
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SPAN')
                this.root.classList.toggle('minimized');
        };

        document.querySelectorAll('.at-tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.at-tab-btn').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.at-pane').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.target).classList.add('active');
            };
        });

        document.getElementById('at-global-switch').onchange = (e) => {
            this.settings.globalActive = e.target.checked;
            this.saveSettings();
        };

        document.getElementById('at-clear-logs').onclick = () => {
            document.getElementById('at-log-container').innerHTML = '';
        };

        document.getElementById('at-sync-all').onclick = () => {
            const btn = document.getElementById('at-sync-all');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizando...'; }
            this.syncAll();
        };

        document.getElementById('at-methods-container').addEventListener('change', (e) => {
            if (!e.target.classList.contains('at-config-input')) return;
            const m = e.target.dataset.m;
            const s = e.target.dataset.s;
            const f = e.target.dataset.f;
            let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
            if (e.target.type === 'number') value = parseFloat(value);
            if (!this.settings.methods[m]) this.settings.methods[m] = this.getDefaultConfig(m, 'VES');
            this.settings.methods[m][s][f] = value;
            if (f === 'mode') {
                const row = e.target.closest('.at-side-config')?.querySelector('.battle-options');
                if (row) row.style.display = value === 'battle' ? 'flex' : 'none';
            }
            // Si cambia cardName, actualizar indicador ⚡/⚠️ inmediatamente
            if (f === 'cardName') this.renderMethodsConfig();
            this.saveSettings();
        });
    }

    setupMethodControlListeners() {
        document.querySelectorAll('.at-fav-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const key = btn.dataset.key;
                if (!this.prefs[key]) this.prefs[key] = {};
                this.prefs[key].favorite = !this.prefs[key].favorite;
                this.savePrefs(); this.renderMethodsConfig();
            };
        });
        document.querySelectorAll('.at-hide-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const key = btn.dataset.key;
                if (!this.prefs[key]) this.prefs[key] = {};
                this.prefs[key].hidden = true;
                this.prefs[key].favorite = false;
                this.savePrefs(); this.renderMethodsConfig();
            };
        });
        document.querySelectorAll('.at-show-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                if (this.prefs[btn.dataset.key]) this.prefs[btn.dataset.key].hidden = false;
                this.savePrefs(); this.renderMethodsConfig();
            };
        });
        const toggleHidden = document.getElementById('at-toggle-hidden');
        if (toggleHidden) {
            toggleHidden.onclick = () => { this.showHidden = !this.showHidden; this.renderMethodsConfig(); };
        }
    }

    // ─────────────────────────────────────────────────────────────
    // LOGGING
    // ─────────────────────────────────────────────────────────────
    log(type, htmlContent) {
        const container = document.getElementById('at-log-container');
        if (!container) return;
        const div = document.createElement('div');
        const cssMap = { success: 'success', error: 'error', attack: 'attack', ignore: 'ignore' };
        div.className = `at-log-card ${cssMap[type] || 'analysis'}`;
        const time = new Date().toLocaleTimeString();
        div.innerHTML = htmlContent?.includes('<div')
            ? htmlContent
            : `<div class="log-header"><span>SISTEMA</span><span style="opacity:0.5">${time}</span></div><div class="log-body">${htmlContent}</div>`;
        container.prepend(div);
        if (container.children.length > 50) container.lastChild.remove();
    }

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            const statusEl = document.getElementById('at-bot-status');
            if (statusEl) {
                statusEl.textContent = this.settings.globalActive ? "Operando" : "Pausado";
                statusEl.style.color = this.settings.globalActive ? "#4ade80" : "#f87171";
            }
            chrome.runtime.sendMessage({ type: "GET_QUEUE_STATUS" }, (response) => {
                if (chrome.runtime.lastError) return;
                const countEl = document.getElementById('queue-count');
                const containerEl = document.getElementById('queue-counter');
                if (response && countEl && containerEl) {
                    countEl.textContent = response.queueLength;
                    const active = response.queueLength > 0 || response.processing;
                    containerEl.style.display = active ? 'inline' : 'none';
                    if (active) containerEl.style.opacity = response.processing ? (Date.now() % 1000 < 500 ? "1" : "0.5") : "1";
                }
            });
        }, 1000);
    }

    updateGlobalLed(isActive) {
        const led = document.getElementById('at-global-led');
        if (led) { led.classList.toggle('active', !!isActive); }
    }
}

// ─────────────────────────────────────────────────────────────────
// INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────────
if (window.top === window.self) {
    setTimeout(() => {
        if (!window.sykloConsole) {
            window.sykloConsole = new AutoTradeConsole();
            window.sykloConsole.init();
        }
    }, 1000);

    chrome.runtime.onMessage.addListener((msg) => {
        if (!window.sykloConsole) return;
        switch (msg.type) {
            case "LOG_TO_CONSOLE":
                window.sykloConsole.log(msg.action, msg.message);
                break;
            case "MARKET_METHODS_READY":
                window.sykloConsole.onMarketMethodsReady(msg.methods);
                break;
            case "CARD_CACHE_UPDATED":
                window.sykloConsole.onCacheUpdated(msg.count, msg.cards, msg.error);
                break;
            case "UPDATE_AUTOTRADER_STATE":
                window.sykloConsole.loadAll(() => window.sykloConsole.renderMethodsConfig());
                break;
        }
    });
}
