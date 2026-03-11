// GESTIÓN DE HORARIO

// services/escaparateService.js

class EscaparateService {
    //Determina si la tienda física está abierta según el horario oficial

    estaLaTiendaAbierta() {
        const ahora = new Date().toLocaleString("en-US", {timeZone: "Europe/Madrid"});
        const fechaEsp = new Date(ahora);
        
        const dia = fechaEsp.getDay(); // 0: Dom, 1: Lun...
        const hora = fechaEsp.getHours();
        const minutos = fechaEsp.getMinutes();
        const tiempoDecimal = hora + (minutos / 60);

        const manana = tiempoDecimal >= 10 && tiempoDecimal < 14;
        const tarde = tiempoDecimal >= 17 && tiempoDecimal < 20;

        // Lun(1), Mar(2), Jue(4), Vie(5)
        if ([1, 2, 4, 5].includes(dia)) return manana || tarde;
        // Mie(3) y Sab(6)
        if ([3, 6].includes(dia)) return manana;
        
        return false;
    }

    //Genera la botonera principal dinámica según el estado de apertura
     
     
    obtenerBotonesMenuPrincipal() {
        const abierta = this.estaLaTiendaAbierta();
        return [
            [{ text: "🎓 Clases de Costura", callback_data: "CLI_ACADEMIA" }],
            [{ text: abierta ? "📲 Hablar con nosotras (Abierto)" : "🙋 Dejar consulta", callback_data: "CLI_INTERESADO" }],
            [{ text: "📦 Mi pedido", callback_data: "CLI_ESTADO" }],
            [{ text: "🧵 Catálogo", callback_data: "CLI_TELAS" }],
            [{ text: "⏰ Horario", callback_data: "CLI_HORARIO" }]
        ];
    }

    //Retorna el texto formateado con los detalles del horario
     
     
    obtenerTextoHorario() {
        return `📍 **Nuestro horario es:**\n` +
               `• **Lun, Mar, Jue y Vie:** 10:00h - 14:00h y 17:00h - 20:00h\n` +
               `• **Miércoles y Sábados:** 10:00h - 14:00h\n` +
               `• **Domingos:** Cerrado 🧵`;
    }
}

module.exports = new EscaparateService();