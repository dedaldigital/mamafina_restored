const fetch = require('node-fetch');
const FormData = require('form-data');

class ImgBBService {
    async subirAFotoUsuario(urlTelegram) {
        try {
            // 1. Descargamos la imagen de Telegram
            const respuestaImagen = await fetch(urlTelegram);
            const buffer = await respuestaImagen.buffer();
            const base64Image = buffer.toString('base64');
    
            // 2. IMPORTANTE: Usamos URLSearchParams en lugar de FormData
            // Esto envía la imagen como un string de texto puro, evitando errores de "Internal upload"
            const body = new URLSearchParams();
            body.append('image', base64Image);
    
            // 3. Petición a ImgBB
            const res = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
                method: 'POST',
                body: body,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
    
            const data = await res.json();
    
            if (data.success) {
                console.log("✅ Imagen en ImgBB:", data.data.url);
                return data.data.url;
            } else {
                console.error("❌ Error API ImgBB:", data.error || data);
                return null;
            }
        } catch (error) {
            console.error("💥 Fallo total en ImgBBService:", error.message);
            return null;
        }
    }

    // NUEVO MÉTODO: Recibe directamente el texto Base64 de Gemini
    async subirBase64(base64Image) {
        try {
            const formData = new FormData();
            formData.append('image', base64Image);
            // formData.append('album_id', process.env.IMGBB_ALBUM_ID); // Opcional según tu .env

            const res = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (data.success) {
                console.log("✅ Diseño de Gemini subido a ImgBB:", data.data.url);
                return data.data.url;
            } else {
                console.error("❌ Error API ImgBB al subir diseño:", data.error);
                return null;
            }
        } catch (error) {
            console.error("💥 Fallo en ImgBBService (subirBase64):", error.message);
            return null;
        }
    }
}

module.exports = new ImgBBService();