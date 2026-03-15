// services/orderService.js
const airtableService = require('./airtableService');

class OrderService {
    // 1. Inicia un borrador vacío en Airtable 
    async startNewOrder(chatId) {
        await airtableService.iniciarBorradorPedido(chatId);
        return "🧵 ¡Nuevo encargo! ¿Qué producto o arreglo encarga?";
    }

    // 2. Gestiona el flujo de preguntas (Detalle -> Nombre -> Teléfono -> Fecha) 
    async handleOrderWorkflow(chatId, step, text, borradorId) {
        const borrador = await airtableService.getPedidoPorId(borradorId);
        const updates = {};
        let result = { text: "", isFinal: false };

        if (step.includes("producto o arreglo")) {
            updates.Pedido_Detalle = text;
            result.text = "📝 Anotado. ¿Cuál es el **Nombre del Cliente**?";
        } else if (step.includes("nombre del cliente")) {
            updates.Nombre_Cliente = text;
            result.text = `📱 ¿Qué **Teléfono** tiene ${text}?`;
        } else if (step.includes("teléfono")) {
            updates.Telefono = text;
            result.text = "📅 ¿Para qué **Fecha de entrega** es?";
        } else if (step.includes("fecha de entrega")) {
            updates.Fecha_Entrega = text; 
            updates.Estado = "📥 Pendiente"; 

            const ticketNum = Date.now().toString().slice(-4); 
            const ticketId = `#REF-${ticketNum}`; 

            updates.ID_Pedido_Unico = ticketId;
            updates.ID_Sesion = ""; 

            result.text = `✅ *PEDIDO COMPLETADO*\n\n🎫 Código de seguimiento: **${ticketId}**`;
            result.isFinal = true;
            result.ticketId = ticketId;
            result.ticketNum = ticketNum; 
            
            result.clienteNombre = updates.Nombre_Cliente || borrador.fields.Nombre_Cliente;
            result.clienteTelefono = updates.Telefono || borrador.fields.Telefono;
        }

        // ✨ GUARDADO ÚNICO: Lo sacamos fuera del IF para que sirva para TODOS los pasos
        try {
            console.log("🚀 Enviando actualización a Airtable...");
            await airtableService.actualizarEstadoPedido(borradorId, updates);
            console.log("✅ Airtable respondió OK");
        } catch (error) {
            console.error("❌ Airtable rechazó el guardado:", error.message);
            result.text = "⚠️ ¡Ay, primor! No he podido anotar esto en Airtable. Error: " + error.message;
            result.isFinal = false; 
        }

        return result;
    }

    // 3. MENÚ DE ESTADOS: Devuelve los botones para cambiar la fase del pedido 
    async getStatusMenu(idPedido) {
        return {
            text: "¿A qué estado quieres pasar el pedido?",
            buttons: [
                [{ text: "📥 Pendiente", callback_data: `SET_ESTADO|${idPedido}|📥 Pendiente` }, { text: "🧵 En curso", callback_data: `SET_ESTADO|${idPedido}|🧵 En curso` }],
                [{ text: "✅ Terminado", callback_data: `SET_ESTADO|${idPedido}|✅ Terminado` }, { text: "🚚 Entregado", callback_data: `SET_ESTADO|${idPedido}|🚚 Entregado` }]
            ]
        };
    }

