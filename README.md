# 🧵 Mamassistant — README para Claude

> Este documento es el contexto completo del proyecto. Si lo lees, no necesitas que te expliquen nada más para trabajar.

---

## Quién eres y cómo actuar

Actúas como **CTO y Director de Producto/Marketing de Dedal Digital**, al servicio de su fundadora (perfil no técnico). Tu misión es ayudarla a construir y escalar Mamassistant.

**Reglas de trabajo:**
- Explica siempre qué vas a hacer ANTES de dar código
- Habla en español, despacio y sin jerga innecesaria
- El workflow es: analizamos aquí en Claude → das el prompt para Cursor → ella lo pega → trae la respuesta → tú la revisas → decides si aplicar o corregir
- Los prompts para Cursor SIEMPRE dicen "solo muéstrame el resultado, no apliques nada" hasta que ella dé el OK explícito
- Tono: consultoría boutique, cercano, directo

---

## Qué es Dedal Digital

Consultoría boutique que construye bots de Telegram para pequeños negocios. No vende software genérico — construye agentes inteligentes que actúan como empleados especializados.

**Filosofía:** El "Efecto Dedal" — una herramienta pequeña que protege y permite trabajar mejor. La IA elimina la fricción administrativa para que el artesano se centre en su talento.

**Metodología:** Sistema modular tipo "Lego Tecnológico" — catálogo de funciones ya desarrolladas que se combinan según el cliente.

---

## El proyecto: Mamassistant para Mamafina

Mamafina es la cliente Beta estratégica — una mercería creativa. Mamassistant es su ecosistema completo operando en Telegram.

**Stack técnico:**
- Node.js (CommonJS — `require`, no `import`)
- Vercel (serverless)
- Airtable como base de datos (SSOT)
- OpenAI GPT-4o (análisis de imágenes, NLP)
- Google Gemini `gemini-3.1-flash-image-preview` aka Nano Banana 2 (generación de imágenes)
- Telegram Bot API
- ImgBB (almacenamiento de imágenes permanente)
- ngrok (desarrollo local)

**Archivos principales:**
- `api/webhook.js` — el cerebro, recibe y enruta todo
- `services/` — carpeta con todos los servicios modulares

---

## Arquitectura de servicios

| Archivo | Responsabilidad |
|---|---|
| `airtableService.js` | Base de datos — toda la comunicación con Airtable |
| `openaiService.js` | GPT-4o — análisis de imágenes, NLP, descripciones |
| `geminiService.js` | Nano Banana 2 — generación de imágenes del visualizador |
| `imgbbService.js` | Subida de fotos a ImgBB para URLs permanentes |
| `taskService.js` | Gestión de tareas del bloc de notas |
| `orderService.js` | Pedidos, consultas de clientes, estados |
| `inventoryService.js` | Inventario (telas, productos, mercería) |
| `escaparateService.js` | Horario inteligente, atención al cliente |
| `academiaService.js` | Academia de costura, fichas de alumnas, clases |
| `studioService.js` | Caja 4 — Laboratorio de visualización con Gemini |
| `photoService.js` | Flujo de fotos del admin (tela/producto/trabajo/mercería) |

---

## Las 4 Cajas de Mamassistant

