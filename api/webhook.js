
//--- IMPORTACIONES ---
const airtableService = require('../services/airtableService');
const openaiService = require('../services/openaiService');
const imgbbService = require('../services/imgbbService'); 
const fetch = require('node-fetch');

const taskService = require('../services/taskService');
const inventoryService = require('../services/inventoryService');
const orderService = require('../services/orderService');
const escaparateService = require('../services/escaparateService');
const academiaService = require('../services/academiaService'); // 
const studioService = require('../services/studioService');
const photoService = require('../services/photoService');
// 🎒 LA MOCHILA (Fuera del handler)
let cacheFotos = {};

module.exports = async function handler(req, res) {

    console.log("¡He recibido algo!")
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
        // 🧩 BLOQUE A: CALLBACK QUERIES (BOTONES)
        // ---------------------------------------------------------
        
        if (callback_query) {
            const data = callback_query.data;
            console.log("🔘 Botón pulsado:", data); // Esto DEBE salir en terminal

            const messageId = callback_query.message.message_id;
            
            // Quitamos el reloj de carga en Telegram
            await responderBoton(callback_query.id);
        

            // BOTONES VISUALIZACION 🧹 FALTA LIMPIAR 

            // SELECCION DE TELA 🧹 FALTA LIMPIAR
        
            if (data.startsWith("TELA_SEL|")) {
                const shortId = data.split('|')[1];
                try {
                    await studioService.seleccionarTela(chatId, shortId);
                    await airtableService.guardarSesion(chatId, "VIZ_ESP_PRODUCTO", {});
                    await enviarMensajeConReply(chatId, `🧵 Tela elegida correctamente.\n\n¿Qué producto vamos a confeccionar?`);
                } catch (e) {
                    console.error("💥 Error en TELA_SEL:", e.message);
                    await enviarMensajeSimple(chatId, "❌ Tela no encontrada.");
                }
                return res.status(200).json({ ok: true });
            }
    

            // SELECCION DE PRODUCTO 🧹 FALTA LIMPIAR
            else if (data.startsWith("PROD_SEL|")) {
                const idProducto = data.split('|')[1];
                try {
                    await enviarMensajeSimple(chatId, "⏳ **Extrayendo patrones y moldes...**");
                    const resultado = await studioService.generarDiseno(chatId, idProducto);
                    await enviarMensajeSimple(chatId, "✨ **Mamafina está diseñando tu prenda...**");
                    await enviarMensajeConBotones(chatId, "🎉 ¡Propuesta terminada!", [
                        [{ text: "🖼️ Ver Alta Res", url: resultado.urlFinal }],
                        [{ text: "🔄 Regenerar", callback_data: `REGEN|${resultado.borradorId}|${resultado.idProducto}` }]
                    ]);
                } catch (e) {
                    console.error("💥 Error en PROD_SEL:", e.message);
                    await enviarMensajeSimple(chatId, `⚠️ Error técnico: ${e.message}`);
                }
                return res.status(200).json({ ok: true });
            }
    
            //BOTÓN REGENERAR IMAGEN 🧹 FALTA LIMPIAR
            else if (data.startsWith("REGEN|")) {
                const partes = data.split('|');
                const idBorrador = partes[1];
                const idProd = partes[2];
                try {
                    await enviarMensajeSimple(chatId, "♻️ **Regenerando diseño...**");
                    const resultado = await studioService.regenerarDiseno(chatId, idBorrador, idProd);
                    await enviarMensajeConBotones(chatId, "🔄 Diseño regenerado.", [
                        [{ text: "🖼️ Ver Alta Res", url: resultado.urlFinal }],
                        [{ text: "🔄 De nuevo", callback_data: `REGEN|${resultado.idBorrador}|${resultado.idProducto}` }]
                    ]);
                } catch (e) {
                    console.error("💥 Error en REGEN:", e.message);
                    await enviarMensajeSimple(chatId, `⚠️ Error al regenerar: ${e.message}`);
                }
                return res.status(200).json({ ok: true });
            }   

            // MARKETING: Crear copy para Instagram
            else if (data === "MKT_CREAR_COPY") {

                const marketingHabilitado = await airtableService.getConfigValue('modulo_marketing') === 'true';
                if (!marketingHabilitado) {
                    await enviarMensajeSimple(chatId, "⭕ El módulo de marketing está desactivado. Actívalo con /modulos.");
                    return res.status(200).json({ ok: true });
                }
                
                const sesion = await airtableService.obtenerSesion(chatId);
                
                if (!sesion || !sesion.metadata || !sesion.metadata.urlFoto) {
                    await enviarMensajeSimple(chatId, "⚠️ La sesión ha expirado. Vuelve a subir el trabajo para crear el copy.");
                    return res.status(200).json({ ok: true });
                }

                const { urlFoto, nombreProyecto } = sesion.metadata;
                
                await enviarMensajeSimple(chatId, "✍️ *Escribiendo el copy...*");
                
                try {
                    const marketingService = require('../services/marketingService');
                    const copy = await marketingService.generarCopyTrabajo(urlFoto, nombreProyecto);
                    
                    await airtableService.borrarSesion(chatId);
                    
                    await enviarMensajeConBotones(
                        chatId,
                        `📲 *Copy para Instagram:*\n\n${copy}`,
                        [[{ text: "🔄 Regenerar copy", callback_data: "MKT_REGEN_COPY" }]]
                    );
                } catch (e) {
                    console.error("💥 Error generando copy:", e.message);
                    await airtableService.borrarSesion(chatId);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido generar el copy ahora. Puedes pedirlo más tarde con /copy.");
                }
                
                return res.status(200).json({ ok: true });
            }

            // MARKETING: Saltar creación de copy
            else if (data === "MKT_SKIP") {
                await airtableService.borrarSesion(chatId);
                await enviarMensajeSimple(chatId, "👍 Perfecto. Cuando quieras crear el copy de cualquier trabajo, usa /copy.");
                return res.status(200).json({ ok: true });
            }

            // MARKETING: Regenerar copy (misma foto, nuevo texto)
            else if (data === "MKT_REGEN_COPY") {
                const sesion = await airtableService.obtenerSesion(chatId);
                
                if (!sesion || !sesion.metadata || !sesion.metadata.urlFoto) {
                    await enviarMensajeSimple(chatId, "⚠️ La sesión ha expirado. Vuelve a subir el trabajo para crear el copy.");
                    return res.status(200).json({ ok: true });
                }

                const { urlFoto, nombreProyecto } = sesion.metadata;
                
                await enviarMensajeSimple(chatId, "✍️ *Generando otra versión...*");
                
                try {
                    const marketingService = require('../services/marketingService');
                    const copy = await marketingService.generarCopyTrabajo(urlFoto, nombreProyecto);
                    
                    await enviarMensajeConBotones(
                        chatId,
                        `📲 *Copy para Instagram:*\n\n${copy}`,
                        [[{ text: "🔄 Regenerar copy", callback_data: "MKT_REGEN_COPY" }]]
                    );
                } catch (e) {
                    console.error("💥 Error regenerando copy:", e.message);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido regenerar el copy. Inténtalo de nuevo.");
                }
                
                return res.status(200).json({ ok: true });
            }

            // MÓDULOS: toggle encender/apagar
            else if (data.startsWith("MOD_TOGGLE|")) {
                const partes = data.split('|');
                const clave = partes[1];
                const estadoActual = partes[2] === 'true';
                const nuevoEstado = !estadoActual;

                await airtableService.setConfigValue(clave, String(nuevoEstado));

                // Recargamos el panel actualizado
                const marketingActivo = await airtableService.getConfigValue('modulo_marketing') === 'true';
                const buenosDiasActivo = await airtableService.getConfigValue('modulo_buenos_dias') === 'true';
                const chatbotActivo = await airtableService.getConfigValue('modulo_chatbot_admin') === 'true';

                const texto = `⚙️ *Panel de Módulos*\n\n${nuevoEstado ? '✅ Activado' : '⭕ Desactivado'}: *${clave.replace('modulo_', '').replace('_', ' ')}*`;
                const botones = [
                    [{ text: `${marketingActivo ? '✅' : '⭕'} Marketing (copy Instagram)`, callback_data: `MOD_TOGGLE|modulo_marketing|${marketingActivo}` }],
                    [{ text: `${buenosDiasActivo ? '✅' : '⭕'} Buenos días`, callback_data: `MOD_TOGGLE|modulo_buenos_dias|${buenosDiasActivo}` }],
                    [{ text: `${chatbotActivo ? '✅' : '⭕'} Chatbot admin`, callback_data: `MOD_TOGGLE|modulo_chatbot_admin|${chatbotActivo}` }],
                    [{ text: "🏠 Cerrar", callback_data: "CLI_INICIO" }]
                ];
                await enviarMensajeConBotones(chatId, texto, botones);
                return res.status(200).json({ ok: true });
            }

            // BOTONES DE FOTOS A INVENTARIO 🧹 FALTA LIMPIAR

            if (data.startsWith("FOTO_")) {
                const [tipo, uniqueId] = data.split('|');
                const sesionFoto = await airtableService.obtenerSesion(chatId);
                const fotoId = sesionFoto?.metadata?.fileId;

                if (!fotoId) {
                    await enviarMensajeSimple(chatId, "⚠️ No he podido recuperar la foto. Inténtalo de nuevo.");
                    return res.status(200).json({ ok: true });
                }
                
                await airtableService.borrarSesion(chatId);

                try {
                    if (tipo === "FOTO_TRABAJO") {
                        await enviarMensajeSimple(chatId, "✨ **Preparando ficha para el Archivador...**");
                    } else {
                        await enviarMensajeSimple(chatId, "🔍 **Analizando imagen y patrón visual...**");
                    }

                    const metadata = await photoService.procesarFotoAdmin(chatId, tipo, uniqueId, fotoId);

                    if (metadata.esTrabajo) {
                        await airtableService.guardarSesion(chatId, metadata.step, metadata);
                        await enviarMensajeConReply(chatId, `🎨 ¡Qué bonito trabajo! ¿Qué **Nombre** le ponemos a este proyecto?`, null);
                    } else {
                        await airtableService.guardarSesion(chatId, metadata.step, metadata);
                        await enviarMensajeConReply(chatId, `✅ Análisis:\n¿Qué **Nombre** le ponemos?`, null);
                    }
                } catch (e) {
                    console.error("💥 Error en FOTO_:", e.message);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido analizar la imagen. Inténtalo de nuevo.");
                }

                return res.status(200).json({ ok: true });
            }   
            
               
            // CATÁLOGO DE TELAS  🧹 FALTA LIMPIAR

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
           //CATÁLOGO DE TRABAJOS  🧹 FALTA LIMPIAR 
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
                return res.status(200).json({ ok: true });
            }
           
            }

            if (data.startsWith("CAT_TRAB|")) {
                const [, categoria, uniqueId] = data.split('|');
                const sesionTrabajo = await airtableService.obtenerSesion(chatId);
                
                if (!sesionTrabajo || !sesionTrabajo.metadata) {
                    await enviarMensajeSimple(chatId, "❌ La sesión ha expirado, por favor sube la foto de nuevo.");
                    return res.status(200).json({ ok: true });
                }
            
                const metadata = sesionTrabajo.metadata;
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
            
                    // Guardamos la URL y el nombre en sesión ANTES de borrar
                    // para que el handler de marketing pueda recuperarlos
                    await airtableService.guardarSesion(chatId, "MKT_ESP_DECISION", {
                        urlFoto: urlFinal,
                        nombreProyecto: metadata.nombre,
                        categoria: categoria
                    });

                    await enviarMensajeConBotones(
                        chatId,
                        `✅ *¡Proyecto archivado con éxito!*\n🌟 *${metadata.nombre}* ya está en el catálogo de *${categoria}*.\n\n¿Quieres que te escriba el copy para Instagram?`,
                        [
                            [{ text: "✨ Sí, crear copy", callback_data: "MKT_CREAR_COPY" }],
                            [{ text: "No, gracias", callback_data: "MKT_SKIP" }]
                        ]
                    );
                } catch (e) {
                    console.error("💥 Error guardando trabajo:", e.message);
                    await enviarMensajeSimple(chatId, "❌ Hubo un problema al guardar la foto en el archivador.");
                    return res.status(200).json({ ok: true });
                }
                
            }

       
             // 1. VOLVER AL INICIO  
             // Retorna al menú principal de la tienda/mostrador
            if (data === "CLI_INICIO") {
                try {
                    const botonesInicio = escaparateService.obtenerBotonesMenuPrincipal();
                    await editarMensajeConBotones(chatId, messageId, "¡Dime, primor! ¿En qué más te ayudo? 🧵", botonesInicio);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error en CLI_INICIO:", e.message);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // 2. BOTONES DE INVENTARIO 
            // A. Iniciar proceso de venta de un artículo
            else if (data.startsWith("INICIAR_VENTA|")) {
                try {
                    const salePrompt = await inventoryService.prepareSale(data);
                    await enviarMensajeConReply(chatId, salePrompt.text);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error en INICIAR_VENTA:", e.message);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // B. Confirmación final tras elegir categoría en alta manual/IA
            else if (data.startsWith("CAT|")) {
                try {
                    const result = await inventoryService.confirmProductCreation(data, user);
                    await editarMensaje(chatId, messageId, result.text);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // 3. BOTONES PEDIDOS
            // A. Asignar prioridad a una nueva tarea
            else if (data.startsWith("PRIO|")) {
                try {
                    const textoConfirmacion = await taskService.confirmTaskCreation(data);
                    await editarMensaje(chatId, messageId, textoConfirmacion);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // B. Eliminar tarea o confirmar borrado
            else if (data.startsWith("EJECUTAR_BORRADO|") || data.startsWith("ELIMINAR_TAREA|")) {
                try {
                    const textoResultado = await taskService.handleTaskAction(data);
                    await editarMensaje(chatId, messageId, textoResultado);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // C. Abrir menú de estados de un pedido
            else if (data.startsWith("ESTADO_MENU|")) {
                try {
                    const idPedido = data.split('|')[1];
                    const menuData = await orderService.getStatusMenu(idPedido);
                    
                    await enviarMensajeConBotones(chatId, menuData.text, menuData.buttons);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error abriendo menú de estado:", e.message);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // D. Ejecutar el cambio de estado de un pedido
            else if (data.startsWith("SET_ESTADO|")) {
                try {
                    const [, idPedido, nuevoEstado] = data.split('|');
                    const resultado = await orderService.updateOrderStatus(idPedido, nuevoEstado);

                    // Si el pedido está terminado, trae botón de WhatsApp
                    if (resultado.button) {
                        await enviarMensajeConBotones(chatId, `${resultado.text}\n\n${resultado.extraMsg}`, resultado.button);
                    } else {
                        // Si es otro estado, simplemente editamos el mensaje para no ensuciar el chat
                        await editarMensaje(chatId, messageId, resultado.text);
                    }

                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error cambiando estado:", e.message);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }
    

            // 5. BOTONES GESTION DE CONSULTAS 
            // A. Ver lista de consultas pendientes (TB-09)
            else if (data === "ADM_VER_CONSULTAS") {
                try {
                    const consultData = await orderService.getPendingConsultations();
                    await enviarMensajeSimple(chatId, consultData.text);
                    for (const block of (consultData.blocks || [])) {
                        await enviarMensajeConBotones(chatId, block.text, block.buttons);
                    }
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                    
                }
            }

            // B. Ver clientes interesados en pedidos (Estado: 🙋Cliente Interesado)
            else if (data === "ADM_VER_INTERESADOS") {
                try {
                    const interestedData = await orderService.getInterestedClients();
                    await enviarMensajeSimple(chatId, interestedData.text);
                    for (const block of (interestedData.blocks || [])) {
                        await enviarMensajeConBotones(chatId, block.text, block.buttons);
                    }
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // C. Ejecutor para cerrar una consulta
            else if (data.includes("CERRAR_CONSULTA")) {
                try {
                    const idConsulta = data.split('|')[1] || data.split('_')[1];
                    if (!idConsulta) throw new Error("ID vacío");
                    const mensajeResultado = await orderService.closeConsultation(idConsulta);
                    await editarMensaje(chatId, messageId, mensajeResultado);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error cerrando consulta:", e.message);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // 6. BOTONES GESTIÓN DE ACADEMIA
            // A. Administrar clases por tipo
            if (data.startsWith("ADM_CLASES|")) {
                try {
                    const tipo = data.split('|')[1]; 
                    // Forzamos respuesta al botón para quitar el reloj de Telegram
                    await responderBoton(callback_query.id); 
                    
                    const blocks = await academiaService.listarClasesAdmin(tipo);
                    
                    await enviarMensajeSimple(chatId, `📊 Gestión de clases de **${tipo}**:`);
                    
                    if (blocks && blocks.length > 0) {
                        for (const b of blocks) {
                            await enviarMensajeConBotones(chatId, b.text, b.buttons);

                        }
                    }
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error en ADM_CLASES:", e.message);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido leer las clases. Revisa los nombres en Airtable.");
                    return res.status(200).json({ ok: true });
                }
            }
                
            // B. Modificar horario de una clase (abre flujo de texto)
            else if (data.startsWith("MOD_HORA_CLASE|")) {
                try {
                    const idClase = data.split('|')[1];
                    const meta = { step: "ADM_ESP_NUEVA_HORA", idClase };
                    await airtableService.guardarSesion(chatId, "ADM_ESP_NUEVA_HORA", meta);
                    await enviarMensajeConReply(chatId, `⏰ ¿Cuál es el nuevo horario?`, null);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error en MOD_HORA_CLASE:", e.message);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido abrir ese formulario. Inténtalo de nuevo.");
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }
            
            // C. Ver alumnas apuntadas a una clase

            // 1. El botón principal "Ver Alumnas" ahora abre el menú de opciones
            else if (data.startsWith("VER_LISTA|")) {
                try {
                    const idClase = data.split('|')[1];
                    const menu = await academiaService.menuGestionAlumnas(idClase);
                    await enviarMensajeConBotones(chatId, menu.text, menu.buttons);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error en VER_LISTA:", e.message);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido cargar la lista. Inténtalo de nuevo.");
                    return res.status(200).json({ ok: true });
                }
            }

            else if (data.startsWith("VER_APUNTADAS|")) {
                try {
                    const idClase = data.split('|')[1];
                    const lista = await academiaService.obtenerAlumnasDeClase(idClase);
                    
                    // 1. Enviamos el mensaje de cabecera
                    await enviarMensajeSimple(chatId, lista.text);
            
                    // 2. Iniciamos el bucle para enviar CADA alumna
                    if (lista.blocks) {
                        for (const b of lista.blocks) {
                            // El bot envía el mensaje de una alumna...
                            await enviarMensajeConBotones(chatId, b.text, b.buttons);
                        }
                    }
            
                    // 3. FINAL DE TRAYECTO (Fuera de los bucles)
                    // Solo cuando ha terminado de enviar TODOS los bloques de alumnas:
                    await responderBoton(callback_query.id); // Quita el relojito de Telegram
                    return res.status(200).json({ ok: true }); // Avisa que todo ha salido bien
            
                } catch (e) {
                    // Si algo explota, también cerramos la persiana correctamente
                    console.error("Error:", e.message);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido cargar las alumnas. Inténtalo de nuevo.");
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }


            // D. Baja de alumna y disparo de relevo automático
            else if (data.startsWith("BORRAR_ALU|")) {
                try {
                    const [, idClase, idAluRecord] = data.split('|');
                    const result = await academiaService.desapuntarAlumna(idClase, idAluRecord);
                    if (result.button) {
                        await enviarMensajeConBotones(chatId, result.text, result.button);
                    } else {
                        await enviarMensajeSimple(chatId, result.text);
                    }
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error en BORRAR_ALU:", e.message);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido dar de baja a la alumna. Inténtalo de nuevo.");
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // F. Ver alumnas interesadas
            else if (data.startsWith("VER_INTERESADAS|")) {
                try {
                    const parts = data.split('|');
                    const idClase = parts[1];

                    if (!idClase) {
                        await enviarMensajeSimple(chatId, "Este botón ya no está disponible.");
                        return res.status(200).json({ ok: true });
                    }

                    console.log("📡 Llamando a academiaService con ID:", idClase);
                    
                    const lista = await academiaService.obtenerInteresadasClase(idClase);
                    
                    await enviarMensajeSimple(chatId, lista.text);
                    for (const block of (lista.blocks || [])) {
                        await enviarMensajeConBotones(chatId, block.text, block.buttons);
                    }
                    
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    // ✨ AÑADE ESTA LÍNEA PARA NO PERDER MÁS ERRORES
                    console.error("💥 [WEBHOOK] Fallo en VER_INTERESADAS:", e.message);
                    
                    await enviarMensajeSimple(chatId, "⚠️ Hubo un fallo interno al buscar las interesadas.");
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // G. Apuntar a clase (desde lista de interesadas)
            else if (data.startsWith("APUNTAR_ALU|")) {
                try {
                    const parts = data.split('|');
                    const idInteresada = parts[1];
                    const idClase = parts[2];

                    if (!idInteresada || !idClase) {
                        await enviarMensajeSimple(chatId, "Este botón ya no está disponible.");
                        await responderBoton(callback_query.id);
                        return res.status(200).json({ ok: true });
                    }

                    const result = await academiaService.inscribirAlumna(idInteresada, idClase);

                    const confirmacion = `✅ Hecho. ${result.nombre} ya está en la clase de ${result.nombreClase}.`;

                    const mensajeWA = result.esAlumnaExistente
                        ? `¡Hola ${result.nombre}! ✨ Soy Reyes de Mamafina. Ya estás apuntada a la clase de ${result.nombreClase}. Tu ID de alumna es ${result.idAlumna}. ¡Guárdalo para consultar tu ficha cuando quieras! 🧵`
                        : `¡Hola ${result.nombre}! ✨ Soy Reyes de Mamafina. Ya estás apuntada a la clase de ${result.nombreClase}. Tu ID de alumna es ${result.idAlumna}. ¡Úsalo para crear tu ficha personal en el bot! 🧵`;

                    const linkWA = await escaparateService.formatearLinkWA(result.telefono, result.nombre, mensajeWA);

                    const botones = [[{ text: `📲 Enviar ID a ${result.nombre} por WhatsApp`, url: linkWA }]];

                    await enviarMensajeConBotones(chatId, confirmacion, botones);
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error en APUNTAR_ALU:", e.message);
                    await enviarMensajeSimple(chatId, "❌ Hubo un problema al apuntar a la alumna. Inténtalo de nuevo.");
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }
            // 7. BOTONES CLIENTES
            // A. Interesado / Hablar (WhatsApp o consulta fuera de horario)
            else if (data === "CLI_INTERESADO") {
                try {
                    const abierta = escaparateService.estaLaTiendaAbierta();
                    if (abierta) {
                        const linkWA = await escaparateService.formatearLinkWA("636796210", user || "Clienta", "¡Hola! Quería consultaros una duda.");
                        await enviarMensajeConBotones(chatId, "¡Estamos en el taller! 🧵\n\nPulsa aquí para hablarnos:", [
                            [{ text: "📲 WhatsApp", url: linkWA }],
                            [{ text: "🏠 Menú Principal", callback_data: "CLI_INICIO" }]
                        ]);
                    } else {
                        const meta = { step: "ESP_CONSULTA", chatId, userTelegram: user };
                        await airtableService.guardarSesion(chatId, "ESP_CONSULTA", meta);
                        await enviarMensajeConReply(chatId, `✨ Taller cerrado.\n¿Qué necesitas consultar?`, null);
                    }
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }
            // B. Consultar estado de pedido (#REF) - Abre escucha de texto
            else if (data === "CLI_ESTADO") {
                try {
                    await enviarMensajeConReply(chatId, "🔎 Por favor, escribe tu **Número de Pedido** (ej: #REF-1234) para buscarlo:");
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }
            // C. Interés en un pedido específico (desde el buscador)
            else if (data.startsWith("INT_PEDIDO_")) {
                try {
                    const idPedidoRaw = data.replace("INT_PEDIDO_", "").trim();
                    let idAirtableReal = idPedidoRaw.startsWith('rec') ? idPedidoRaw : (await escaparateService.buscarPedidoPorTicket(idPedidoRaw, airtableService))?.id;

                    if (!idAirtableReal) {
                        await enviarMensajeSimple(chatId, "⚠️ No encuentro el pedido.");
                    } else {
                        await airtableService.actualizarEstadoPedido(idAirtableReal, { "Estado": "🙋Cliente Interesado" });
                        const registro = await airtableService.base(airtableService.t.pedidos).find(idAirtableReal);
                        const abierta = escaparateService.estaLaTiendaAbierta();

                        if (abierta) {
                            const linkWA = await escaparateService.formatearLinkWA("636796210", registro.fields.Nombre_Cliente || user, `Duda pedido: ${registro.fields.Pedido_Detalle}`);
                            await enviarMensajeConBotones(chatId, "✅ ¡Estado actualizado! Pulsa aquí:", [[{ text: "📲 WhatsApp", url: linkWA }], [{ text: "🏠 Menú", callback_data: "CLI_INICIO" }]]);
                        } else {
                            await airtableService.registrarConsultaAutomatica(chatId, user, registro.fields.Nombre_Cliente, registro.fields.Telefono, registro.fields.Pedido_Detalle);
                            await enviarMensajeConBotones(chatId, "😴 Taller cerrado. Ya hemos marcado tu interés.", [[{ text: "🏠 Menú", callback_data: "CLI_INICIO" }]]);
                            return res.status(200).json({ ok: true });
                        }
                    }
                }
                 catch (e) {
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }
        
            // 8 . BOTONES ACADEMIA CLIENTES (UNIFICADO)
            // A. Menú Raíz Academia (Entrada)
            else if (data === "CLI_ACADEMIA") {
                try {
                    const texto = `🎓 **BIENVENIDA A LA ACADEMIA**\n\nAquí puedes consultar tus clases o gestionar tu rincón de costura personal. ¿Qué necesitas, primor?`;
                    const botones = [
                        [{ text: "📅 Ver Clases y Huecos", callback_data: "ACAD_VER_MENU_CLASES" }],
                        [{ text: "📓 Mi Ficha de Alumna", callback_data: "ACAD_MI_FICHA" }],
                        [{ text: "🏠 Volver al Menú", callback_data: "CLI_INICIO" }]
                    ];
                    await editarMensajeConBotones(chatId, messageId, texto, botones);
                } catch (e) { console.error("Error en CLI_ACADEMIA:", e); }
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }

            // B. Submenú: Selección de tipo de clase
            else if (data === "ACAD_VER_MENU_CLASES") {
                try {
                    const botones = [
                        [{ text: "🧵 Clases de Costura (Individual)", callback_data: "ACAD_VER_CLASES|Costura" }],
                        [{ text: "🧶 Clases de Crochet (Grupal)", callback_data: "ACAD_VER_CLASES|Crochet" }],
                        [{ text: "💬 Grupo WhatsApp Crochet", url: "https://chat.whatsapp.com/TU_LINK_AQUI" }],
                        [{ text: "⬅️ Volver", callback_data: "CLI_ACADEMIA" }]
                    ];
                    await editarMensajeConBotones(chatId, messageId, "Elige el tipo de clase para ver los huecos libres:", botones);
                } catch (e) { console.error("Error en ACAD_VER_MENU_CLASES:", e); }
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }
            
            // C. Acción: Listar Huecos según tipo
            else if (data.startsWith("ACAD_VER_CLASES|")) {
                const tipo = data.split('|')[1];
                try {
                    // 1. Quitamos el reloj de carga rápido
                    await responderBoton(callback_query.id); 
            
                    const clases = await academiaService.obtenerClasesDisponibles(tipo);
            
                    if (!clases || clases.length === 0) {
                        await enviarMensajeSimple(chatId, `Vaya, parece que ahora mismo no hay huecos disponibles para **${tipo}**. 🧵✨`);
                    } else {
                        await enviarMensajeSimple(chatId, `📍 Estas son las clases de **${tipo}** con plazas libres:`);
                        for (const clase of clases) {
                            const botonesClase = [[{ text: "🙋‍♀️ Me interesa", callback_data: `FLUJO_INTERES|${clase.id}|${tipo}` }]];
                            await enviarMensajeConBotones(chatId, clase.texto, botonesClase);
                        }
                    }
                    return res.status(200).json({ ok: true }); 
            
                } catch (error) {
                    console.error("Error al listar clases:", error);
                    await enviarMensajeSimple(chatId, "He tenido un problemilla al mirar la agenda. 😅");
                    // 3. ERROR: También avisamos que terminamos
                    return res.status(200).json({ ok: true });
                }
            }


            // D. Submenú: Acceso a Ficha (ID o Nueva)
            else if (data === "ACAD_MI_FICHA") {
                try {
                    const texto = `📓 **ÁREA DE ALUMNAS**\n\n` +
                                `¿Ya tienes un número de alumna o eres nueva en el taller, primor?\n\n` +
                                `🔍 **Tengo ID:** Si ya tienes un número (ej: #ALU-1234).\n` +
                                `✨ **Soy Nueva:** Si es tu primera vez aquí.`;
                    const botones = [
                        [{ text: "🔍 Ya tengo mi ID de Alumna", callback_data: "ACAD_BUSCAR_POR_ID" }],
                        [{ text: "✨ Crear Ficha Nueva/Gestionar", callback_data: "ACAD_GESTION_FICHA" }],
                        [{ text: "⬅️ Volver", callback_data: "CLI_ACADEMIA" }]
                    ];
                    await editarMensajeConBotones(chatId, messageId, texto, botones);
                } catch (e) { console.error("Error en ACAD_MI_FICHA:", e); }
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }

            // D.2. Buscar ficha por ID de alumna
            else if (data === "ACAD_BUSCAR_POR_ID") {
                try {
                    await responderBoton(callback_query.id);
                    await airtableService.guardarSesion(chatId, "ESP_ID_ALUMNA", { step: "ESP_ID_ALUMNA" });
                    await enviarMensajeConReply(chatId, "🔍 Dime tu ID de alumna (empieza por #ALU) y te abro la ficha enseguida, primor.", null);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("Error en ACAD_BUSCAR_POR_ID", e);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido procesar eso. Inténtalo de nuevo.");
                    return res.status(200).json({ ok: true });
                }
            }

            // E. Acción: Gestión de Ficha (Obtener/Crear)
            else if (data === "ACAD_GESTION_FICHA" || data === "ACAD_CREAR_NUEVA") {
                try {
                    const usuarioTelegram = callback_query.from;
                    let ficha = await academiaService.obtenerOcrearFicha(chatId, usuarioTelegram.first_name);

                    const sesion = await airtableService.obtenerSesion(chatId);
                    let airtableId = sesion?.metadata?.airtableId || ficha?.id || "";

                    let mensajeStatus = `📓 **TU FICHA DE ALUMNA**\n\n` +
                                        `🆔 **ID:** \`${ficha.ID_Alumna_Unico}\`\n` +
                                        `👤 **Nombre:** ${ficha.Nombre_Real || '⚠️ Pendiente'}\n` +
                                        `🧵 **Proyecto:** ${ficha.Proyecto_Actual || 'Sin anotar'}\n` +
                                        `📍 **Notas:** ${ficha.Notas_Tecnicas || 'Sin notas'}`;

                    await airtableService.guardarSesion(chatId, "FICHA_ACTIVA", { airtableId });
                    const botonesGestion = [
                        [{ text: "👤 Cambiar mi Nombre", callback_data: "MOD_NOMBRE" }],
                        [{ text: "🧵 Gestionar Proyecto Actual", callback_data: "MENU_LABOR" }],
                        [{ text: "⬅️ Volver", callback_data: "CLI_ACADEMIA" }]
                    ];
                    await enviarMensajeConBotones(chatId, mensajeStatus, botonesGestion, null);

                    if (ficha.Foto_Patron) {
                        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: chatId, photo: ficha.Foto_Patron, caption: "🖼️ Foto de tu patrón actual" })
                        });
                    }
                    if (!ficha.Foto_Patron && ficha.Patron_PDF && Array.isArray(ficha.Patron_PDF) && ficha.Patron_PDF[0]?.url) {
                        await enviarMensajeConBotones(chatId, "📄 Tienes un patrón en PDF guardado", [[{ text: "📄 Ver PDF", url: ficha.Patron_PDF[0].url }]], null);
                    }
                    if (ficha.Link_Patron) {
                        await enviarMensajeConBotones(chatId, "🔗 Tienes un patrón guardado", [[{ text: "🔗 Ver patrón", url: ficha.Link_Patron }]], null);
                    }
                } catch (e) {
                    console.error("💥 Error en Gestión Ficha:", e.message);
                    await enviarMensajeSimple(chatId, "❌ No he podido abrir tu libreta de costura ahora mismo.");
                }
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }

            // F. Submenú: Gestión de Labor (Proyecto, Notas, Patrón)
            else if (data === "MENU_LABOR") {
                try {
                    const sesion = await airtableService.obtenerSesion(chatId);
                    const airtableId = sesion?.metadata?.airtableId || "";

                    const ficha = await airtableService.obtenerFichaAlumna(chatId);
                    await airtableService.guardarSesion(chatId, "MENU_LABOR", { airtableId });
                    const texto = `🧵 **GESTIÓN DE TU LABOR**\n\n` +
                                `Actualmente estás con: **${ficha?.Proyecto_Actual || 'Sin anotar'}**\n` +
                                `¿Qué quieres actualizar, primor?`;
                    const botonesLabor = [
                        [{ text: "📝 Nombre del Proyecto", callback_data: "MOD_PROYECTO" }],
                        [{ text: "📍 Notas Técnicas", callback_data: "MOD_NOTAS" }],
                        [{ text: "📂 Gestionar Patrón", callback_data: "MENU_PATRON" }],
                        [{ text: "⬅️ Volver", callback_data: "ACAD_GESTION_FICHA" }]
                    ];
                    await enviarMensajeConBotones(chatId, texto, botonesLabor, null);
                } catch (e) { console.error("Error en MENU_LABOR:", e); }
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }

            // G. Acciones de Edición (Disparadores de Reply)
            else if (["MOD_NOMBRE", "MOD_PROYECTO", "MOD_NOTAS", "MOD_LINK", "MOD_ARCHIVO"].includes(data)) {
                try {
                    if (data === "MOD_ARCHIVO") {
                        const sesion = await airtableService.obtenerSesion(chatId);
                        let airtableId = sesion?.metadata?.airtableId;
                        if (!airtableId) {
                            const ficha = await airtableService.obtenerFichaAlumna(chatId);
                            if (ficha) airtableId = ficha.id;
                        }
                        if (airtableId) {
                            await airtableService.guardarSesion(chatId, "ESP_ARCHIVO", { step: "ESP_ARCHIVO", airtableId });
                            await enviarMensajeConReply(chatId, "📄 Envíame el archivo PDF o una foto del patrón, primor.", null);
                        } else {
                            await enviarMensajeSimple(chatId, "Para guardar un patrón, ve a tu ficha y pulsa 📂 Gestionar Patrón primero, primor.");
                        }
                    } else {
                        const sesion = await airtableService.obtenerSesion(chatId);
                        const airtableId = sesion?.metadata?.airtableId || "";

                        await airtableService.guardarSesion(chatId, data, { airtableId });
                        const mensajes = {
                            "MOD_NOMBRE": "✍️ ¿Cómo quieres que te anote en la libreta? (Dime Nombre y Apellidos)",
                            "MOD_PROYECTO": "🧵 ¿En qué **Proyecto** estás trabajando ahora, primor?",
                            "MOD_NOTAS": "📍 ¡Cuéntame los detalles! (Agujas, tensión, cambios...)",
                            "MOD_LINK": "🔗 Pega aquí el **Enlace/Link** de la web de tu patrón:"
                        };
                        await airtableService.iniciarBorradorAlumna(chatId);
                        await enviarMensajeConReply(chatId, mensajes[data], null);
                    }
                } catch (e) { console.error("Error en MOD_ acciones:", e); }
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }

            // H. Submenú: Gestión de Patrón
            else if (data === "MENU_PATRON") {
                try {
                    const sesion = await airtableService.obtenerSesion(chatId);
                    const airtableId = sesion?.metadata?.airtableId;

                    await airtableService.guardarSesion(chatId, "MENU_PATRON", { airtableId: airtableId || "" });
                    const textoMenu = "¡Genial! ¿Cómo es el patrón que quieres guardar?";
                    const botonesPatron = [
                        [{ text: "🔗 Enlace Web (URL)", callback_data: "MOD_LINK" }],
                        [{ text: "📄 Archivo (PDF/Foto)", callback_data: "MOD_ARCHIVO" }],
                        [{ text: "⬅️ Volver", callback_data: "MENU_LABOR" }]
                    ];
                    await enviarMensajeConBotones(chatId, textoMenu, botonesPatron, null);
                } catch (e) { console.error("Error en MENU_PATRON:", e); }
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }

            // I. Acción: Interés en Clase (WhatsApp)
            else if (data.startsWith("INT_CLASE|")) {
                try {
                    const [, idClase, tipoClase] = data.split('|');
                    const abierta = escaparateService.estaLaTiendaAbierta(); 
                    const ficha = await airtableService.obtenerFichaAlumna(chatId);
                    const nombreAlumna = ficha ? ficha.Nombre_Real : "Alumna";
                    const idAlu = ficha ? ficha.ID_Alumna_Unico : "#ALU-TEMP";

                    await airtableService.guardarConsultaFinal({
                        nombreCliente: `${nombreAlumna} (${idAlu})`,
                        mensajeConsulta: `Interés en clase de ${tipoClase}`,
                        telefono: ficha?.Telefono || "Consultar ficha"
                    });

                    if (abierta) {
                        const mensajeWA = `¡Hola Reyes! Soy ${nombreAlumna} (${idAlu}). Me interesa el hueco de ${tipoClase} que he visto en el bot. ✨`;
                        const linkWA = await escaparateService.formatearLinkWA("636796210", nombreAlumna, mensajeWA); 
                        await enviarMensajeConBotones(chatId, "✅ He registrado tu interés. Pulsa aquí para confirmar por WhatsApp:", [[{ text: "📲 Hablar por WhatsApp", url: linkWA }]]);
                    } else {
                        await enviarMensajeSimple(chatId, "😴 Taller cerrado, pero ya he anotado tu interés. ¡Mañana te decimos algo! ✨");
                    }
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) { 
                    console.error("Error en INT_CLASE:", e);
                    await enviarMensajeSimple(chatId, "⚠️ No he podido registrar tu interés. Inténtalo de nuevo.");
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            
            // J. Apuntar alumna
            }

            // K. Formulario interés

            else if (data.startsWith("FLUJO_INTERES|")) {
                try {
                    const [, idClase, tipo] = data.split('|');
                    
                    const ficha = await airtableService.obtenerFichaAlumna(chatId);
                    const tipoLimpio = tipo.replace(/[🧵🧶]/g, '').trim(); 

                    if (ficha && ficha.Nombre_Real && ficha.Nombre_Real !== "Pendiente") {
                        // ✨ ESCENARIO A: ALUMNA CONOCIDA -> Guardado Directo
                        const nombreAlu = ficha.Nombre_Real.split(' ')[0];
                        
                        // Usamos la tabla de ESPERA directamente
                        await airtableService.base(process.env.AT_TABLE_LISTA_ESPERA).create([{
                            fields: {
                                "Nombre_Interesada": ficha.Nombre_Real,
                                "Telefono": ficha.Telefono || "Ver ficha",
                                "Disciplina": tipoLimpio,
                                "Clase_Deseada": [idClase], // Vínculo correcto
                                "Estado": "Pendiente"
                            }
                        }]);

                        await enviarMensajeSimple(chatId, `¡Marchando, **${nombreAlu}**! ✨ Ya te he anotado en la lista para las clases de ${tipo}. ¡En cuanto haya hueco te aviso, primor!`);
                    } else {
                        // ✨ ESCENARIO B: ES NUEVA -> Inicia Cuestionario
                        const meta = { 
                            step: "ESP_NOMBRE_INTERESADA", 
                            idClase: idClase, 
                            tipoClase: tipo 
                        };
                        await airtableService.guardarSesion(chatId, "ESP_NOMBRE_INTERESADA", meta);
                        await enviarMensajeConReply(chatId, `¡Qué alegría! ✨ Para avisarte cuando haya un hueco libre en **${tipo}**, ¿cómo te llamas?`, null);
                    }
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                } catch (e) {
                    console.error("💥 Error en radar de alumna:", e.message);
                    await enviarMensajeSimple(chatId, "¡Hola! ✨ Cuéntame, ¿cómo te llamas para que pueda anotarte?");
                    await responderBoton(callback_query.id);
                    return res.status(200).json({ ok: true });
                }
            }

            // L. Ver Horario
            else if (data === "CLI_HORARIO") {
                try {
                    const abierta = escaparateService.estaLaTiendaAbierta();
                    const mensajeEstado = abierta ? "¡Estamos en el taller! 🧵" : "😴 **Taller cerrado.**";
                    const botonesHorario = abierta 
                        ? [[{ text: "📲 WhatsApp ahora", url: await escaparateService.formatearLinkWA("636796210", "Taller", "¡Hola!") }], [{ text: "🏠 Menú", callback_data: "CLI_INICIO" }]]
                        : [[{ text: "🙋 Dejar consulta", callback_data: "CLI_INTERESADO" }], [{ text: "🏠 Menú", callback_data: "CLI_INICIO" }]];
                    await enviarMensajeConBotones(chatId, `${mensajeEstado}\n\n${escaparateService.obtenerTextoHorario()}`, botonesHorario);
                } catch (e) { console.error("Error en CLI_HORARIO:", e); }
                await responderBoton(callback_query.id);
                return res.status(200).json({ ok: true });
            }
            
        } // CIERRE CALLBACK QUERY


        // =========================================================
        // 📸 BLOQUE B: RECEPCIÓN DE FOTOS
        // =========================================================

        if (message && message.photo) {
            // 1. Extraemos la foto de mayor calidad (la última del array)
            const fotoCualquierUsuario = message.photo[message.photo.length - 1];
            const uniqueId = fotoCualquierUsuario.file_unique_id;
            const fileId = fotoCualquierUsuario.file_id;

            // --- ESCENARIO A: FLUJO DE ADMIN (Guardar en Inventario o Portfolio) ---
            if (esAdmin) {
                await airtableService.guardarSesion(chatId, "ESPERANDO_TIPO_FOTO", { uniqueId, fileId });
                const botonesAdmin = photoService.obtenerBotonesAdmin(uniqueId);
                await enviarMensajeConBotones(chatId, "📸 **Jefa**, ¿dónde guardamos esta imagen?", botonesAdmin);
            } 

            // --- ESCENARIO B: FLUJO ALUMNA (Diario de Labores / Avances) ---
            else {
                if (message.reply_to_message) {
                    const replyText = message.reply_to_message.text || message.reply_to_message.caption || "";
                    const sesionFoto = await airtableService.obtenerSesion(chatId);
                    if (sesionFoto && sesionFoto.step === "ESP_ARCHIVO") {
                        await enviarMensajeSimple(chatId, "⏳ **Guardando patrón en tu costurero digital...**");

                        try {
                            const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
                            const fileJson = await fileRes.json();
                            const urlTele = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileJson.result.file_path}`;

                            const urlFinal = await imgbbService.subirAFotoUsuario(urlTele);

                            await airtableService.actualizarPatronAlumna(sesionFoto.metadata.airtableId, {
                                "Foto_Patron": urlFinal
                            });

                            await airtableService.borrarSesion(chatId);
                            await enviarMensajeSimple(chatId, "✅ **¡Foto del patrón guardada, primor!** ✨");
                        } catch (error) {
                            console.error("💥 Error guardando foto patrón:", error.message);
                            await enviarMensajeSimple(chatId, "⚠️ No he podido guardar la foto. Inténtalo de nuevo, primor.");
                        }
                    }
                } else {
                    await enviarMensajeSimple(chatId, "¡Qué foto más bonita, corazón! ✨\n\nSi quieres que la guarde en tu **Ficha de Alumna**, pulsa primero en:\n**🎓 Academia** -> **📓 Mi Ficha** -> **🧵 Gestionar Proyecto**.");
                }
            }

            // Cerramos la petición de Telegram para evitar que reintente el envío
            return res.status(200).json({ ok: true });
        }

        // CIERRE BLOQUE B

        // =========================================================
        // 📂 BLOQUE C: RECEPCIÓN DE DOCUMENTOS (PDF)
        // =========================================================

        else if (message && message.document) {
            try {
                const sesionPDF = await airtableService.obtenerSesion(chatId);
                const airtableId = sesionPDF?.metadata?.airtableId;

                if (airtableId && message.document.mime_type === 'application/pdf') {
                    const fileId = message.document.file_id;

                    await enviarMensajeSimple(chatId, "⏳ **Guardando patrón en tu costurero digital...**");

                    const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
                    const fileJson = await fileRes.json();
                    const urlTele = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileJson.result.file_path}`;

                    await airtableService.actualizarPatronAlumna(airtableId, {
                        "Patron_PDF": [{ url: urlTele }]
                    });

                    await airtableService.borrarSesion(chatId);
                    await enviarMensajeSimple(chatId, "✅ ¡PDF recibido y guardado en tu ficha de alumna, primor! Ya no se te perderá ninguna medida. ✨");
                } else if (!airtableId) {
                    await enviarMensajeSimple(chatId, "Para guardar un patrón, ve a tu ficha y pulsa 📂 Gestionar Patrón primero, primor.");
                } else if (message.document.mime_type !== 'application/pdf') {
                    await enviarMensajeSimple(chatId, "Cielo, por ahora solo puedo guardar archivos en formato **PDF**. Inténtalo de nuevo con ese formato. 🧵");
                }
            } catch (error) {
                console.error("💥 Error en recepción de documentos:", error.message);
                await enviarMensajeSimple(chatId, "⚠️ Ay, no he podido guardar el archivo. Asegúrate de que no es muy pesado e inténtalo de nuevo.");
            }

            return res.status(200).json({ ok: true });
        }

        // CIERRE BLOQUE C

       // =========================================================
        // 📝 BLOQUE D: RECEPCIÓN DE MENSAJES DE TEXTO
        // =========================================================
        
        else if (message && message.text) {
            const textoRecibido = message.text;
            const textoMinus = textoRecibido.toLowerCase();
           
            // 1. VARIABLES DE ENTORNO DEL MENSAJE
            const esRespuesta = !!message.reply_to_message;
            const replyText = esRespuesta ? (message.reply_to_message.text || message.reply_to_message.caption || "") : "";
            const rTextLower = replyText.toLowerCase(); // ✨ ¡ESTA ES LA LÍNEA QUE FALTA!
            const sesion = await airtableService.obtenerSesion(chatId);
            const metadata = sesion?.metadata || null;
            const paso = sesion?.step || null;
            console.log("📨 [DEBUG] esRespuesta:", esRespuesta);
            console.log("📨 [DEBUG] replyText:", replyText);
            console.log("📨 [DEBUG] metadata:", metadata);
            console.log("📨 [DEBUG] paso:", paso);
            console.log("📨 [DEBUG] message.reply_to_message:", JSON.stringify(message.reply_to_message, null, 2));

            // 2. FILTRO DE IDENTIDAD: SALUDOS Y MENÚ PRINCIPAL
            if (textoMinus === "/start" || textoMinus === "hola" || textoMinus === "menú") {
                if (esAdmin) {
                    // Respuesta exclusiva para Reyes/Begoña
                    await enviarMensajeSimple(chatId, "👋 **¡Hola Jefa!**\n\n📦 *pedidos* - Ver activos\n🙋‍♀️ */consultas* - Dudas clientes\n📋 *tareas* - Bloc de notas\n🔎 *stock [nombre]* - Inventario\n🎓 *academia* - Panel de clases");
                } else {
                    // Respuesta para cualquier otro cliente
                    const botones = escaparateService.obtenerBotonesMenuPrincipal(); 
                    await enviarMensajeConBotones(chatId, "¡Hola, primor! ✨ Soy Mamassistant, tu costurera digital. ¿En qué puedo ayudarte hoy?", botones);
                }
                return res.status(200).json({ ok: true }); 
            }

            //  COMANDO DE CANCELACIÓN
            if (textoMinus === "cancelar") {
                try { 
                    await airtableService.cancelarBorradorPedido(chatId); 
                    await airtableService.iniciarBorradorAlumna(chatId);
                } catch (e) {}
                await enviarMensajeSimple(chatId, "❌ Operación cancelada. ¿En qué más te ayudo?");
                return res.status(200).json({ ok: true });
            }

            // 3. INTERCEPTOR DE TICKET
            const esRespuestaAlTicket = esRespuesta && 
                (replyText.includes("Número de Pedido") || replyText.includes("#REF"));

            if (esRespuestaAlTicket) {
                const pedido = await escaparateService.buscarPedidoPorTicket(textoRecibido, airtableService);
                if (pedido) {
                    const txt = `🧵 **Encargo Encontrado**\n📦 **Detalle:** ${pedido.detalle}\n📌 **Estado:** ${pedido.estado}\n📅 **Entrega:** ${pedido.entrega}`;
                    await enviarMensajeConBotones(chatId, txt, [[{ text: "🙋 ¡Tengo una duda!", callback_data: `INT_PEDIDO_${pedido.id}` }]]);
                } else {
                    await enviarMensajeSimple(chatId, "😔 No encuentro ningún pedido con ese código. Revisa que esté bien escrito.");
                }
                return res.status(200).json({ ok: true });
            }

            // 4. FLUJOS BASADOS EN METADATOS (Formularios)
            if (paso) {
                // A. Buscar ficha por ID de alumna (ESP_ID_ALUMNA)
                if (paso === "ESP_ID_ALUMNA") {
                    const idTexto = textoRecibido.trim();
                    console.log("🔍 [DEBUG ESP_ID_ALUMNA] idTexto:", idTexto);

                    const records = await airtableService.base(airtableService.t.academia).select({
                        filterByFormula: `{ID_Alumna_Unico} = '${idTexto.replace(/'/g, "''")}'`,
                        maxRecords: 1
                    }).firstPage();
                    console.log("🔍 [DEBUG ESP_ID_ALUMNA] registros encontrados:", records.length);

                    const ficha = records && records.length > 0 ? { id: records[0].id, ...records[0].fields } : null;
                    console.log("🔍 [DEBUG ESP_ID_ALUMNA] ficha:", ficha ? ficha.ID_Alumna_Unico : "null");

                    if (ficha) {
                        const textoFicha = `📓 **TU FICHA DE ALUMNA**\n\n🆔 **ID:** ${ficha.ID_Alumna_Unico || '—'}\n👤 **Nombre:** ${ficha.Nombre_Real || '—'}\n🧵 **Proyecto:** ${ficha.Proyecto_Actual || '—'}\n📍 **Notas:** ${ficha.Notas_Tecnicas || '—'}`;
                        await enviarMensajeSimple(chatId, textoFicha);

                        if (ficha.Foto_Patron) {
                            await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ chat_id: chatId, photo: ficha.Foto_Patron, caption: "🖼️ Foto de tu patrón actual" })
                            });
                        }
                        if (!ficha.Foto_Patron && ficha.Patron_PDF && Array.isArray(ficha.Patron_PDF) && ficha.Patron_PDF[0]?.url) {
                            await enviarMensajeConBotones(chatId, "📄 Tienes un patrón en PDF guardado", [[{ text: "📄 Ver PDF", url: ficha.Patron_PDF[0].url }]], null);
                        }
                        if (ficha.Link_Patron) {
                            await enviarMensajeConBotones(chatId, "🔗 Tienes un patrón guardado", [[{ text: "🔗 Ver patrón", url: ficha.Link_Patron }]], null);
                        }

                        await airtableService.guardarSesion(chatId, "GESTION_FICHA", { airtableId: ficha.id });
                        const textoConMetadata = "✨ ¿Qué quieres gestionar?";
                        const botones = [[{ text: "✨ Gestionar mi ficha", callback_data: "ACAD_GESTION_FICHA" }]];
                        await enviarMensajeConBotones(chatId, textoConMetadata, botones, null);
                    } else {
                        await enviarMensajeSimple(chatId, "🤷‍♀️ No he encontrado ninguna ficha con ese ID. Comprueba que empiece por #ALU y vuelve a intentarlo.");
                        await airtableService.borrarSesion(chatId);
                    }
                    return res.status(200).json({ ok: true });
                }

                // B. Nombre Real de Alumna (Actualización de Ficha)
                if (paso === "ACAD_ESP_NOMBRE_REAL") {
                    const ficha = await airtableService.obtenerFichaAlumna(chatId);
                    if (ficha) await airtableService.base('Alumnas_Comunidad').update(ficha.id, { "Nombre_Real": textoRecibido });
                    
                    // Preparamos el siguiente paso enviando la metadata actualizada
                    metadata.step = "ACAD_ESP_PROYECTO";
                    await airtableService.guardarSesion(chatId, metadata.step, metadata);
                    await enviarMensajeConReply(chatId, `✅ ¡Encantada, **${textoRecibido}**! Ya estás bien anotada.\n\nAhora cuéntame, ¿en qué **Proyecto** estás trabajando? 🧵`, null);
                    return res.status(200).json({ ok: true });
                }

                // B. Inventario IA
                if (paso.startsWith("ESPERANDO_")) {
                    const result = await inventoryService.handleInventoryIAWorkflow(chatId, metadata, textoRecibido);
                    if (result.isFinal) {
                        await airtableService.borrarSesion(chatId);
                        await enviarMensajeSimple(chatId, result.text);
                    } else {
                        await airtableService.guardarSesion(chatId, result.metadata.step, result.metadata);
                        if (result.type === 'reply') await enviarMensajeConReply(chatId, result.text);
                        else await enviarMensajeSimple(chatId, result.text);
                    }
                    return res.status(200).json({ ok: true });
                }

                // C. Visualizador (Laboratorio Mamafina)
                if (paso === "VIZ_ESP_TELA") {
                    const telas = await airtableService.buscarTelas(textoRecibido.trim());
                    if (!telas || telas.length === 0) {
                        await enviarMensajeSimple(chatId, "❌ No encontré esa tela. Prueba con otro nombre.");
                    } else {
                        for (const t of telas) {
                            await enviarMensajeConBotones(chatId, `🧵 *Tela:* ${t.fields.Articulo}`, [[{ text: "✨ Elegir", callback_data: `TELA_SEL|${t.id.slice(-5)}` }]]);
                        }
                        await airtableService.borrarSesion(chatId);
                    }
                    return res.status(200).json({ ok: true });
                }

                if (paso === "VIZ_ESP_PRODUCTO") {
                    const productos = await airtableService.buscarProductos(textoRecibido.trim());
                    if (!productos || productos.length === 0) {
                        await enviarMensajeSimple(chatId, "❌ No encontré ese producto. Prueba con otro nombre.");
                    } else {
                        for (const p of productos) {
                            await enviarMensajeConBotones(chatId, `👗 *Producto:* ${p.fields.Articulo}`, [[{ text: "✨ Elegir", callback_data: `PROD_SEL|${p.id}` }]]);
                        }
                        await airtableService.borrarSesion(chatId);
                    }
                    return res.status(200).json({ ok: true });
                }

                // D. Consultas Escaparate e Interesadas Academia
                if (["ESP_CONSULTA", "ESP_NOMBRE", "ESP_TELEFONO", "ESP_NOMBRE_INTERESADA", "ESP_TEL_INTERESADA"].includes(paso)) {
                    const result = await escaparateService.handleConsultationWorkflow(textoRecibido, metadata);
                    
                    if (result.isFinal) {
                        await enviarMensajeSimple(chatId, "⏳ Guardando todo en el libro de hilos...");
                        
                        // Aquí llamamos a tu función maestra (la que sabe distinguir la tabla de espera)
                        await airtableService.guardarConsultaFinal(result.meta);
                        
                        if (escaparateService.estaLaTiendaAbierta()) {
                            const linkWA = await escaparateService.formatearLinkWA("636796210", result.meta.nombreCliente, `¡Hola! Soy ${result.meta.nombreCliente}. Os escribo por la consulta: "${result.meta.mensajeConsulta}"`);                    
                            await enviarMensajeConBotones(chatId, `✅ ¡Hecho! Ya podéis hablar por aquí:`, [[{ text: "📲 WhatsApp Directo", url: linkWA }], [{ text: "🏠 Menú Principal", callback_data: "CLI_INICIO" }]]);
                        } else {
                            await enviarMensajeConBotones(chatId, result.text, [[{ text: "🏠 Menú", callback_data: "CLI_INICIO" }]]);
                        }
                    } else {
                        // Si no es el final, sigue preguntando
                        await airtableService.guardarSesion(chatId, result.meta.step, result.meta);
                        await enviarMensajeConReply(chatId, result.text, null);
                    }
                    return res.status(200).json({ ok: true });
                }

                // D. Trabajos Admin (Guardar fotos en portfolio)
                if (paso === "ESP_NOMBRE_TRABAJO" && esAdmin) {
                    metadata.nombre = textoRecibido;
                    metadata.step = "ESP_CATEGORIA_TRABAJO";
                    const botonesCat = [
                        [{ text: "👗 Ropa", callback_data: `CAT_TRAB|Ropa|${metadata.uniqueId}` }, { text: "👜 Bolsos", callback_data: `CAT_TRAB|Bolsos|${metadata.uniqueId}` }],
                        [{ text: "👶 Bebes", callback_data: `CAT_TRAB|Bebes|${metadata.uniqueId}` }, { text: "✨ Otros", callback_data: `CAT_TRAB|Otros|${metadata.uniqueId}` }]
                    ];
                    await airtableService.guardarSesion(chatId, "ESP_CATEGORIA_TRABAJO", metadata);
                    await enviarMensajeConBotones(chatId, `Perfecto: "${metadata.nombre}". ¿En qué categoría lo guardamos?`, botonesCat);
                    return res.status(200).json({ ok: true });
                }

                // E. Admin Clases (Cambio de hora)
                if (paso === "ADM_ESP_NUEVA_HORA" && esAdmin) {
                    const result = await academiaService.actualizarHorarioClase(metadata.idClase, textoRecibido);
                    const botones = [[{ text: result.esGrupo ? "📲 Enviar al Grupo" : `📲 Avisar a ${result.nombreAlu}`, url: result.linkWA }]];
                    await enviarMensajeConBotones(chatId, `${result.text}\n\n${result.instrucciones}`, botones);
                    return res.status(200).json({ ok: true });
                }

                
            } 

            
            // 5. BORRADOES ACTIVOS
            try {
                // A. Borrador Pedido
                const borradorPedido = await airtableService.obtenerBorradorActivo(chatId);
                console.log("🔍 [DEBUG BORRADOR] borradorPedido:", borradorPedido ? borradorPedido.id : "null");
                if (borradorPedido && borradorPedido.id) {
                    const result = await orderService.handleOrderWorkflow(chatId, replyText.toLowerCase(), textoRecibido, borradorPedido.id);
                    if (result.isFinal) {
                        const linkWA = await escaparateService.formatearLinkWA(result.clienteTelefono, result.clienteNombre, `¡Hola ${result.clienteNombre}! ✨ Tu pedido en Mamafina ya está anotado. Tu código es: ${result.ticketNum}.`);
                        await enviarMensajeConBotones(chatId, result.text, [[{ text: "📲 Enviar Ticket por WhatsApp", url: linkWA }]]);
                    } else {
                        await enviarMensajeConReply(chatId, result.text);
                    }
                    return res.status(200).json({ ok: true });
                }

                // B. Borrador Academia (Solo para alumnas)
                if (!esAdmin) {
                    console.log("🔍 [DEBUG ACADEMIA] entrando en borrador academia");
                    console.log("🔍 [DEBUG ACADEMIA] replyText:", replyText);
                    const sesionAcad = await airtableService.obtenerSesion(chatId);
                    let fichaAlumna = null;
                    if (sesionAcad && sesionAcad.metadata && sesionAcad.metadata.airtableId) {
                        fichaAlumna = { id: sesionAcad.metadata.airtableId };
                    }
                    if (!fichaAlumna) {
                        const ficha = await airtableService.obtenerFichaAlumna(chatId);
                        if (ficha) fichaAlumna = ficha;
                    }
                    console.log("🔍 [DEBUG ACADEMIA] metadata:", sesionAcad?.metadata);
                    console.log("🔍 [DEBUG ACADEMIA] fichaAlumna:", fichaAlumna);
                    const replyLower = replyText.toLowerCase();
                    if (fichaAlumna && replyText && (
                        replyLower.includes("libreta") ||
                        replyLower.includes("proyecto") ||
                        replyLower.includes("detalles") ||
                        replyLower.includes("enlace")
                    )) {
                        console.log("🔍 [DEBUG ACADEMIA] llamando workflow con step:", replyText.toLowerCase());
                        const result = await academiaService.handleAcademiaWorkflow(
                            chatId, replyText.toLowerCase(), textoRecibido, fichaAlumna.id
                        );
                        if (result.isFinal) await enviarMensajeSimple(chatId, result.text);
                        else await enviarMensajeConReply(chatId, result.text);
                        return res.status(200).json({ ok: true });
                    }
                }
            } catch (e) { 
                console.error("⚠️ Error leyendo borradores, bot sigue vivo:", e.message); 
                return res.status(200).json({ ok: true });
            }
        

            //6. FLUJOS EXCLUSIVOS ADMIN

            if (esAdmin) {

                try {
                if (esRespuesta) {

                 

                    // No usa metadatos, lee directamente el texto del prompt de venta
                    if (replyText.includes("¿Cuántas unidades vendidas de:")) {
                        await enviarMensajeSimple(chatId, "⏳ Actualizando stock...");
                        const saleResult = await inventoryService.executeSale(replyText, textoRecibido, user);
                        await enviarMensajeSimple(chatId, saleResult.text);
                        return res.status(200).json({ ok: true });
                    }

                    // B. Búsqueda de stock ❓
          
                    if (rTextLower.includes("artículo buscas en el inventario")) {
                        const busqueda = textoRecibido.trim();
                        await enviarMensajeSimple(chatId, `🔍 Buscando "${busqueda}"...`);
                        const searchData = await inventoryService.searchStock(busqueda);
                        await enviarMensajeSimple(chatId, searchData.text);
                        for (const block of searchData.blocks) {
                            await enviarMensajeConBotones(chatId, block.text, block.buttons);
                        }
                        return res.status(200).json({ ok: true });
                    }


                    // C. Respuesta a tareas ❓
                    if (replyText.includes("Escribe la descripción de la tarea")) {
                        const taskData = await taskService.handleTaskInput(chatId, textoRecibido);
                        await enviarMensajeConBotones(chatId, taskData.text, taskData.buttons);
                        return res.status(200).json({ ok: true });
                    }
                    
                        

                    // Mensaje por defecto si ninguna condición anterior coincide
                    await enviarMensajeSimple(chatId, "No he entendido esa respuesta. ¿Puedes intentarlo de nuevo?");
                    return res.status(200).json({ ok: true });
   
                }//CIERRE ESRESPUESTAS

                   
                //7. COMANDOS DIRECTOS
                    
                // A. Whatsapp directo
                if (textoMinus.startsWith("wa:")) {
                    const nombreBusqueda = textoRecibido.split(":")[1]?.trim();
                    if (!nombreBusqueda) {
                        await enviarMensajeSimple(chatId, "⚠️ Indica un nombre. Ej: `wa:Maria`.");
                        return res.status(200).json({ ok: true });
                    }
                    const pedidos = await airtableService.getPedidosActivos();
                    let persona = pedidos.find(p => p.fields.Nombre_Cliente && p.fields.Nombre_Cliente.toLowerCase().includes(nombreBusqueda.toLowerCase()));
                    let fuente = "Pedido", nombreFinal, telefonoFinal;

                    if (!persona) {
                        const consultas = await airtableService.obtenerConsultasPendientes();
                        persona = consultas.find(c => c.nombre && c.nombre.toLowerCase().includes(nombreBusqueda.toLowerCase()));
                        if (persona) { fuente = "Consulta"; nombreFinal = persona.nombre; telefonoFinal = persona.tel; }
                    } else {
                        nombreFinal = persona.fields.Nombre_Cliente; telefonoFinal = persona.fields.Telefono;
                    }

                    if (persona) {
                        const link = await escaparateService.formatearLinkWA(telefonoFinal, nombreFinal, `¡Hola ${nombreFinal}! Te escribo de la costura por tu ${fuente.toLowerCase()}... ✨`);
                        await enviarMensajeConBotones(chatId, `📲 WhatsApp para ${nombreFinal} (${fuente}):`, [[{ text: "Abrir Chat", url: link }]]);
                    } else {
                        await enviarMensajeSimple(chatId, `❌ No encontré a "${nombreBusqueda}".`);
                    }
                    return res.status(200).json({ ok: true });
                }    

                // B. Visualizar
                if (textoMinus.startsWith("/visualizar")) {
                    await airtableService.guardarSesion(chatId, "VIZ_ESP_TELA", {});
                    await enviarMensajeConReply(chatId, "🎨 **Laboratorio Mamafina**\n¿Qué tela buscamos?");
                    return res.status(200).json({ ok: true });
                } 
                
                // C. Inventario  

                // Comando stcock/inventario 
                if (textoMinus.includes("stock") || textoMinus.includes("inventario")) {
                    const busq = textoMinus.replace(/stock|inventario|de/gi, "").trim();
                    
                    if (!busq) {
                        await enviarMensajeConReply(chatId, "🔍 ¿Qué artículo buscas en el inventario?");
                    } else {
                        try {
                            const searchData = await inventoryService.searchStock(busq);
                            
                            // Si el servicio devuelve el texto de "No encontré...", lo enviamos
                            await enviarMensajeSimple(chatId, searchData.text);
                            
                            // Solo intentamos el bucle si hay bloques reales
                            if (searchData.blocks && searchData.blocks.length > 0) {
                                for (const block of searchData.blocks) {
                                    await enviarMensajeConBotones(chatId, block.text, block.buttons);
                                }
                            }
                        } catch (e) {
                            console.error("💥 ERROR CRÍTICO EN COMANDO STOCK:", e.message);
                            await enviarMensajeSimple(chatId, "⚠️ Ay jefa, me he liado buscando en los estantes. Inténtalo de nuevo.");
                        }
                    }
                    return res.status(200).json({ ok: true });
                }
                
                // Añadir artículo manualmente 
                else if (textoMinus.includes("añadir artículo") || textoMinus.includes("nuevo producto")) {
                    // Inicializamos la mochila de datos con el primer paso
                    const metadataManual = { 
                        step: "ESPERANDO_NOMBRE", 
                        tipo: "MERC", // Por defecto a Mercería, luego se puede ajustar
                        precio: 0,
                        stock: 0,
                        referencia: ""
                    };
                    
                    await airtableService.guardarSesion(chatId, "ESPERANDO_NOMBRE", metadataManual);
                    await enviarMensajeConReply(chatId, `🆕 **Entrada Manual de Inventario**\n¿Cuál es el **Nombre** del artículo?`, null);
                    return res.status(200).json({ ok: true });
                }   

                // D. Pedios
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
                        // ✨ Usamos la nueva función pasando el objeto del detalle
                        await airtableService.actualizarEstadoPedido(nuevoP.id, { "Pedido_Detalle": detalle });
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
                // E. Tareas

                // Crear nueva tarea 
                if (textoMinus.startsWith("tarea:")) {
                    const response = await taskService.handleTaskInput(chatId, textoRecibido);
                    await enviarMensajeConBotones(chatId, response.text, response.buttons);
                    return res.status(200).json({ ok: true });
                }

                // Ver lista de tareas
                else if (textoMinus.includes("tareas") || textoMinus.includes("pendientes")) {
                    const listData = await taskService.formatTaskList();
                    
                    if (listData.blocks) {
                        // Si hay tareas, enviamos el encabezado y luego cada tarea con sus botones
                        await enviarMensajeSimple(chatId, listData.text);
                        for (const block of listData.blocks) {
                            await enviarMensajeConBotones(chatId, block.text, block.buttons);
                        }
                    } else {
                        await enviarMensajeSimple(chatId, listData.text);
                    }
                    return res.status(200).json({ ok: true });

                }

                // Purga
                if (textoMinus === "/purgar" || textoMinus === "limpiar todo") {
                    const nTareas = await airtableService.vaciarHistorialTareas();
                    const nPedidos = await airtableService.vaciarPedidosCompletados();
                    await enviarMensajeSimple(chatId, `✨ **¡Taller reluciente!**\n🗑️ Tareas borradas: ${nTareas}\n📦 Pedidos archivados: ${nPedidos}`);
                    return res.status(200).json({ ok: true });
                }

                // F. Clientela

                // Ver consultas de clientes (TB-09)
                if (textoMinus === "/consultas" || textoMinus === "consultas") {
                    try {
                        const consultData = await orderService.getPendingConsultations();
                        await enviarMensajeSimple(chatId, consultData.text);
                        
                        if (consultData.blocks) {
                            for (const block of consultData.blocks) {
                                await enviarMensajeConBotones(chatId, block.text, block.buttons);
                            }
                        }
                    } catch (e) {
                        console.error("💥 Error en comando /consultas:", e.message);
                        await enviarMensajeSimple(chatId, "❌ No he podido recuperar las consultas ahora mismo.");
                    }
                    return res.status(200).json({ ok: true });
                }    
                
                // B. Ver interesados en pedido (Estado: 🙋Cliente Interesado)
                else if (textoMinus === "/interesados" || textoMinus === "interesados") {
                    try {
                        // Delegamos la búsqueda y generación de botones al servicio de pedidos
                        const interestedData = await orderService.getInterestedClients();
                        
                        await enviarMensajeSimple(chatId, interestedData.text);
                        
                        if (interestedData.blocks) {
                            for (const block of interestedData.blocks) {
                                await enviarMensajeConBotones(chatId, block.text, block.buttons);
                            }
                        }
                    } catch (e) {
                        console.error("💥 Error en comando /interesados:", e.message);
                        await enviarMensajeSimple(chatId, "❌ No he podido ver los clientes interesados ahora.");
                    }
                    return res.status(200).json({ ok: true });
                }
                
                // G. Academia

                // PANEL DE MÓDULOS — encender/apagar servicios de IA
                if (textoMinus === "/modulos") {
                    const marketingActivo = await airtableService.getConfigValue('modulo_marketing') === 'true';
                    const buenosDiasActivo = await airtableService.getConfigValue('modulo_buenos_dias') === 'true';
                    const chatbotActivo = await airtableService.getConfigValue('modulo_chatbot_admin') === 'true';

                    const texto = `⚙️ *Panel de Módulos*\n\nEstado actual de los servicios de IA:`;
                    const botones = [
                        [{ text: `${marketingActivo ? '✅' : '⭕'} Marketing (copy Instagram)`, callback_data: `MOD_TOGGLE|modulo_marketing|${marketingActivo}` }],
                        [{ text: `${buenosDiasActivo ? '✅' : '⭕'} Buenos días`, callback_data: `MOD_TOGGLE|modulo_buenos_dias|${buenosDiasActivo}` }],
                        [{ text: `${chatbotActivo ? '✅' : '⭕'} Chatbot admin`, callback_data: `MOD_TOGGLE|modulo_chatbot_admin|${chatbotActivo}` }],
                        [{ text: "🏠 Cerrar", callback_data: "CLI_INICIO" }]
                    ];
                    await enviarMensajeConBotones(chatId, texto, botones);
                    return res.status(200).json({ ok: true });
                
                }
                if (textoMinus === "academia" || textoMinus === "/clases") {
                    const botones = [
                        [{ text: "🧵 Gestionar Costura", callback_data: "ADM_CLASES|🧵Costura" }],
                        [{ text: "🧶 Gestionar Crochet", callback_data: "ADM_CLASES|🧶Crochet" }],
                        [{ text: "🏠 Menú Principal", callback_data: "/start" }]
                    ];
                    await enviarMensajeConBotones(chatId, "🎓 **Panel de Control de la Academia**\n\n¿Qué especialidad quieres gestionar hoy, jefa?", botones);
                    return res.status(200).json({ ok: true });
                }

                // Si es un Admin y escribe algo que no reconoce, la IA responde (cajón de sastre) 🫧 LIMPIO
                if (!esRespuesta && !textoMinus.startsWith("/")) {
                    const respuestaIA = await openaiService.generarRespuesta(textoRecibido);
                    await enviarMensajeSimple(chatId, respuestaIA);
                    return res.status(200).json({ ok: true });
                }  
       
                }//Cierre try esrespuestas
            
            catch (e) {
                // Si CUALQUIERA de los de arriba falla, esto nos salva del bucle
                console.error("💥 Error en bloque Admin:", e.message);
                await enviarMensajeSimple(chatId, "⚠️ Jefa, ha habido un error técnico en esa última orden.");
                return res.status(200).json({ ok: true });
            }

        }// CIERRE ES ADMIN
                
            // 8. FLUJOS CLIENTE
            else { 
                                                
                // B. Interceptor de IA para el ARCHIVADOR VISUAL
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

                // C. Cajón de sastre
                const mensajeAyuda = "No te he entendido muy bien, primor. 🧵 ¿Quieres consultar un pedido o dejar una consulta? Usa los botones del /start";
                await enviarMensajeSimple(chatId, mensajeAyuda);
                return res.status(200).json({ ok: true }); // ✅ FINAL DE TRAYECTO
                
            } //CIERRE FLUJO DE CLIENTES
            
        
        }//CIERRE FLUJO DE TEXTO 
        return res.status(200).json({ ok: true }); // ✅ FINAL DE TRAYECTO

    } 

    catch (error) {
        console.error("💥 Error Crítico Global:", error.message);
        return res.status(200).json({ ok: true });
    } 

     // --- HELPERS (FUNCIONES DE APOYO) ---
    // IMPORTANTE: Estas funciones están DENTRO del handler pero FUERA del try/catch



    async function enviarMensajeSimple(chatId, texto) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' })
        });
    }

    async function enviarMensajeConBotones(chatId, texto, botones, parseMode = 'Markdown') {
        const body = {
            chat_id: chatId,
            text: texto,
            reply_markup: { inline_keyboard: botones }
        };
        if (parseMode != null) {
            body.parse_mode = parseMode;
        }
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    async function enviarMensajeConReply(chatId, texto, parseMode = 'Markdown') {
        const body = {
            chat_id: chatId,
            text: texto,
            reply_markup: { force_reply: true }
        };
        if (parseMode != null) {
            body.parse_mode = parseMode;
        }
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
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

}; //CERRAMOS HANDLER