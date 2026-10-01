/**
 * Llamadas a la API de recetas.
 *
 * Cada receta viaja con su lista de insumos incluida, asi la pantalla no
 * tiene que hacer un pedido por receta para mostrarlos.
 */

const cabeceras = { 'Content-Type': 'application/json' };

async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo completar la operacion');
  }
  return datos;
}

export async function listarRecetas() {
  const respuesta = await fetch('/api/recetas', { credentials: 'same-origin' });
  return (await procesar(respuesta)).recetas;
}

/** Crea la receta junto con sus insumos, en una sola operacion. */
export async function crearReceta(datos) {
  const respuesta = await fetch('/api/recetas', {
    method: 'POST',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify(datos),
  });
  return (await procesar(respuesta)).receta;
}

/** Edita la receta. La lista de insumos que se manda reemplaza a la anterior. */
export async function editarReceta(idReceta, datos) {
  const respuesta = await fetch(`/api/recetas/${idReceta}`, {
    method: 'PUT',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify(datos),
  });
  return (await procesar(respuesta)).receta;
}
