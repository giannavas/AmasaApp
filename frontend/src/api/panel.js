/**
 * Llamada a la API del panel de control (CU-12).
 */

/** Devuelve el panel del periodo. Sin fechas, el servidor usa los ultimos 30 dias. */
export async function obtenerPanel({ desde, hasta } = {}) {
  const parametros = new URLSearchParams();
  if (desde) parametros.set('desde', desde);
  if (hasta) parametros.set('hasta', hasta);
  const consulta = parametros.toString();

  const respuesta = await fetch(`/api/panel${consulta ? `?${consulta}` : ''}`, {
    credentials: 'same-origin',
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo cargar el panel de control');
  }
  return datos;
}
