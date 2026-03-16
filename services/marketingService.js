// services/marketingService.js
const fetch = require('node-fetch');
const { GoogleGenAI } = require('@google/genai');

let ai = null;

function getAI() {
    if (!ai) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY no está definido.');
        ai = new GoogleGenAI({ apiKey });
    }
    return ai;
}

async function descargarImagenComoBase64(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Error al descargar imagen: ${response.status}`);
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    const buffer = await response.buffer();
    
    return {
        base64: buffer.toString('base64'),
        mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg'
    };
}

async function generarCopyTrabajo(urlFoto, nombreProyecto) {
    const imagen = await descargarImagenComoBase64(urlFoto);

    const prompt = `
Eres el asistente de marketing de Mamafina, una mercería creativa en Madrid. 
Mamafina es un negocio artesanal con mucho corazón, llevado por Reyes. 
Su tono es cercano, cálido, femenino y entusiasta. Usa algún emoji de costura 
o textil pero sin exagerar. Tutea siempre.

Mira esta foto de un trabajo terminado que se llama "${nombreProyecto}".

Escribe un post para Instagram con este formato EXACTO:

1. Una frase de apertura llamativa que enganche (máximo 1 línea)
2. Descripción del trabajo en 2-3 líneas: qué es, qué tiene de especial, qué transmite
3. Una pregunta o CTA que invite a la comunidad a reaccionar o a pedir uno
4. Entre 8 y 12 hashtags relevantes para costura, bordado, mercería y personalización en España

Tono: como si Reyes lo escribiera ella misma, con orgullo y cariño por su trabajo.
No uses asteriscos para negritas. Escribe el texto tal cual se publicaría en Instagram.
    `.trim();

    const response = await getAI().models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [
            {
                role: 'user',
                parts: [
                    { text: prompt },
                    { inlineData: { data: imagen.base64, mimeType: imagen.mimeType } }
                ]
            }
        ]
    });

    if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Gemini no devolvió texto en la respuesta.');
    }

    return response.candidates[0].content.parts[0].text.trim();
}

module.exports = { generarCopyTrabajo };