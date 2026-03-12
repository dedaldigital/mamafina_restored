const airtableService = require('./airtableService');

class AcademiaService {


    // MOSTRAR MENU CLASES
    async mostrarMenuClases(chatId) {
        const botones = [
            [{ text: "🧵 Clases de Costura (Individual)", callback_data: "VER_CLASES|🧵Costura" }],
            [{ text: "🧶 Clases de Crochet (Grupo)", callback_data: "VER_CLASES|🧶Crochet" }],
            [{ text: "🏠 Volver a la Academia", callback_data: "CLI_ACADEMIA" }]
        ];
        return {
            text: "¡Claro, primor! ¿Qué tipo de clase te interesa consultar hoy?",
            buttons: botones
        };
    }
    
    // HUECOS DISPONIBLES
    async listarHuecos(tipo) {
        const clases = await airtableService.base(process.env.AT_TABLE_CLASES).select({
            filterByFormula: `AND({Tipo_Clase} = '${tipo}', {Huecos_Libres} > 0)`,
            sort: [{ field: "Nombre_Clase", direction: "asc" }]
        }).all();
    
        if (clases.length === 0) {
            return { 
                text: `Ay, cielo, ahora mismo no tenemos huecos libres en **${tipo}**, pero si quieres te apunto en la lista de espera para avisarte la primera.` 
            };
        }

        const blocks = clases.map(c => ({
            text: `📍 **${c.fields.Nombre_Clase}**\n🪑 Huecos: ${c.fields.Huecos_Libres}\n📝 ${c.fields.Notas || 'Sin notas adicionales.'}`,
            buttons: [[{ text: "🙋 Me interesa este hueco", callback_data: `INT_CLASE|${c.id}|${tipo}` }]]
        }));
    
        return { text: `Estos son los huecos para **${tipo}**:`, blocks };

    }

    // GENERAR ID UNICO DE ALUMNA
    generarIDAlumna(chatId) {
        // Protocolo de IDs cortos para evitar límites [cite: 70]
        return `#ALU-${String(chatId).slice(-4)}`;
    }

    // OBTENER / CREAR FICHA
    async obtenerOcrearFicha(chatId, username) {
        let ficha = await airtableService.obtenerFichaAlumna(chatId);
        
        if (!ficha) {
            const nuevoID = this.generarIDAlumna(chatId);
            // Usamos la variable de entorno AT_TABLE_ALUMNAS mapeada en airtableService
            const records = await airtableService.base(process.env.AT_TABLE_ALUMNAS).create([{
                fields: {
                    "Telegram_ID": String(chatId),
                    "ID_Alumna_Unico": nuevoID,
                    "User_Telegram": username || "",
                    "Nombre_Real": "Pendiente"
                }
            }]);
            ficha = { id: records[0].id, ...records[0].fields };
        }
        return ficha;
    }
   
    // MAPEO DE LA FICHA DE ALUMNA
        async handleAcademiaWorkflow(chatId, step, text, recordId) {
            const updates = {};
            let result = { text: "", isFinal: false };
        
            // Mapeo de respuestas según la pregunta que hizo el bot
            if (step.includes("anote en la libreta")) {
                updates.Nombre_Real = text;
                result.text = "✅ ¡Nombre actualizado, primor! Ya aparece en tu ficha digital.";
                result.isFinal = true;
            } 
            else if (step.includes("proyecto estás trabajando")) {
                updates.Proyecto_Actual = text;
                result.text = "🧵 ¡Anotado! He actualizado el nombre de tu labor.";
                result.isFinal = true;
            }
            else if (step.includes("cuéntame los detalles")) {
                updates.Notas_Tecnicas = text;
                result.text = "📍 Notas técnicas guardadas. ¡Así no se te olvida ni un punto!";
                result.isFinal = true;
            }
            else if (step.includes("enlace/link de la web")) {
                if (text.startsWith("http")) {
                    updates.Link_Patron = text;
                    result.text = "🔗 Enlace guardado correctamente en tu ficha. ✨";
                    result.isFinal = true;
                } else {
                    result.text = "⚠️ Eso no parece un enlace, cielo. Asegúrate de que empiece por http...";
                    result.isFinal = false; // Le dejamos reintentar
                }
            }
        
            // Persistencia en Airtable usando la tabla de Alumnas (TB-11) [cite: 88, 93]
            await airtableService.actualizarEstadoPedido(recordId, updates, 'academia');
            return result;
        }
    
}
module.exports = new AcademiaService();