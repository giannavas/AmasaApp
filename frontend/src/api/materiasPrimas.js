/**
 * Llamadas a la API de materias primas (CU-03, CU-04 y CU-05).
 */

const cabeceras = { 'Content-Type': 'application/json' };

async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo completar la operacion');
  }
  return datos;
}

/**
 * CU-05. Devuelve el inventario con el estado ya calculado por el servidor.
 *
 * El estado se calcula alla y no aca porque el filtro por estado tiene que
 * resolverse en la consulta: si se filtrara en el navegador habria que
 * traerse la tabla completa para despues descartar la mayor parte.
 */
export async function listarMateriasPrimas({ estado, orden } = {}) {
  const parametros = new URLSearchParams();
  if (estado) parametros.set('estado', estado);
  if (orden) parametros.set('orden', orden);

  const consulta = parametros.toString();
  const respuesta = await fetch(`/api/materias-primas${consulta ? `?${consulta}` : ''}`, {
    credentials: 'same-origin',
  });
  return (await procesar(respuesta)).materiasPrimas;
}

/** CU-03. Da de alta el insumo junto con su primera entrada de mercaderia. */
export async function crearMateriaPrima(datos) {
  const respuesta = await fetch('/api/materias-primas', {
    method: 'POST',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify(datos),
  });
  return (await procesar(respuesta)).materiaPrima;
}

/** CU-04. Edita la ficha y los umbrales. El stock y el costo no se tocan. */
export async function editarMateriaPrima(idMateriaPrima, datos) {
  const respuesta = await fetch(`/api/materias-primas/${idMateriaPrima}`, {
    method: 'PUT',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify(datos),
  });
  return (await procesar(respuesta)).materiaPrima;
}
