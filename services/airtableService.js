const Airtable = require('airtable');

class AirtableService {
    constructor() {

        this.base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);


        this.t = {
            telas: process.env.AT_TABLE_TELAS,           
            productos: process.env.AT_TABLE_PRODUCTOS,   
            inventario: process.env.AT_TABLE_INVENTARIO_MERCERIA, 
            disenos: process.env.AT_TABLE_DISENOS,       
            pedidos: process.env.AT_TABLE_PEDIDOS,       
            tasks: process.env.AT_TABLE_TASKS,           
            config: process.env.AT_TABLE_CONFIG,         
            registros: process.env.AT_TABLE_REGISTROS,
            consultas: process.env.AT_TABLE_CONSULTAS || 'Consultas' // El nombre exacto de tu pestaña
        };
    }

        async getConfigValue(clave) {
            try {
                const records = await this.base(this.t.config).select({
                    filterByFormula: `{Clave} = '${clave}'`,
                    maxRecords: 1
                }).firstPage();
                return records.length > 0 ? records[0].fields.Valor : null;
            } catch (e) { this._logError(e, 'getConfigValue'); }
        }

        // --- SECCIÓN: TAREAS ---
        async crearTarea(descripcion, prioridad = "Media") {
            try {
                return await this.base(this.t.tasks).create([{
                    fields: { "Tarea": descripcion, "Prioridad": prioridad, "Completada": false }
                }]);
            } catch (e) { this._logError(e, 'crearTarea'); }
        }


        async getTareasPendientes() {
            try {
                return await this.base(this.t.tasks).select({ filterByFormula: "{Completada} = 0" }).all();
            } catch (e) { this._logError(e, 'getTareasPendientes'); }
        }


        async completarTarea(id) {
            try {
                return await this.base(this.t.tasks).update([{ id, fields: { "Completada": true } }]);
            } catch (e) { this._logError(e, 'completarTarea'); }
        }


        async vaciarHistorialTareas() {
            try {
                const registros = await this.base(this.t.tasks).select({ filterByFormula: "{Completada} = 1" }).all();
                const ids = registros.map(r => r.id);
                if (ids.length > 0) {
                    for (let i = 0; i < ids.length; i += 10) {
                        await this.base(this.t.tasks).destroy(ids.slice(i, i + 10));
                    }
                }
                return ids.length;
            } catch (e) { this._logError(e, 'vaciarHistorialTareas'); }
        }

        async vaciarPedidosCompletados() {
            try {
                // 1. Buscamos pedidos que ya estén entregados
                const entregados = await this.base(this.t.pedidos).select({
                    filterByFormula: "{Estado} = '🚚 Entregado'"
                }).all();
        
                if (entregados.length === 0) return 0;
        
                // 2. Los borramos uno a uno (o por lotes si fueran muchos)
                for (const record of entregados) {
                    await this.base(this.t.pedidos).destroy(record.id);
                }
        
                return entregados.length;
            } catch (e) {
                this._logError(e, 'vaciarPedidosCompletados');
                return 0;
            }
        }

        // --- SECCIÓN: PEDIDOS ---
        async getPedidosActivos() {
            try {

                return await this.base(this.t.pedidos).select({

                    filterByFormula: "OR({Estado} = '📥 Pendiente', {Estado} = '🧵 En curso', {Estado} = '✅ Terminado')",
                    
                    sort: [{field: "Fecha_Entrega", direction: "asc"}]
                }).all();
            } catch (e) { this._logError(e, 'getPedidosActivos'); }
        }


        async getPedidoPorId(id) {
            try {
                return await this.base(this.t.pedidos).find(id);
            } catch (e) { this._logError(e, 'getPedidoPorId'); }
        }


        async iniciarBorradorPedido(chatId) {
            try {
                // ✨ CORRECCIÓN: Usamos [0] para devolver el registro creado, no el array
                const records = await this.base(this.t.pedidos).create([{
                    fields: { "Estado": "📝 Borrador", "ID_Sesion": String(chatId) }
                }]);
                return records[0]; 
            } catch (e) { this._logError(e, 'iniciarBorradorPedido'); }
        }

        async obtenerBorradorActivo(chatId) {
            try {
                const records = await this.base(this.t.pedidos).select({
                    filterByFormula: `AND({Estado} = '📝 Borrador', {ID_Sesion} = '${chatId}')`,
                    maxRecords: 1
                }).firstPage();
                return records.length > 0 ? records[0] : null;
            } catch (e) { this._logError(e, 'obtenerBorradorActivo'); }
        }


        async actualizarPedido(id, campos) {
            try {
                // ✨ CORRECCIÓN: Simplificamos la sintaxis para un solo registro
                return await this.base(this.t.pedidos).update(id, campos);
            } catch (e) { this._logError(e, 'actualizarPedido'); }
        }


        async cambiarEstadoPedido(id, nuevoEstado) {
            try {
                return await this.base(this.t.pedidos).update([{ id, fields: { "Estado": nuevoEstado } }]);
            } catch (e) { this._logError(e, 'cambiarEstadoPedido'); }
        }


        async cancelarBorradorPedido(chatId) {
            try {
                const borrador = await this.obtenerBorradorActivo(chatId);
                if (borrador) {
                    await this.base(this.t.pedidos).destroy(borrador.id);
                    return true;
                }
                return false;
            } catch (e) { this._logError(e, 'cancelarBorradorPedido'); }
        }

        // --- SECCIÓN: INVENTARIO Y REGISTROS ---

        // Única versión válida de crearRegistro (Sin campos automáticos)
        async crearRegistro(articulo, accion, cantidad, stockFinal, responsable = "Admin") {
            try {
                return await this.base(this.t.registros).create([{
                    fields: {
                        "Artículo": articulo,           
                        "Accion": accion,               
                        "Cantidad_Movida": parseInt(cantidad),
                        "Stock_Resultante": parseInt(stockFinal),
                    }
                }]);
            } catch (e) { this._logError(e, 'crearRegistro'); }
        }

        async crearArticuloNuevo(nombre, cantidad, unidad, categoria, responsable = "Admin") {
            try {
                const cantNumerica = parseInt(cantidad) || 0;
                const nuevoArticulo = await this.base(this.t.inventario).create([{
                    "fields": {
                        "Articulo": nombre,
                        "Stock": cantNumerica,
                        "Unidad_Medida": unidad,
                        "Categoría": categoria
                    }
                }]);

                if (this.t.registros) {
                    await this.crearRegistro(nombre, "Nuevo", cantNumerica, cantNumerica, responsable);
                }
                return nuevoArticulo[0];
            } catch (e) { this._logError(e, 'crearArticuloNuevo'); }
        }

        async buscarEnTodoElInventario(busqueda) {
            try {
                const query = busqueda.toLowerCase().trim();
                const formula = `OR(FIND("${query}", LOWER({Articulo})), FIND("${query}", LOWER({Referencia})))`;
        
                // ✨ USAMOS LOS NOMBRES EXACTOS DE TU CONSTRUCTOR: telas, productos, inventario
                const promesas = [];
        
                if (this.t.telas) {
                    promesas.push(this.base(this.t.telas).select({ filterByFormula: formula }).all()
                        .then(r => r.map(i => ({ ...i, tipo: '🧵 Tela' }))));
                }
                if (this.t.productos) {
                    promesas.push(this.base(this.t.productos).select({ filterByFormula: formula }).all()
                        .then(r => r.map(i => ({ ...i, tipo: '👗 Producto' }))));
                }
                if (this.t.inventario) { // <--- Cambiado de 'merceria' a 'inventario'
                    promesas.push(this.base(this.t.inventario).select({ filterByFormula: formula }).all()
                        .then(r => r.map(i => ({ ...i, tipo: '🔘 Mercería' }))));
                }
        
                const resultadosArrays = await Promise.all(promesas);
                return resultadosArrays.flat();
        
            } catch (e) {
                console.error("❌ Error en búsqueda global:", e.message);
                return [];
            }
        }
        async actualizarStock(idAirtable, cantidad, usuario, tablaKey = 'inventario') {
            try {
                const tablaId = this.t[tablaKey]; // Selecciona la tabla dinámica
                const record = await this.base(tablaId).find(idAirtable);
                
                const nuevoStock = (record.fields.Stock || 0) + cantidad;
                
                await this.base(tablaId).update(idAirtable, { "Stock": nuevoStock });
                
                return { nombre: record.fields.Articulo, stock: nuevoStock };
            } catch (e) {
                this._logError(e, 'actualizarStock');
                throw e;
            }
        }

        _logError(error, method) {
            console.error(`[API ERROR] ${method}:`, error.message);
            throw error;
        }


        // --- SECCIÓN: VISIÓN IA (NUEVO) ---
        async crearRegistroDesdeIA(nombre, datos) {
            try {
                let tabla = this.t.inventario; // Por defecto: Mercería 
                let campos = {
                    "Articulo": nombre,
                    "Referencia": datos.referencia || "",
                    "Stock": parseInt(datos.stock) || 0,
                    "Precio": parseFloat(datos.precio) || 0
                };
        
                // DISTINCIÓN DE TABLA SEGÚN EL TIPO DE ANÁLISIS 
                if (datos.tipo === "TELA") {
                    tabla = this.t.telas;
                    campos["Color"] = datos.Color_Principal || "";
                    campos["Estampado"] = datos.Tipo_Estampado || "";
                    campos["Prompt_Final"] = datos.prompt_final || ""; // El prompt de 35 palabras [cite: 18]
                } 
                else if (datos.tipo === "PROD") {
                    tabla = this.t.productos;
                    campos["Prompt_Final"] = datos.prompt_prod || ""; // El prompt de 3-6 palabras [cite: 18]
                }
        
                // INTEGRACIÓN DE LA FOTO (ImgBB URL) [cite: 19]
                // En Airtable, si el campo es tipo 'URL', pasamos el string. 
                // Si es 'Adjunto', enviamos un array de objetos [{url: "..."}] 
                if (datos.urlImgBB) {
                    // Ajustamos según tu configuración de tabla (usualmente "Foto")
                    campos["Foto"] = datos.urlImgBB; 
                }
        
                const record = await this.base(tabla).create([{ fields: campos }]);
                
                // REGISTRO DE AUDITORÍA: Guardamos el movimiento en la tabla de Registros 
                await this.crearRegistro(nombre, "Alta IA", campos["Stock"], campos["Stock"], "Mamassistant");
                
                return record[0];
            } catch (e) { 
                console.error("❌ Error en crearRegistroDesdeIA:", e.message);
                throw e;
            }  
        }
    // Dentro de la clase AirtableService
        async buscarTelas(termino) {
            try {
                // Limpiamos el término y lo pasamos a minúsculas
                const t = termino.toLowerCase().trim();
                
                // Esta fórmula busca la palabra dentro de los campos 'Articulo', 'Color' y 'Estampado'
                // SEARCH es más potente que FIND para estos casos [cite: 22, 27]
                const formula = `OR(
                    SEARCH("${t}", LOWER({Articulo})),
                    SEARCH("${t}", LOWER({Color})),
                    SEARCH("${t}", LOWER({Estampado}))
                )`;
        
                const records = await this.base(this.t.telas).select({
                    filterByFormula: formula
                }).all();
        
                return records;
            } catch (e) {
                this._logError(e, 'buscarTelas');
                return [];
            }
        }
        async buscarProductos(busqueda) {
            try {
                const q = busqueda.toLowerCase().trim();
                // SEARCH devuelve la posición. Si es > 0, es que hay coincidencia.
                const formula = `OR(SEARCH("${q}", LOWER({Articulo})), SEARCH("${q}", LOWER({Referencia})))`;
                return await this.base(this.t.productos).select({ filterByFormula: formula }).all();
            } catch (e) { return []; }
        }

        async crearBorradorDiseno(chatId, telaId) {
            return await this.base(this.t.disenos).create([{
                fields: {
                    "ID_Sesion": String(chatId),
                    "Tela_Relacionada": [telaId] // Enlace a TB-01
                }
            }]);
        }

        // --- DENTRO DE airtableService.js ---

        async obtenerBorradorDiseno(chatId) {
            try {
                // Buscamos en TB-04 el diseño que coincida con el chat actual
                const records = await this.base(this.t.disenos).select({
                    filterByFormula: `{ID_Sesion} = '${chatId}'`,
                    maxRecords: 1,
                    sort: [{ field: "Created", direction: "desc" }] // Opcional: traer el más reciente
                }).firstPage();

                return records.length > 0 ? records[0] : null;
            } catch (e) {
                this._logError(e, 'obtenerBorradorDiseno');
            }
        }

        async eliminarTarea(idTarea) {
            try {
                // ✨ CORRECCIÓN: Cambiamos 'tareas' por 'tasks' para que coincida con el constructor
                await this.base(this.t.tasks).destroy(idTarea);
                return true;
            } catch (e) {
                console.error("❌ Error eliminando tarea:", e.message);
                throw e;
            }
        }

        // Obtener todas las consultas de clientes

        async obtenerTodasLasConsultas() {
            try {
                const records = await this.base(this.t.consultas).select().all();
                return records.map(r => ({
                    nombre: r.fields["Nombre/ID"] || "Sin nombre",
                    tel: r.fields.Telefono || ""
                }));
            } catch (e) { return []; }
        }

        // Obtener datos de la tabla 'Consultas'
        async obtenerConsultasPendientes() {
            try {
                const records = await this.base(this.t.consultas).select({
                    filterByFormula: "{Estado} != 'Cerrada'",
                    sort: [{ field: "Created", direction: "desc" }]
                }).all();
                return records.map(r => ({
                    nombre: r.fields["Nombre/ID"] || "Sin nombre",
                    duda: r.fields.Consulta || "Sin duda",
                    tel: r.fields.Telefono || ""
                }));
            } catch (e) { return []; }
        }

        // Obtener datos de la tabla 'Pedidos_y_Clientes'
        async obtenerPedidosConInteres() {
            try {
                const records = await this.base(this.t.pedidos).select({
                    filterByFormula: "{Estado} = '🙋Cliente Interesado'"
                }).all();
                return records.map(r => ({
                    nombre: r.fields.Nombre_Cliente || "Cliente",
                    detalle: r.fields.Pedido_Detalle || "Encargo",
                    tel: r.fields.Telefono || "",
                    estado: r.fields.Estado
                }));
            } catch (e) { return []; }
        }


        async buscarTrabajosPortfolio(termino) {
            try {
                const t = termino.toLowerCase().trim();
                
                const formula = t === 'todo' 
                    ? "NOT({Foto_Final} = '')" 
                    : `OR(
                        LOWER({Categoria}) = "${t}",
                        SEARCH("${t}", LOWER({Nombre_Proyecto})),
                        SEARCH("${t}", LOWER({Keywords}))
                      )`;
        
                const records = await this.base('Trabajos_Realizados').select({
                    filterByFormula: formula,
                    maxRecords: 10,
                    sort: [{ field: "Fecha_Terminado", direction: "desc" }]
                }).all();
        
                return records.map(r => ({
                    caption: r.fields.Nombre_Proyecto || "Trabajo de Mamafina",
                    url: r.fields.Foto_Final && r.fields.Foto_Final.length > 0 ? r.fields.Foto_Final[0].url : null
                })).filter(item => item.url !== null);
        
            } catch (e) {
                console.error("💥 Error en buscarTrabajosPortfolio:", e.message);
                return [];
            }
        }


