// GESTIÓN DE HORARIO

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

    // services/escaparateService.js (Añade estos métodos)

// Procesa la búsqueda de pedidos filtrando por número ID de pedido
async buscarPedidoPorTicket(ticketIdRecibido, airtableService) {
    const ticketLimpio = ticketIdRecibido.trim().toUpperCase();
    
    // Buscamos en la tabla de pedidos
    const registros = await airtableService.base(airtableService.t.pedidos).select({
        filterByFormula: `{ID_Pedido_Unico} = '${ticketLimpio}'`,
        maxRecords: 1
    }).firstPage();

    if (!registros || registros.length === 0) return null;

    const p = registros[0];
    return {
        id: p.id,
        detalle: p.fields.Pedido_Detalle || "Encargo",
        estado: p.fields.Estado || "Pendiente",
        entrega: p.fields.Fecha_Entrega || "A determinar"
    };
}

//Formatea el mensaje de estado de un pedido para la clienta

 
formatearMensajePedido(pedido, indice) {
    return `🧵 **Encargo #${indice + 1}**\n` +
           `📦 **Detalle:** ${pedido.detalle}\n` +
           `📌 **Estado:** ${pedido.estado}\n` +
           `📅 **Entrega:** ${pedido.entrega}`;
}
}

module.exports = new EscaparateService();

