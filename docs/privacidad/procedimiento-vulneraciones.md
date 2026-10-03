# Procedimiento ante vulneraciones de seguridad

Qué hacer si algo expone o pone en riesgo datos personales. Base legal: art. 19 LFPDPPP. Las vulneraciones que **afecten de forma significativa los derechos patrimoniales o morales** de las personas se les informan **de forma inmediata**, para que puedan defenderse.

## Pasos

1. **Detectar y registrar.** Anotar en la bitácora qué se vio, quién lo vio y cuándo (fecha y hora).
2. **Contener**, en minutos y no en días: revocar la credencial expuesta, retirar el despliegue con el fallo (revertir `main` en GitHub Pages), apagar el flujo de n8n o cerrar la tabla afectada.
3. **Evaluar.** Qué datos, de cuántas personas, desde cuándo y si alguien accedió de verdad. ¿Afecta de forma significativa sus derechos? Si hay duda, se trata como si sí.
4. **Informar a las personas de inmediato** si afecta de forma significativa. Contenido recomendado (lo exigía el Reglamento de 2011; se mantiene como buena práctica mientras se publica el nuevo):
   - la naturaleza del incidente;
   - los datos personales comprometidos;
   - qué puede hacer la persona para protegerse;
   - las acciones correctivas que ya se tomaron;
   - dónde obtener más información.

   **Por dónde:** hoy COSECHA no tiene correos de las personas, así que el aviso va en la app (un mensaje en Hoy) y en `privacidad.html`. Cuando haya cuentas, también por correo.
5. **Corregir y verificar.** Arreglar la causa, añadir un test que la cubra y comprobarlo en la URL pública.
6. **Aprender.** Revisar el aviso, el inventario y las medidas de seguridad; cerrar la entrada de la bitácora.

## Escenarios de este proyecto

| Escenario | Qué expone | Contención |
|---|---|---|
| Un token o clave aparece en el repo público (GitHub) | Acceso a cuentas de COSECHA (GitHub, n8n, Google) | Revocarlo **primero** y después limpiarlo del historial; revisar los registros del servicio. Borrarlo del código no basta: el historial es público. |
| Alguien pone `MODO_DEMO = false` por error | Pedidos de prueba en la hoja de producción (sin identificadores directos) | Volver a `true` y desplegar; limpiar las filas de prueba. `tests/cocina.test.mjs` y la guarda dentro de `llamarCocina` lo previenen. |
| Un respaldo importado con código malicioso (XSS) | Los datos del propio dispositivo | Parchear el escapado, añadir el caso a los tests y avisar en la app si hubo exposición. |
| Fase nube: una tabla de Supabase sin RLS | Los datos de salud de **todas** las cuentas | Activar RLS o cerrar la tabla en minutos, rotar las claves y revisar los registros de acceso. Se informa de inmediato a las personas afectadas: es el caso más grave posible. |

## Bitácora de incidentes

| Fecha y hora | Qué pasó | Datos y personas afectadas | ¿Significativa? | Contención | Aviso a personas | Cierre |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | Sin incidentes a la fecha |
