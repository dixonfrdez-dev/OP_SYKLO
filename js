function hablarAlerta(mensaje) {
  // Forzamos una alerta visual en pantalla primero para confirmar que el botón funciona
  alert("Voz activada: " + mensaje);
  
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(mensaje);
    utterance.lang = 'es-ES';
    window.speechSynthesis.speak(utterance);
  }
}

function activarSistemaAlertas() {
  hablarAlerta("Sistema de alertas activado correctamente");
  
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification("Syklo Ops", { body: "Notificaciones permitidas." });
      }
    });
  }
}
