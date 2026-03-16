// services/marketingService.js
const fetch = require('node-fetch');
const { GoogleGenAI } = require('@google/genai');
const airtableService = require('./airtableService');

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

// Lee todos los tipos de post activos de Airtable
async function obtenerTiposPost() {
    try {
        const tabla = process.env.AT_TABLE_TIPOS_POST || 'Tipos_Post_Marketing';
        const records = await airtableService.base(tabla).select({
            filterByFormula: "{Activo} = 1",
            fields: ['Nombre', 'Descripcion', 'Requiere'],
            sort: [{ field: 'Nombre', direction: 'asc' }]
        }).all();
        return records.map(r => ({
            nombre: r.fields.Nombre,
            descripcion: r.fields.Descripcion || '',
            requiere: r.fields.Requiere || 'foto'
        }));
    } catch (e) {
        console.error('💥 Error leyendo tipos de post:', e.message);
        return [];
    }
}

// Lee los trabajos de los últimos 7 días para ver qué tipos se han usado
async function obtenerHistorialReciente() {
    try {
        const haceUnaSemana = new Date();
        haceUnaSemana.setDate(haceUnaSemana.getDate() - 7);
        const fechaISO = haceUnaSemana.toISOString().split('T')[0];

        const records = await airtableService.base('Trabajos_Realizados').select({
            filterByFormula: `AND({Tipo_Post} != '', IS_AFTER({Fecha_Terminado}, '${fechaISO}'))`,
            fields: ['Tipo_Post', 'Fecha_Terminado'],
            sort: [{ field: 'Fecha_Terminado', direction: 'desc' }],
            maxRecords: 20
        }).all();

        return records
            .map(r => r.fields.Tipo_Post)
            .filter(Boolean);
    } catch (e) {
        console.error('💥 Error leyendo historial reciente:', e.message);
        return [];
    }
}

// Usa Gemini para sugerir el tipo de post más adecuado dada la foto y el historial
async function sugerirTipoPost(urlFoto, nombreProyecto) {
    try {
        const [tipos, historial] = await Promise.all([
            obtenerTiposPost(),
            obtenerHistorialReciente()
        ]);

        // Filtramos los que requieren solo foto o texto — los de gemini_imagen no aplican aquí
        const tiposDisponibles = tipos.filter(t => t.requiere !== 'gemini_imagen' && t.requiere !== 'manual');

        if (tiposDisponibles.length === 0) return null;

        const listaTipos = tiposDisponibles
            .map(t => `- ${t.nombre}: ${t.descripcion}`)
            .join('\n');

        const historialTexto = historial.length > 0
            ? `En los últimos 7 días se han publicado estos tipos: ${historial.join(', ')}.`
            : 'No hay publicaciones recientes registradas.';

        const prompt = `
Eres el director de marketing de Mamafina, una mercería creativa en Madrid.

Tienes esta foto de un trabajo terminado llamado "${nombreProyecto}".
${historialTexto}

Estos son los tipos de post disponibles:
${listaTipos}

Teniendo en cuenta la foto, el nombre del proyecto y el historial reciente,
sugiere los 3 tipos de post más adecuados para esta foto.
Prioriza variedad respecto al historial reciente.

Responde ÚNICAMENTE con un JSON válido con este formato exacto, sin texto adicional:
{
  "sugerencias": [
    { "nombre": "Nombre exacto del tipo", "razon": "Por qué encaja en máximo 8 palabras" },
    { "nombre": "Nombre exacto del tipo", "razon": "Por qué encaja en máximo 8 palabras" },
    { "nombre": "Nombre exacto del tipo", "razon": "Por qué encaja en máximo 8 palabras" }
  ]
}
        `.trim();

        const imagen = await descargarImagenComoBase64(urlFoto);

        const response = await getAI().models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: [{
                role: 'user',
                parts: [
                    { text: prompt },
                    { inlineData: { data: imagen.base64, mimeType: imagen.mimeType } }
                ]
            }]
        });

        const texto = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const limpio = texto.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(limpio);
        return parsed.sugerencias || null;

    } catch (e) {
        console.error('💥 Error en sugerirTipoPost:', e.message);
        return null;
    }
}

// Genera el copy final adaptado al tipo de post elegido
async function generarCopyTrabajo(urlFoto, nombreProyecto, tipoPost) {
    const imagen = await descargarImagenComoBase64(urlFoto);

    // Buscamos la descripción y hashtags base del tipo elegido
    let descripcionTipo = '';
    let hashtagsBase = '';
    try {
        const tabla = process.env.AT_TABLE_TIPOS_POST || 'Tipos_Post_Marketing';
        const records = await airtableService.base(tabla).select({
            filterByFormula: `{Nombre} = '${tipoPost}'`,
            maxRecords: 1
        }).firstPage();
        if (records.length > 0) {
            descripcionTipo = records[0].fields.Descripcion || '';
            hashtagsBase = records[0].fields.Hashtags_Base || '';
        }
    } catch (e) {
        console.error('💥 Error leyendo tipo de post para copy:', e.message);
    }

    const prompt = `
Eres el asistente de marketing de Mamafina, una mercería creativa en Madrid.
Mamafina es un negocio artesanal con mucho corazón, llevado por Reyes.
Su tono es cercano, cálido, femenino y entusiasta. Usa algún emoji de costura
o textil pero sin exagerar. Tutea siempre.

Mira esta foto de un trabajo terminado que se llama "${nombreProyecto}".

El tipo de post elegido es: "${tipoPost}"
${descripcionTipo ? `Descripción del formato: ${descripcionTipo}` : ''}

Escribe un post para Instagram siguiendo el espíritu de ese tipo de post:

1. Una frase de apertura llamativa que enganche (máximo 1 línea)
2. Descripción del trabajo en 2-3 líneas adaptada al tono del tipo elegido
3. Una pregunta o CTA que invite a la comunidad a reaccionar o a pedir uno
4. Entre 8 y 12 hashtags relevantes${hashtagsBase ? ` (incluye estos como base: ${hashtagsBase})` : ''}

Tono: como si Reyes lo escribiera ella misma, con orgullo y cariño.
No uses asteriscos para negritas. Escribe el texto tal cual se publicaría en Instagram.
    `.trim();

    const response = await getAI().models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [{
            role: 'user',
            parts: [
                { text: prompt },
                { inlineData: { data: imagen.base64, mimeType: imagen.mimeType } }
            ]
        }]
    });

    if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Gemini no devolvió texto en la respuesta.');
    }

    return response.candidates[0].content.parts[0].text.trim();
}

// Registra el tipo de post usado en el registro de Airtable
async function registrarTipoPost(recordId, tipoPost) {
    try {
        await airtableService.base('Trabajos_Realizados').update(recordId, {
            'Tipo_Post': tipoPost
        });
    } catch (e) {
        console.error('💥 Error registrando tipo de post:', e.message);
    }
}

module.exports = { generarCopyTrabajo, sugerirTipoPost, obtenerTiposPost, registrarTipoPost };