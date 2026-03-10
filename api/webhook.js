//--- IMPORTACIONES ---
const airtableService = require('../services/airtableService');
const openaiService = require('../services/openaiService');
const imgbbService = require('../services/imgbbService'); 
const geminiService = require('../services/geminiService');
const fetch = require('node-fetch');

// 🎒 LA MOCHILA (Fuera del handler)
let cacheFotos = {};

module.exports = async function handler(req, res) {
    // 1. Solo aceptamos peticiones POST desde Telegram
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        // 1. Extraemos lo que nos manda Telegram
        const { message, callback_query } = req.body;

        // Si no hay contenido útil, respondemos 200 y salimos "en paz"
        if (!message && !callback_query) return res.status(200).json({ ok: true });
        
        // 2. DEFINIMOS LAS VARIABLES (DENTRO DEL TRY)
        const chatId = message ? message.chat.id : callback_query.message.chat.id;
        const userId = message ? message.from.id : callback_query.from.id;
        const user = message ? (message.from.username || "") : (callback_query.from.username || "");

        // Usamos tu ID real que vimos en el log
        const esAdmin = (user.toLowerCase() === 'paxsurgam' || userId === 8737137125);
        

        // ---------------------------------------------------------
        // BLOQUE A: CALLBACK QUERIES (BOTONES)
        // ---------------------------------------------------------
        
        if (callback_query) {
            const data = callback_query.data;
            const messageId = callback_query.message.message_id;
            
            // Quitamos el reloj de carga en Telegram
            await responderBoton(callback_query.id);
        
            // BOTONES VISUALIZACION

            // SELECCION DE TELA
                if (data.startsWith("TELA_SEL|")) {
                    const shortId = data.split('|')[1];
                    const registrosTelas = await airtableService.base(airtableService.t.telas).select().all();
                    const tela = registrosTelas.find(r => r.id.endsWith(shortId));
                    
                if (!tela) {
                    await enviarMensajeSimple(chatId, "❌ Tela no encontrada.");
                    return res.status(200).json({ ok: true });
                }

                    // Creamos/Actualizamos el borrador en TB-04 con la tela elegida 
                    await airtableService.base(airtableService.t.disenos).create([{
                        fields: { 
                            "ID_Sesion": String(chatId), 
                            "Tela_Relacionada": [tela.id] 
                        }
                    }]);

                    await enviarMensajeConReply(chatId, `🧵 Tela elegida correctamente.\n\n¿Qué producto vamos a confeccionar?`);
                    return res.status(200).json({ ok: true });

                } // CIERRA TELA_SEL
            

                // SELECCION DE PRODUCTO
                else if (data.startsWith("PROD_SEL|")) {
                    const idProducto = data.split('|')[1];
                    try {
                        await enviarMensajeSimple(chatId, "⏳ **Extrayendo patrones y moldes...**");
                
                        const producto = await airtableService.base(airtableService.t.productos).find(idProducto);
                        const borrador = await airtableService.obtenerBorradorDiseno(chatId);
                
                        if (!producto || !borrador) throw new Error("Datos no encontrados.");
                        
                
                        // Extraemos prompts (Producto + Tela)
                        const descProdIA = producto.fields.Prompt_Final || "a plain white garment";
                        let descTelaIA = borrador.fields.Prompt_Tela_Lookup;
                
                        if (!descTelaIA && borrador.fields.Tela_Relacionada) {
                            const idTela = borrador.fields.Tela_Relacionada[0];
                            const registroTela = await airtableService.base(airtableService.t.telas).find(idTela);
                            descTelaIA = registroTela.fields.Prompt_Final;
                        }
                        descTelaIA = descTelaIA || "minimalist repeating pattern";
                
                        // 2. EL PROMPT MAESTRO "BUENO" (Sincronizado con REGEN)
                        const promptMaestro = `
                        Isolated ecommerce product photo of ${descProdIA} on a pure white (#FFFFFF) seamless background.
                        Perfect straight front view. 
                        The product is centered and fully visible.
                        Clean cutout-style product image with only the product visible.
                        On the center of the product there is a small appliqué letter "R".
                        The letter occupies about one third of the product width.
                        The letter "R" itself is a piece of fabric cut exactly in the shape of the letter.
                        The fabric is cut following the exact outline of the letter.
                        There is NO square patch.
                        There is NO rectangular patch.
                        There is NO fabric panel behind the letter.
                        The letter is made from printed fabric with this exact visual identity: ${descTelaIA}.
                        The printed pattern appears only inside the shape of the letter.
                        The letter is sewn directly onto the product with zigzag satin stitching following the outer contour of the letter.
                        Minimalist ecommerce catalog image.
                        `.trim();

                        await enviarMensajeSimple(chatId, "✨ **Mamafina está diseñando tu prenda...**");

                        const imgTmp = await openaiService.generarImagenDiseno(promptMaestro);
                        const urlF = await imgbbService.subirAFotoUsuario(imgTmp) || imgTmp;

                        await airtableService.base(airtableService.t.disenos).update(borrador.id, { 
                            "Imagen_Generada": urlF,
                            "Prompt_Final": promptMaestro // ✨ Guardamos la memoria exacta
                        });                        await enviarMensajeConBotones(chatId, "🎉 ¡Propuesta terminada!", [
                            [{ text: "🖼️ Ver Alta Res", url: urlF }],
                            [{ text: "🔄 Regenerar", callback_data: `REGEN|${borrador.id}|${idProducto}` }] // ✨ IDs unidos
                        ])
                                    } catch (e) {
                                        console.error("💥 Error en PROD_SEL:", e.message);
                                        await enviarMensajeSimple(chatId, `⚠️ Error técnico: ${e.message}`);
                                    }
                                    return res.status(200).json({ ok: true });

                    } // CIERRE PROD_SEL
          
                //BOTÓN REGENERAR IMAGEN
                else if (data.startsWith("REGEN|")) {
                    const partes = data.split('|');
                    const idBorrador = partes[1];
                    const idProd = partes[2]; 
                
                    try {
                        if (!idBorrador || !idProd) throw new Error("Faltan IDs para regenerar");
                
                        const borradorValido = await airtableService.base(airtableService.t.disenos).find(idBorrador);
                        const productoValido = await airtableService.base(airtableService.t.productos).find(idProd);
                
                        if (!borradorValido || !productoValido) throw new Error("No encontré los registros en Airtable");

                        let promptMaestro;

                        // ✨ MEJORA: Si ya existe un Prompt_Final guardado, lo usamos (Memoria perfecta)
                        if (borradorValido.fields.Prompt_Final) {
                            promptMaestro = borradorValido.fields.Prompt_Final;
                            await enviarMensajeSimple(chatId, "♻️ **Regenerando con el patrón exacto guardado...**");
                        } else {
                            // Si no está guardado, construimos el prompt de nuevo
                            const descProdIA = productoValido.fields.Prompt_Final || "a plain white garment";
                            let descTelaIA = borradorValido.fields.Prompt_Tela_Lookup;

                            if (!descTelaIA && borradorValido.fields.Tela_Relacionada) {
                                const idTela = borradorValido.fields.Tela_Relacionada[0];
                                const registroTela = await airtableService.base(airtableService.t.telas).find(idTela);
                                descTelaIA = registroTela.fields.Prompt_Final;
                            }
                            descTelaIA = descTelaIA || "minimalist repeating pattern";

                            // EL PROMPT ÍNTEGRO Y CORRECTO
                            promptMaestro = `
                            Isolated ecommerce product photo of ${descProdIA} on a pure white (#FFFFFF) seamless background.
                            Perfect straight front view. 
                            The product is centered and fully visible.
                            Clean cutout-style product image with only the product visible.
                            On the center of the product there is a small appliqué letter "R".
                            The letter occupies about one third of the product width.
                            The letter "R" itself is a piece of fabric cut exactly in the shape of the letter.
                            The fabric is cut following the exact outline of the letter.
                            There is NO square patch.
                            There is NO rectangular patch.
                            There is NO fabric panel behind the letter.
                            The letter is made from printed fabric with this exact visual identity: ${descTelaIA}.
                            The printed pattern appears only inside the shape of the letter.
                            The letter is sewn directly onto the product with zigzag satin stitching following the outer contour of the letter.
                            Minimalist ecommerce catalog image.
                            `.trim();
                            
                            await enviarMensajeSimple(chatId, "♻️ **Regenerando y guardando nuevo patrón...**");
                        }

                        const img = await openaiService.generarImagenDiseno(promptMaestro);
                        const urlF = await imgbbService.subirAFotoUsuario(img) || img;

                        await airtableService.base(airtableService.t.disenos).update(borradorValido.id, { 
                            "Imagen_Generada": urlF,
                            "Prompt_Final": promptMaestro
                        });

                        await enviarMensajeConBotones(chatId, "🔄 Diseño regenerado.", [
                            [{ text: "🖼️ Ver Alta Res", url: urlF }],
                            [{ text: "🔄 De nuevo", callback_data: `REGEN|${idBorrador}|${idProd}` }]
                        ]);
                    } catch (e) { 
                        console.error("💥 Error en REGEN:", e.message);
                        await enviarMensajeSimple(chatId, `⚠️ Error al regenerar: ${e.message}`); 
                    }
                    return res.status(200).json({ ok: true });
                    }

           // BOTONES DE FOTOS A INVENTARIO
            if (data.startsWith("FOTO_")) {
                const [tipo, uniqueId] = data.split('|');
                const fotoId = cacheFotos[uniqueId];
                
                if (!fotoId) {
                    await enviarMensajeSimple(chatId, "❌ Sesión expirada.");
                    return res.status(200).json({ ok: true }); // ✨ Cierre vital
                }

                await enviarMensajeSimple(chatId, "🔍 **Analizando imagen y patrón visual...**");

                const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fotoId}`);
                const fileJson = await fileRes.json();
                const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileJson.result.file_path}`;
                
                // ✨ INSERCIÓN ESTRATÉGICA: Si es un trabajo, saltamos el análisis de stock
                if (tipo === "FOTO_TRABAJO") {
                    await enviarMensajeSimple(chatId, "✨ **Preparando ficha para el Archivador...**");
                    const metadataInitial = { 
                        uniqueId, 
                        fotoId,
                        tipo: "TRABAJO", 
                        step: "ESP_NOMBRE_TRABAJO" 
                    };
                    await enviarMensajeConReply(chatId, `🎨 ¡Qué bonito trabajo! ¿Qué **Nombre** le ponemos a este proyecto?\n\n(DATOS_IA: ${JSON.stringify(metadataInitial)})`);
                    return res.status(200).json({ ok: true });
                }

                let promptAnalizado = "";

                if (tipo === "FOTO_TELA") {
                    await enviarMensajeSimple(chatId, "🎨 **Analizando estampado...**");
                    promptAnalizado = await openaiService.describirTela(fileUrl); // Tu función de 35 palabras
                } else if (tipo === "FOTO_PROD") {
                    await enviarMensajeSimple(chatId, "👗 **Analizando tipo de producto...**");
                    promptAnalizado = await openaiService.describirProducto(fileUrl); // Tu nueva función de 3-6 palabras
                }

                const analisis = await openaiService.analizarImagenInventario(fileUrl, tipo);
                const metadataInitial = { 
                    ...analisis, 
                    uniqueId, 
                    fotoId,
                    // Guardamos el prompt analizado en la mochila según el tipo
                    prompt_final: tipo === "FOTO_TELA" ? promptAnalizado : "",
                    prompt_prod: tipo === "FOTO_PROD" ? promptAnalizado : "",
                    tipo: tipo.replace("FOTO_", ""), 
                    step: "ESPERANDO_NOMBRE" 
                };

                
                

              
                await enviarMensajeConReply(chatId, `✅ Análisis:\n¿Qué **Nombre** le ponemos?\n\n(DATOS_IA: ${JSON.stringify(metadataInitial)})`);
                return res.status(200).json({ ok: true }); // ✨ El recibo para que Telegram no repita
            } 

            
       
            // BOTONOES DE INVENTARIO

            //Iniciar venta
            if (data.startsWith("INICIAR_VENTA|")) {
                const [, id, nombre, tabla] = data.split('|'); // Ahora recibimos 4 datos
                await enviarMensajeConReply(chatId, `✍️ ¿Cuántas unidades vendidas de: *${nombre}*?\n\n(Responde solo el número. ID:${id}|TABLA:${tabla})`);
                return res.status(200).json({ ok: true });
            }

            //Guardado final tras elegir Categoría
            else if (data.startsWith("CAT|")) {
                const [, nombre, cant, unidad, categoria] = data.split('|'); // Desempaquetamos los 4 datos
                
            
                await airtableService.crearArticuloNuevo(nombre, cant, unidad, categoria, user);
                
                // Editamos el mensaje para confirmar que se ha guardado 
                await editarMensaje(chatId, messageId, `✅ **¡Producto Creado!**\n📦 *${nombre}*\n🔢 Cantidad: ${cant} ${unidad}\n🗂️ Categoría: ${categoria}`);
                return res.status(200).json({ ok: true });
            }

            // BOTONES PEDIDOS

            //Menú de estados
            else if (data.startsWith("ESTADO_MENU|")) {
                const idPedido = data.split('|')[1];
                const botonesEstado = [
                    [{ text: "📥 Pendiente", callback_data: `SET_ESTADO|${idPedido}|📥 Pendiente` }, { text: "🧵 En curso", callback_data: `SET_ESTADO|${idPedido}|🧵 En curso` }],
                    [{ text: "✅ Terminado", callback_data: `SET_ESTADO|${idPedido}|✅ Terminado` }, { text: "🚚 Entregado", callback_data: `SET_ESTADO|${idPedido}|🚚 Entregado` }]
                ];
                await editarMensajeConBotones(chatId, messageId, "¿A qué estado quieres pasar el pedido?", botonesEstado);
                return res.status(200).json({ ok: true });
            }

            //Aplicar nuevo estado
            else if (data.startsWith("SET_ESTADO|")) {
                const [, idPedido, nuevoEstado] = data.split('|');
                await airtableService.cambiarEstadoPedido(idPedido, nuevoEstado);
                await editarMensaje(chatId, messageId, `✅ Estado actualizado a: *${nuevoEstado}*`);
                
                if (nuevoEstado === "✅ Terminado") {
                    const ped = await airtableService.getPedidoPorId(idPedido);
                    const link = await formatearLinkWA(ped.fields.Telefono, ped.fields.Nombre_Cliente, "¡Hola {nombre}! Tu pedido está listo. ✨");
                    if (link) {
                        await enviarMensajeConBotones(chatId, `🎊 ¡Avisar a ${ped.fields.Nombre_Cliente}!`, [
                            [{ text: "📲 WhatsApp", url: link }]
                            ]);
                        }

                    return res.status(200).json({ ok: true });
                }

                return res.status(200).json({ ok: true }); 

            }
    
            // BOTONES TAREAS

            //Marcar como completada
            else if (data.startsWith("EJECUTAR_BORRADO|")) {
                const idTarea = data.split('|')[1];
                await airtableService.completarTarea(idTarea);
                await editarMensaje(chatId, messageId, "✅ *¡Tarea terminada!* Archivada en el Bloc de Notas.");
                return res.status(200).json({ ok: true });
            }

            // Eliminar
            else if (data.startsWith("ELIMINAR_TAREA|")) {
                const idTarea = data.split('|')[1];
                try {
                    // Llamada al servicio con el nombre corregido
                    await airtableService.eliminarTarea(idTarea); 
                    await editarMensaje(chatId, messageId, "🗑️ *Tarea eliminada permanentemente.*");
                } catch (e) {
                    console.error("💥 Error borrando:", e.message);
                    await enviarMensajeSimple(chatId, "⚠️ No pude eliminar la tarea de la base de datos.");
                }
                return res.status(200).json({ ok: true });
            }

            // Guardar con prioridad
            else if (data.startsWith("PRIO|")) {
                const [, prioridad, tareaTexto] = data.split('|');
                await airtableService.crearTarea(tareaTexto, prioridad);
                await editarMensaje(chatId, messageId, `✅ *Tarea guardada:* ${tareaTexto} (${prioridad})`);
                return res.status(200).json({ ok: true });
            
            }

            // BOTONES GESTION DE CONSULTAS

            if (data === "ADM_VER_CONSULTAS") {
                await responderBoton(callback_query.id);
                const consultas = await airtableService.obtenerConsultasPendientes();
            
                if (!consultas || consultas.length === 0) {
                    await enviarMensajeSimple(chatId, "✅ No hay consultas pendientes. ¡Estamos al día!");
                } else {
                    for (const c of consultas) {
                        const mensaje = `📝 **CONSULTA DE:** ${c.nombre}\n` +
                                      `💬 "${c.duda}"\n` +
                                      `📞 Tel: ${c.tel}\n` +
                                      `⏰ ${c.fecha}`;
                        
                        const linkWA = await formatearLinkWA(c.tel, c.nombre, `¡Hola ${c.nombre}! Soy Reyes, te escribo por la consulta que nos dejaste... ✨`);
            
                        const botones = [
                            [{ text: "📲 WhatsApp Directo", url: linkWA }],
                            [{ text: "✅ Marcar como Atendida", callback_data: `CERRAR_CONSULTA_${c.id}` }]
                        ];
                        await enviarMensajeConBotones(chatId, mensaje, botones);
                    }
                }
                return res.status(200).json({ ok: true });
            }

            if (data === "ADM_VER_INTERESADOS") {
                await responderBoton(callback_query.id);
                const interesados = await airtableService.obtenerPedidosConInteres();
            
                if (!interesados || interesados.length === 0) {
                    await enviarMensajeSimple(chatId, "☕️ Nadie ha preguntado por pedidos hoy.");
                } else {
                    for (const p of interesados) {
                        const mensaje = `📦 **PEDIDO:** ${p.detalle}\n` +
                                      `👤 **CLIENTE:** ${p.nombre}\n` +
                                      `📍 **ESTADO:** ${p.estado}`;
                        
                        const linkWA = await formatearLinkWA(p.tel, p.nombre, `¡Hola! Soy Reyes, he visto que has preguntado por tu pedido de "${p.detalle}"...`);
            
                        await enviarMensajeConBotones(chatId, mensaje, [[{ text: "📲 Contactar", url: linkWA }]]);
                    }
                }
                return res.status(200).json({ ok: true });
            }
            
            //BOTONES CLIENTES

            // CLIENTE: HABLAR / INTERESADO
            else if (data === "CLI_INTERESADO") {
                const abierta = estaLaTiendaAbierta();
                if (abierta) {
                    const linkWA = await formatearLinkWA("636796210", "Reyes y Begoña", "¡Hola! No he podido contactar por llamada...");
                    await enviarMensajeConBotones(chatId, "¡Estamos en el taller! 🧵\n\nPuedes pasarte, hablarnos por WhatsApp o llamarnos directamente pulsando aquí:\n👉 +34636796210", [                        //[{ text: "¡Estamos en el taller! 🧵 Si quieres llámanos ahora 📞", url: linkLlamada }],
                        [{ text: "📲 WhatsApp", url: linkWA }],
                        [{ text: "🏠 Menú", callback_data: "CLI_INICIO" }]
                    ]);
                    
                } else {
                    const meta = { step: "ESP_CONSULTA", chatId, userTelegram: user };
                    await enviarMensajeConReply(chatId, `✨ Taller cerrado.\n¿Qué necesitas consultar?\n\n(DATOS_IA: ${JSON.stringify(meta)})`);
                }
                return res.status(200).json({ ok: true });
            }

            // VOLVER AL INICIO
            else if (data === "CLI_INICIO") {
                const abierta = estaLaTiendaAbierta();
                const botones = obtenerBotonesMenuPrincipal();
                await enviarMensajeConBotones(chatId, "¡Dime, primor! ¿En qué más te ayudo? 🧵", botones);
                return res.status(200).json({ ok: true });
            }

            if (data === "CLI_HORARIO") {
                await responderBoton(callback_query.id);
                
                const abierta = estaLaTiendaAbierta();
                let mensajeEstado, botonesHorario;
            
                if (abierta) {
                    mensajeEstado = "¡Estamos en el taller! 🧵\n\nPuedes pasarte, hablarnos por WhatsApp o llamarnos directamente pulsando aquí:\n👉 +34636796210";
                    
                    // Generamos el link de WhatsApp genérico
                    const linkWA = await formatearLinkWA("636796210", "Reyes y Begoña", "¡Hola! He visto que estáis abiertas y tengo una duda... 🧵");
                    
                    botonesHorario = [
                    
                        [{ text: "📲 Hablar por WhatsApp ahora", url: linkWA }],
                        [{ text: "🏠 Volver al Menú", callback_data: "CLI_INICIO" }]
                    ];
                } else {
                    mensajeEstado = "😴 **Ahora mismo el taller está cerrado.** Estamos descansando para coser con más ganas mañana.";
                    botonesHorario = [
                        [{ text: "🙋 Dejar una consulta ahora", callback_data: "CLI_INTERESADO" }],
                        [{ text: "🏠 Volver al Menú", callback_data: "CLI_INICIO" }]
                    ];
                }
            
                const mensajeCompleto = `${mensajeEstado}\n\n` +
                    `📍 **Nuestro horario es:**\n` +
                    `• **Lun, Mar, Jue y Vie:** 10:00h - 14:00h y 17:00h - 20:00h\n` +
                    `• **Miércoles y Sábados:** 10:00h - 14:00h\n` +
                    `• **Domingos:** Cerrado 🧵`;
            
                await enviarMensajeConBotones(chatId, mensajeCompleto, botonesHorario);
                return res.status(200).json({ ok: true });
            }

            // CONSULTAR ESTADO DE PEDIDO 
            else if (data === "CLI_ESTADO") {
                await enviarMensajeConReply(chatId, "🔎 Por favor, escribe tu número de **Teléfono** para buscar tu pedido:");
                return res.status(200).json({ ok: true });
            }

            // CATÁLOGO DE TELAS 
            else if (data === "CLI_TELAS") {
                await responderBoton(callback_query.id);
                const mensaje = "✨ *¡Bienvenida a nuestro baúl de labores!*\n\nAquí puedes ver fotos de los trabajos que hemos terminado en el taller. ¿Qué te gustaría cotillear hoy, corazón?";
                
                const botones = [
                    [{ text: "👗 Ropa", callback_data: "VER_TRABAJOS|ropa" }, { text: "👜 Bolsos", callback_data: "VER_TRABAJOS|bolsos" }],
                    [{ text: "👶 Bebés", callback_data: "VER_TRABAJOS|bebes" }, { text: "✨ Otros", callback_data: "VER_TRABAJOS|otros" }],
                    [{ text: "🌈 Ver Todo", callback_data: "VER_TRABAJOS|todo" }],
                    [{ text: "⬅️ Volver al Menú Principal", callback_data: "CLI_INICIO" }] // RETORNO GARANTIZADO
                ];
                
                await enviarMensajeConBotones(chatId, mensaje, botones);
                return res.status(200).json({ ok: true });
            }

            //CATÁLOGO DE TRABAJOS 

            else if (data.startsWith("VER_TRABAJOS|")) {
                const categoria = data.split('|')[1];
                await responderBoton(callback_query.id);
                
                const trabajos = await airtableService.buscarTrabajosPortfolio(categoria);
                
                if (trabajos.length === 0) {
                    const mensajeVacio = `¡Ay! Pues de *${categoria}* no tengo fotos ahora mismo, pero seguro que podemos hacer algo precioso.`;
                    const botonesRetorno = [[{ text: "⬅️ Volver", callback_data: "CLI_TELAS" }]];
                    await enviarMensajeConBotones(chatId, mensajeVacio, botonesRetorno);
                } else {
                    // Preparamos el álbum (MediaGroup)
                    const mediaGroup = trabajos.map(t => ({
                        type: 'photo',
                        media: t.url,
                        caption: t.caption
                    }));
            
                    // Enviamos las fotos
                    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMediaGroup`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, media: mediaGroup })
                    });
                    
                    // MENSAJE DE CIERRE CON BOTÓN DE RETORNO
                    // Esto es vital para que el usuario pueda seguir navegando después de ver las fotos
                    const mensajeCierre = "Espero que te gusten, cielo. ✨\n¿Quieres ver algo más o prefieres volver al inicio?";
                    const botonesCierre = [
                        [{ text: "🔍 Ver otra categoría", callback_data: "CLI_TELAS" }],
                        [{ text: "🏠 Volver al Inicio", callback_data: "CLI_INICIO" }]
                    ];
                    
                    await enviarMensajeConBotones(chatId, mensajeCierre, botonesCierre);
                }
                return res.status(200).json({ ok: true });
            }

            if (data.startsWith("CAT_TRAB|")) {
                const [, categoria, uniqueId] = data.split('|');
                const metaRaw = cacheFotos[uniqueId + "_meta"];
                
                if (!metaRaw) {
                    await enviarMensajeSimple(chatId, "❌ La sesión ha expirado, por favor sube la foto de nuevo.");
                    return res.status(200).json({ ok: true });
                }
            
                const metadata = JSON.parse(metaRaw);
                await editarMensaje(chatId, callback_query.message.message_id, `⏳ Procesando imagen para la categoría *${categoria}*...`);
            
                try {
                    // 1. Descargar de Telegram y subir a ImgBB para tener URL permanente
                    const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${metadata.fotoId}`);
                    const fileJson = await fileRes.json();
                    const urlTele = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileJson.result.file_path}`;
                    
                    const urlFinal = await imgbbService.subirAFotoUsuario(urlTele);
            
                    // 2. Crear el registro en la nueva tabla de Airtable
                    await airtableService.base('Trabajos_Realizados').create([{
                        fields: {
                            "Nombre_Proyecto": metadata.nombre,
                            "Categoria": categoria,
                            "Foto_Final": [{ url: urlFinal }] // Airtable acepta objetos con URL en campos de adjunto
                        }
                    }]);
            
                    await enviarMensajeSimple(chatId, `✅ **¡Proyecto archivado con éxito!**\n🌟 *${metadata.nombre}* ya está disponible en el catálogo de *${categoria}* para los clientes.`);
                    
                    // Limpiamos caché
                    delete cacheFotos[uniqueId + "_meta"];
            
                } catch (e) {
                    console.error("💥 Error guardando trabajo:", e.message);
                    await enviarMensajeSimple(chatId, "❌ Hubo un problema al guardar la foto en el archivador.");
                }
                return res.status(200).json({ ok: true });
            }

            // PEDIDO ESPECÍFICO (INTERÉS)

            else if (data.startsWith("INT_PEDIDO_")) {
                const idPedido = data.replace("INT_PEDIDO_", "");
                const abierta = estaLaTiendaAbierta();
                const pedidoData = await airtableService.obtenerPedidoPorId(idPedido);
            
                if (abierta) {
                    await airtableService.actualizarEstadoPedido(idPedido, "🙋Cliente Interesado");
                    const linkWA = await formatearLinkWA("636796210", "Reyes y Begoña", `Hola! Soy cliente y quería consultar sobre mi pedido: ${pedidoData.detalle}`);
                    await enviarMensajeConBotones(chatId, "✅ ¡Genial! Pulsa aquí para hablar con nosotras:", [[{ text: "📲 WhatsApp", url: linkWA }]]);
                } else {
                    await airtableService.actualizarEstadoPedido(idPedido, "🙋Cliente Interesado");
                    await airtableService.registrarConsultaAutomatica(chatId, user, pedidoData.nombre, pedidoData.telefono, pedidoData.detalle);
                    await enviarMensajeConBotones(chatId, `¡Hola! Taller cerrado 😴. He dejado una nota automática.\n\nMañana te diremos algo. ✨`, [[{ text: "🏠 Menú Principal", callback_data: "CLI_INICIO" }]]);
                }
                return res.status(200).json({ ok: true });
            }

            // --- MÓDULO ACADEMIA ---

            // A. Menú Principal de Academia
            if (data === "CLI_ACADEMIA") {
                const botones = [
                    [{ text: "📝 Actualizar mi Labor", callback_data: "ACAD_UPDATE_LABOR" }],
                    [{ text: "📝 Gestionar mi Ficha", callback_data: "ACAD_GESTION_FICHA" }],                    [{ text: "📅 Ver Clases y Huecos", callback_data: "ACAD_VER_CLASES" }], // Añadido para consistencia
                    [{ text: "🧶 Grupo Clases Crochet", url: "https://chat.whatsapp.com/C5ZLwuNwAMWCh4MGZBI7RY" }],
                    [{ text: "🏠 Volver al Inicio", callback_data: "CLI_INICIO" }]
                ];
                
                await editarMensajeConBotones(chatId, messageId, 
                    "¡Qué alegría verte por aquí, primor! ✨ ¿Quieres mirar tus notas de costura, actualizar tu labor o unirte a nuestros grupos?", 
                    botones);
                return res.status(200).json({ ok: true });
            }

            // Iniciador del cuestionario
            else if (data === "ACAD_UPDATE_LABOR") {
                const meta = { step: "ACAD_ESP_PROYECTO", chatId };
                await enviarMensajeConReply(chatId, `✨ ¡Perfecto! Vamos a actualizar tu ficha.\n\n¿En qué **Proyecto** estás trabajando ahora?\n\n(DATOS_IA: ${JSON.stringify(meta)})`);
            }

            // --- GESTIÓN DE FICHA (ESTRATEGIA DEMO: CREACIÓN + PANEL) ---
            if (data === "ACAD_MI_FICHA" || data === "ACAD_GESTION_FICHA") {
                try {
                    // 1. Buscamos si ya tiene ficha en la tabla Alumnas_Comunidad
                    let ficha = await airtableService.obtenerFichaAlumna(chatId);
                    let mensajeStatus = "";

                    // 2. CREACIÓN SILENCIOSA: Si no existe, la creamos con datos básicos
                    if (!ficha) {
                        await airtableService.crearFichaBasica(chatId, user);
                        mensajeStatus = "✨ **¡Ficha del Costurero Creada!**\n\nBienvenida a la academia, primor. Todavía no tengo tus datos anotados en mi libreta.\n\nUsa los botones de abajo para completar tu perfil a tu ritmo. 👇";
                    } else {
                        // 3. RECUPERACIÓN: Mostramos lo que tenemos en Airtable
                        mensajeStatus = `📓 **TU FICHA DE ALUMNA**\n\n` +
                                        `👤 **Nombre:** ${ficha.Nombre_Real || '⚠️ Pendiente'}\n` +
                                        `🧵 **Proyecto:** ${ficha.Proyecto_Actual || 'Sin anotar'}\n` +
                                        `📍 **Notas:** ${ficha.Notas_Tecnicas || 'Sin notas'}\n\n` +
                                        `¿Qué quieres actualizar hoy, cielo?`;
                    }

                    // 4. PANEL DE BOTONES: Acciones directas para la alumna
                    const botonesGestion = [
                        [{ text: "👤 Cambiar mi Nombre", callback_data: "MOD_NOMBRE" }],
                        [{ text: "🧵 Actualizar Proyecto", callback_data: "MOD_PROYECTO" }],
                        [{ text: "📸 Subir Foto de Avance", callback_data: "ACAD_UPDATE_LABOR" }],
                        [{ text: "🏠 Volver a la Academia", callback_data: "CLI_ACADEMIA" }]
                    ];

                    // Editamos el mensaje actual para que la navegación sea fluida
                    await editarMensajeConBotones(chatId, messageId, mensajeStatus, botonesGestion);

                } catch (e) {
                    console.error("💥 Error Crítico en Gestión Ficha:", e.message);
                    await enviarMensajeSimple(chatId, "❌ He tenido un tropezón al abrir tu ficha. ¡Inténtalo de nuevo en un momento, primor!");
                }
                
                // IMPORTANTE: Liberamos el reloj de arena de Telegram
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }
                    
            
            // C. Ver Clases y Lista de Espera
            else if (data === "ACAD_VER_CLASES") {
                const clases = await airtableService.obtenerClasesDisponibles();
                
                if (clases.length === 0) {
                    await enviarMensajeSimple(chatId, "Ahora mismo todas las clases están completas, pero si quieres puedes apuntarte a la lista de espera y te aviso si alguien falla. ✨");
                } else {
                    for (const c of clases) {
                        const txt = `🎓 **${c.fields.Nombre_Clase}**\n🪑 Huecos: ${c.fields.Huecos_Libres}`;
                        const btn = [[{ text: "🙋 Me interesa", callback_data: `WAIT|${c.id.slice(-5)}` }]]; // ID Corto 
                        await enviarMensajeConBotones(chatId, txt, btn);
                    }
                }

                
            }
            if (data === "ACAD_MI_FICHA" || data === "ACAD_GESTION_FICHA") {              try {
                    let ficha = await airtableService.obtenerFichaAlumna(chatId);
                    let mensajeStatus = "📓 **Tu Ficha de Alumna**\n\n";
            
                    if (!ficha) {
                        // Creación silenciosa si no existe
                        await airtableService.crearFichaBasica(chatId, user);
                        mensajeStatus = "✨ **¡Ficha creada con éxito!**\n\nTodavía no te conozco bien, primor. Pulsa los botones de abajo para completar tu perfil.";
                    } else {
                        mensajeStatus += `👤 **Nombre:** ${ficha.Nombre_Real || 'Pendiente'}\n` +
                                        `🧵 **Proyecto:** ${ficha.Proyecto_Actual || 'Sin anotar'}\n` +
                                        `📍 **Notas:** ${ficha.Notas_Tecnicas || 'Sin notas'}`;
                    }
            
                    const botonesGestion = [
                        [{ text: "👤 Cambiar mi Nombre", callback_data: "MOD_NOMBRE" }],
                        [{ text: "🧵 Actualizar Proyecto", callback_data: "MOD_PROYECTO" }],
                        [{ text: "📸 Subir Foto de Avance", callback_data: "MOD_FOTO" }],
                        [{ text: "⬅️ Volver", callback_data: "CLI_ACADEMIA" }]
                    ];
            
                    await editarMensajeConBotones(chatId, messageId, mensajeStatus, botonesGestion);
            
                } catch (e) {
                    console.error("Error gestionando ficha:", e.message);
                    await enviarMensajeSimple(chatId, "❌ He tenido un tropezón con la libreta. Prueba en un momento.");
                }
                
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }
            
            await responderBoton(callback_query.id);
            return res.status(200).json({ ok: true })

            

        } //CIERRE CALLBACK QUERY
        

        // ---------------------------------------------------------
        // BLOQUE B: RECEPCIÓN DE FOTOS
        // ---------------------------------------------------------
        
        if (message && message.photo) {

            // FLUJO DE ADMIN
            if (esAdmin) {
                const fotoFull = message.photo[message.photo.length - 1];
                const uniqueId = fotoFull.file_unique_id;
                cacheFotos[uniqueId] = fotoFull.file_id;

                const botones = [
                    [{ text: "🧵 Tela", callback_data: `FOTO_TELA|${uniqueId}` }],
                    [{ text: "👗 Producto", callback_data: `FOTO_PROD|${uniqueId}` }],
                    [{ text: "✨ Trabajo Realizado", callback_data: `FOTO_TRABAJO|${uniqueId}` }], // NUEVA OPCIÓN
                    [{ text: "🔘 Mercería", callback_data: `FOTO_MERC|${uniqueId}` }]
                ];
                await enviarMensajeConBotones(chatId, "📸 ¿Dónde guardamos esta imagen?", botones);
            
            } 

            // --- FLUJO B: ALUMNA (Diario de Labores) --- 
            else {
                // Verificamos si la foto es una respuesta al paso de "FOTO_AVANCE"
                if (message.reply_to_message) {
                    const replyText = message.reply_to_message.text;
                    const metadata = extraerMetadata(replyText); // Función helper ya definida

                    if (metadata.step === "ACAD_ESP_NOMBRE_REAL") {
                        const nombreHumano = textoRecibido;
                        const ficha = await airtableService.obtenerFichaAlumna(chatId);
                        
                        if (ficha) {
                            await airtableService.base('Alumnas_Comunidad').update(ficha.id, {
                                "Nombre_Real": nombreHumano // Ahora escribimos en la columna limpia
                            });
                        }
                    
                        metadata.step = "ACAD_ESP_PROYECTO";
                        await enviarMensajeConReply(chatId, 
                            `✅ ¡Encantada, **${nombreHumano}**! Ya estás bien anotada.\n\nAhora cuéntame, ¿en qué **Proyecto** estás trabajando? 🧵\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                        return res.status(200).json({ ok: true });
                    }

                    if (metadata && metadata.step === "ACAD_ESP_FOTO") {
                        await enviarMensajeSimple(chatId, "⏳ **Guardando tu avance en el costurero digital...**");

                        try {
                            // 1. Obtener URL de Telegram
                            const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fotoFull.file_id}`);
                            const fileJson = await fileRes.json();
                            const urlTele = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileJson.result.file_path}`;

                            // 2. Subida Crítica a ImgBB para URL permanente [cite: 19]
                            const urlFinal = await imgbbService.subirAFotoUsuario(urlTele);

                            // 3. Persistencia en Airtable (TB-11) [cite: 12]
                            const fichaExistente = await airtableService.obtenerFichaAlumna(chatId);
                            const campos = {
                                "Telegram_ID": String(chatId),
                                "Proyecto_Actual": metadata.proyecto,
                                "Notas_Tecnicas": metadata.notas,
                                "Foto": urlFinal // Asegúrate de que el campo en Airtable se llame 'Foto' o 'Adjunto' 
                            };

                            if (fichaExistente) {
                                // Si ya tiene ficha, actualizamos sus notas y foto 
                                await airtableService.base('Alumnas_Comunidad').update(fichaExistente.id, campos);
                            } else {
                                // Si es nueva, creamos su primer registro 
                                await airtableService.base('Alumnas_Comunidad').create([{ fields: campos }]);
                            }

                            await enviarMensajeSimple(chatId, `✅ **¡Todo guardado, primor!**\n\nHe anotado tu avance en *${metadata.proyecto}* con la aguja ${metadata.notas}. ¡Va a quedar precioso! ✨`);
                        } catch (e) {
                            console.error("💥 Error en guardado de alumna:", e.message);
                            await enviarMensajeSimple(chatId, "⚠️ ¡Ay, cielo! He podido anotar tus notas pero la foto se me ha escapado. No te preocupes, lo importante es el avance.");
                        }
                    }
                } else {
                    // Si una alumna envía una foto sin estar en el flujo, la IA responde con cortesía
                    const respuestaIA = await openaiService.generarRespuesta("He recibido una foto de una alumna fuera de flujo.");
                    await enviarMensajeSimple(chatId, "¡Qué foto más bonita, corazón! Si quieres que la guarde en tu ficha de clase, pulsa primero en **🎓 Clases** -> **📝 Actualizar mi Labor**.");
                }
            }

            return res.status(200).json({ ok: true }); // Pararrayos activado [cite: 43]
        }//CIERRE BLOQUE DE FOTOS


        
        // ---------------------------------------------------------
        // BLOQUE C: RECEPCIÓN DE MENSAJES DE TEXTO
        // ---------------------------------------------------------
        
        
        if (message && message.text) {
            const textoRecibido = message.text;
            const textoMinus = textoRecibido.toLowerCase();
            const esRespuesta = !!message.reply_to_message;
            
            //COMANDO GLOBAL DE CANCELACIÓN PARA TODO EL MUNDO
            if (textoMinus === "cancelar") {
                try { await airtableService.cancelarBorradorPedido(chatId); } catch (e) {}
                await enviarMensajeSimple(chatId, "❌ Operación cancelada.");
                return res.status(200).json({ ok: true });
            }

            // FLUJO DE ADMIN

            if (esAdmin) {

                // COMANDO SALUDO/MENU ADMIN
                if (textoMinus === "/start" || textoMinus === "hola" || textoMinus === "menú") {
                    await enviarMensajeSimple(chatId, "👋 **¡Hola Jefa!**\n\n" +
                        "📦 *pedidos* - Ver activos\n" +
                        "🙋‍♀️ */consultas* - Dudas clientes\n" +
                        "📋 *tareas* - Bloc de notas\n" +
                        "🔎 *stock [nombre]* - Inventario");
                    return res.status(200).json({ ok: true });
                }
                // RESPUESTAS
                if (esRespuesta) {
                    const replyText = message.reply_to_message.text;
                    const rTextLower = replyText.toLowerCase();
                
                    // RESPUESTAS INVENTARIO

                    // Búsqueda directa
                    if (rTextLower.includes("artículo buscas en el inventario")) {
                        const busqueda = textoRecibido.trim();
                        // Avisamos que estamos buscando para dar feedback visual
                        await enviarMensajeSimple(chatId, `🔍 Buscando "${busqueda}"...`);
                        
                        const resultados = await airtableService.buscarEnTodoElInventario(busqueda);
                        
                        if (!resultados || resultados.length === 0) {
                            await enviarMensajeSimple(chatId, `❌ No encontré "${busqueda}" en el inventario.`);
                        } else {
                            for (const r of resultados) {
                                const nombre = r.fields?.Articulo || "Sin nombre";
                                const stock = r.fields?.Stock ?? 0;
                                const tipoEmoji = r.tipo || "📦";
                                const tablaKey = r.tipo.includes('Tela') ? 'telas' : 
                                                r.tipo.includes('Producto') ? 'productos' : 'inventario';

                                const txt = `${tipoEmoji}\n📦 *${nombre}*\n🔹 Cantidad: **${stock}**`;

                                await enviarMensajeConBotones(chatId, txt, [[{ 
                                    text: "🛒 Registrar Venta", 
                                    callback_data: `INICIAR_VENTA|${r.id}|${nombre}|${tablaKey}` 
                                }]]);
                            }
                        }
                        return res.status(200).json({ ok: true }); // ✅ Cierre vital para romper el bucle
                    }
                
                    // VISUALIZAR

                    // Elegimos tela
                    if (rTextLower.includes("tela buscamos")) {
                        const telas = await airtableService.buscarTelas(textoRecibido.trim());
                        for (const t of telas) {
                            await enviarMensajeConBotones(chatId, `🧵 *Tela:* ${t.fields.Articulo}`, [[{ text: "✨ Elegir", callback_data: `TELA_SEL|${t.id.slice(-5)}` }]]);
                        }
                        return res.status(200).json({ ok: true });
                    }
                
                    // Elegimos producto
                    if (rTextLower.includes("producto vamos a confeccionar")) {
                        const productos = await airtableService.buscarProductos(textoRecibido.trim());
                        for (const p of productos) {
                            await enviarMensajeConBotones(chatId, `👗 *Producto:* ${p.fields.Articulo}`, [[{ text: "✨ Elegir", callback_data: `PROD_SEL|${p.id}` }]]);
                        }
                        return res.status(200).json({ ok: true });
                    }
                
                    // PEDIDOS 

                    // Pasos para borrador activo
                    const borradorPedido = await airtableService.obtenerBorradorActivo(chatId);

                    if (borradorPedido && borradorPedido.id) {
                        const rText = replyText.toLowerCase();

                        // PASO 1: DETALLE DEL PEDIDO
                        if (rText.includes("producto o arreglo encarga")) {
                            await airtableService.actualizarPedido(borradorPedido.id, { "Pedido_Detalle": textoRecibido });
                            await enviarMensajeConReply(chatId, "📝 Anotado. ¿Cuál es el **Nombre del Cliente**?");
                            return res.status(200).json({ ok: true });
                        }
                        // PASO 2: NOMBRE DEL CLIENTE
                        else if (rText.includes("nombre del cliente")) {
                            await airtableService.actualizarPedido(borradorPedido.id, { "Nombre_Cliente": textoRecibido });
                            await enviarMensajeConReply(chatId, `📱 ¿Qué **Teléfono** tiene ${textoRecibido}?`);
                            return res.status(200).json({ ok: true });
                        }
                        // PASO 3: TELÉFONO (Detecta varias formas de preguntar)
                        else if (rText.includes("teléfono") || rText.includes("móvil") || rText.includes("contacto")) {
                            await airtableService.actualizarPedido(borradorPedido.id, { "Telefono": textoRecibido });
                            await enviarMensajeConReply(chatId, "📅 ¿Para qué **Fecha de entrega** es?");
                            return res.status(200).json({ ok: true });
                        }
                        // PASO 4: FECHA DE ENTREGA (Cierre del pedido)
                        else if (rText.includes("fecha de entrega") || rText.includes("cuándo lo entregamos")) {
                            await airtableService.actualizarPedido(borradorPedido.id, { 
                                "Fecha_Entrega": textoRecibido, 
                                "Estado": "📥 Pendiente", 
                                "ID_Sesion": "" // Importante: Cerramos el borrador aquí
                            });
                            await enviarMensajeSimple(chatId, `✅ *PEDIDO COMPLETADO*\n👤 Cliente: ${borradorPedido.fields.Nombre_Cliente || 'Nuevo'}\n🧵 Detalle: ${borradorPedido.fields.Pedido_Detalle || 'Consultar'}`);
                            return res.status(200).json({ ok: true });
                        }
                    }

                    // Metadatos
    
                    const metadata = extraerMetadata(replyText);
                    if (metadata && metadata.step) {
                        const paso = metadata.step;
                    
                        // --- 1. PASO NUEVO: CORREGIR/AÑADIR NOMBRE REAL ---
                        if (metadata && metadata.step) {
                            const paso = metadata.step;
                            const textoMinus = textoRecibido.toLowerCase(); // Definimos esto por seguridad
                        
                            // --- PASO: CAPTURAR NOMBRE REAL ---
                            if (paso === "ACAD_ESP_NOMBRE_REAL") {
                                try {
                                    const nombreHumano = textoRecibido.trim();
                                    const ficha = await airtableService.obtenerFichaAlumna(chatId);
                                    
                                    if (ficha && ficha.id) {
                                        // Actualizamos la fila usando el ID interno (rec...)
                                        await airtableService.base('Alumnas_Comunidad').update(ficha.id, {
                                            "Nombre_Real": nombreHumano 
                                        });
                        
                                        // Preparamos el siguiente paso en los metadatos
                                        metadata.step = "ACAD_ESP_PROYECTO";
                                        metadata.nombreReal = nombreHumano;
                        
                                        await enviarMensajeConReply(chatId, 
                                            `✅ ¡Perfecto, **${nombreHumano}**! Ya estás en la libretita.\n\n¿En qué **Proyecto** estás trabajando hoy? 🧵\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                                    } else {
                                        // Si la ficha no existe (raro), la creamos de cero con el nombre
                                        await airtableService.base('Alumnas_Comunidad').create([{
                                            fields: {
                                                "Telegram_ID": String(chatId),
                                                "Nombre_Real": nombreHumano,
                                                "Notas_Tecnicas": "Alta directa."
                                            }
                                        }]);
                                        metadata.step = "ACAD_ESP_PROYECTO";
                                        await enviarMensajeConReply(chatId, `✅ ¡Anotada, **${nombreHumano}**! ¿En qué **Proyecto** estamos? 🧵\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                                    }
                                } catch (e) {
                                    console.error("💥 Error en paso NOMBRE_REAL:", e.message);
                                    await enviarMensajeSimple(chatId, "❌ He tenido un tropezón al guardar tu nombre. ¡Inténtalo de nuevo, primor!");
                                }
                                return res.status(200).json({ ok: true });
                            }
                        
                            // --- PASO: CAPTURAR PROYECTO ---
                            else if (paso === "ACAD_ESP_PROYECTO") {
                                metadata.proyecto = textoRecibido;
                                metadata.step = "ACAD_ESP_TECNICO";
                        
                                await enviarMensajeConReply(chatId, 
                                    `🧵 ¡Qué bien suena! **${textoRecibido}**.\n\n¿Qué **Número de Aguja** estás usando?\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                                return res.status(200).json({ ok: true });
                            }
                        }
                        // --- TUS PASOS EXISTENTES DE INVENTARIO Y TRABAJOS ---
                        if (paso === "ESP_NOMBRE_TRABAJO") {
                            metadata.nombre = textoRecibido;
                            metadata.step = "ESP_CATEGORIA_TRABAJO";
                            
                            const botonesCat = [
                                [{ text: "👗 Ropa", callback_data: `CAT_TRAB|Ropa|${metadata.uniqueId}` }, 
                                { text: "👜 Bolsos", callback_data: `CAT_TRAB|Bolsos|${metadata.uniqueId}` }],
                                [{ text: "👶 Bebes", callback_data: `CAT_TRAB|Bebes|${metadata.uniqueId}` }, 
                                { text: "✨ Otros", callback_data: `CAT_TRAB|Otros|${metadata.uniqueId}` }]
                            ];
                    
                            cacheFotos[metadata.uniqueId + "_meta"] = JSON.stringify(metadata);
                    
                            await enviarMensajeConBotones(chatId, `Perfecto: "${metadata.nombre}". ¿En qué categoría lo guardamos?`, botonesCat);
                            return res.status(200).json({ ok: true });
                        }

                        if (paso === "ESPERANDO_NOMBRE") {
                            metadata.nombre = textoRecibido;
                            metadata.step = "ESPERANDO_REFERENCIA";
                            await enviarMensajeConReply(chatId, `🏷️ **Nombre:** ${metadata.nombre}\n¿Qué **Referencia** tiene? (Escribe 'no')\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                            return res.status(200).json({ ok: true }); // ✨ AÑADIDO: Cierre de paso
                        } 
                        else if (paso === "ESPERANDO_REFERENCIA") {
                            metadata.referencia = textoMinus === 'no' ? "" : textoRecibido;
                            metadata.step = "ESPERANDO_PRECIO";
                            await enviarMensajeConReply(chatId, `Ref: *${metadata.referencia || 'N/A'}*\n¿Qué **Precio** tiene? (Escribe '0')\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                            return res.status(200).json({ ok: true }); // ✨ AÑADIDO: Cierre de paso
                        }
                        else if (paso === "ESPERANDO_PRECIO") {
                            metadata.precio = parseFloat(textoRecibido.replace(',', '.')) || 0;
                            metadata.step = "ESPERANDO_STOCK";
                            await enviarMensajeConReply(chatId, `💰 Precio: *${metadata.precio}*\n¿Qué **Cantidad (Stock)** hay?\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                            return res.status(200).json({ ok: true }); // ✨ AÑADIDO: Cierre de paso
                        }
                    }

                        


                        // Guardado
                        else if (paso === "ESPERANDO_STOCK") { 
                            metadata.stock = parseInt(textoRecibido) || 0;
                            metadata.step = "FINALIZADO";
                            
                            await enviarMensajeSimple(chatId, "⏳ **Guardando en el inventario...**");
                            
                            try {
                                const fotoId = metadata.fotoId; 
                                if (fotoId) {
                                    // 1. Recuperamos el archivo de Telegram
                                    const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fotoId}`);
                                    const fileJson = await fileRes.json();
                                    
                                    if (fileJson.ok) {
                                        const urlTele = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileJson.result.file_path}`;
                                        
                                        // 2. Subida Crítica a ImgBB 
                                        const urlFinal = await imgbbService.subirAFotoUsuario(urlTele);
                                        
                                        if (urlFinal) {
                                            metadata.urlImgBB = urlFinal; // Se guarda en metadata para Airtable
                                            console.log("📸 URL Generada con éxito:", urlFinal);
                                        }
                                    }
                                }
                        
                                // 3. Llamada al servicio con los metadatos completos 
                                // Se ejecuta fuera del 'if (fotoId)' pero dentro del 'try' principal
                                await airtableService.crearRegistroDesdeIA(metadata.nombre, metadata);
                                
                                const conFoto = metadata.urlImgBB ? "🖼️ ✅ Con foto" : "⚠️ Sin foto";
                                await enviarMensajeSimple(chatId, `🎉 **¡Inventario Actualizado!**\n📦 ${metadata.nombre}\n${conFoto}`);
                        
                            } catch (e) {
                                console.error("💥 Error en el proceso final:", e.message);
                                await enviarMensajeSimple(chatId, "❌ Hubo un problema al guardar en el sistema, pero el registro se ha intentado procesar.");
                            }
                        
                            return res.status(200).json({ ok: true }); // Cierre del pararrayos 
                        }

                        if (metadata && metadata.step) {
                            if (metadata.step === "ACAD_ESP_PROYECTO") {
                                metadata.proyecto = textoRecibido;
                                metadata.step = "ACAD_ESP_TECNICO";
                                await enviarMensajeConReply(chatId, `🧵 ¡Qué bonito! ¿Y qué **Número de Aguja** o ganchillo estás usando?\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                            }
                            else if (metadata.step === "ACAD_ESP_TECNICO") {
                                metadata.notas = textoRecibido;
                                
                                await enviarMensajeSimple(chatId, "⏳ Guardando tus avances en el costurero digital...");
                                
                                // Buscamos si ya existe la alumna para actualizar o crear
                                const fichaExistente = await airtableService.obtenerFichaAlumna(chatId);
                                
                                const campos = {
                                    "Telegram_ID": String(chatId),
                                    "Proyecto_Actual": metadata.proyecto,
                                    "Notas_Tecnicas": `Aguja: ${metadata.notas}`
                                };
                        
                                if (fichaExistente) {
                                    await airtableService.base('Alumnas_Comunidad').update(fichaExistente.id, campos);
                                } else {
                                    await airtableService.base('Alumnas_Comunidad').create([{ fields: campos }]);
                                }
                        
                                await enviarMensajeSimple(chatId, `✅ ¡Listo, cariño! Ya he anotado tu avance en *${metadata.proyecto}*. Cuando quieras recordarlo, solo tienes que pedírmelo. ✨`);
                            }

                            if (metadata.step === "ACAD_ESP_TECNICO") {
                                metadata.notas = textoRecibido;
                                metadata.step = "ACAD_ESP_FOTO"; // Nuevo paso
                                
                                await enviarMensajeConReply(chatId, 
                                    `📸 ¡Anotado! **Aguja: ${metadata.notas}**.\n\nPara terminar, ¿me envías una **foto de cómo va tu labor**? Me encanta ver vuestros progresos. ✨\n\n(Escribe 'no' si prefieres no enviarla ahora).\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                                return res.status(200).json({ ok: true });
                        }
                    }
                        // RESPUESTAS DE TAREA

                        // RESPUESTAS DE TAREA
                        else if (replyText.includes("Escribe la descripción de la tarea")) {
                            const botonesPrio = [[{ text: "🔴 Alta", callback_data: `Alta|${textoRecibido}` }, { text: "🟡 Media", callback_data: `Media|${textoRecibido}` }, { text: "🟢 Baja", callback_data: `Baja|${textoRecibido}` }]];
                            await enviarMensajeConBotones(chatId, `¿Qué prioridad le damos a: "${textoRecibido}"?`, botonesPrio);
                            return res.status(200).json({ ok: true });
                        }

                        // ✨ NUEVO: RESPUESTAS DE VENTA (Aquí estaba el agujero)
                        else if (replyText.includes("¿Cuántas unidades vendidas de:")) {
                            // Extraemos los datos ocultos en el mensaje (ID y TABLA)
                            const matchId = replyText.match(/ID:([^|]+)/);
                            const matchTabla = replyText.match(/TABLA:([^)]+)/);
                            
                            const idAirtable = matchId ? matchId[1].trim() : null;
                            const tablaKey = matchTabla ? matchTabla[1].trim() : 'inventario';
                            const unidades = parseInt(textoRecibido);

                            if (!unidades || unidades <= 0) {
                                await enviarMensajeSimple(chatId, "⚠️ Por favor, introduce un número válido mayor que 0.");
                                return res.status(200).json({ ok: true });
                            }

                            try {
                                await enviarMensajeSimple(chatId, "⏳ Actualizando stock...");
                                // Descontamos las unidades en Airtable
                                const resultado = await airtableService.actualizarStock(idAirtable, -unidades, user, tablaKey); 
                                await enviarMensajeSimple(chatId, `✅ **Venta registrada con éxito**\n📦 ${resultado.nombre}\n📉 Stock actual: **${resultado.stock}** unidades.`);
                            } catch (e) {
                                console.error("💥 Error registrando venta:", e.message);
                                await enviarMensajeSimple(chatId, "❌ Hubo un error al descontar el stock en Airtable.");
                            }
                            return res.status(200).json({ ok: true }); 
                        }

                    }//CIERRE ESRESPUESTAS
                   
 

                // ---------------------------------------------------------
                // BLOQUE D: COMANDOS DIRECTOS
                // ---------------------------------------------------------
                
                
                /// WHATSAPP DIRECTO UNIVERSAL (Pedidos + Consultas)
                if (textoMinus.startsWith("wa:")) {
                    const nombreBusqueda = textoRecibido.split(":")[1]?.trim();
                    if (!nombreBusqueda) {
                        await enviarMensajeSimple(chatId, "⚠️ Indica un nombre. Ej: `wa:Maria`.");
                        return res.status(200).json({ ok: true });
                    }

                    // Buscamos primero en Pedidos
                    const pedidos = await airtableService.getPedidosActivos();
                    let persona = pedidos.find(p => 
                        p.fields.Nombre_Cliente && 
                        p.fields.Nombre_Cliente.toLowerCase().includes(nombreBusqueda.toLowerCase())
                    );

                    let fuente = "Pedido";
                    let nombreFinal, telefonoFinal;

                    // Si no hay pedido, buscamos en la nueva tabla de Consultas
                    if (!persona) {
                        const consultas = await airtableService.obtenerConsultasPendientes(); // Usamos la que ya creamos
                        persona = consultas.find(c => 
                            c.nombre && c.nombre.toLowerCase().includes(nombreBusqueda.toLowerCase())
                        );
                        
                        if (persona) {
                            fuente = "Consulta";
                            nombreFinal = persona.nombre;
                            telefonoFinal = persona.tel;
                        }
                    } else {
                        nombreFinal = persona.fields.Nombre_Cliente;
                        telefonoFinal = persona.fields.Telefono;
                    }

                    // Si encontramos a alguien (en cualquier tabla), generamos el link
                    if (persona) {
                        const link = await formatearLinkWA(
                            telefonoFinal, 
                            nombreFinal, 
                            `¡Hola ${nombreFinal}! Te escribo de la costura por tu ${fuente.toLowerCase()}... ✨`
                        );
                        
                        await enviarMensajeConBotones(chatId, `📲 WhatsApp para ${nombreFinal} (${fuente}):`, [
                            [{ text: "Abrir Chat", url: link }]
                        ]);
                    } else {
                        await enviarMensajeSimple(chatId, `❌ No encontré a "${nombreBusqueda}" ni en Pedidos ni en Consultas.`);
                    }
                    
                    return res.status(200).json({ ok: true });
                }

                //COMANDO VISUALIZAR
                if (textoMinus.startsWith("/visualizar")) {
                    // IMPORTANTE: El texto debe coincidir con el del paso anterior
                    await enviarMensajeConReply(chatId, "🎨 **Laboratorio Mamafina**\n¿Qué tela buscamos?");
                    return res.status(200).json({ ok: true });
                }
              
                // COMANDOS DE INVENTARIO


                // COMANDO STOCK / INVENTARIO 
                if (textoMinus.includes("stock") || textoMinus.includes("inventario")) {
                    const busq = textoMinus.replace(/stock|inventario|de/gi, "").trim();
                    
                    if (!busq) {
                        
                        await enviarMensajeConReply(chatId, "🔍 ¿Qué artículo buscas en el inventario?");
                        return res.status(200).json({ ok: true });
                    }

                    try {
                        const resultados = await airtableService.buscarEnTodoElInventario(busq);
                        
                        if (!resultados || resultados.length === 0) {
                            await enviarMensajeSimple(chatId, `❌ No he encontrado "${busq}" en el inventario.`);
                        } else {

                            for (const r of resultados) {

                                // Definimos variables para devolver el mensaje
                                const nombre = r.fields?.Articulo || "Sin nombre";
                                const stock = r.fields?.Stock ?? 0;
                                const tipoEmoji = r.tipo || "📦";
                                const referencia = r.fields?.Referencia ? `\n🆔 Ref: \`${r.fields.Referencia}\`` : "";
                                const txt = `${tipoEmoji}\n📦 *${nombre}*${referencia}\n🔹 Cantidad: **${stock}**`;
                                const tablaKey = r.tipo.includes('Tela') ? 'telas' : 
                                                r.tipo.includes('Producto') ? 'productos' : 'inventario';

                                // Registrar venta
                                await enviarMensajeConBotones(chatId, txt, [[{ 
                                    text: "🛒 Registrar Venta", 
                                    callback_data: `INICIAR_VENTA|${r.id}|${nombre}|${tablaKey}` 
                                }]]);
                            }
                        }
                    } catch (error) {

                        console.error("💥 Error en comando stock:", error.message);
                        await enviarMensajeSimple(chatId, "⚠️ Error al consultar el inventario.");
                    }

                    return res.status(200).json({ ok: true });

                }

                // COMANDO AÑADIR ARTÍCULO MANUALMENTE

                else if (textoMinus.includes("añadir artículo") || textoMinus.includes("nuevo producto")) {
                    // Inicializamos la mochila de datos con el primer paso
                    const metadataManual = { 
                        step: "ESPERANDO_NOMBRE", 
                        tipo: "MERC", // Por defecto a Mercería, luego se puede ajustar
                        precio: 0,
                        stock: 0,
                        referencia: ""
                    };
                    
                    await enviarMensajeConReply(chatId, `🆕 **Entrada Manual de Inventario**\n¿Cuál es el **Nombre** del artículo?\n\n(DATOS_IA: ${JSON.stringify(metadataManual)})`);
                    return res.status(200).json({ ok: true });
                }

                // COMANDOS PARA PEDIDOS

                //Nuevo pedido
                if (/^pedido\s*:/i.test(textoRecibido)) {
                    const detalle = textoRecibido.replace(/^pedido\s*:\s*/i, "").trim();
                    
                    if (!detalle) {
                        
                        await airtableService.iniciarBorradorPedido(chatId);
                        await enviarMensajeConReply(chatId, "🧵 ¡Nuevo encargo! ¿Qué producto o arreglo encarga?");
                        return res.status(200).json({ ok: true });
                    }
                    
                    const nuevoP = await airtableService.iniciarBorradorPedido(chatId);
                    if (nuevoP && nuevoP.id) {
                        await airtableService.actualizarPedido(nuevoP.id, { "Pedido_Detalle": detalle });
                        await enviarMensajeConReply(chatId, `🧵 Entendido: *${detalle}*.\n¿Cuál es el **Nombre del Cliente**?`);
                    } else {
                        await enviarMensajeSimple(chatId, "❌ No pude iniciar el borrador en Airtable.");
                    }
                    return res.status(200).json({ ok: true });
                }

                //Ver lista de pedidos
                if (textoMinus === "pedidos") {
                    const peds = await airtableService.getPedidosActivos(); // 
                    if (!peds || peds.length === 0) {
                        await enviarMensajeSimple(chatId, "✅ No hay pedidos activos.");
                    } else {
                        for (const p of peds) {
                            await enviarMensajeConBotones(chatId, 
                                `📦 *${p.fields.Nombre_Cliente}*\n🧵 ${p.fields.Pedido_Detalle}`, 
                                [[{ text: "🔄 Estado", callback_data: `ESTADO_MENU|${p.id}` }]]
                            );
                        }
                    }
                    return res.status(200).json({ ok: true });
                }

                 // COMANDOS PARA TAREAS

                //Nueva tarea
                else if (textoMinus.startsWith("tarea:")) {
                    const cont = textoRecibido.replace(/tarea:/i, "").trim();
                    const btnsT = [[
                        { text: "🔴 Alta", callback_data: `PRIO|Alta|${cont}` },
                        { text: "🟡 Media", callback_data: `PRIO|Media|${cont}` },
                        { text: "🟢 Baja", callback_data: `PRIO|Baja|${cont}` }
                    ]];
                    await enviarMensajeConBotones(chatId, `¿Qué prioridad le damos a: "${cont}"?`, btnsT);
                    return res.status(200).json({ ok: true });
                }

                // Tareas pendientes
                
                else if (textoMinus.includes("tareas") || textoMinus.includes("pendientes")) {
                    const tareas = await airtableService.getTareasPendientes();
                    if (!tareas || tareas.length === 0) {
                        await enviarMensajeSimple(chatId, "✅ No hay tareas pendientes.");
                    } else {
                        await enviarMensajeSimple(chatId, "📋 *TAREAS PENDIENTES:*");
                        for (const t of tareas) {
                            const p = t.fields.Prioridad || "Media";
                            const emoji = p === "Alta" ? "🔴" : (p === "Baja" ? "🟢" : "🟡");
                            
                            const botones = [[
                                { text: "✅ Terminar", callback_data: `EJECUTAR_BORRADO|${t.id}` },
                                { text: "🗑️ Eliminar", callback_data: `ELIMINAR_TAREA|${t.id}` }
                            ]];
                            
                            await enviarMensajeConBotones(chatId, `${emoji} *[${p}]* ${t.fields.Tarea}`, botones);
                        }
                    }
                    return res.status(200).json({ ok: true });
                }
                
                // COMANDOS DE PURGA
                if (textoMinus === "/purgar" || textoMinus === "limpiar todo") {
                    const nTareas = await airtableService.vaciarHistorialTareas();
                    const nPedidos = await airtableService.vaciarPedidosCompletados();
                    await enviarMensajeSimple(chatId, `✨ **¡Taller reluciente!**\n🗑️ Tareas borradas: ${nTareas}\n📦 Pedidos archivados: ${nPedidos}`);
                    return res.status(200).json({ ok: true });
                }

                // COMANDOS PARA GESTIONAR LA CLIENTELA

                // comando /consultas (Ver consultas pendientes)
                if (textoMinus === "/consultas") {
                    const consultas = await airtableService.obtenerConsultasPendientes();
                    if (consultas.length === 0) await enviarMensajeSimple(chatId, "✅ No hay consultas nuevas.");
                    else {
                        for (const c of consultas) {
                            const linkWA = await formatearLinkWA(c.tel, c.nombre, `¡Hola ${c.nombre}! Soy Reyes...`);
                            await enviarMensajeConBotones(chatId, `👤 **${c.nombre}**\n❓ "${c.duda}"\n📞 ${c.tel}`, [[{ text: "📲 Responder por WhatsApp", url: linkWA }]]);
                        }
                    }
                    return res.status(200).json({ ok: true });
                }

                // Comando: /interesados (Ver quién ha preguntado por su pedido)
                if (textoMinus === "/interesados") {
                    const interesados = await airtableService.obtenerPedidosConInteres();
                    if (interesados.length === 0) await enviarMensajeSimple(chatId, "☕️ Nadie ha preguntado por pedidos hoy.");
                    else {
                        for (const p of interesados) {
                            const linkWA = await formatearLinkWA(p.tel, p.nombre, `Hola ${p.nombre}, he visto que has preguntado por tu pedido de "${p.detalle}"...`);
                            await enviarMensajeConBotones(chatId, `👤 **${p.nombre}**\n🧵 Pedido: ${p.detalle}`, [[{ text: "📲 Avisar por WhatsApp", url: linkWA }]]);
                        }
                    }
                    return res.status(200).json({ ok: true });
                }
               // Si es un Admin y escribe algo que no reconoce, la IA responde (cajón de sastre)
               if (!esRespuesta && !textoMinus.startsWith("/")) {
                const respuestaIA = await openaiService.generarRespuesta(textoRecibido);
                await enviarMensajeSimple(chatId, respuestaIA);
                return res.status(200).json({ ok: true });
                }
                
                return res.status(200).json({ ok: true });
            } //CIERRE ESADMIN

            // FLUJO DE CLIENTES

            else { 


                const textoRecibido = message.text || "";
                const textoMinus = textoRecibido.toLowerCase();
                const replyText = message.reply_to_message ? message.reply_to_message.text : "";
            
                // 0. Interceptor de Metadata (Flujo Consulta: Mensaje -> Nombre -> Teléfono)
                const metadata = extraerMetadata(replyText); 

                if (metadata && metadata.step) {
                    // PASO 1: RECIBIMOS LA CONSULTA -> PEDIMOS NOMBRE
                    if (metadata.step === "ESP_CONSULTA") {
                        metadata.mensajeConsulta = textoRecibido;
                        metadata.step = "ESP_NOMBRE";
                        await enviarMensajeConReply(chatId, `📝 Anotado. ¿A nombre de quién pongo la consulta, primor?\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                        return res.status(200).json({ ok: true });
                    }
                    // PASO 2: RECIBIMOS NOMBRE -> PEDIMOS TELÉFONO
                    else if (metadata.step === "ESP_NOMBRE") {
                        metadata.nombreCliente = textoRecibido;
                        metadata.step = "ESP_TELEFONO";
                        await enviarMensajeConReply(chatId, `🏷️ Muy bien, **${textoRecibido}**. \n¿A qué número de **Teléfono** podemos contactarte?\n\n(DATOS_IA: ${JSON.stringify(metadata)})`);
                        return res.status(200).json({ ok: true });
                    }
                    // PASO 3: RECIBIMOS TELÉFONO -> GUARDADO FINAL
                    else if (metadata.step === "ESP_TELEFONO") {
                        metadata.telefonoCliente = textoRecibido;
                        const abierta = estaLaTiendaAbierta();
                        metadata.estado = abierta ? "WhatsApp Abierto" : "Pendiente";

                        await enviarMensajeSimple(chatId, "⏳ Guardando todo en el libro de hilos...");
                        await airtableService.guardarConsultaFinal(metadata);

                        if (abierta) {
                            const linkWA = await formatearLinkWA("636796210", metadata.nombreCliente, `¡Hola! Soy ${metadata.nombreCliente}. Os escribo por la consulta: "${metadata.mensajeConsulta}"`);
                            await enviarMensajeConBotones(chatId, `✅ ¡Hecho! Ya podéis hablar por aquí:`, [
                                [{ text: "📲 WhatsApp Directo", url: linkWA }],
                                [{ text: "🏠 Menú Principal", callback_data: "CLI_INICIO" }]
                            ]);
                        } else {
                            await enviarMensajeConBotones(chatId, `✅ ¡Anotado, ${metadata.nombreCliente}! Mañana Reyes o Begoña te responderán al ${metadata.telefonoCliente} sobre tu duda. ✨`, [
                                [{ text: "🏠 Volver al Menú", callback_data: "CLI_INICIO" }]
                            ]);
                        }
                        return res.status(200).json({ ok: true });
                    }
                }
            
                // 1. PRIORIDAD: Interceptor de Teléfono (Búsqueda de Pedidos)
                const esRespuesta = !!message.reply_to_message;
                const esRespuestaAlTelefono = esRespuesta && 
                    (message.reply_to_message.text.includes("escribe tu número de Teléfono") || 
                     message.reply_to_message.text.includes("Teléfono"));
            
                if (esRespuestaAlTelefono) {
                    const numLimpio = textoRecibido.replace(/\s+/g, ''); 
                    await enviarMensajeSimple(chatId, "🔍 Buscando tus encargos por separado...");
                    const pedidos = await airtableService.buscarPedidoPublico(numLimpio);
            
                    if (pedidos && pedidos.length > 0) {
                        for (const [index, p] of pedidos.entries()) {
                            const mensajeIndividual = `🧵 **Encargo #${index + 1}**\n📦 **Detalle:** ${p.detalle}\n📌 **Estado:** ${p.estado}\n📅 **Entrega:** ${p.entrega}`;
                            const botonesIndividuales = [[{ text: "🙋 ¡Me interesa este!", callback_data: `INT_PEDIDO_${p.id}` }]];
                            await enviarMensajeConBotones(chatId, mensajeIndividual, botonesIndividuales);
                        }
                        await enviarMensajeSimple(chatId, "✨ Pulsa el botón del pedido que quieras consultar o actualizar.");
                    } else {
                        await enviarMensajeSimple(chatId, "😔 No encuentro ningún pedido con ese número, primor.");
                    }
                    await enviarMensajeConBotones(chatId, "✨ ¿Quieres consultar algo más?", [[{ text: "🏠 Volver al Menú", callback_data: "CLI_INICIO" }]]);
                    return res.status(200).json({ ok: true }); 
                }
            
                // NUEVO: Interceptor de IA para el ARCHIVADOR VISUAL
                const palabrasClave = ['foto', 'ver', 'enseña', 'muestra', 'ejemplo', 'trabajo', 'hecho'];
                const pareceBusqueda = palabrasClave.some(p => textoMinus.includes(p));

                if (pareceBusqueda) {
                    const intencion = await openaiService.detectarIntencionPortfolio(textoMinus);
                    
                    if (intencion !== "nada") {
                        await enviarMensajeSimple(chatId, `✨ ¡Claro que sí, primor! Busco ahora mismo mis trabajos de *${intencion}*...`);
                        const trabajos = await airtableService.buscarTrabajosPortfolio(intencion);

                        if (trabajos && trabajos.length > 0) {
                            const mediaGroup = trabajos.map(t => ({
                                type: 'photo', media: t.url, caption: t.caption
                            }));

                            await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMediaGroup`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ chat_id: chatId, media: mediaGroup })
                            });

                            const botonesCierre = [
                                [{ text: "🔍 Ver otra categoría", callback_data: "CLI_TELAS" }],
                                [{ text: "🏠 Volver al Inicio", callback_data: "CLI_INICIO" }]
                            ];
                            await enviarMensajeConBotones(chatId, "Espero que te gusten, corazón. ¿Quieres ver algo más?", botonesCierre);
                            return res.status(200).json({ ok: true });
                        }
                    }
                }
              
                // SALUDO PRINCIPAL
                
                else if (textoMinus === "/start" || textoMinus === "hola") {
                    const botones = obtenerBotonesMenuPrincipal();
                    const bienvenida = "¡Hola, primor! Soy Mamassistant, la ayudante de Mamafina. 🧵 ¿En qué puedo ayudarte hoy?";
                    
                    await enviarMensajeConBotones(chatId, bienvenida, botones);
                    return res.status(200).json({ ok: true }); 
                }
            
                // 3. ÚLTIMA OPCIÓN: IA
                else {
                    const respuestaIA = await openaiService.generarRespuesta(textoRecibido);
                    await enviarMensajeSimple(chatId, respuestaIA);
                    return res.status(200).json({ ok: true }); 
                }
            } //CIERRE FLUJO DE CLIENTES
            
        } //CIERRE FLUJO DE TEXTO 




    } //CIERRE FLUJO DE TEXTO//CERRAMOS TRY

  
    catch (error) {
        console.error("💥 Error Crítico:", error.message);
        return res.status(200).json({ ok: true });
    }

     // --- HELPERS (FUNCIONES DE APOYO) ---
    // IMPORTANTE: Estas funciones están DENTRO del handler pero FUERA del try/catch

    async function formatearLinkWA(telefono, nombre, mensajeBase) {
        if (!telefono) return null;
        let telLimpio = String(telefono).replace(/[^0-9]/g, ''); // Limpieza pura 
        if (telLimpio.length === 9) telLimpio = '34' + telLimpio; // Prefijo automático 
        const textoWA = encodeURIComponent(mensajeBase.replace('{nombre}', nombre || 'cliente'));
        return `https://wa.me/${telLimpio}?text=${textoWA}`;
    }

    async function enviarMensajeSimple(chatId, texto) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' })
        });
    }

    async function enviarMensajeConBotones(chatId, texto, botones) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId, text: texto, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: botones }
            })
        });
    }

    async function enviarMensajeConReply(chatId, texto) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: texto, reply_markup: { force_reply: true } })
        });
    }

    async function editarMensaje(chatId, messageId, texto) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/editMessageText`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'Markdown' })
        });
    }

    async function editarMensajeConBotones(chatId, messageId, texto, botones) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/editMessageText`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'Markdown', reply_markup: { inline_keyboard: botones } })
        });
    }

    async function responderBoton(callbackQueryId) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/answerCallbackQuery`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId })
        });
    }

    // --- NUEVO HELPER: Extractor de Metadata Blindado ---
    function extraerMetadata(texto) {
        try {
            // Busca el patrón DATOS_IA seguido del JSON entre llaves
            const match = texto.match(/DATOS_IA:\s*(\{.*\})/s);
            if (!match) return null;
            return JSON.parse(match[1]);
        } catch (e) {
            console.error("❌ Error parseando JSON de metadatos:", e.message);
            return null;
        }
    }

    function estaLaTiendaAbierta() {
        // 1. Obtenemos la hora actual en España
        const ahora = new Date().toLocaleString("en-US", {timeZone: "Europe/Madrid"});
        const fechaEsp = new Date(ahora);
        
        const dia = fechaEsp.getDay(); // 0: Dom, 1: Lun, 2: Mar, 3: Mie, 4: Jue, 5: Vie, 6: Sab
        const hora = fechaEsp.getHours();
        const minutos = fechaEsp.getMinutes();
        const tiempoDecimal = hora + (minutos / 60); // Ejemplo: 10:30 -> 10.5
    
        // Tramos Horarios
        const manana = tiempoDecimal >= 10 && tiempoDecimal < 14;
        const tarde = tiempoDecimal >= 17 && tiempoDecimal < 20;
    
        // 2. LÓGICA DE APERTURA (Tu horario exacto)
        // Lunes(1), Martes(2), Jueves(4), Viernes(5)
        if ([1, 2, 4, 5].includes(dia)) {
            return manana || tarde;
        }
        // Miércoles(3) y Sábados(6)
        if ([3, 6].includes(dia)) {
            return manana;
        }
        // Domingos(0)
        return false;
    }

    function obtenerBotonesMenuPrincipal() {
        const abierta = estaLaTiendaAbierta();
        return [
            [{ text: "🎓 Clases de Costura", callback_data: "CLI_ACADEMIA" }], // Nuevo acceso
            [{ text: abierta ? "📲 Hablar con nosotras (Abierto)" : "🙋 Dejar consulta", callback_data: "CLI_INTERESADO" }],
            [{ text: "📦 Mi pedido", callback_data: "CLI_ESTADO" }],
            [{ text: "🧵 Catálogo", callback_data: "CLI_TELAS" }],
            [{ text: "⏰ Horario", callback_data: "CLI_HORARIO" }]
        ];
    }

 };//CERRAMOS HANDLER
