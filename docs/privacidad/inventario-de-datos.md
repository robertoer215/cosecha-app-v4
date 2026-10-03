# Inventario de datos (registro de tratamientos)

Qué datos personales toca COSECHA App, de dónde salen, para qué, dónde viven y quién los ve. Versión legible por máquina: [`inventario.json`](inventario.json). Actualizado el 3-oct-2026, aviso v1.0.

## Datos que recoge la app

Todos los escribe la persona y se guardan **solo en su dispositivo**, en `localStorage` bajo la clave `cosecha.v1`. COSECHA no los recibe, así que nadie más los ve. Se conservan hasta que la persona los borra en *Diario › Tus datos › Borrar todos mis datos* o borra los datos del sitio en su navegador.

| Grupo | Datos | Finalidad | Sensible (art. 2 fr. VI) | Sale del dispositivo |
|---|---|---|---|---|
| Perfil | Sexo, edad, peso, estatura, nivel de actividad, objetivo, comidas al día, unidad de peso, metas tecleadas (modo manual), aceptación de términos y versión del aviso aceptada | Calcular la meta (Mifflin-St Jeor) y repartirla por comida | **Sí**: revela estado de salud | No |
| Meta (`metaCache`) | Kcal y macros por comida, origen de la meta | Medir el progreso del día | **Sí** (deriva del perfil) | No |
| Diario | Alimento, cantidad, comida del día, fecha y hora, origen (búsqueda o plato COSECHA) | Registrar lo que se come | **Sí**: hábitos alimentarios | No |
| Entrenamiento | Rutinas, sesiones, ejercicios, series, repeticiones, peso, RIR, duración, récords | Registrar el entrenamiento y su progreso | **Sí**: condición física | No |
| Recientes | Alimentos y ejercicios usados hace poco | Atajos de registro | **Sí** (deriva de lo anterior) | No |
| Preferencias | Kilos o libras | Mostrar los pesos | No | No |
| Plato (Pedir) | Módulos y tamaños elegidos, meta por comida, origen de la meta | Porcionar en el teléfono y, cuando se active, enviar el pedido a cocina | Indirecto (no identifica a nadie) | **No** mientras `MODO_DEMO = true` (`js/cocina.js`) |

La app no pide nombre, correo, teléfono, ubicación ni datos de pago, y no usa cookies, analítica, publicidad ni rastreadores.

### Por qué COSECHA hoy apenas trata datos

La LFPDPPP llama tratamiento a obtener, usar, almacenar, poseer o acceder a datos personales (art. 2 fr. XIX). La app es software que guarda los datos en el dispositivo de la persona, y COSECHA nunca los posee ni accede a ellos. Aun así, la app los **recoge** y son sensibles, por eso se informa (aviso integral y simplificado) y se pide aceptación expresa antes de calcular con ellos. Si algún día los datos salen del dispositivo, COSECHA sí los poseerá y aplica todo el régimen de datos sensibles (art. 8): ver [evaluacion-impacto-nube.md](evaluacion-impacto-nube.md).

## Terceros técnicos

Al abrir la app, el **navegador** pide archivos a estos proveedores, que reciben directamente su IP y su tipo de navegador. COSECHA no les comunica nada, así que no son transferencias en el sentido del art. 2 fr. XX, pero se declaran en el aviso por transparencia.

| Dominio | Proveedor | Para qué | Recibe datos de la app | Aviso del proveedor |
|---|---|---|---|---|
| `robertoer215.github.io` | GitHub, Inc. (Pages) | Aloja la app | No | [GitHub](https://docs.github.com/es/site-policy/privacy-policies/github-general-privacy-statement) |
| `raw.githubusercontent.com` | GitHub, Inc. | Imágenes de ejercicios (free-exercise-db) | No | [GitHub](https://docs.github.com/es/site-policy/privacy-policies/github-general-privacy-statement) |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Google LLC | Tipografías Inter e IBM Plex Mono | No | [Google](https://policies.google.com/privacy?hl=es) |
| `cdnjs.cloudflare.com` | Cloudflare, Inc. | Librería del QR (con SRI) | No | [Cloudflare](https://www.cloudflare.com/es-es/privacypolicy/) |
| `n8n.srv1683942.hstgr.cloud` | n8n de COSECHA (Hostinger) | Cocina | **Nada**: inactivo con `MODO_DEMO = true` | — |

## Otros tratamientos de COSECHA (fuera de esta app)

No forman parte de COSECHA App v4, pero son del mismo responsable y también necesitan aviso:

| Tratamiento | Datos | Qué falta |
|---|---|---|
| Landing `cosecha-landing`: formulario "Guía gratis" → webhook n8n `cosecha-lead-magnet-m3` | Los datos de contacto que pida el formulario | Aviso simplificado junto al formulario y aviso integral; declarar n8n y el destino de los datos |
| App en producción `cosecha-macro-calculator`: Pedir envía el pedido a n8n | Meta por comida, origen de la meta, módulos y tamaños (sin identificadores directos) | Declarar a los encargados: Hostinger (servidor de n8n), Anthropic (agente que redacta la explicación) y Google Sheets (hoja de pedidos) |
| Entrevistas del TFG (13 personas, hoja "Cosecha_Entrevistas_Cualitativas" en Drive) | Datos de las personas entrevistadas y sus respuestas | Confirmar el consentimiento informado, limitar el acceso y fijar cuándo se seudonimizan o se borran |
