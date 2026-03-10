const { OpenAI } = require("openai");

class OpenAIService {
    constructor() {
        // Usamos la clave de tu .env
        this.openai = new OpenAI({ 
            apiKey: process.env.OPENAI_API_KEY 
        });
    }

      
    
    async generarImagenDiseno(promptMaestro) {
      // 🔍 DEBUG: Esta línea te permitirá ver en los logs de Vercel 
      // el prompt final que se envía a DALL-E 3.
      console.log("🚀 [DALL-E 3] Enviando Prompt Maestro:", promptMaestro);
      
      try {
          const response = await this.openai.images.generate({
              model: "dall-e-3",
              prompt: promptMaestro,
              n: 1,
              size: "1024x1024",
              quality: "hd",
              // ✨ EL HACK: Usamos "natural" para evitar que DALL-E 3 
              // convierta el estampado en algo con relieve o 3D.
              style: "natural", 
          });

          if (response.data && response.data[0]) {
              console.log("✅ [DALL-E 3] Imagen generada con éxito.");
              return response.data[0].url; 
          }
          
          return null;
      } catch (error) {
          // Error detallado para saber si es por política de contenido o fallo de red
          console.error("💥 Error en DALL-E 3:", error.message);
          return null;
      }
  }

    async obtenerInstrucciones() {
      try {
        // 1. Traemos la esencia desde Airtable (Lo que ya tienes)
        const personalidadBase = await airtableService.getConfigValue('PERSONALIDAD_BOT');
        
        // 2. Le inyectamos las "Directivas de Supervivencia" para la Demo
        return `
          ${personalidadBase || "Eres Mamafina, una costurera amable experta en telas."}
          
          ESTÁS EN MODO ASISTENTE DE VENTAS (MAMASSISTANT v1.5):
          - Si el cliente pregunta por su pedido: Indícale con cariño que use el botón "📦 ¿Cómo va mi pedido?".
          - Si quiere algo nuevo: Dile que pulse "🙋 Quiero un encargo" para que guardemos su turno.
          - Si pregunta por stock de telas: Sé entusiasta, pero dile que lo mejor es mirar el botón "🧵 Ver Telas".
          - NUNCA inventes precios ni confirmes fechas de entrega exactas.
          - Usa un lenguaje cercano (cariño, primor, corazón) y emojis (🧵, ✨, 👗).
        `.trim();
    
      } catch (error) {
        // Fallback de seguridad por si falla la conexión con Airtable
        return "Eres Mamafina, la costurera de Dedal Digital. Eres amable, experta y siempre derivas los pedidos a los botones del sistema.";
      }
    }

