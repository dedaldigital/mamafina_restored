// GESTIÓN DE HORARIO Y ESCAPARATE

class EscaparateService {
    // 1. Determina si la tienda física está abierta
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

    // 2. Genera la botonera principal
    obtenerBotonesMenuPrincipal() {
        // Usamos 'this' porque estamos DENTRO de la clase instanciada
        const abierta = this.estaLaTiendaAbierta(); 
        return [
            [{ text: "🎓 Clases de Costura", callback_data: "CLI_ACADEMIA" }],
            [{ text: abierta ? "📲 Hablar con nosotras (Abierto)" : "🙋 Dejar consulta", callback_data: "CLI_INTERESADO" }],
            [{ text: "📦 Mi pedido", callback_data: "CLI_ESTADO" }],
            [{ text: "🧵 Catálogo", callback_data: "CLI_TELAS" }],
            [{ text: "⏰ Horario", callback_data: "CLI_HORARIO" }]
        ];
    }

    // 3. Retorna el texto del horario (¡Con el return recuperado!)
    obtenerTextoHorario() {
        return `📍 **Nuestro horario es:**\n` +
               `• **Lun, Mar, Jue y Vie:** 10:00h - 14:00h y 17:00h - 20:00h\n` +
               `• **Miércoles y Sábados:** 10:00h - 14:00h\n` +
               `• **Domingos:** Cerrado 🧵`;
    }

    // 4. Busca pedidos por Ticket (¡Con el async recuperado!)
    async buscarPedidoPorTicket(textoUsuario, airtableService) {
        if (!textoUsuario) return null;

        let busqueda = textoUsuario.trim();
        let formula = "";
        
        if (busqueda.startsWith('rec')) {
            formula = `RECORD_ID() = '${busqueda}'`;
        } else {
            const soloNumeros = busqueda.toUpperCase().replace(/#REF-/g, "").trim();
            const ticketExacto = `#REF-${soloNumeros}`;
            formula = `{ID_Pedido_Unico} = '${ticketExacto}'`;
        }

        try {
            console.log(`🔎 Ejecutando fórmula en Airtable: ${formula}`);
            const registros = await airtableService.base(airtableService.t.pedidos).select({
                filterByFormula: formula,
                maxRecords: 1
            }).all();

            if (registros && registros.length > 0) {
                const r = registros[0];
                return {
                    id: r.id,
                    detalle: r.fields.Pedido_Detalle,
                    estado: r.fields.Estado,
                    nombre: r.fields.Nombre_Cliente
                };
            }
            return null;
        } catch (e) {
            console.error("❌ Error en búsqueda fallback:", e);
            return null;
        }
    }

    // 5. Formatea el mensaje del estado
    formatearMensajePedido(pedido, indice) {
        return `🧵 **Encargo #${indice + 1}**\n` +
               `📦 **Detalle:** ${pedido.detalle}\n` +
               `📌 **Estado:** ${pedido.estado}\n` +
               `📅 **Entrega:** ${pedido.entrega}`;
    }

    // 6. Gestiona las consultas e intereses de academia (¡Con el async y la fusión!)
    async handleConsultationWorkflow(textoRecibido, metadata) {
        let result = { text: "", step: "", isFinal: false, meta: metadata };

        if (!metadata || !metadata.step) return result;

        if (metadata.step === "ESP_CONSULTA") {
            result.meta.mensajeConsulta = textoRecibido; 
            result.meta.step = "ESP_NOMBRE";
            result.text = `📝 Anotado. ¿A nombre de quién pongo la consulta, primor?`;
        }
        else if (metadata.step === "ESP_NOMBRE" || metadata.step === "ESP_NOMBRE_INTERESADA") {
            result.meta.nombreCliente = textoRecibido;
            result.meta.step = metadata.step === "ESP_NOMBRE_INTERESADA" ? "ESP_TEL_INTERESADA" : "ESP_TELEFONO";
            result.text = `🏷️ Muy bien, **${textoRecibido}**. \n¿A qué número de **Teléfono** podemos contactarte?`;
        } 
        else if (metadata.step === "ESP_TELEFONO" || metadata.step === "ESP_TEL_INTERESADA") {
            result.meta.telefono = textoRecibido; 
            result.isFinal = true;
            
            if (metadata.step === "ESP_TEL_INTERESADA") {
                result.meta.idClase = metadata.idClase; 
                const tipoLimpio = (metadata.tipoClase || "").replace(/[🧵🧶]/g, '').trim();
                
                result.meta.tipoInteres = tipoLimpio; 
                result.meta.mensajeConsulta = `Interés en clase de ${tipoLimpio}`;
                result.text = `✅ ¡Perfecto, corazón! He anotado tu interés en la clase de **${metadata.tipoClase}**. Reyes te avisará en cuanto haya un hueco libre. ✨`;
            } else {
                result.text = `✅ ¡Perfecto! He anotado todo. Enseguida te atenderemos. ✨`;
            }
        }
        return result;
    }

    // 7. Generador de link de WhatsApp (¡Con el async, limpieza de teléfono y tickets!)
    async formatearLinkWA(telefono, nombre, mensajeBase, ticketId = "") {
        if (!telefono) return null;
        
        let telLimpio = String(telefono).replace(/[^0-9]/g, ''); 
        
        if (telLimpio.startsWith('0') && !telLimpio.startsWith('00')) {
            telLimpio = telLimpio.substring(1);
        }
        
        if (telLimpio.length === 9 && /^[67]/.test(telLimpio)) {
            telLimpio = '34' + telLimpio;
        }

        let textoFinal = mensajeBase
            .replace('{nombre}', nombre || 'cliente')
            .replace('{ticket}', ticketId || ''); 
            
        const textoWA = encodeURIComponent(textoFinal);
        return `https://wa.me/${telLimpio}?text=${textoWA}`;
    }
}

// ✨ ¡LA LÍNEA QUE LO CONECTA TODO AL WEBHOOK!
module.exports = new EscaparateService();