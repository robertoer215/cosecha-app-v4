# Privacidad y protección de datos — COSECHA App

Qué hace COSECHA App para cumplir la **Ley Federal de Protección de Datos Personales en Posesión de los Particulares** (LFPDPPP, DOF 20-03-2025; texto vigente con última reforma DOF 14-11-2025), en qué estado está cada obligación y qué falta antes de lanzar.

> No es asesoría legal. Está redactado contra el texto oficial de la ley (Cámara de Diputados), pero antes del lanzamiento debe revisarlo un abogado especializado en protección de datos.

## La idea central

Hoy la app **no saca ningún dato del dispositivo**. Perfil, diario y entrenamientos viven solo en el `localStorage` del navegador de cada persona (`cosecha.v1`), y COSECHA no los recibe. Eso reduce al mínimo lo que COSECHA trata. Aun así:

- la app recoge **datos sensibles** (salud: art. 2 fr. VI), así que informa y pide aceptación expresa antes de usarlos;
- terceros técnicos (GitHub, Google Fonts, Cloudflare) reciben la IP de quien abre la app, y eso se declara;
- el día que algo salga del dispositivo (cocina, cuentas, nube, analítica), cambian las obligaciones: ver [Evaluación de impacto: nube](evaluacion-impacto-nube.md).

## Estado (3-oct-2026)

| Obligación | Artículo | Estado | Dónde |
|---|---|---|---|
| Aviso de privacidad integral | 15 | ✅ Redactado · ⚠️ falta la identidad del responsable | [`privacidad.html`](../../privacidad.html) |
| Aviso simplificado al recabar datos por medios electrónicos | 16 fr. II | ✅ En el perfil, antes de usar la fórmula | `index.html` (`.legal-simplificado`) |
| Consentimiento expreso para datos sensibles | 8 | ✅ Fase local: aceptación explícita y versionada · ⏳ Fase nube: expreso y por escrito con autenticación | `js/privacidad.js`, `js/app.js` |
| Revocar el consentimiento | 7 | ✅ "Borrar todos mis datos" | Diario › Tus datos |
| Derechos ARCO | 21–34 | ✅ En la app (ver, editar, exportar, borrar) + procedimiento por correo | [procedimiento-arco.md](procedimiento-arco.md) |
| Persona o área que atiende solicitudes | 29 | ⚠️ Por designar | — |
| Comunicar cambios del aviso | 15 fr. VI | ✅ Subir `AVISO_VERSION` vuelve a pedir la aceptación | `js/privacidad.js` |
| Medidas de seguridad | 18 | ✅ Vigentes · ⏳ 3 pendientes | [medidas-de-seguridad.md](medidas-de-seguridad.md) |
| Informar vulneraciones | 19 | ✅ Procedimiento listo | [procedimiento-vulneraciones.md](procedimiento-vulneraciones.md) |
| Confidencialidad de quien trate datos | 20 | ⏳ Compromiso firmado cuando haya equipo | [medidas-de-seguridad.md](medidas-de-seguridad.md) |
| Transferencias | 35–36 | ✅ No hay; los terceros técnicos están declarados | [inventario-de-datos.md](inventario-de-datos.md) |

## Pendientes antes de lanzar

| # | Pendiente | Dueño |
|---|---|---|
| 1 | Identidad del responsable: nombre o razón social, domicilio y correo de privacidad. Se escriben **solo** en `js/privacidad.js` (`RESPONSABLE`); la app y el aviso los toman de ahí. Hasta entonces se ven marcados en rojo como "dato pendiente". | Roberto |
| 2 | Designar a la persona o área que atiende solicitudes (art. 29). | Roberto |
| 3 | Edad mínima: el formulario acepta desde 15 años. Decidir entre subirla a 18 o pedir el consentimiento de madre, padre o tutor. | Roberto |
| 4 | Revisión legal del aviso y de estos documentos. | Abogado |
| 5 | Si el responsable está establecido en España o en otro país de la UE, revisar si además aplica el RGPD (art. 3.1). | Abogado |
| 6 | Medidas técnicas pendientes: tipografías alojadas en el propio sitio, CSP e imágenes de ejercicios propias (quitan terceros). | Desarrollo |
| 7 | Otros tratamientos de COSECHA fuera de esta app: formulario de la landing, pedidos en la app de producción y entrevistas del TFG (ver el inventario). | Roberto |

## Cuándo hay que actualizar esto

Antes de fusionar cualquier cambio que:

- recoja un dato nuevo (campo en perfil, diario o entrenamiento);
- envíe algo fuera del dispositivo (activar cocina, cuentas, sincronización, analítica, formularios);
- cargue algo de un dominio externo nuevo (tipografías, CDN, imágenes, API);
- cambie para qué se usan los datos.

Qué hacer:

1. Actualizar [`inventario.json`](inventario.json) y [inventario-de-datos.md](inventario-de-datos.md).
2. Actualizar [`privacidad.html`](../../privacidad.html).
3. Si cambia el tratamiento, subir `AVISO_VERSION` en `js/privacidad.js` y `aviso.version` en `inventario.json`, y añadir la versión al historial del aviso. La app volverá a pedir la aceptación.

`tests/privacidad.test.mjs` hace fallar `npm test` si aparece un dominio sin declarar, si algo fuera de `js/almacen.js` toca el almacenamiento del navegador o si las versiones del aviso no coinciden.

## Documentos

- [Inventario de datos](inventario-de-datos.md) (y [`inventario.json`](inventario.json), que lee el test)
- [Procedimiento de derechos ARCO](procedimiento-arco.md)
- [Procedimiento ante vulneraciones de seguridad](procedimiento-vulneraciones.md)
- [Medidas de seguridad](medidas-de-seguridad.md)
- [Evaluación de impacto: cuentas y nube](evaluacion-impacto-nube.md)
- Aviso público: [`privacidad.html`](../../privacidad.html)

## Historial del aviso

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 3-oct-2026 | Primera versión: datos solo en el dispositivo; Pedir en modo demostración. |
