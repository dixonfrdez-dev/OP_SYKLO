// js/alertas.js - Audio Beep NATIVO + Sintetizador de Voz Móvil

// Función para emitir un tono de beep real nativo del celular
function emitirBeep(frecuencia = 800, duracion = 300) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frecuencia;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => {
            osc.stop();
            ctx.close();
        }, duracion);
    } catch (e) {
        console.error("Error al reproducir audio beep:", e);
    }
}

function hablarAlerta(mensaje) {
    // 1. Siempre emitimos un pitido sonoro instantáneo
    emitirBeep(880, 250);

    // 2. Intentamos reproducir la voz
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Limpiar cola previa

        const utterance = new SpeechSynthesisUtterance(mensaje);
        utterance.lang = 'es-ES';
        utterance.rate = 1.0;

        // Cargar voces disponibles en Android/iOS
        const voices = window.speechSynthesis.getVoices();
        const spanishVoice = voices.find(v => v.lang.startsWith('es'));
        if (spanishVoice) utterance.voice = spanishVoice;

        window.speechSynthesis.speak(utterance);
    }
}

function activarSistemaAlertas() {
    // Confirmación sonora doble para verificar que el evento funciona
    emitirBeep(600, 150);
    setTimeout(() => emitirBeep(1200, 250), 200);

    // Intentar reproducir voz
    hablarAlerta("Sistema de alertas activado correctamente");

    // Permisos de notificación
    if ('Notification' in window) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification("Syklo Ops", { body: "Notificaciones activas" });
            }
        });
    }
}

// Cargar voces del sistema al iniciar
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
    };
}
