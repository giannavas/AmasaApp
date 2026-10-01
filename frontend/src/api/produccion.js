/**
 * Llamadas a la API de produccion (CU-06).
 */

const cabeceras = { 'Content-Type': 'application/json' };

async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo completar la operacion');
  }
  return datos;
}

/** Devuelve los lotes producidos, del mas reciente al mas viejo. */
export async function listarLotes() {
  const respuesta = await fetch('/api/produccion', { credentials: 'same-origin' });
  return (await procesar(respuesta)).lotes;
}

/**
 * CU-06. Registra un lote: descuenta los insumos, suma el producto terminado
 * y deja asentado el costo. Si falta stock de algun insumo, el servidor
 * responde con el nombre del que falta y no modifica nada.
 */
export async function registrarLote({ idReceta, cantidadProducida, fecha }) {
  const respuesta = await fetch('/api/produccion', {
    method: 'POST',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify({ idReceta, cantidadProducida, fecha }),
  });
  return (await procesar(respuesta)).lote;
}
