// autotrader.js - WebApp Mobile Version (Native LocalStorage & Voice Integration)

console.log("🤖 Auto-Trader Adaptado a WebApp Móvil Cargado");

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let _soldadoLock = false;

// =================================================================
// 📊 LOGGING Y UTILIDADES DOM
// =================================================================
const Logger = {
    info(step, msg, data = {}) { console.log(`ℹ️ [INFO] ${step}: ${msg}`, data); },
    error(step, msg, data = {}) { console.log(`❌ [ERROR] ${step}: ${msg}`, data); }
};

async function executeWithRetry(fn, maxRetries = 3, backoff = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try { return await fn(); }
        catch (error) {
            if (attempt === maxRetries) throw error;
            await wait(backoff * attempt);
        }
    }
}

async function waitForCondition(conditionFn, timeout = 15000, context = 'condition') {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            const result = await conditionFn();
            if (result) return result;
        } catch (e) {}
        await wait(200);
    }
    throw new Error(`Timeout (${timeout}ms) esperando ${context}`);
}

function forceClick(element) {
    if (!element) return;
    const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
    element.dispatchEvent(clickEvent);
    if (element.click) element.click();
}

function simulateTypingGlobal(input, value) {
    input.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.style.backgroundColor = "#dcfce7";
}

async function simulateTypingValidated(input, value, maxRetries = 3) {
    const valString = String(value);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        simulateTypingGlobal(input, valString);
        await wait(300);
        if (String(input.value) === valString) return true;
        await wait(500 * attempt);
    }
    throw new Error(`Failed to set input value to ${valString}`);
}

// =================================================================
// 🔒 DETECTOR DE SESIÓN EXPIRADA
// =================================================================
function detectarSesionExpirada() {
    const indicators = [
        document.querySelector('input[type="password"]'),
        document.querySelector('input[autocomplete="one-time-code"]'),
        document.querySelector('input[placeholder*="código"]'),
        document.querySelector('input[placeholder*="autenticador"]'),
        document.querySelector('input[placeholder*="OTP"]'),
        ...(Array.from(document.querySelectorAll('button, h1, h2')).filter(el =>
            el.textContent?.toLowerCase().includes('iniciar sesión') ||
            el.textContent?.toLowerCase().includes('ingresar código') ||
            el.textContent?.toLowerCase().includes('two-factor') ||
            el.textContent?.toLowerCase().includes('autenticación')
        ))
    ].filter(Boolean);
    return indicators.length > 0;
}

// =================================================================
// 🗂️ CACHÉ DE TARJETAS (Usando LocalStorage NATIVO del celular)
// =================================================================
function getCardUrlMap() {
    try {
        const data = localStorage.getItem('syklo_cardUrlMap');
        return data ? JSON.parse(data) : {};
    } catch (e) {
        return {};
    }
}

function saveCardUrlMap(map) {
    try {
        localStorage.setItem('syklo_cardUrlMap', JSON.stringify(map));
    } catch (e) {
        console.error("Error al guardar caché:", e);
    }
}

// =================================================================
// 🧭 NAVEGACIÓN VÍA REACT ROUTER (pushState)
// =================================================================
function navegarA(path) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}

// =================================================================
// 🎯 LÓGICA DEL GERENTE Y EJECUCIÓN
// =================================================================
async function ejecutarRolGerente(data) {
    const order = {
        targetCardName: data.targetCardName,
        action: data.action,
        newPrice: data.newPrice,
        completionKey: data.completionKey,
        returnToVES: data.returnToVES !== false
    };

    showDetailedToast("SECUENCIA ACTIVA", data.action, data.newPrice,
        generateFullPanelHTML(data.method, data.targetCardName, data.details));

    // Avisar por voz que inició la secuencia
    if (typeof hablarAlerta === 'function') {
        hablarAlerta(`Iniciando actualización de ${data.action} para ${data.targetCardName}`);
    }

    try {
        const cardUrlMap = getCardUrlMap();
        const directUrl = cardUrlMap[data.targetCardName];

        if (directUrl) {
            order.directUrl = directUrl;
            updateToastStatusLocal("⚡ Tarjeta en caché. Acción directa...");
        } else {
            order.needsScan = true;
            updateToastStatusLocal("🗂️ Sin caché. Escaneando tarjetas...");
        }

        await executeSoldadoV50(order);

    } catch (error) {
        updateToastStatusLocal("❌ Fallo del Gerente: " + error.message);
        if (typeof hablarAlerta === 'function') {
            hablarAlerta("Error en la secuencia de auto trade");
        }
    }
}