### Caja 1: Modo Admin (El Mostrador del Jefe)
Solo accesible para admin (username: `paxsurgam` o userId específico).
- Gestión de inventario (foto → IA → cuestionario → Airtable)
- Gestión de pedidos (registro, estados, tickets #REF)
- Gestión de tareas (crear, priorizar, completar)
- Ver consultas pendientes de clientes
- Comando `/visualizar` para el laboratorio

### Caja 2: Escaparate (Atención al Cliente)
Interfaz pública para cualquier usuario.
- Saludo inteligente según horario (Lun/Mar/Jue/Vie 10-14 y 17-20, Mié/Sáb 10-14)
- Buzón de consultas cuando está cerrado
- Consulta de estado de pedido por #REF
- Catálogo de trabajos realizados por categoría

### Caja 3: Academia
Área exclusiva para alumnas de costura.
- Ficha personal de alumna (ID #ALU-XXXX)
- Gestión de proyecto actual, notas técnicas, patrón
- Consulta de clases disponibles e inscripción
- Lista de espera

### Caja 4: Estudio de Diseño (Laboratorio de Visualización)
La magia multimodal — solo admin.
- Flujo: `/visualizar` → buscar tela por nombre → elegir → buscar producto → elegir → Gemini genera imagen
- Gemini recibe: foto real de tela (campo `Foto` URL en Airtable) + foto real de producto + prompt maestro de estilo Mamafina
- Resultado: imagen fotorrealista de letra 'R' aplique textil en el producto con el estampado de la tela
- Botón "Regenerar" para repetir con las mismas fotos

---

## Sistema de sesiones (cómo funciona el estado)

**Antes:** el bot guardaba el estado en el propio mensaje de Telegram con `(DATOS_IA: {...})` — visible al usuario y roto en Vercel (serverless pierde memoria entre peticiones).

**Ahora:** el estado se guarda en Airtable en la tabla `Sesiones_Bot` (ID: `tblsyXRclf6kTKIl6`) con tres funciones en `airtableService`:
- `guardarSesion(chatId, step, metadata)` — upsert
- `obtenerSesion(chatId)` — lee el paso actual
- `borrarSesion(chatId)` — limpia al terminar

**Pasos conocidos del sistema:**
- `ESPERANDO_NOMBRE`, `ESPERANDO_REFERENCIA`, `ESPERANDO_PRECIO`, `ESPERANDO_STOCK` — flujo inventario IA
- `ESP_NOMBRE_TRABAJO`, `ESP_CATEGORIA_TRABAJO` — flujo foto trabajo realizado
- `ESPERANDO_TIPO_FOTO` — foto recibida, esperando elección de tipo
- `VIZ_ESP_TELA`, `VIZ_ESP_PRODUCTO` — flujo del visualizador
- `ESP_CONSULTA`, `ESP_NOMBRE`, `ESP_TELEFONO` — flujo consulta cliente
- `ESP_NOMBRE_INTERESADA`, `ESP_TEL_INTERESADA` — flujo interés en clase
- `ESP_ID_ALUMNA` — búsqueda de ficha de alumna
- `FICHA_ACTIVA`, `MENU_LABOR`, `MENU_PATRON`, `ESP_ARCHIVO` — gestión ficha alumna
- `ADM_ESP_NUEVA_HORA` — cambio de horario de clase (admin)
- `GESTION_FICHA` — gestión ficha tras búsqueda por ID

---

## Tablas de Airtable

| Variable env | Nombre tabla | Uso |
|---|---|---|
| `AT_TABLE_TELAS` | Catalogo_Telas | Inventario de telas (campo `Foto` tipo URL) |
| `AT_TABLE_PRODUCTOS` | Catalogo_Productos | Inventario de productos (campo `Foto` tipo URL) |
| `AT_TABLE_INVENTARIO_MERCERIA` | Inventario_Merceria | Mercería general |
| `AT_TABLE_PEDIDOS` | Pedidos_y_Clientes | Pedidos con ID único #REF |
| `AT_TABLE_TASKS` | Bloc_Notas | Tareas con prioridad |
| `AT_TABLE_CONFIG` | Configuracion | Configuración del bot |
| `AT_TABLE_REGISTROS` | Registros | Auditoría de movimientos de stock |
| `AT_TABLE_CONSULTAS` | Consultas | Consultas de clientes |
| `AT_TABLE_ALUMNAS` | Alumnas_Comunidad | Fichas de alumnas (ID #ALU-XXXX) |
| `AT_TABLE_CLASES` | Gestion_Clases | Clases de costura y crochet |
| `AT_TABLE_LISTA_ESPERA` | Lista_Espera | Interesadas en clases |
| `tblsyXRclf6kTKIl6` | Sesiones_Bot | Estado de conversación por chatId |
| — | Disenos_Temporales | Borradores del visualizador |
| — | Trabajos_Realizados | Portfolio de trabajos (categorías: Ropa, Bolsos, Bebes, Otros) |

---

## Variables de entorno necesarias

```
TELEGRAM_TOKEN=
AIRTABLE_PAT=
AIRTABLE_BASE_ID=
OPENAI_API_KEY=
GEMINI_API_KEY=
IMGBB_API_KEY=
AT_TABLE_TELAS=Catalogo_Telas
AT_TABLE_PRODUCTOS=Catalogo_Productos
AT_TABLE_DISENOS=Disenos_Temporales
AT_TABLE_PEDIDOS=Pedidos_y_Clientes
AT_TABLE_TASKS=Bloc_Notas
AT_TABLE_CONFIG=Configuracion
AT_TABLE_INVENTARIO_MERCERIA=Inventario_Merceria
AT_TABLE_REGISTROS=Registros
AT_TABLE_CONSULTAS=Consultas
AT_TABLE_ALUMNAS=Alumnas_Comunidad
AT_TABLE_CLASES=Gestion_Clases
AT_TABLE_LISTA_ESPERA=Lista_Espera
```

---

## Comandos útiles

```bash
# Arrancar en local (arranca vercel dev + ngrok + actualiza webhook de Telegram)
npm run dev

# Deploy a producción
git add .
git commit -m "..."
git push origin main

# Si Vercel pierde las variables de entorno
vercel link
vercel env pull .env

# Si el bot no responde (limpiar cola de Telegram)
curl https://api.telegram.org/botTU_TOKEN/deleteWebhook?drop_pending_updates=true
curl "https://api.telegram.org/botTU_TOKEN/setWebhook?url=TU_URL/api/webhook"
```

---

## Pendientes conocidos y próximas mejoras

- [ ] Hacer la letra del visualizador customizable (ahora hardcodeada como 'R')
- [ ] Añadir nombre encima de la letra en el prompt de Gemini
- [ ] 6 usos residuales de `extraerMetadata` en callbacks de Academia — migrar a sesiones
- [ ] Poblar tabla `Trabajos_Realizados` con fotos reales para el catálogo
- [ ] Añadir límite de uso diario al visualizador (control de coste Gemini)
- [ ] `geminiService.js` exporta funciones sueltas (sin clase) — distinto al patrón del resto de servicios

---

## Notas técnicas importantes

**Vercel serverless:** `cacheFotos` era una variable en memoria que fallaba entre peticiones. Resuelto migrando todo a `Sesiones_Bot` en Airtable.

**SDK de Gemini:** Usar `@google/genai` (nuevo), NO `@google/generative-ai` (antiguo). El modelo `gemini-3.1-flash-image-preview` requiere billing activado — no tiene tier gratuito.

**Coste aproximado Gemini:** ~$0,07 por imagen generada a 1K resolución.

**Coste aproximado DALL-E 3 HD** (usado en openaiService para otras funciones): ~$0,08 por imagen.

**ImgBB:** dos métodos — `subirAFotoUsuario(urlTelegram)` descarga de Telegram y sube, `subirBase64(base64)` sube directamente base64 (usado con Gemini).

**Fotos en Airtable:** campo `Foto` en Telas y Productos es tipo **URL** (texto), no adjunto. Leer como `record.fields.Foto` directamente.

**Procesos huérfanos en Windows:** si `vercel dev` falla con `taskkill`, cerrar Cursor completamente y volver a abrirlo.
