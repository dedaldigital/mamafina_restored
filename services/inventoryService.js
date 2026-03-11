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
}

module.exports = new InventoryService();