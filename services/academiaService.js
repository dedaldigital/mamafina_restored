const airtableService = require('./airtableService');

class AcademiaService {


    // MOSTRAR MENU CLASES CLIENTE
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

    // MOSTRAR MENU CLASES ADMIN
    async listarClasesAdmin(tipo) {
        const clases = await airtableService.base(process.env.AT_TABLE_CLASES).select({
            filterByFormula: `{Tipo_Clase} = '${tipo}'`
        }).all();
    
        const blocks = clases.map(c => {
            const huecos = c.fields.Huecos_Libres;
            const color = huecos === 0 ? "🔴" : "🟢";
            return {
                text: `${color} **${c.fields.Nombre_Clase}**\n🪑 Libres: ${huecos}\n⏰ ${c.fields.Horario || 'Sin horario'}`,
                buttons: [
                    [{ text: "👥 Ver Alumnas", callback_data: `VER_LISTA|${c.id}` }],
                    [{ text: "⏰ Cambiar Horario", callback_data: `MOD_HORA_CLASE|${c.id}` }] // <-- Nuevo botón
                ]
            };
        });
        return blocks;
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

    // GESTIONAR HORARIO CLASES

    async actualizarHorarioClase(idClase, nuevoHorario) {
        // 1. Actualizamos la tabla Gestion_Clases (TB-13)
        const claseEditada = await airtableService.base(process.env.AT_TABLE_CLASES).update(idClase, {
            "Horario": nuevoHorario
        });

        const tipo = claseEditada.fields.Tipo_Clase;
        const nombreClase = claseEditada.fields.Nombre_Clase;

        // 2. Preparamos el mensaje de aviso
        const avisoBase = `¡Hola! Soy Reyes. ✨ Te escribo porque ha habido un cambio en el horario de la clase de ${nombreClase}. El nuevo horario es: ${nuevoHorario}.`;

        // 3. Diferenciamos el destino del aviso
        if (tipo === "🧶Crochet") {
            // Para Crochet, generamos el aviso para el grupo general [cite: 61, 64]
            return {
                text: `✅ Horario actualizado para ${nombreClase}.`,
                esGrupo: true,
                linkWA: `https://wa.me/?text=${encodeURIComponent(avisoBase)}`, // Link genérico para compartir en grupo
                instrucciones: "Pulsa el botón para enviar el aviso al **Grupo de Crochet**."
            };
        } else {
            // Para Costura, buscamos a la alumna vinculada a esa clase [cite: 60]
            const alumnas = await airtableService.base(process.env.AT_TABLE_ALUMNAS).select({
                filterByFormula: `{Clase_Asignada} = '${claseEditada.fields.Nombre_Clase}'`
            }).firstPage();

            if (alumnas.length > 0) {
                const alu = alumnas[0].fields;
                const linkWA = await escaparateService.formatearLinkWA(alu.Telefono, alu.Nombre_Real, avisoBase);
                return {
                    text: `✅ Horario actualizado.`,
                    esGrupo: false,
                    nombreAlu: alu.Nombre_Real,
                    linkWA: linkWA,
                    instrucciones: `Pulsa para avisar a **${alu.Nombre_Real}** por WhatsApp.`
                };
            }
        }
        return { text: "✅ Horario actualizado (no hay alumnas asignadas para avisar)." };
    }


    // LISTAR ALUMNAS APUNTADAS (ADMIN)
    async obtenerAlumnasDeClase(idClase) {
        // 1. Obtenemos el nombre de la clase para filtrar
        const clase = await airtableService.base(process.env.AT_TABLE_CLASES).find(idClase);
        const nombreClase = clase.fields.Nombre_Clase;
    
        // 2. Buscamos en la tabla de Alumnas (TB-11) quién tiene esa clase asignada
        const alumnas = await airtableService.base(process.env.AT_TABLE_ALUMNAS).select({
            filterByFormula: `{Clase_Asignada} = '${nombreClase}'`
        }).all();
    
        if (alumnas.length === 0) {
            return { text: `No hay alumnas apuntadas en **${nombreClase}** todavía.`, blocks: [] };
        }
    
        // 3. Creamos los bloques con el botón de expulsar ❌
        const blocks = alumnas.map(alu => ({
            text: `👤 **${alu.fields.Nombre_Real}** (${alu.fields.ID_Alumna_Unico})`,
            buttons: [[{ 
                text: "❌ Desapuntar", 
                callback_data: `BORRAR_ALU|${idClase}|${alu.id}` 
            }]]
        }));
    
        return { text: `Alumnas en **${nombreClase}**:`, blocks };
    }

    // GESTIONAR ALUMNAS APUNTADAS (ADMIN)

    async desapuntarAlumna(idClase, idAlumnaRecord) {
        // 1. Obtenemos datos de la clase antes de borrar
        const clase = await airtableService.base(process.env.AT_TABLE_CLASES).find(idClase);
        const estabaLlena = clase.fields.Huecos_Libres === 0;
    
        // 2. Liberamos el hueco (Borramos el enlace en la tabla Alumnas o Clases según tu estructura)
        await airtableService.base(process.env.AT_TABLE_ALUMNAS).update(idAlumnaRecord, {
            "Clase_Asignada": null // O como se llame tu campo de relación
        });
    
        let mensaje = `✅ Alumna desapuntada con éxito.`;
    
        // 3. PROTOCOLO DE RELEVO
        if (estabaLlena) {
            // Buscamos en Consultas (TB-09) la más antigua de ese tipo de clase
            const siguiente = await airtableService.base(process.env.AT_TABLE_CONSULTAS).select({
                filterByFormula: `AND({Estado} = 'Pendiente', SEARCH('${clase.fields.Tipo_Clase}', {Consulta}))`,
                sort: [{ field: "Fecha", direction: "asc" }],
                maxRecords: 1
            }).firstPage();
    
            if (siguiente.length > 0) {
                const s = siguiente[0].fields;
                mensaje += `\n\n📢 **¡HUECO LIBRE!**\nLa siguiente interesada es: **${s.Nombre_Cliente}**.\n\n¿Quieres avisarla?`;
                
                // Generamos el link de WhatsApp automático [cite: 67, 117]
                const textoWA = `¡Hola ${s.Nombre_Cliente}! Soy Reyes de Mamafina. ✨ Se ha liberado un hueco en la clase de ${clase.fields.Nombre_Clase}. ¿Te gustaría que te apunte? 🧵`;
                const linkWA = await escaparateService.formatearLinkWA(s.Telefono, s.Nombre_Cliente, textoWA);
                
                return { text: mensaje, button: [[{ text: "📲 Avisar a la siguiente", url: linkWA }]] };
            }
        }
    
        return { text: mensaje };
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