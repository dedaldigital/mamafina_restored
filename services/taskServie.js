const airtableService = require('./airtableService');

class TaskService {
    // 1. Lógica para identificar y preparar la creación de una tarea
    async handleTaskInput(chatId, text) {
        const contenido = text.replace(/tarea:/i, "").trim();
        
        // Retornamos la estructura del mensaje y los botones de prioridad 
        return {
            text: `¿Qué prioridad le damos a: "${contenido}"?`,
            buttons: [[
                { text: "🔴 Alta", callback_data: `PRIO|Alta|${contenido}` },
                { text: "🟡 Media", callback_data: `PRIO|Media|${contenido}` },
                { text: "🟢 Baja", callback_data: `PRIO|Baja|${contenido}` }
            ]]
        };
    }

    // 2. Lógica para listar tareas pendientes 
    async formatTaskList() {
        const tareas = await airtableService.getTareasPendientes();
        if (!tareas || tareas.length === 0) {
            return { text: "✅ No hay tareas pendientes.", blocks: [] };
        }

        const blocks = tareas.map(t => {
            const p = t.fields.Prioridad || "Media";
            const emoji = p === "Alta" ? "🔴" : (p === "Baja" ? "🟢" : "🟡");
            return {
                text: `${emoji} *[${p}]* ${t.fields.Tarea}`,
                buttons: [[
                    { text: "✅ Terminar", callback_data: `EJECUTAR_BORRADO|${t.id}` },
                    { text: "🗑️ Eliminar", callback_data: `ELIMINAR_TAREA|${t.id}` }
                ]]
            };
        });

        return { text: "📋 *TAREAS PENDIENTES:*", blocks };
    }

    // services/taskService.js (Añadir estos métodos a la clase)

    // 3. Procesar la asignación de prioridad (Guardado final)
    async confirmTaskCreation(data) {
        const [, prioridad, tareaTexto] = data.split('|'); // Prio: Alta/Media/Baja
        await airtableService.crearTarea(tareaTexto, prioridad);
        return `✅ *Tarea guardada:* ${tareaTexto} (${prioridad})`;
    }

    // 4. Procesar el borrado o finalización
    async handleTaskAction(data) {
        const partes = data.split('|');
        const accion = partes[0];
        const idTarea = partes[1];
        
        try {
            if (accion === "EJECUTAR_BORRADO") {
                await airtableService.completarTarea(idTarea); // [cite: 43]
                return "✅ *¡Tarea terminada!* Archivada en el Bloc de Notas.";
            }
            
            if (accion === "ELIMINAR_TAREA") {
                await airtableService.eliminarTarea(idTarea); // [cite: 43]
                return "🗑️ *Tarea eliminada permanentemente.*";
            }
        } catch (e) {
            console.error(`💥 Error en TaskService (${accion}):`, e.message);
            return "⚠️ No pude procesar la tarea en la base de datos, primor.";
        }
    }
}
module.exports = new TaskService();