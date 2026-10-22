// Función para reproducir voz
function hablarAlerta(mensaje) {
  if ('speechSynthesis' in window) {
    // Cancelar cualquier audio previo retenido
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(mensaje);
    utterance.lang = 'es-ES';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  } else {
    alert("Tu navegador no soporta síntesis de voz");
  }
}

// Función para solicitar permisos e iniciar prueba
function activarSistemaAlertas() {
  // 1. Probar Voz tras toque de usuario
  hablarAlerta("Sistema de alertas activado correctamente");

  // 2. Solicitar permiso de Notificaciones
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification("Syklo Ops", { body: "Las notificaciones están activas." });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification("Syklo Ops", { body: "Notificaciones permitidas." });
        }
      });
    }
  }
}
