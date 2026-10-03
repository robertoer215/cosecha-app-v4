# Medidas de seguridad

El art. 18 LFPDPPP obliga a mantener medidas **administrativas, técnicas y físicas** proporcionales al riesgo, a las consecuencias para las personas, a la sensibilidad de los datos y al desarrollo tecnológico. El art. 20 exige confidencialidad a quien intervenga en el tratamiento. Estas son las de COSECHA App a 3-oct-2026.

## Técnicas (vigentes)

| Medida | Qué protege | Cómo se verifica |
|---|---|---|
| Los datos nunca salen del dispositivo | Todo: no hay servidor que atacar | `tests/privacidad.test.mjs` (dominios declarados) y la auditoría multi-rol (registro de red) |
| Un solo módulo toca el almacenamiento del navegador (`js/almacen.js`) | Que ningún módulo guarde datos por su cuenta ni use cookies | `tests/privacidad.test.mjs` |
| Guarda del webhook dentro de `llamarCocina` (`MODO_DEMO = true`) | Que ningún pedido llegue a producción por accidente | `tests/cocina.test.mjs` |
| Todo texto de la persona o de un respaldo se escapa antes de pintarse | Inyección de código (XSS) | Revisión de código y auditoría (caso `<img src=x onerror=…>`) |
| Importar valida el esquema y nunca reemplaza con un archivo vacío | Pérdida de datos por un archivo malo | `tests/almacen.test.mjs` |
| Borrar todo bloquea la escritura hasta recargar | Que un guardado en vuelo resucite lo borrado | `tests/privacidad.test.mjs` |
| Integridad (SRI) de la librería del QR en cdnjs | Que un CDN comprometido ejecute código en la app | Atributo `integrity` en `index.html` |
| Sin secretos en el repositorio | Acceso a cuentas de COSECHA | Escaneo del historial en cada auditoría |
| HTTPS (GitHub Pages) | Lectura o alteración en tránsito | Pages solo sirve HTTPS |

## Técnicas (pendientes, por prioridad)

1. **Alojar Inter e IBM Plex Mono en el propio sitio** (archivos `woff2` en el repo y `@font-face` en lugar del `@import` de Google Fonts). Quita a Google como tercero que recibe la IP de cada visita. Ambas tipografías tienen licencia OFL, que lo permite.
2. **Política de seguridad de contenidos (CSP) por `<meta>`**, con `connect-src 'self'`: aunque hubiera una inyección de código, no podría enviar datos fuera. Hay que probarla en todos los recorridos, porque la app usa atributos `onclick` y estilos en línea.
3. **Imágenes de ejercicios en el propio sitio**, optimizadas (WebP) y cargadas bajo demanda. Quitan a `raw.githubusercontent.com` como tercero. Tope de 20 MB en el repo.

## Administrativas

| Medida | Estado |
|---|---|
| Inventario de datos y aviso versionados, con disparadores de actualización | ✅ [README](README.md) |
| Procedimientos de derechos ARCO y de vulneraciones | ✅ |
| Revisión de privacidad en cada auditoría (rol de seguridad, privacidad y licencias) | ✅ |
| Persona o área designada para datos personales (art. 29) | ⚠️ Pendiente |
| Compromiso de confidencialidad firmado por quien acceda a datos (art. 20) | ⏳ Cuando haya equipo o proveedores con acceso |
| Formación básica en protección de datos para quien se incorpore | ⏳ Cuando haya equipo |

## Físicas

| Medida | Estado |
|---|---|
| El equipo donde se desarrolla y se guardan respaldos de COSECHA tiene cifrado de disco (FileVault) y bloqueo de pantalla | ⏳ Por confirmar |
| El aviso recomienda a cada persona proteger su teléfono con bloqueo de pantalla | ✅ |
