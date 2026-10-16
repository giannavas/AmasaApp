/**
 * Llamadas a la API de umbrales y alertas de stock (CU-09 y CU-10).
 */

async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo completar la operacion');
  }
  return datos;
}

/**
 * Devuelve { alertas, resumen }. Los filtros vacios no se mandan: el
 * servidor rechaza valores que no conoce, y '' no aporta nada.
 */
export async function listarAlertas({ tipo, origen } = {}) {
  const parametros = new URLSearchParams();
  if (tipo) parametros.set('tipo', tipo);
  if (origen) parametros.set('origen', origen);
  const consulta = parametros.toString();

  const respuesta = await fetch(`/api/alertas${consulta ? `?${consulta}` : ''}`, {
    credentials: 'same-origin',
  });
  return procesar(respuesta);
}

/** Solo los numeros, para el aviso de la barra superior. */
export async function obtenerResumenAlertas() {
  const respuesta = await fetch('/api/alertas/resumen', { credentials: 'same-origin' });
  return (await procesar(respuesta)).resumen;
}

/** CU-09: todos los items con sus umbrales. */
export async function listarUmbrales() {
  const respuesta = await fetch('/api/alertas/umbrales', { credentials: 'same-origin' });
  return (await procesar(respuesta)).umbrales;
}

/**
 * CU-09: guarda los umbrales cambiados. O se guardan todos o ninguno.
 * Devuelve { umbrales, alertas } ya actualizados.
 */
export async function guardarUmbrales(umbrales) {
  const respuesta = await fetch('/api/alertas/umbrales', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ umbrales }),
  });
  return procesar(respuesta);
}

/** CU-10, paso 3: detalle ampliado de un item. */
export async function obtenerDetalleAlerta(origen, id) {
  const respuesta = await fetch(`/api/alertas/${origen}/${id}`, { credentials: 'same-origin' });
  return (await procesar(respuesta)).detalle;
}
