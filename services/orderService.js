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
        const updates = {};
        let nextMsg = "";

        if (step.includes("producto o arreglo")) {
            updates.Pedido_Detalle = text;
            nextMsg = "📝 Anotado. ¿Cuál es el **Nombre del Cliente**?";
        } else if (step.includes("nombre del cliente")) {
            updates.Nombre_Cliente = text;
            nextMsg = `📱 ¿Qué **Teléfono** tiene ${text}?`;
        } else if (step.includes("teléfono")) {
            updates.Telefono = text;
            nextMsg = "📅 ¿Para qué **Fecha de entrega** es?";
        } else if (step.includes("fecha de entrega")) {
            updates.Fecha_Entrega = text;
            updates.Estado = "📥 Pendiente";
            updates.ID_Sesion = ""; // Cerramos borrador 
            nextMsg = "✅ *PEDIDO COMPLETADO*";
        }

        await airtableService.actualizarPedido(borradorId, updates);
        return nextMsg;
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
            await airtableService.cambiarEstadoPedido(idPedido, nuevoEstado); 
            let aviso = { text: `✅ Estado actualizado a: *${nuevoEstado}*`, button: null };

            // Si el pedido está terminado, preparamos el botón de WhatsApp 
            if (nuevoEstado === "✅ Terminado") {
                const ped = await airtableService.getPedidoPorId(idPedido); 
                // Usamos la función de formateo (asumiendo que está disponible o la movemos a un util)
                const link = `https://wa.me/${String(ped.fields.Telefono).replace(/[^0-9]/g, '')}?text=¡Hola! Tu pedido está listo. ✨`;
                
                aviso.extraMsg = `🎊 ¡Avisar a ${ped.fields.Nombre_Cliente}!`;
                aviso.button = [[{ text: "📲 WhatsApp", url: link }]];
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
    
            const blocks = consultas.map(c => {
                // Importante: Usamos encodeURIComponent para que el link no se rompa
                const textoWA = encodeURIComponent(`¡Hola ${c.nombre}! Soy Reyes, te escribo por la consulta que nos dejaste... ✨`);
                const linkWA = `https://wa.me/${String(c.tel).replace(/[^0-9]/g, '')}?text=${textoWA}`;
                
                return {
                    text: `📝 **CONSULTA DE:** ${c.nombre}\n💬 "${c.duda}"\n📞 Tel: ${c.tel}`,
                    buttons: [
                        [{ text: "📲 WhatsApp Directo", url: linkWA }],
                        [{ text: "✅ Marcar como Atendida", callback_data: `CERRAR_CONSULTA|${c.id}` }] // Usamos | como separador
                    ]
                };
            });
            return { text: "🙋‍♀️ **CONSULTAS PENDIENTES:**", blocks };
        } catch (e) { 
            return { text: "⚠️ Error en consultas.", blocks: [] }; 
        }
    }
    // services/orderService.js

    // 6. LISTAR INTERESADOS: Clientes que han preguntado por sus pedidos hoy
    async getInterestedClients() {
        try {
            // Buscamos en la memoria de Airtable los pedidos con estado "🙋Cliente Interesado"
            const interesados = await airtableService.obtenerPedidosConInteres();
            
            if (!interesados || interesados.length === 0) {
                return { text: "☕️ Nadie ha preguntado por pedidos hoy, jefa. ¡Tómate un respiro!", blocks: [] };
            }

            const blocks = interesados.map(p => {
                // Generamos el link de WhatsApp específico para el pedido del cliente
                const linkWA = `https://wa.me/${String(p.tel).replace(/[^0-9]/g, '')}?text=Hola ${p.nombre}, soy Reyes. He visto que has preguntado por tu pedido de "${p.detalle}"... ✨`;
                
                return {
                    text: `👤 **CLIENTE:** ${p.nombre}\n🧵 **PEDIDO:** ${p.detalle}\n📍 **ESTADO:** ${p.estado}`,
                    buttons: [[{ text: "📲 Avisar por WhatsApp", url: linkWA }]]
                };
            });

            return { text: "🙋‍♂️ **CLIENTES INTERESADOS:**", blocks };
        } catch (e) {
            console.error("💥 Error en getInterestedClients:", e.message);
            return { text: "⚠️ Error al consultar la lista de interesados." };
        }
    }

    // 7. CERRAR CONSULTA: Cambia el estado en Airtable para que no aparezca más como pendiente
    async closeConsultation(idConsulta) {
        try {
            // Usamos el servicio de Airtable para actualizar la columna "Estado" a "Cerrada"
            // Nota: Asegúrate de que en tu Airtable el valor del desplegable sea exactamente "Cerrada"
            await airtableService.base(airtableService.t.consultas).update(idConsulta, {
                "Estado": "Cerrada"
            });
            return "✅ **Consulta marcada como atendida.** ¡Un hilo menos en el costurero!";
        } catch (e) {
            console.error("💥 Error en closeConsultation:", e.message);
            return "⚠️ No pude cerrar la consulta en la base de datos, primor.";
        }
    }
    
}

module.exports = new OrderService();