  async analizarImagenInventario(urlImagen, tipo) {
    try {
        // « CAMBIO »: Usamos 'this.openai' para referirnos a la instancia creada en el constructor
        // « CAMBIO »: Aseguramos que 'tipo' se use en el prompt para contextualizar la IA
        const response = await this.openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { 
                            type: "text", 
                            text: `Eres un experto en inventario de mercería y costura. 
                            Analiza esta imagen de una ${tipo} y extrae la información necesaria.
                            
                            Responde ÚNICAMENTE con un objeto JSON que tenga este formato:
                            {
                              "nombre": "Nombre descriptivo del artículo",
                              "referencia": "Código de referencia si es visible, si no inventa uno corto basado en el nombre",
                              "precio": 0.0,
                              "stock": 1
                            }` 
                        },
                        { 
                            type: "image_url", 
                            image_url: { 
                                url: urlImagen // URL pública (ImgBB o Telegram Path)
                            } 
                        }
                    ],
                },
            ],
            response_format: { type: "json_object" }, // Obligamos a la IA a responder en JSON
            max_tokens: 300,
        });

        // Extraemos el contenido de la respuesta
        const contenido = response.choices[0].message.content;
        console.log("Log: Respuesta de IA recibida:", contenido);

        return JSON.parse(contenido);

    } catch (error) {
        // « CAMBIO »: Añadimos contexto al error para saber si falló por la API o por las variables
        console.error("💥 Error en visión OpenAI:", error.message);
        
        // Fallback en caso de error para que el bot no se detenga
        return {
            nombre: `${tipo} nueva`,
            referencia: "REF-TEMP",
            precio: 0,
            stock: 0
        };
    }
}

  async generarRespuesta(mensajeDelUsuario) {
    try {
      const instrucciones = await this.obtenerInstrucciones();

      const respuesta = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Actualizado para mayor inteligencia
        messages: [
          { role: "system", content: instrucciones },
          { role: "user", content: mensajeDelUsuario }
        ],
        temperature: 0.7,
      });

      return respuesta.choices[0].message.content;

    } catch (error) {

      return "¡Ay, cariño! Mi mente se ha enredado un poquito. 🧵 ¿Me lo repites?";
    }
  }
  async describirTela(urlImagen) {
    try {
        const response = await this.openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: [
                    {
                      type: "text",
                      text: `
                    Analyze this fabric print image and return a single compact description optimized for DALL-E 3.
        
                    Goal:
                    Describe only the visual print so it can be used inside an appliqué letter on clothing.
                    
                    Include only:
                    - scale
                    - pattern type
                    - motifs
                    - illustration style
                    - motif colors
                    - background color
                    - arrangement if relevant
                    
                    Rules:
                    - One single sentence fragment
                    - Maximum 35 words
                    - No labels
                    - No full explanation
                    - No mention of embroidery, stitching, quilting, applique, texture, or fabric type
                    - Use simple visual language
                    - End exactly with: "small repeating printed fabric pattern"
                    
                    Example output:
                    small folk-style floral print with stylized flowers and leaves in terracotta, dusty pink, olive green and mustard on a warm cream background, small repeating printed fabric pattern
                    `.trim()
                  },
                  { type: "image_url", image_url: { url: urlImagen } }
              ]
          }],
          temperature: 0.4
      });
      return response.choices[0].message.content.trim();
  } catch (error) {
      console.error("Error en describirTela:", error.message);
      return "small floral print, flat seamless fabric pattern printed on cotton";
  }
}

  async describirProducto(urlImagen) {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `
                You are analyzing a product image for use in an AI product photography prompt.
                
                Your task is to identify the object and produce a SHORT ecommerce-style product description.
                
                This text will be inserted into a DALL-E product generation prompt.
                
                Focus only on:
                - product type
                - main color
                - general material look
                
                Rules:
                - 3 to 6 words only
                - one short phrase
                - no full sentences
                - no background description
                - no lighting description
                - no explanations
                
                Use common ecommerce product names.
                
                Format:
                "a [color] [material/look] [product type]"
                
                Examples:
                a white cotton t-shirt
                a beige canvas zip pouch
                a black leather tote bag
                a children's cotton sweatshirt
                a beige canvas tote bag
                a cotton baseball cap
                `
              },
              {
                type: "image_url",
                image_url: { url: urlImagen }
              }
            ]
          }
        ],
        max_tokens: 30,
        temperature: 0.2
      });
  
      let descripcion = response.choices[0].message.content.trim();
  
      descripcion = descripcion
        .replace(/^["']|["']$/g, "")
        .replace(/\.$/, "");
  
      return descripcion;
  
    } catch (error) {
      console.error("Error describiendo producto:", error.message);
      return "a white cotton t-shirt";
    }
  }
  
 
  async normalizarDescripcionTela(descripcionLarga) {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: `Rewrite the following fabric pattern description so it is optimized for AI image generation.
  
  Rules:
  - Maximum 30 words.
  - Use this exact structure: [scale] [style] [pattern type] with [motifs] in [colors] on a [background color] background.
  - ALWAYS interpret motif scale as small-scale, micro motifs, or small repeating motifs.
  - NEVER describe motifs as large, oversized, bold, or wide-scale.
  - Assume the fabric is intended for a small textile appliqué, so the pattern must read as a small printed textile design.
  - ALWAYS end with: "small repeating printed fabric pattern".
  - Keep only visual pattern information. NO texture. NO embroidery.
  
  Text: ${descripcionLarga}`
          }
        ],
        max_tokens: 60,
        temperature: 0.2
      });
  
      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error("💥 Error normalizando tela:", error.message);
      return descripcionLarga;
    }
  }

  async detectarIntencionPortfolio(mensaje) {
    try {
        const response = await this.openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
                role: "system",
                content: "Eres un clasificador de intenciones para una mercería. Si el usuario pide VER fotos, ejemplos, o trabajos anteriores, responde únicamente con la categoría: 'ropa', 'bolsos', 'bebes', 'otros' o 'todo'. Si no pide ver trabajos, responde 'NADA'."
            }, {
                role: "user",
                content: mensaje
            }],
            temperature: 0
        });
        return response.choices[0].message.content.trim().toLowerCase();
    } catch (e) {
        return "nada";
    }
}
}
module.exports = new OpenAIService();

