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


// Procesa la búsqueda de pedidos filtrando por número ID de pedido

a// services/escaparateService.js

async buscarPedidoPorTicket(textoUsuario, airtableService) {
    // 1. Limpieza extrema: quitamos prefijos, espacios y forzamos Mayúsculas
    const soloNumeros = textoUsuario.toUpperCase().replace(/#REF-/g, "").trim();
    
    if (!soloNumeros) return null;

    // 2. Reconstruimos el ID exacto
    const ticketExacto = `#REF-${soloNumeros}`;
    
    // Debug: Esto saldrá en tus logs de Vercel para que veas qué busca
    console.log(`🔎 Buscando ticket: "${ticketExacto}" en la columna ID_Pedido_Unico`);

    try {
        // 3. Fórmula de Airtable (Asegúrate de que el nombre de la columna sea idéntico)
        const formula = `{ID_Pedido_Unico} = '${ticketExacto}'`;
        
        const registros = await airtableService.base(airtableService.t.pedidos).select({
            filterByFormula: formula,
            maxRecords: 1
        }).all();

        if (registros && registros.length > 0) {
            const p = registros[0].fields;
            return {
                id: registros[0].id,
                detalle: p.Pedido_Detalle,
                estado: p.Estado,
                entrega: p.Fecha_Entrega,
                nombre: p.Nombre_Cliente
            };
        }
        
        console.log("❌ No se encontró ningún registro con esa fórmula.");
        return null;
    } catch (e) {
        console.error("💥 Error en buscarPedidoPorTicket:", e.message);
        return null;
    }
}
// Formatea el mensaje de estado de un pedido para la clienta

formatearMensajePedido(pedido, indice) {
    return `🧵 **Encargo #${indice + 1}**\n` +
           `📦 **Detalle:** ${pedido.detalle}\n` +
           `📌 **Estado:** ${pedido.estado}\n` +
           `📅 **Entrega:** ${pedido.entrega}`;
}

// Generador de WhatsApp 
     
async formatearLinkWA(telefono, nombre, mensajeBase, ticketId = "") {
    if (!telefono) return null;
    let telLimpio = String(telefono).replace(/[^0-9]/g, ''); 
    if (telLimpio.length === 9) telLimpio = '34' + telLimpio; 
    
    // Reemplazamos tanto el nombre como la referencia si existen en la plantilla
    let textoFinal = mensajeBase
        .replace('{nombre}', nombre || 'cliente')
        .replace('{ticket}', ticketId || ''); // Inyectamos el #REF aquí
        
    const textoWA = encodeURIComponent(textoFinal);
    return `https://wa.me/${telLimpio}?text=${textoWA}`;
}

//Gestiona el flujo de la consulta (Duda -> Nombre -> Teléfono)
   
     
async handleConsultationWorkflow(textoRecibido, metadata) {
    let result = { text: "", step: "", isFinal: false, meta: metadata };

    if (metadata.step === "ESP_CONSULTA") {
        result.meta.mensajeConsulta = textoRecibido;
        result.meta.step = "ESP_NOMBRE";
        result.text = `📝 Anotado. ¿A nombre de quién pongo la consulta, primor?`;
    } 
    else if (metadata.step === "ESP_NOMBRE") {
        result.meta.nombreCliente = textoRecibido;
        result.meta.step = "ESP_TELEFONO";
        result.text = `🏷️ Muy bien, **${textoRecibido}**. \n¿A qué número de **Teléfono** podemos contactarte?`;
    } 
    else if (metadata.step === "ESP_TELEFONO") {
        result.meta.telefonoCliente = textoRecibido;
        const abierta = this.estaLaTiendaAbierta();
        result.meta.estado = abierta ? "WhatsApp Abierto" : "Pendiente";
        result.isFinal = true;
        result.text = "✅ ¡Anotado! Mañana Reyes o Begoña te responderán.";
    }

    return result;
}
}


module.exports = new EscaparateService();

