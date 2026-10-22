// js/alertas.js - Versión Robótica Móvil Optimizada

function hablarAlerta(mensaje) {
    // 1. Forzamos una alerta visual previa para garantizar que el navegador desbloquee los eventos de audio
    console.log("🗣️ Intentando hablar:", mensaje);

    if ('speechSynthesis' in window) {
        // Cancelar cualquier audio anterior trabado
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(mensaje);
        utterance.lang = 'es-ES';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Forzar la reproducción asegurando que el navegador tome el foco
        window.speechSynthesis.speak(utterance);
    } else {
        alert("Alerta: " + mensaje);
    }
}

function solicitarNotificacion(titulo, cuerpo) {
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            new Notification(titulo, { body: cuerpo });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification(titulo, { body: cuerpo });
                }
            });
        }
    }
}

function activarSistemaAlertas() {
    // Reproducir un sonido/voz de prueba inmediato al presionar el botón
    hablarAlerta("Sistema de alertas activado correctamente");
    
    // Solicitar permiso de notificaciones nativas del celular
    if ('Notification' in window) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification("Syklo Ops", { body: "Notificaciones activadas con éxito" });
            }
        });
    }
}
