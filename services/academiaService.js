const airtableService = require('./airtableService');
const escaparateService = require('./escaparateService');

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

    // A. MENÚ INTERMEDIO: Selección entre Apuntadas o Interesadas
    async menuGestionAlumnas(idClase) {
        try {
            const clase = await airtableService.base(process.env.AT_TABLE_CLASES).find(idClase);
            const nombre = clase.fields.Nombre_Clase;

            return {
                text: `👥 **Gestión de ${nombre}**\n\n¿Qué lista quieres consultar, jefa?`,
                buttons: [
                    [{ text: "✅ Ver Apuntadas (En clase)", callback_data: `VER_APUNTADAS|${idClase}` }],
                    [{ text: "🙋‍♀️ Ver Interesadas (Buzón)", callback_data: `VER_INTERESADAS|${idClase}` }]
                ]
            };
        } catch (e) {
            console.error("Error en menuGestionAlumnas:", e.message);
            return { text: "⚠️ No he podido abrir el menú de la clase." };
        }
    }

    // B. VER APUNTADAS: Solo las que ya tienen esta clase asignada
    async obtenerAlumnasDeClase(idClase) {
        try {
            // 1. Obtenemos el registro de la clase para saber su nombre real
            const claseDoc = await airtableService.base(airtableService.t.clases).find(idClase);
            const nombreClase = claseDoc.fields.Nombre_Clase;
    
            console.log(`👥 Buscando alumnas para la clase: ${nombreClase}`);
    
            // 2. Buscamos en la tabla de Alumnas (this.t.academia)
            // IMPORTANTE: He puesto 'Clase_Asignada' con mayúsculas. 
            // Si en tu Airtable la columna se llama distinto, cámbialo aquí.
            const alumnas = await airtableService.base(airtableService.t.academia).select({
                filterByFormula: `{Clase_Asignada} = '${nombreClase}'`
            }).all();
    
            if (alumnas.length === 0) {
                return { text: `🤷‍♀️ No hay nadie apuntado todavía en **${nombreClase}**.` };
            }
    
            const blocks = alumnas.map(a => ({
                text: `👤 **${a.fields.Nombre_Real || 'Alumna sin nombre'}**\n🧵 Proyecto: ${a.fields.Proyecto_Actual || 'Sin anotar'}\n📱 ${a.fields.Telefono || 'Sin tel.'}`,
                buttons: [[{ text: "❌ Dar de Baja", callback_data: `BORRAR_ALU|${idClase}|${a.id}` }]]
            }));
    
            return { text: `✅ **Apuntadas en ${nombreClase}:**`, blocks };
        } catch (e) {
            console.error("💥 Error en obtenerAlumnasDeClase:", e.message);
            // Si falla, el bot te dirá qué campo cree Airtable que no existe
            return { text: `⚠️ Error de configuración: Asegúrate de que en la tabla de Alumnas existe la columna 'Clase_Asignada'.` };
        }
    }

    // C. VER INTERESADAS: Consulta centralizada en Lista_Espera (TB-10)
    async obtenerInteresadasClase(idClase) {
        console.log("🚀 [ACADEMIA] Iniciando búsqueda de interesadas para ID:", idClase);
        
        try {
            // 1. Obtenemos el registro de la clase para saber su nombre real
            const claseDoc = await airtableService.base(airtableService.t.clases).find(idClase);
            const nombreClase = claseDoc.fields.Nombre_Clase || "Clase seleccionada";

            // 2. FÓRMULA DE BÚSQUEDA PROFESIONAL
            // Usamos {ID_Clase_Lookup} (texto plano) para evitar errores de vinculación. 
            const formula = `AND(
                {ID_Clase_Lookup} = '${idClase}', 
                OR({Estado} = 'Pendiente', {Estado} = 'Avisada')
            )`;

            console.log("🔍 [DEBUG] Buscando con fórmula de texto plano:", formula);

            const registros = await airtableService.base(airtableService.t.espera).select({
                filterByFormula: formula,
                sort: [{ field: "Fecha_Registro", direction: "asc" }] 
            }).all();

            console.log(`📊 [RESULTADO] Registros encontrados en Airtable: ${registros.length}`);

            if (!registros || registros.length === 0) {
                return { text: `✅ No hay interesadas con estado 'Pendiente' o 'Avisada' para la clase de **${nombreClase}**.` };
            }

            // 3. MAPEAMOS LOS BLOQUES CON LOS BOTONES DE ACCIÓN
            const blocks = await Promise.all(registros.map(async (reg) => {
                const f = reg.fields;
                
                // Usamos la función oficial de la Caja 2 para el link de WhatsApp [cite: 67]
                const mensajeWA = `¡Hola ${f.Nombre_Interesada}! ✨ Soy Reyes de Mamafina. Tengo un hueco libre en la clase de ${nombreClase}. ¿Te apunto?`;
                const linkWA = await escaparateService.formatearLinkWA(f.Telefono, f.Nombre_Interesada, mensajeWA);

                return {
                    text: `🆕 **${f.Nombre_Interesada}**\n📞 ${f.Telefono}\n📝 Estado: ${f.Estado}`,
                    buttons: [
                        [{ text: "📲 Hablar por WhatsApp", url: linkWA }],
                        [{ text: "✅ Apuntar a Clase", callback_data: `APUNTAR_ALU|${reg.id}|${idClase}` }]
                    ]
                };
            }));

            return { 
                text: `📋 **Lista de espera para ${nombreClase}:**`, 
                blocks 
            };

        } catch (e) {
            console.error("💥 [ERROR CRÍTICO] academiaService.obtenerInteresadasClase:", e.message);
            return { text: "⚠️ Error técnico al consultar la lista. Verifica las importaciones y columnas." };
        }
    }

    // MOSTRAR MENU CLASES ADMIN
    async listarClasesAdmin(tipo) {
        try {
            const tipoLimpio = tipo.replace(/[🧵🧶]/g, '').trim();
            const formula = `SEARCH('${tipoLimpio}', {Tipo_Clase})`;

            // 1. Intentamos leer la tabla
            const clases = await airtableService.base(process.env.AT_TABLE_CLASES).select({
                filterByFormula: formula
            }).all();
        
            if (!clases || clases.length === 0) {
                return [{ text: `🤷‍♀️ No he encontrado clases de **${tipoLimpio}**. Revisa que la columna 'Tipo_Clase' tenga ese valor.`, buttons: [] }];
            }

            // 2. Intentamos mapear los campos
            return clases.map(c => {
                const n = c.fields.Nombre_Clase || "Clase sin nombre";
                const h = c.fields.Huecos_Libres ?? "?";
                const horario = c.fields.Horario || 'Sin horario';

                return {
                    text: `📍 **${n}**\n🪑 Libres: ${h}\n⏰ ${horario}`,
                    buttons: [
                        [{ text: "👥 Ver Apuntadas", callback_data: `VER_APUNTADAS|${c.id}` }],
                        [{ text: "🙋‍♀️ Ver Interesadas", callback_data: `VER_INTERESADAS|${c.id}` }],
                        [{ text: "⏰ Cambiar Horario", callback_data: `MOD_HORA_CLASE|${c.id}` }]
                    ]
                };
            });
        } catch (e) {
            console.error("💥 Error en listarClasesAdmin:", e.message);
            // Si hay un error, el bot ahora TE LO DIRÁ en vez de quedarse mudo
            return [{ text: `⚠️ Error técnico: ${e.message}. Revisa que las columnas Nombre_Clase, Tipo_Clase y Huecos_Libres existan.`, buttons: [] }];
        }
    }

    // VER ALUMNAS ACTUALES DE UNA CLASE
    async obtenerAlumnasDeClase(idClase) {
        try {
            const clase = await airtableService.base(process.env.AT_TABLE_CLASES).find(idClase);
            const nombreClase = clase.fields.Nombre_Clase;

            const alumnas = await airtableService.base(process.env.AT_TABLE_ALUMNAS).select({
                filterByFormula: `{Clase_Asignada} = '${nombreClase}'`
            }).all();

            if (alumnas.length === 0) return { text: `🤷‍♀️ No hay alumnas apuntadas en **${nombreClase}**.`, blocks: [] };

            const blocks = alumnas.map(a => ({
                text: `👤 **${a.fields.Nombre_Real || 'Alumna sin nombre'}**\n🧵 Proyecto: ${a.fields.Proyecto_Actual || 'Ninguno'}`,
                buttons: [[{ text: "❌ Dar de Baja", callback_data: `BORRAR_ALU|${idClase}|${a.id}` }]]
            }));

            return { text: `👥 Alumnas en **${nombreClase}**:`, blocks };
        } catch (e) {
            console.error("Error en obtenerAlumnasDeClase:", e.message);
            return { text: "⚠️ Error al consultar la lista.", blocks: [] };
        }
    }

     // VER CLASES DISPONIBLES    
     async obtenerClasesDisponibles(tipo) {
        try {
            // Usamos SEARCH para que encuentre "Costura" dentro de "🧵Costura"
            const formula = `AND(SEARCH('${tipo}', {Tipo_Clase}), {Huecos_Libres} > 0)`;
            
            console.log("🔍 Buscando clases con fórmula:", formula);

            // ⚠️ AQUÍ ESTABA EL ERROR: Pasamos la variable 'formula' en lugar del string estricto
            const records = await airtableService.base(process.env.AT_TABLE_CLASES).select({
                filterByFormula: formula,
                sort: [{ field: "Nombre_Clase", direction: "asc" }]
            }).all();

            return records.map(r => ({
                id: r.id,
                nombre: r.fields.Nombre_Clase,
                huecos: r.fields.Huecos_Libres,
                horario: r.fields.Horario || "Consultar horario", 
                texto: `📍 **${r.fields.Nombre_Clase}**\n🪑 Huecos: ${r.fields.Huecos_Libres}`
            }));
        } catch (e) {
            console.error("💥 Error en obtenerClasesDisponibles:", e.message);
            return [];
        }
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


    // GESTIONAR ALUMNAS APUNTADAS (ADMIN)

    async desapuntarAlumna(idClase, idAlumnaRecord) {
        try {
            // 1. Obtenemos datos de la clase para saber si estaba llena
            const clase = await airtableService.base(airtableService.t.clases).find(idClase);
            const nombreClase = clase.fields.Nombre_Clase;
            const tipoClase = clase.fields.Tipo_Clase;
            const estabaLlena = (clase.fields.Huecos_Libres === 0);
    
            // 2. Quitamos la clase a la alumna (Vaciamos el campo de relación)
            await airtableService.base(airtableService.t.academia).update(idAlumnaRecord, {
                "Clase_Asignada": null 
            });
    
            let mensaje = `✅ Se ha procesado la baja en **${nombreClase}**.`;
    
            // 3. PROTOCOLO DE RELEVO: Si la clase estaba llena, buscamos a la siguiente
            if (estabaLlena) {
                const siguiente = await airtableService.base(airtableService.t.espera).select({
                    filterByFormula: `AND({Clase_Deseada} = '${idClase}', {Estado} = 'Pendiente')`,
                    sort: [{ field: "Fecha_Registro", direction: "asc" }],
                    maxRecords: 1
                }).firstPage();
    
                if (siguiente.length > 0) {
                    const s = siguiente[0].fields;
                    const textoWA = `¡Hola ${s.Nombre_Interesada}! ✨ Soy Reyes de Mamafina. Se ha liberado un hueco en la clase de ${nombreClase} que querías. ¿Te apunto? 🧵`;
                    
                    // Generamos el link de WhatsApp ya formateado [cite: 67]
                    const linkWA = await escaparateService.formatearLinkWA(s.Telefono, s.Nombre_Interesada, textoWA);
                    
                    return { 
                        text: mensaje + `\n\n📢 **¡HUECO LIBRE!**\nLa primera persona en la lista es **${s.Nombre_Interesada}**.`,
                        button: [[{ text: "📲 Avisar por WhatsApp", url: linkWA }]] 
                    };
                }
            }
    
            return { text: mensaje };
        } catch (e) {
            console.error("💥 Error en desapuntarAlumna:", e.message);
            return { text: "⚠️ Error al procesar la baja." };
        }
    }

    // GENERAR ID UNICO DE ALUMNA
    generarIDAlumna(chatId) {
        // Protocolo de IDs cortos para evitar límites [cite: 70]
        return `#ALU-${String(chatId).slice(-4)}`;
    }

    //BUSCAR ALUMNA POR SU ID
    async buscarAlumnaPorID(idUnico) {
        try {
            const records = await airtableService.base(process.env.AT_TABLE_ALUMNAS).select({
                filterByFormula: `{ID_Alumna_Unico} = '${idUnico}'`,
                maxRecords: 1
            }).firstPage();

            if (records.length > 0) {
                return { id: records[0].id, ...records[0].fields };
            }
            return null;
        } catch (e) {
            console.error("💥 Error en buscarAlumnaPorID:", e.message);
            return null;
        }
    }   

    // OBTENER / CREAR FICHA
    async obtenerOcrearFicha(chatId, username) {
        // 1. Buscamos a la alumna
        let ficha = await airtableService.obtenerFichaAlumna(chatId);        
        
        // 2. Si no existe la ficha, usamos la función nativa que ya creaste en airtableService
        if (!ficha) {
            const nuevoID = await airtableService.generarSiguienteIDAlumna();
            const records = await airtableService.crearFichaBasica(chatId, username, nuevoID);
            
            if (records && records.length > 0) {
                ficha = { id: records[0].id, ...records[0].fields };
            } else {
                throw new Error("Airtable no devolvió la ficha creada.");
            }
        }
        return ficha;
    }
   
    // MAPEO DE LA FICHA DE ALUMNA
        async handleAcademiaWorkflow(chatId, step, text, recordId) {
            console.log("🔍 [DEBUG WORKFLOW] step recibido:", step);
            try {
                const updates = {};
                let result = { text: "", isFinal: false };
                if (step.includes("anote en la libreta")) {
                    updates.Nombre_Real = text;
                    result.text = "✅ ¡Nombre actualizado, primor! Ya aparece en tu ficha digital.";
                    result.isFinal = true;
                }
                else if (step.includes("proyecto")) {
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
                        result.isFinal = false;
                    }
                }
                await airtableService.actualizarEstadoPedido(recordId, updates, 'academia');
                return result;
            } catch (e) {
                console.error("💥 Error en handleAcademiaWorkflow:", e.message);
                return { text: "⚠️ No he podido guardar ese dato. Inténtalo de nuevo.", isFinal: true };
            }
        }
        async inscribirAlumna(idInteresada, idClase) {
            try {
                const interesada = await airtableService.base(airtableService.t.espera).find(idInteresada);
                const clase = await airtableService.base(airtableService.t.clases).find(idClase);

                const nombre = interesada.fields.Nombre_Interesada;
                const telefono = interesada.fields.Telefono;
                const nombreClase = clase.fields.Nombre_Clase;

                // Buscar si ya existe una alumna con el mismo teléfono en academia
                const existentes = await airtableService.base(airtableService.t.academia).select({
                    filterByFormula: `{Telefono} = '${telefono}'`
                }).firstPage();

                let idAlumna;
                let esAlumnaExistente;

                if (existentes && existentes.length > 0) {
                    esAlumnaExistente = true;
                    idAlumna = existentes[0].fields.ID_Alumna_Unico;
                } else {
                    esAlumnaExistente = false;
                    idAlumna = await airtableService.generarSiguienteIDAlumna();
                    await airtableService.base(airtableService.t.academia).create([{
                        fields: {
                            "Nombre_Real": nombre,
                            "Telefono": telefono,
                            "Clase_Asignada": nombreClase,
                            "ID_Alumna_Unico": idAlumna
                        }
                    }]);
                }

                await airtableService.base(airtableService.t.espera).update(idInteresada, {
                    "Estado": "Inscrita"
                });

                return {
                    nombre,
                    nombreClase,
                    idAlumna,
                    telefono,
                    esAlumnaExistente
                };
            } catch (e) {
                console.error("💥 Error en inscribirAlumna:", e.message);
                throw e;
            }
        }
    }

module.exports = new AcademiaService();