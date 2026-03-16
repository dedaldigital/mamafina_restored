// services/geminiService.js
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

/**
 * Descarga una imagen desde una URL y la convierte a base64.
 * Intenta obtener el mimeType desde el header Content-Type,
 * y si no se puede, asume "image/jpeg".
 * @param {string} url
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
async function descargarImagenComoBase64(url) {
  const result = {
    base64: '',
    mimeType: 'image/jpeg',
  };

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Error al descargar imagen desde ${url}. Status: ${response.status} ${response.statusText}`
      );
    }

    const contentType = response.headers.get('content-type');
    if (contentType && typeof contentType === 'string') {
      // Tomamos solo la parte principal, por ejemplo "image/jpeg; charset=utf-8" -> "image/jpeg"
      const [mime] = contentType.split(';').map((s) => s.trim());
      if (mime && mime.startsWith('image/')) {
        result.mimeType = mime;
      }
    }

    const buffer = await response.buffer();
    result.base64 = buffer.toString('base64');

    return result;
  } catch (error) {
    console.error(
      `Error al procesar la imagen desde la URL: ${url}`,
      { message: error.message, stack: error.stack }
    );
    throw new Error(`No se pudo descargar o procesar la imagen desde: ${url}`);
  }
}

/**
 * Genera un diseño de producto personalizado usando Gemini,
 * combinando la imagen de producto base y la imagen de tela.
 *
 * @param {string} urlFotoTela - URL de la imagen de la tela/patrón.
 * @param {string} urlFotoProducto - URL de la imagen del producto base.
 * @param {string} [letra="R"] - Letra para el monograma.
 * @returns {Promise<string>} - Base64 de la imagen generada.
 */
async function generarDiseno(urlFotoTela, urlFotoProducto, letra = 'R') {
  try {
    if (!urlFotoTela || !urlFotoProducto) {
      throw new Error('Se requieren urlFotoTela y urlFotoProducto.');
    }

    const [tela, producto] = await Promise.all([
      descargarImagenComoBase64(urlFotoTela),
      descargarImagenComoBase64(urlFotoProducto),
    ]);

    const prompt = `
Eres un experto en diseño textil y fotografía de producto. 
Tu misión es generar una imagen que recree con precisión el 
estilo de personalización artesanal de Mamafina, aplicando 
este estilo a un producto base y utilizando un patrón de tela 
específico, ambos proporcionados como imágenes de referencia.

INSTRUCCIONES DE DISEÑO:
- Composición: Monograma grande con la letra mayúscula '${letra}' 
  centrada en el producto base. El interior de la letra debe tener 
  la textura y patrón exactos de la tela de referencia.
- Texto superpuesto: Sobre la letra grande, incluir el nombre 
  en tipografía script elegante y manuscrita. Color sólido que 
  contraste fuertemente con la tela para máxima legibilidad.
- Acabado textil: La letra grande debe tener un borde de aplique 
  visible con costura de satén o festón densa alrededor del 
  perímetro. El hilo de coser debe ser visible, coordinando o 
  contrastando para efecto artesanal de cosido a mano.
  La textura del producto base debe ser visible alrededor del aplique.

REQUERIMIENTOS FOTOGRÁFICOS:
- Plano de detalle de producto de alta resolución, limpio y profesional.
- Fondo blanco puro, sin fisuras y perfectamente limpio.
- Iluminación natural suave y uniforme para resaltar texturas 
  de telas y relieve de costuras, sin sombras duras ni brillos.
    `.trim();

    const request = {
      model: 'gemini-3.1-flash-image-preview',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt,
            },
            {
              inlineData: {
                data: producto.base64,
                mimeType: producto.mimeType,
              },
            },
            {
              inlineData: {
                data: tela.base64,
                mimeType: tela.mimeType,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    };

    const response = await getAI().models.generateContent(request);

    if (!response || !response.candidates || !response.candidates.length) {
      console.error('Respuesta de Gemini sin candidatos válidos:', response);
      throw new Error('La respuesta de Gemini no contiene candidatos.');
    }

    const candidate = response.candidates[0];

    if (
      !candidate.content ||
      !candidate.content.parts ||
      !candidate.content.parts.length
    ) {
      console.error('Contenido de candidato vacío o inválido:', candidate);
      throw new Error('La respuesta de Gemini no contiene contenido válido.');
    }

    let imagenBase64 = null;

    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        imagenBase64 = part.inlineData.data;
        break;
      }
    }

    if (!imagenBase64) {
      console.error(
        'No se encontró ninguna parte con inlineData en la respuesta de Gemini.',
        { candidate: JSON.stringify(candidate, null, 2) }
      );
      throw new Error('La respuesta de Gemini no contiene una imagen generada.');
    }

    return imagenBase64;
  } catch (error) {
    console.error('Error en generarDiseno de geminiService:', {
      message: error.message,
      stack: error.stack,
      urlFotoTela,
      urlFotoProducto,
      letra,
    });
    throw error;
  }
}

module.exports = {
  generarDiseno,
};