    // 4. APLICAR CAMBIO: Actualiza Airtable y genera el link de aviso si está listo 
    async updateOrderStatus(idPedido, nuevoEstado) {
        try {
            await airtableService.actualizarEstadoPedido(idPedido, nuevoEstado);
            let aviso = { text: `✅ Estado actualizado a: *${nuevoEstado}*`, button: null, extraMsg: "" };
    
            // Si el pedido está terminado, preparamos el botón de WhatsApp 
            if (nuevoEstado === "✅ Terminado") {
                const ped = await airtableService.getPedidoPorId(idPedido); 
                
                // ✨ CORRECCIÓN: Extraemos los datos reales de ped.fields
                const tel = ped.fields.Telefono;
                const nombre = ped.fields.Nombre_Cliente || "cliente";
    
                // 1. Limpieza de teléfono (usando la variable correcta)
                let telLimpio = tel ? String(tel).replace(/[^0-9]/g, '') : "";
                if (telLimpio.length === 9 && /^[67]/.test(telLimpio)) {
                    telLimpio = '34' + telLimpio;
                }
    
                // 2. Creación del mensaje y la URL
                const mensajeRespuesta = `¡Hola ${nombre}! ✨ Tu pedido está listo. ¡Estoy deseando que lo veas!`;
                const urlWA = telLimpio ? `https://wa.me/${telLimpio}?text=${encodeURIComponent(mensajeRespuesta)}` : null;
    
                // ✨ CORRECCIÓN: Guardamos el botón en el objeto aviso para que el webhook lo vea
                if (urlWA) {
                    aviso.extraMsg = `🎊 ¡Avisar a ${nombre}!`;
                    aviso.button = [[{ text: "📲 WhatsApp", url: urlWA }]];
                }
            }
            return aviso;
        } catch (e) {
            console.error("💥 Error en OrderService.updateOrderStatus:", e.message);
            return { text: "⚠️ No pude actualizar el estado en la base de datos." };
        }
    }
    // 5. LISTAR CONSULTAS: Recupera las dudas que los clientes dejaron en el buzón
    async getPendingConsultations() {
        try {
            const consultas = await airtableService.obtenerConsultasPendientes();
            if (!consultas || consultas.length === 0) {
                return { text: "✅ No hay consultas pendientes.", blocks: [] };
            }
    
            const blocks = consultas.map(r => {
                // ✨ CORRECCIÓN: Usamos las propiedades que definiste en airtableService.js
                // r.fields ya no existe aquí porque airtableService lo mapeó a r.nombre, r.duda, etc.
                const nombre = r.nombre || "Desconocido"; 
                const duda = r.duda || "Sin mensaje"; 
                const tel = r.tel || ""; // Si no hay teléfono, dejamos vacío para evitar errores
    
                // Limpiamos el teléfono para el link de WhatsApp de forma segura
                let telLimpio = tel ? String(tel).replace(/[^0-9]/g, '') : "";
                if (telLimpio.length === 9 && /^[67]/.test(telLimpio)) {
                    telLimpio = '34' + telLimpio;
                }
                // 2. Creación del mensaje pre-rellenado
                const mensajeRespuesta = `¡Hola ${nombre}! ✨ Soy Reyes, de la costura. Te escribo por la consulta que nos dejaste: "${duda}"...`;
                const urlWA = telLimpio ? `https://wa.me/${telLimpio}?text=${encodeURIComponent(mensajeRespuesta)}` : null;
       
                const buttons = [];
                if (urlWA) {
                    buttons.push([{ text: "📲 Responder WhatsApp", url: urlWA }]);
                }
                buttons.push([{ text: "✅ Cerrar Consulta", callback_data: `CERRAR_CONSULTA|${r.id}` }]);
    
                return {
                    text: `👤 **CLIENTE:** ${nombre}\n💬 **DUDA:** ${duda}\n📱 **TEL:** ${tel || "No facilitado"}`,
                    buttons: buttons
                };
            });
            return { text: "🙋‍♀️ **CONSULTAS PENDIENTES:**", blocks };
        } catch (e) { 
            console.error("💥 Error en getPendingConsultations:", e.message);
            return { text: "⚠️ Error al procesar la lista de consultas.", blocks: [] }; 
        }
    }
    // services/orderService.js

    // 6. LISTAR INTERESADOS: Clientes que han preguntado por sus pedidos hoy
    async getInterestedClients() {
        try {
            // ✨ CORRECCIÓN: El nombre real de la función
            const pedidos = await airtableService.obtenerPedidosConInteres();
            if (!pedidos || pedidos.length === 0) {
                return { text: "✅ No hay clientes esperando respuesta ahora mismo.", blocks: [] };
            }
    
            const blocks = await Promise.all(pedidos.map(async p => {
                // ✨ CORRECCIÓN: Aquí "p" ya está mapeado, no tiene ".fields"
                const nombreFinal = p.nombre || "Cliente";
                const detalle = p.detalle || "Encargo";
                const estado = p.estado || "Pendiente";
                const mensajeBase = `Hola ${nombreFinal}, soy Reyes. He visto que has preguntado por tu pedido de "${detalle}"... ✨`;
                
                let telLimpio = String(p.tel).replace(/[^0-9]/g, '');
                if (telLimpio.length === 9 && /^[67]/.test(telLimpio)) {
                    telLimpio = '34' + telLimpio;
                }
                const linkWA = `https://wa.me/${telLimpio}?text=${encodeURIComponent(mensajeBase)}`;
                
                return {
                    text: `👤 **CLIENTE:** ${nombreFinal}\n🧵 **PEDIDO:** ${detalle}\n📍 **ESTADO:** ${estado}`,
                    buttons: [[{ text: "📲 Avisar por WhatsApp", url: linkWA }]]
                };
            }));
    
            return { text: "🙋‍♂️ **CLIENTES INTERESADOS:**", blocks };
        } catch (e) {
            console.error("💥 Error en getInterestedClients:", e.message);
            return { text: "⚠️ Error al consultar la lista de interesados." };
        }
    }
    // 7. CERRAR CONSULTA: Cambia el estado en Airtable para que no aparezca más como pendiente
 
   // services/orderService.js

   async closeConsultation(idConsulta) {
        try {
            await airtableService.base(airtableService.t.consultas).update(idConsulta, {
                "Estado": "Cerrada"
            });
            return "✅ **Consulta atendida.** ¡Un hilo menos!";
        } catch (e) {
            // ESTO ES LO MÁS IMPORTANTE: Mira este log en Vercel
            console.error(`💥 ERROR AIRTABLE DETALLADO: ${e.message} | ID: [${idConsulta}]`);
            return `⚠️ Error: ${e.message}. Revisa los logs.`;
        }
    }
}
module.exports = new OrderService();