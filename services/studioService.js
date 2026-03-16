const airtableService = require('./airtableService');
const geminiService = require('./geminiService');
const imgbbService = require('./imgbbService');

class StudioService {

    async seleccionarTela(chatId, shortId) {
        const registrosTelas = await airtableService.base(airtableService.t.telas).select().all();
        const tela = registrosTelas.find(r => r.id.endsWith(shortId));

        if (!tela) {
            throw new Error("Tela no encontrada.");
        }

        await airtableService.base(airtableService.t.disenos).create([{
            fields: {
                "ID_Sesion": String(chatId),
                "Tela_Relacionada": [tela.id]
            }
        }]);

        return { ok: true };
    }

    async generarDiseno(chatId, idProducto) {
        const producto = await airtableService.base(airtableService.t.productos).find(idProducto);
        const borrador = await airtableService.obtenerBorradorDiseno(chatId);

        if (!producto || !borrador) throw new Error("Datos no encontrados.");

        // Obtener URL de la foto del producto
        const urlFotoProducto = producto.fields.Foto || null;

        // Obtener URL de la foto de la tela relacionada
        let urlFotoTela = null;
        const relacionTela = borrador.fields.Tela_Relacionada;

        if (Array.isArray(relacionTela) && relacionTela[0]) {
            const idTela = relacionTela[0];
            const registroTela = await airtableService.base(airtableService.t.telas).find(idTela);

            urlFotoTela = registroTela && registroTela.fields && registroTela.fields.Foto
                ? registroTela.fields.Foto
                : null;
        }

        if (!urlFotoTela && !urlFotoProducto) {
            throw new Error("Faltan las fotos de tela y producto para generar el diseño.");
        }

        if (!urlFotoTela) {
            throw new Error("Falta la foto de la tela (campo 'Foto' en el registro de tela relacionado).");
        }

        if (!urlFotoProducto) {
            throw new Error("Falta la foto del producto (campo 'Foto' en el registro de producto).");
        }

        // Llamar a Gemini para generar la imagen a partir de las dos fotos
        const base64Generado = await geminiService.generarDiseno(urlFotoTela, urlFotoProducto, "R");

        if (!base64Generado) {
            throw new Error("No se pudo generar la imagen con Gemini.");
        }

        // Subir el base64 a ImgBB
        const urlFinal = await imgbbService.subirBase64(base64Generado);

        if (!urlFinal) {
            throw new Error("No se pudo subir la imagen generada a ImgBB.");
        }

        // Guardar en Airtable
        await airtableService.base(airtableService.t.disenos).update(borrador.id, {
            "Imagen_Generada": urlFinal
        });

        return { urlFinal, borradorId: borrador.id, idProducto };
    }

    async regenerarDiseno(chatId, idBorrador, idProducto) {
        if (!idBorrador || !idProducto) throw new Error("Faltan IDs para regenerar");

        const borradorValido = await airtableService.base(airtableService.t.disenos).find(idBorrador);
        const productoValido = await airtableService.base(airtableService.t.productos).find(idProducto);

        if (!borradorValido || !productoValido) throw new Error("No encontré los registros en Airtable");

        // Obtener URL de la foto del producto (siempre desde el registro actual)
        const urlFotoProducto = productoValido.fields.Foto || null;

        // Obtener URL de la foto de la tela relacionada (siempre desde el registro actual)
        let urlFotoTela = null;
        const relacionTela = borradorValido.fields.Tela_Relacionada;

        if (Array.isArray(relacionTela) && relacionTela[0]) {
            const idTela = relacionTela[0];
            const registroTela = await airtableService.base(airtableService.t.telas).find(idTela);

            urlFotoTela = registroTela && registroTela.fields && registroTela.fields.Foto
                ? registroTela.fields.Foto
                : null;
        }

        if (!urlFotoTela && !urlFotoProducto) {
            throw new Error("Faltan las fotos de tela y producto para regenerar el diseño.");
        }

        if (!urlFotoTela) {
            throw new Error("Falta la foto de la tela (campo 'Foto' en el registro de tela relacionado).");
        }

        if (!urlFotoProducto) {
            throw new Error("Falta la foto del producto (campo 'Foto' en el registro de producto).");
        }

        // Llamar a Gemini para generar la nueva imagen
        const base64Generado = await geminiService.generarDiseno(urlFotoTela, urlFotoProducto, "R");

        if (!base64Generado) {
            throw new Error("No se pudo generar la imagen con Gemini.");
        }

        // Subir a ImgBB
        const urlFinal = await imgbbService.subirBase64(base64Generado);

        if (!urlFinal) {
            throw new Error("No se pudo subir la imagen generada a ImgBB.");
        }

        // Guardar en Airtable (ya no guardamos Prompt_Final)
        await airtableService.base(airtableService.t.disenos).update(borradorValido.id, {
            "Imagen_Generada": urlFinal
        });

        return { urlFinal, idBorrador, idProducto };
    }
}

module.exports = new StudioService();