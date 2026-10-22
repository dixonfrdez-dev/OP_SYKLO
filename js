// Función para activar la voz en el celular/PC
function hablarAlerta(mensaje) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(mensaje);
    utterance.lang = 'es-ES'; // Idioma español
    window.speechSynthesis.speak(utterance);
  }
}

// Función para solicitar permiso y mostrar notificación
function solicitarNotificacion(titulo, texto) {
  if (!('Notification' in window)) {
    console.log("Este navegador no soporta notificaciones");
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(titulo, { body: texto });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(titulo, { body: texto });
      }
    });
  }
}
