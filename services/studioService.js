const airtableService = require('./airtableService');
const openaiService = require('./openaiService');
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

        const descProdIA = producto.fields.Prompt_Final || "a plain white garment";
        let descTelaIA = borrador.fields.Prompt_Tela_Lookup;

        if (!descTelaIA && borrador.fields.Tela_Relacionada) {
            const idTela = borrador.fields.Tela_Relacionada[0];
            const registroTela = await airtableService.base(airtableService.t.telas).find(idTela);
            descTelaIA = registroTela.fields.Prompt_Final;
        }
        descTelaIA = descTelaIA || "minimalist repeating pattern";

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

        const imgTmp = await openaiService.generarImagenDiseno(promptMaestro);
        if (!imgTmp) throw new Error("No se pudo generar la imagen.");
        const urlFinal = await imgbbService.subirAFotoUsuario(imgTmp) || imgTmp;

        await airtableService.base(airtableService.t.disenos).update(borrador.id, {
            "Imagen_Generada": urlFinal,
            "Prompt_Final": promptMaestro
        });

        return { urlFinal, borradorId: borrador.id, idProducto };
    }

    async regenerarDiseno(chatId, idBorrador, idProducto) {
        if (!idBorrador || !idProducto) throw new Error("Faltan IDs para regenerar");

        const borradorValido = await airtableService.base(airtableService.t.disenos).find(idBorrador);
        const productoValido = await airtableService.base(airtableService.t.productos).find(idProducto);

        if (!borradorValido || !productoValido) throw new Error("No encontré los registros en Airtable");

        let promptMaestro;

        if (borradorValido.fields.Prompt_Final) {
            promptMaestro = borradorValido.fields.Prompt_Final;
        } else {
            const descProdIA = productoValido.fields.Prompt_Final || "a plain white garment";
            let descTelaIA = borradorValido.fields.Prompt_Tela_Lookup;

            if (!descTelaIA && borradorValido.fields.Tela_Relacionada) {
                const idTela = borradorValido.fields.Tela_Relacionada[0];
                const registroTela = await airtableService.base(airtableService.t.telas).find(idTela);
                descTelaIA = registroTela.fields.Prompt_Final;
            }
            descTelaIA = descTelaIA || "minimalist repeating pattern";

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
        }

        const img = await openaiService.generarImagenDiseno(promptMaestro);
        if (!img) throw new Error("No se pudo generar la imagen.");
        const urlFinal = await imgbbService.subirAFotoUsuario(img) || img;

        await airtableService.base(airtableService.t.disenos).update(borradorValido.id, {
            "Imagen_Generada": urlFinal,
            "Prompt_Final": promptMaestro
        });

        return { urlFinal, idBorrador, idProducto };
    }
}

module.exports = new StudioService();