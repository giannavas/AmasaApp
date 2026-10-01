/**
 * Llamadas a la API de productos terminados.
 */

const cabeceras = { 'Content-Type': 'application/json' };

async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo completar la operacion');
  }
  return datos;
}

/** Devuelve los productos con su estado de stock ya calculado. */
export async function listarProductos() {
  const respuesta = await fetch('/api/productos', { credentials: 'same-origin' });
  return (await procesar(respuesta)).productos;
}

/** Da de alta un producto. Nace siempre con stock en cero. */
export async function crearProducto(datos) {
  const respuesta = await fetch('/api/productos', {
    method: 'POST',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify(datos),
  });
  return (await procesar(respuesta)).producto;
}

/** Edita la ficha del producto. El stock no se toca desde aca. */
export async function editarProducto(idProducto, datos) {
  const respuesta = await fetch(`/api/productos/${idProducto}`, {
    method: 'PUT',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify(datos),
  });
  return (await procesar(respuesta)).producto;
}
