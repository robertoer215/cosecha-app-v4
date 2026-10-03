# Evaluación de impacto: cuentas y sincronización en la nube

Qué tiene que ser verdad **antes** de que un solo dato de salud salga del dispositivo, por ejemplo con cuentas opcionales y sincronización en Supabase. Hoy no está construido: este documento es el filtro previo.

## Por qué es de alto riesgo

- Son **datos sensibles** (salud, art. 2 fr. VI), concentrados en una base de datos.
- El art. 8 exige su **consentimiento expreso y por escrito**, mediante firma autógrafa, firma electrónica o un mecanismo de autenticación. También exige que la base de datos se justifique por finalidades legítimas, concretas y acordes con la actividad de COSECHA.
- En una app estática, la clave pública de Supabase queda a la vista en el código, y así está pensado. Lo único que separa los datos de una persona de los de las demás es **Row Level Security (RLS)**.

## Riesgos y controles obligatorios

| Riesgo | Control |
|---|---|
| Cualquiera lee los datos de todos | RLS activado en **todas** las tablas, con políticas `auth.uid() = usuario_id`, y un test automático que falle si una tabla no tiene RLS. La clave `service_role` nunca llega al cliente. |
| Consentimiento inválido para datos sensibles | Pantalla propia para "Guardar tu progreso en la nube", con casilla sin marcar, el aviso 2.0 a la vista y la cuenta verificada por correo o Google como mecanismo de autenticación. Se registran la fecha, la versión del aviso y la cuenta. |
| Más datos de los necesarios | Sin nombre ni teléfono. El correo solo sirve para entrar. Solo se sincronizan las ramas que la persona elija. |
| Proveedor y transferencia internacional | Supabase como **persona encargada** (art. 2 fr. XII), con su contrato de tratamiento de datos (DPA) aceptado. Región elegida a propósito e informada en el aviso, junto con el país de los servidores. |
| Conservación indefinida | Borrar la cuenta borra los datos en el servidor de verdad, no solo los oculta. Las cuentas sin actividad durante un plazo definido se avisan y se borran. |
| Derechos ARCO | Exportar y borrar la cuenta desde la app. Por correo, plazos de 20 y 15 días (art. 31). Se actualiza [procedimiento-arco.md](procedimiento-arco.md). |
| Vulneraciones | Aviso inmediato por correo a las cuentas afectadas (art. 19). Se actualiza [procedimiento-vulneraciones.md](procedimiento-vulneraciones.md). |
| Menores de edad | Edad mínima decidida antes de abrir las cuentas (hoy el formulario acepta desde 15 años). |
| La app deja de funcionar sin conexión | Primero lo local: la app sigue funcionando sin conexión y sincroniza al recuperarla. La cuenta es opcional. |

## Criterios de salida (todos, antes de activar)

- [ ] RLS en todas las tablas, con un test que lo comprueba.
- [ ] Aviso de privacidad 2.0 publicado (`AVISO_VERSION = '2.0'`), con la nube, el proveedor, la región y el consentimiento separado.
- [ ] Pantalla de consentimiento expreso con registro de fecha, versión y cuenta.
- [ ] Exportar y borrar cuenta funcionando de punta a punta.
- [ ] Contrato de tratamiento de datos (DPA) con Supabase aceptado y archivado.
- [ ] `inventario.json` y `inventario-de-datos.md` actualizados (nuevo dominio, nueva tabla, nuevas finalidades).
- [ ] Revisión legal del aviso 2.0.
- [ ] Prueba con datos falsos de que una cuenta no puede leer los datos de otra.
