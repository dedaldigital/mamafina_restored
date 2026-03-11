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
        // 1. IMPORTANTE: Recuperamos el borrador para tener los datos guardados en pasos anteriores
        const borrador = await airtableService.getPedidoPorId(borradorId);
        
        const updates = {};
        // 2. Inicializamos el objeto result para que siempre devuelva algo válido
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
       
            const ticketId = `#REF-${Date.now().toString().slice(-4)}`;
            
            updates.Fecha_Entrega = text;
            updates.Estado = "📥 Pendiente";
            updates.ID_Pedido_Unico = ticketId; 
            updates.ID_Sesion = ""; // Cerramos el borrador
            
            result.text = `✅ *PEDIDO COMPLETADO*\n\n🎫 Código de seguimiento: **${ticketId}**`;
            result.isFinal = true;
            
            // 3. Pasamos los datos para el botón de WhatsApp del webhook
            result.ticketId = ticketId;
            // Si el nombre se acaba de escribir en este paso, lo cogemos de updates, si no, del borrador
            result.clienteNombre = updates.Nombre_Cliente || borrador.fields.Nombre_Cliente;
            result.clienteTelefono = updates.Telefono || borrador.fields.Telefono;
        }
    
        // Guardamos los cambios en Airtable
        await airtableService.actualizarPedido(borradorId, updates);
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

                // Si por lo que sea Airtable no trae el ID, usamos una alerta
                const idSeguro = c.id || "SIN_ID";
                // Importante: Usamos encodeURIComponent para que el link no se rompa
                const textoWA = encodeURIComponent(`¡Hola ${c.nombre}! Soy Reyes, te escribo por la consulta que nos dejaste... ✨`);
                const linkWA = `https://wa.me/${String(c.tel).replace(/[^0-9]/g, '')}?text=${textoWA}`;
                
                return {
                    text: `📝 **CONSULTA DE:** ${c.nombre}\n💬 "${c.duda}"\n📞 Tel: ${c.tel}`,
                    buttons: [
                        [{ text: "📲 WhatsApp Directo", url: linkWA }],
                        [{ text: "✅ Marcar como Atendida", callback_data: `CERRAR_CONSULTA|${idSeguro}` }]
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
 
   // services/orderService.js

   async closeConsultation(idConsulta) {
        try {
            // Forzamos el nombre de la tabla como texto para evitar fallos de variables
            await airtableService.base('Consultas').update(idConsulta, {
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