// =================================================================
// 🎯 LÓGICA DEL SOLDADO (Ejecución real de precios)
// =================================================================
async function executeSoldadoV50(order) {
    if (_soldadoLock) {
        Logger.info('WORKER', `⏳ Esperando lock para "${order.targetCardName}"...`);
        await waitForCondition(() => !_soldadoLock, 90000, 'soldado lock liberado');
    }
    _soldadoLock = true;

    const updateUI = (msg) => updateToastStatusLocal(msg);
    const targetId = order.action === 'COMPRA'
        ? 'app-settings-detail-buyPrice'
        : 'app-settings-detail-sellPrice';

    try {
        if (detectarSesionExpirada()) {
            throw new Error('⚠️ Sesión expirada en Syklo.');
        }

        let targetPath;

        if (order.directUrl) {
            targetPath = new URL(order.directUrl).pathname;
        } else {
            updateUI("🗂️ Escaneando Mis Ofertas (primera vez)...");

            const misOfertasText = await waitForCondition(() => {
                const els = Array.from(document.querySelectorAll('span, div, a, li'));
                return els.find(el => el.textContent && el.textContent.trim() === "Mis ofertas");
            }, 12000, '"Mis ofertas"');

            if (misOfertasText) {
                forceClick(misOfertasText);
                const menuTitle = misOfertasText.closest('.ant-menu-submenu-title') || misOfertasText.parentElement;
                if (menuTitle) forceClick(menuTitle);
                const parentLi = misOfertasText.closest('li');
                if (parentLi) forceClick(parentLi);
            }

            await waitForCondition(() =>
                document.querySelectorAll('.ant-card-hoverable').length > 0,
            10000, 'tarjetas cargadas');

            const newMap = {};
            document.querySelectorAll('.ant-card-hoverable').forEach(card => {
                const nameEl = card.querySelector('.ant-typography');
                const link = card.querySelector('a');
                if (nameEl && link && link.href && link.href.includes('/settings/')) {
                    newMap[nameEl.textContent.trim()] = link.href;
                }
            });
            saveCardUrlMap(newMap);

            const scannedUrl = newMap[order.targetCardName];
            if (!scannedUrl) throw new Error(`Tarjeta "${order.targetCardName}" no encontrada`);
            targetPath = new URL(scannedUrl).pathname;
        }

        updateUI(`⚡ Navegando a formulario...`);
        navegarA(targetPath);

        updateUI(`⚙️ Esperando formulario...`);
        const targetInput = await waitForCondition(() => {
            if (detectarSesionExpirada()) throw new Error('Sesión expirada durante espera');
            const el = document.getElementById(targetId);
            return (el && document.contains(el)) ? el : null;
        }, 12000, `Input "${targetId}"`);

        updateUI(`💰 Estableciendo precio: ${order.newPrice}`);
        await executeWithRetry(() => simulateTypingValidated(targetInput, order.newPrice), 3, 1000);

        updateUI('💾 Guardando...');
        const saveBtn = await waitForCondition(() => {
            return Array.from(document.querySelectorAll('button')).find(btn =>
                btn.textContent.includes("Guardar configuración") && !btn.disabled
            );
        }, 5000, 'Botón Guardar');

        forceClick(saveBtn);

        await waitForCondition(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b =>
                b.textContent.includes("Guardar configuración")
            );
            return !btn || btn.disabled || btn.classList.contains('ant-btn-loading');
        }, 8000, 'Confirmación de guardado');

        updateUI('✅ Precio actualizado.');

        // Alerta por Voz y Notificación Móvil de Éxito
        if (typeof hablarAlerta === 'function') {
            hablarAlerta(`Precio actualizado correctamente a ${order.newPrice}`);
        }
        if (typeof solicitarNotificacion === 'function') {
            solicitarNotificacion("Syklo Auto-Trader", `Precio actualizado: ${order.newPrice}`);
        }

    } catch (error) {
        const isSessionError = error.message.includes('Sesión expirada');
        updateUI(isSessionError ? "🔒 Sesión expirada" : "❌ Fallo: " + error.message);

        if (typeof hablarAlerta === 'function') {
            hablarAlerta(isSessionError ? "Alerta. Sesión expirada en Syklo" : "Error al actualizar precio");
        }
    } finally {
        _soldadoLock = false;
    }
}

