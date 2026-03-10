const { GoogleGenerativeAI } = require("@google/generative-ai");

class GeminiService {
    constructor() {
        // Inicializamos Gemini con tu API Key del .env
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }

    async generarDisenoSudadera(promptMaestro) {
        try {
            console.log("Log: Llamando a Gemini 3 Flash Image...");
            
            // Instanciamos el modelo de generación de imágenes
            const model = this.genAI.getGenerativeModel({ model: "gemini-3-flash-image" });

            const result = await model.generateContent(promptMaestro);
            const response = await result.response;
            
            // Gemini nos devuelve la imagen en formato Base64
            const base64Image = response.text(); // Dependiendo del SDK, puede ser response.candidates[0].content...
            
            return base64Image;
            
        } catch (error) {
            console.error("💥 Error Crítico en Gemini:", error.message);
            return null;
        }
    }
}

module.exports = new GeminiService();