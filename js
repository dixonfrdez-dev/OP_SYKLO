// js/alertas.js - Centro de Control Flotante para Web App Móvil

function hablarAlerta(mensaje) {
    console.log("🗣️ Alerta:", mensaje);
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(mensaje);
        utterance.lang = 'es-ES';
        window.speechSynthesis.speak(utterance);
    }
}

function solicitarNotificacion(titulo, cuerpo) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(titulo, { body: cuerpo });
    }
}

function activarSistemaAlertas() {
    hablarAlerta("Centro de control activado");
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
    crearCentroControlFlotante();
}

// Crear panel flotante visual en la pantalla si no existe
function crearCentroControlFlotante() {
    if (document.getElementById('syklo-floating-hub')) return;

    const hub = document.createElement('div');
    hub.id = 'syklo-floating-hub';
    hub.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
        background: #0f172a; border: 2px solid #3b82f6; border-radius: 30px;
        padding: 8px 16px; display: flex; align-items: center; gap: 10px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.8); color: white; font-family: sans-serif;
    `;
    hub.innerHTML = `
        <div style="width: 10px; height: 10px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 8px #22c55e;"></div>
        <span style="font-size: 12px; font-weight: bold;">🤖 Centro de Control</span>
        <button id="test-voz-btn" style="background: #3b82f6; border: none; color: white; padding: 4px 8px; border-radius: 12px; font-size: 10px; cursor: pointer;">Test Voz</button>
    `;

    document.body.appendChild(hub);

    document.getElementById('test-voz-btn').addEventListener('click', () => {
        hablarAlerta("Prueba de audio exitosa en web app");
    });
}

// Auto-iniciar el panel flotante al cargar la página
window.addEventListener('DOMContentLoaded', () => {
    crearCentroControlFlotante();
});
