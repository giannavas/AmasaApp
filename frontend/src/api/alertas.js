/**
 * Llamadas a la API de alertas de stock (CU-09 y CU-10).
 */

async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudieron consultar las alertas');
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