// --------------------- CLIENTE ----------------------

    async registrarProspecto(chatId, nombreTelegram) {
        try {
            return await this.base(this.t.pedidos).create([{
                fields: {
                    "ID_Sesion": String(chatId),
                    "Estado": "🙋Cliente Interesado", // Sin espacio inicial, tal cual lo pediste
                    "Pedido_Detalle": `Interés registrado por @${nombreTelegram} desde el Bot.`
                }
            }]);
        } catch (e) { 
            this._logError(e, 'registrarProspecto'); 
        }
    }

    async registrarInteresado(chatId, nombreUser) {
        try {
            return await this.base(this.t.pedidos).create([{
                fields: {
                    "ID_Sesion": String(chatId),
                    "Estado": "🙋Cliente Interesado", // 
                    "Pedido_Detalle": `Cliente @${nombreUser} pulsó el botón de WhatsApp.`
                }
            }]);
        } catch (e) { 
            console.error("💥 Error registrando interés:", e.message);
        }
    }

    async buscarPedidoPublico(telefonoRecibido) {
        try {
            const telBusqueda = String(telefonoRecibido).replace(/[^0-9]/g, '');
            const records = await this.base(this.t.pedidos).select({ maxRecords: 10 }).all();
    
            const encontrados = records.filter(r => {
                const telAirtable = String(r.fields.Telefono || "").replace(/[^0-9]/g, '');
                return telAirtable.includes(telBusqueda);
            });
    
            return encontrados.map(r => ({
                id: r.id, // <--- NECESARIO PARA EL BOTÓN
                detalle: r.fields.Pedido_Detalle || "Encargo",
                estado: r.fields.Estado || "Pendiente",
                entrega: r.fields.Fecha_Entrega || "A determinar"
            }));
        } catch (e) { return null; }
    }
    
    // NUEVA FUNCIÓN: Actualiza el estado de un pedido específico
    async actualizarEstadoPedido(idPedido, nuevoEstado) {
        try {
            return await this.base(this.t.pedidos).update(idPedido, {
                "Estado": nuevoEstado
            });
        } catch (e) { console.error("Error actualizando pedido:", e); }
    }

    async obtenerCatalogoPublico() {
        try {
            // Usamos el nombre de la tabla desde el constructor 
            const registros = await this.base(this.t.telas).select({
                maxRecords: 5,
                // Eliminamos filtros complejos para la demo y asegurar que traiga algo
                sort: [{ field: "Created", direction: "desc" }] 
            }).firstPage();
            
            console.log("📊 Telas encontradas en Airtable:", registros.length);
            return registros;
        } catch (e) { 
            console.error("💥 Error en obtenerCatalogoPublico:", e.message);
            return []; 
        }
    }

    async guardarConsultaFinal(metadata) {
        try {
            return await this.base(this.t.consultas).create([{
                fields: {
                    "Nombre/ID": metadata.nombreCliente,
                    "Telefono": metadata.telefonoCliente,
                    "Consulta": metadata.mensajeConsulta, // <--- NUEVO CAMPO
                    "ID_Sesion": String(metadata.chatId),
                    "User_Telegram": metadata.userTelegram,
                    "Estado": metadata.estado
                }
            }]);
        } catch (e) {
            console.error("💥 Error guardando consulta:", e.message);
        }
    }

    async registrarNuevaConsulta(chatId, usuario, tipo) {
        try {
            await this.base(this.t.consultas).create([{
                fields: {
                    "ID_Sesion": String(chatId),
                    "Nombre/ID": usuario || "Usuario Telegram",
                    "Consulta": `Interés detectado: ${tipo}`,
                    // 💡 IMPORTANTE: Usa aquí un estado que YA TENGAS en tu desplegable de Airtable.
                    // Si no estás segura, ponlo exactamente como esté en tu tabla (ej: "Pendiente" o "Nuevo")
                    "Estado": "Pendiente" 
                }
            }]);
            console.log("✅ Intención de contacto guardada correctamente.");
        } catch (e) {
            // Si falla por los permisos, al menos el bot no se rompe para el usuario
            console.error("⚠️ Nota: No se pudo guardar en Airtable pero el flujo sigue:", e.message);
        }
    }

    async registrarConsultaAutomatica(chatId, username, nombreCliente, telefono, detallePedido) {
        try {
            return await this.base(this.t.consultas).create([{
                fields: {
                    "ID_Sesion": String(chatId),
                    "Nombre/ID": nombreCliente || username || "Cliente Conocido",
                    "Telefono": telefono,
                    "Consulta": `Seguimiento de pedido: "${detallePedido}"`,
                    "Estado": "Pendiente",
                    "User_Telegram": username
                }
            }]);
        } catch (e) {
            console.error("💥 Error en registro automático:", e.message);
        }
    }

    async obtenerPedidoPorId(idRecord) {
        try {
            const record = await this.base(this.t.pedidos).find(idRecord);
            return {
                detalle: record.fields.Pedido_Detalle || "Encargo",
                telefono: record.fields.Telefono || "",
                nombre: record.fields.Nombre_Cliente || "Cliente" // Asegúrate de que este campo existe en Pedidos
            };
        } catch (e) {
            return { detalle: "Encargo", telefono: "", nombre: "Cliente" };
        }
    }

    // FICHA PRIVADA: Filtrado por ID de Telegram
    async obtenerFichaAlumna(chatId) {
        try {
            const records = await this.base('Alumnas_Comunidad').select({
                filterByFormula: `{Telegram_ID} = '${chatId}'`,
                maxRecords: 1
            }).firstPage();
            
            if (records.length > 0) {
                // Devolvemos el ID de la fila (rec...) + los campos
                return {
                    id: records[0].id, // <--- ESTO ES LO QUE NECESITAMOS PARA EL UPDATE
                    ...records[0].fields
                };
            }
            return null;
        } catch (e) {
            console.error("Error buscando ficha:", e.message);
            return null;
        }
    }
    // 2. CONSULTA DE CLASES: Solo las que tienen huecos
    async obtenerClasesDisponibles() {
        try {
            return await this.base('Gestion_Clases').select({
                filterByFormula: "{Huecos_Libres} > 0",
                sort: [{ field: "Nombre_Clase", direction: "asc" }]
            }).all();
        } catch (e) { return []; }
    }

    // 3. LISTA DE ESPERA: Protocolo ERR-22 para IDs cortos
    async registrarEnListaEspera(chatId, nombre, idClase) {
        try {
            return await this.base('Alumnas_Comunidad').create([{
                fields: {
                    "Telegram_ID": String(chatId),
                    "Nombre_Real": nombre,
                    "Lista_Espera": [idClase]
                }
            }]);
        } catch (e) { console.error("Error lista espera:", e.message); }
    }

    // Añadir a services/airtableService.js

    async crearFichaBasica(chatId, username) {
        try {
            return await this.base('Alumnas_Comunidad').create([{
                fields: {
                    "Telegram_ID": String(chatId), // Identificador técnico único [cite: 45, 52]
                    "User_Telegram": username || "", // Guardamos el @alias por si acaso 
                    "Nombre_Real": "Pendiente", // Se llenará en el flujo conversacional
                    "Notas_Tecnicas": "Ficha iniciada desde el Bot. ✨"
                }
            }]);
        } catch (e) {
            console.error("💥 Error en creación técnica:", e.message);
            return null;
        }
    }
}
module.exports = new AirtableService();