// =================================================================
// 🛠️ UI PANEL TOAST
// =================================================================
function generateFullPanelHTML(method, targetCardName, details) {
    return `
        <div style="background:rgba(15,23,42,0.8);border-radius:8px;padding:12px;margin:10px 0;border:1px solid #334155;text-align:left;">
            <div style="display:flex;justify-content:space-between;margin-bottom:10px;border-bottom:1px dashed #475569;padding-bottom:8px;">
                <div><div style="font-size:10px;color:#94a3b8;">TU TASA</div><div style="color:#ef4444;font-weight:bold;">${details?.myRate || 'N/A'}</div></div>
                <div style="text-align:right;"><div style="font-size:10px;color:#94a3b8;">RIVAL (${details?.rival || 'N/A'})</div><div style="color:#22c55e;font-weight:bold;">${details?.rivalPrice || 'N/A'}</div></div>
            </div>
            <div><div style="font-size:11px;color:#cbd5e1;">Método:</div><div style="font-weight:bold;">${method || 'VES'} (${targetCardName})</div></div>
        </div>`;
}

function showDetailedToast(title, action, price, logicHtml) {
    const old = document.getElementById('syklo-auto-toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = 'syklo-auto-toast';
    toast.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#0f172a;border:2px solid #3b82f6;color:white;border-radius:12px;z-index:2147483647;width:90%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,0.95);font-family:'Segoe UI',sans-serif;overflow:hidden;`;
    const actionColor = action === 'COMPRA' ? '#22c55e' : '#ef4444';
    toast.innerHTML = `
        <div style="background:#1e293b;padding:10px 15px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">
            <h3 style="color:#60a5fa;margin:0;font-size:14px;">🤖 AUTO-TRADER <span style="background:${actionColor};color:white;padding:1px 6px;border-radius:4px;font-size:10px;">${action}</span></h3>
            <span style="font-size:10px;color:#64748b;">${title}</span>
        </div>
        <div style="padding:15px;">
            <div style="text-align:center;margin-bottom:10px;"><div style="font-size:28px;font-weight:bold;color:white;">${price}</div><div style="font-size:11px;color:#64748b;">NUEVA TASA</div></div>
            ${logicHtml}
            <div id="toast-status-area" style="margin-top:10px;color:#facc15;font-weight:bold;font-size:12px;text-align:center;background:rgba(250,204,21,0.1);padding:5px;border-radius:4px;">⏳ Iniciando...</div>
        </div>`;
    document.body.appendChild(toast);
    setTimeout(() => { const t = document.getElementById('syklo-auto-toast'); if (t) t.remove(); }, 12000);
}

function updateToastStatusLocal(msg) {
    const area = document.getElementById('toast-status-area');
    if (area) {
        area.textContent = msg;
        if (msg.includes("Error") || msg.includes("Fallo") || msg.includes("❌") || msg.includes("🔒")) {
            area.style.color = "#f87171";
            area.style.background = "rgba(239,68,68,0.1)";
        } else if (msg.includes("✅")) {
            area.style.color = "#4ade80";
            area.style.background = "rgba(34,197,94,0.1)";
        }
    }
}
