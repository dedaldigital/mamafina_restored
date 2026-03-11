const airtableService = require('./airtableService');

class InventoryService {
    
    // 1. Buscador unificado en Telas, Productos y Mercería
    async searchStock(busqueda) {
        try {
            const resultados = await airtableService.buscarEnTodoElInventario(busqueda);
            
            if (!resultados || resultados.length === 0) {
                return { text: `❌ No encontré "${busqueda}" en el inventario.`, blocks: [] };
            }

            const blocks = resultados.map(r => {
                const nombre = r.fields?.Articulo || "Sin nombre";
                const stock = r.fields?.Stock ?? 0;
                const tipoEmoji = r.tipo || "📦";
                // Recuperamos tu lógica de la Referencia
                const referencia = r.fields?.Referencia ? `\n🆔 Ref: \`${r.fields.Referencia}\`` : "";
                
                const tablaKey = r.tipo.includes('Tela') ? 'telas' : 
                                r.tipo.includes('Producto') ? 'productos' : 'inventario';

                return {
                    text: `${tipoEmoji}\n📦 *${nombre}*${referencia}\n🔹 Cantidad: **${stock}**`,
                    buttons: [[{ 
                        text: "🛒 Registrar Venta", 
                        callback_data: `INICIAR_VENTA|${r.id}|${nombre}|${tablaKey}` 
                    }]]
                };
            });

            return { text: `🔍 Resultados para "${busqueda}":`, blocks };
        } catch (error) {
            console.error("💥 Error en InventoryService.searchStock:", error.message);
            return { text: "⚠️ Error al consultar el inventario.", blocks: [] };
        }
    }

    // 2. Prepara el flujo de venta (Pide la cantidad)
    async prepareSale(data) {
        const [, id, nombre, tabla] = data.split('|');
        return {
            text: `✍️ ¿Cuántas unidades vendidas de: *${nombre}*?\n\n(Responde solo el número. ID:${id}|TABLA:${tabla})`,
            forceReply: true
        };
    }

    // 3. Ejecuta la venta en Airtable (Descuento de stock)
    async executeSale(replyText, unitsText, user) {
        const matchId = replyText.match(/ID:([^|]+)/);
        const matchTabla = replyText.match(/TABLA:([^)]+)/);
        
        const idAirtable = matchId ? matchId[1].trim() : null;
        const tablaKey = matchTabla ? matchTabla[1].trim() : 'inventario';
        const unidades = parseInt(unitsText);

        if (!unidades || unidades <= 0) {
            return { success: false, text: "⚠️ Por favor, introduce un número válido mayor que 0." };
        }

        try {
            // Llamada al servicio de Airtable para restar el stock [cite: 43]
            const resultado = await airtableService.actualizarStock(idAirtable, -unidades, user, tablaKey); 
            return { 
                success: true, 
                text: `✅ **Venta registrada con éxito**\n📦 ${resultado.nombre}\n📉 Stock actual: **${resultado.stock}** unidades.` 
            };
        } catch (e) {
            console.error("💥 Error en InventoryService.executeSale:", e.message);
            return { success: false, text: "❌ Hubo un error al descontar el stock en Airtable." };
        }
    }

    // 4. Guardado final de un artículo nuevo tras elegir categoría
    async confirmProductCreation(data, user) {
        try {
            const [, nombre, cant, unidad, categoria] = data.split('|');
            
            await airtableService.crearArticuloNuevo(nombre, cant, unidad, categoria, user);
            
            return {
                success: true,
                text: `✅ **¡Producto Creado!**\n📦 *${nombre}*\n🔢 Cantidad: ${cant} ${unidad}\n🗂️ Categoría: ${categoria}`
            };
        } catch (error) {
            console.error("💥 Error en InventoryService.confirmProductCreation:", error.message);
            return {
                success: false,
                text: "⚠️ No pude guardar el producto en Airtable. Revisa los logs."
            };
        }
    }
}

module.exports = new InventoryService();