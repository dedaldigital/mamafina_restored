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
    
}

module.exports = new OrderService();