const airtableService = require('./airtableService');
const imgbbService = require('./imgbbService');
const fetch = require('node-fetch');

class InventoryService {
    
    // 1. Buscador unificado en Telas, Productos y Mercería
    async searchStock(busqueda) {
        try {
            const resultados = await airtableService.buscarEnTodoElInventario(busqueda);
            
            if (!resultados || resultados.length === 0) {
                return { text: `❌ No encontré "${busqueda}" en el inventario.`, blocks: [] };
            }

            const blocks = resultados.map(r => {
                // Limpiamos el nombre de caracteres que rompen el Markdown
                const nombreLimpio = (r.fields?.Articulo || "Sin nombre").replace(/[_*`]/g, '');
                const stock = r.fields?.Stock ?? 0;
                const tipoEmoji = r.tipo || "📦";
                const referencia = r.fields?.Referencia ? `\n🆔 Ref: \`${r.fields.Referencia}\`` : "";
                
                // Simplificamos la tablaKey para que el callback_data sea corto
                const tipoSeguro = r.tipo || "";
                const tablaKey = tipoSeguro.includes('Tela') ? 'telas' : 
                                 tipoSeguro.includes('Producto') ? 'productos' : 'inventario';

                return {
                    text: `${tipoEmoji}\n📦 *${nombreLimpio}*${referencia}\n🔹 Cantidad: **${stock}**`,
                    buttons: [[{ 
                        text: "🛒 Registrar Venta", 
                        // QUITAMOS el nombre del callback_data para evitar el error de espacios
                        callback_data: `INICIAR_VENTA|${r.id}|${tablaKey}` 
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
        // Ahora data viene solo con 3 partes: "INICIAR_VENTA|ID|TABLA"
        const partes = data.split('|');
        const id = partes[1];
        const tabla = partes[2]; // <-- Antes era partes[3]

        try {
            // Buscamos el nombre real en Airtable para que el mensaje sea claro
            // Usamos el mapeo de tablas que tienes en airtableService
            const tablaId = airtableService.t[tabla];
            const registro = await airtableService.base(tablaId).find(id);
            const nombre = registro.fields.Articulo || "Artículo";

            return {
                text: `✍️ ¿Cuántas unidades vendidas de: *${nombre}*?\n\n(Responde solo el número. ID:${id}|TABLA:${tabla})`,
                forceReply: true
            };
        } catch (e) {
            console.error("💥 Error buscando nombre en prepareSale:", e.message);
            // Si falla la búsqueda, enviamos un mensaje genérico pero con los IDs correctos
            return {
                text: `✍️ ¿Cuántas unidades se han vendido?\n\n(Responde solo el número. ID:${id}|TABLA:${tabla})`,
                forceReply: true
            };
        }
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

   // 5. Gesto de flujo IA (Cuestionario Nombre > Ref)

   // Recibe el chatId, los metadatos actuales y el texto que acaba de escribir el usuario.

   async handleInventoryIAWorkflow(chatId, metadata, text) {
    const paso = metadata.step;
    const textoMinus = text.toLowerCase();
    
    // PASO: CAPTURAR NOMBRE
    if (paso === "ESPERANDO_NOMBRE") {
        metadata.nombre = text;
        metadata.step = "ESPERANDO_REFERENCIA";
        return {
            text: `🏷️ **Nombre:** ${metadata.nombre}\n¿Qué **Referencia** tiene? (Escribe 'no')\n\n(DATOS_IA: ${JSON.stringify(metadata)})`,
            type: 'reply'
        };
    } 

    // PASO: CAPTURAR REFERENCIA (O IGNORARLA)
    else if (paso === "ESPERANDO_REFERENCIA") {
        metadata.referencia = textoMinus === 'no' ? "" : text;
        metadata.step = "ESPERANDO_PRECIO";
        return {
            text: `Ref: *${metadata.referencia || 'N/A'}*\n¿Qué **Precio** tiene? (Escribe '0')\n\n(DATOS_IA: ${JSON.stringify(metadata)})`,
            type: 'reply'
        };
    }

    // PASO: CAPTURAR PRECIO
    else if (paso === "ESPERANDO_PRECIO") {
        metadata.precio = parseFloat(text.replace(',', '.')) || 0;
        metadata.step = "ESPERANDO_STOCK";
        return {
            text: `💰 Precio: *${metadata.precio}*\n¿Qué **Cantidad (Stock)** hay?\n\n(DATOS_IA: ${JSON.stringify(metadata)})`,
            type: 'reply'
        };
    }

    // PASO FINAL: CAPTURAR STOCK + SUBIR FOTO A IMGBB + GUARDAR EN AIRTABLE
    else if (paso === "ESPERANDO_STOCK") {
        metadata.stock = parseInt(text) || 0;
        metadata.step = "FINALIZADO";

        try {
            const fotoId = metadata.fotoId;
            if (fotoId) {
                const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fotoId}`);
                const fileJson = await fileRes.json();
                
                if (fileJson.ok) {
                    const urlTele = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileJson.result.file_path}`;
                    const urlFinal = await imgbbService.subirAFotoUsuario(urlTele); // [cite: 45]
                    if (urlFinal) metadata.urlImgBB = urlFinal;
                }
            }

            await airtableService.crearRegistroDesdeIA(metadata.nombre, metadata);
            const conFoto = metadata.urlImgBB ? "🖼️ ✅ Con foto" : "⚠️ Sin foto";
            
            return {
                text: `🎉 **¡Inventario Actualizado!**\n📦 ${metadata.nombre}\n${conFoto}`,
                type: 'simple'
            };
        } catch (e) {
            console.error("💥 Error en el proceso final de inventario:", e.message);
            return {
                text: "❌ Hubo un problema al guardar en el sistema, pero el registro se ha intentado procesar.",
                type: 'simple'
            };
        }
    }
}
}
module.exports = new InventoryService()
