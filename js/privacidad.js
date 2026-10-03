// ─────────────────────────────────────────────────────────────────────────────
// PRIVACIDAD — una sola fuente para la versión del aviso y la identidad del
// responsable (LFPDPPP, DOF 20-03-2025). privacidad.html, el aviso simplificado
// del perfil y "Tus datos" leen de aquí, y tests/privacidad.test.mjs comprueba
// que esta versión, la de docs/privacidad/inventario.json y la que enseña
// privacidad.html sean la misma.
//
// Subir AVISO_VERSION obliga a volver a aceptar el aviso antes de calcular la
// meta con datos de salud: es el mecanismo para comunicar cambios (art. 15
// fr. VI). Súbela SOLO cuando cambie el tratamiento (qué datos, para qué,
// quién los recibe), no por una errata.
// ─────────────────────────────────────────────────────────────────────────────

export const AVISO_VERSION = '1.0';
export const AVISO_FECHA = '3 de octubre de 2026';
export const AVISO_URL = 'privacidad.html';

// Identidad del responsable (art. 15 fr. I). PENDIENTE: sin estos tres datos
// el aviso está incompleto y no debe publicarse. No se inventan: los da el
// responsable y se escriben aquí, en ningún otro sitio.
export const RESPONSABLE = {
  nombre: null,    // persona física o razón social que decide sobre los datos
  domicilio: null, // domicilio para oír y recibir notificaciones
  correo: null     // buzón donde se reciben las solicitudes de derechos ARCO
};

const PENDIENTE = 'dato pendiente';

export function datoLegal(clave) {
  const v = RESPONSABLE[clave];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// ¿Aceptó esta persona la versión VIGENTE del aviso? Una aceptación de una
// versión anterior no vale: el tratamiento pudo cambiar desde entonces.
export function avisoAceptado(perfil) {
  return !!perfil && perfil.terminos === true && perfil.avisoVersion === AVISO_VERSION;
}

// Rellena cada [data-legal="nombre|domicilio|correo|version|fecha"] de la raíz.
// Lo que falta se pinta marcado (.legal-pendiente), nunca inventado.
export function rellenarLegales(raiz = document) {
  raiz.querySelectorAll('[data-legal]').forEach(el => {
    const k = el.dataset.legal;
    const v = k === 'version' ? AVISO_VERSION : k === 'fecha' ? AVISO_FECHA : datoLegal(k);
    if (k === 'correo' && v && el.tagName === 'A') el.href = `mailto:${v}`;
    el.textContent = v ?? PENDIENTE;
    el.classList.toggle('legal-pendiente', v == null);
  });
}
