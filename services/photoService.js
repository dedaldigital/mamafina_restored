const openaiService = require('./openaiService');
const fetch = require('node-fetch');

class PhotoService {

    obtenerBotonesAdmin(uniqueId) {
        return [
            [{ text: "🧵 Tela", callback_data: `FOTO_TELA|${uniqueId}` }],
            [{ text: "👗 Producto", callback_data: `FOTO_PROD|${uniqueId}` }],
            [{ text: "✨ Trabajo Realizado", callback_data: `FOTO_TRABAJO|${uniqueId}` }],
            [{ text: "🔘 Mercería", callback_data: `FOTO_MERC|${uniqueId}` }]
        ];
    }

    async _obtenerUrlFoto(fotoId) {
        const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fotoId}`;
        const fileRes = await fetch(url);
        const fileJson = await fileRes.json();
        if (!fileJson.ok || !fileJson.result || !fileJson.result.file_path) {
            throw new Error("No se pudo obtener la foto desde Telegram.");
        }
        return `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileJson.result.file_path}`;
    }

    async procesarFotoAdmin(chatId, tipo, uniqueId, fotoId) {
        const fileUrl = await this._obtenerUrlFoto(fotoId);

        if (tipo === "FOTO_TRABAJO") {
            return {
                tipo: "TRABAJO",
                step: "ESP_NOMBRE_TRABAJO",
                uniqueId,
                fotoId,
                esTrabajo: true
            };
        }

        let promptAnalizado = "";

        if (tipo === "FOTO_TELA") {
            promptAnalizado = await openaiService.describirTela(fileUrl);
        } else if (tipo === "FOTO_PROD") {
            promptAnalizado = await openaiService.describirProducto(fileUrl);
        }

        const analisis = await openaiService.analizarImagenInventario(fileUrl, tipo);

        if (tipo === "FOTO_TELA") {
            return {
                ...analisis,
                uniqueId,
                fotoId,
                tipo: "TELA",
                prompt_final: promptAnalizado,
                prompt_prod: "",
                step: "ESPERANDO_NOMBRE"
            };
        }

        if (tipo === "FOTO_PROD") {
            return {
                ...analisis,
                uniqueId,
                fotoId,
                tipo: "PROD",
                prompt_final: "",
                prompt_prod: promptAnalizado,
                step: "ESPERANDO_NOMBRE"
            };
        }

        if (tipo === "FOTO_MERC") {
            return {
                ...analisis,
                uniqueId,
                fotoId,
                tipo: "MERC",
                prompt_final: "",
                prompt_prod: "",
                step: "ESPERANDO_NOMBRE"
            };
        }

        throw new Error(`Tipo de foto no soportado: ${tipo}`);
    }
}

module.exports = new PhotoService();