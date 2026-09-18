/**
 * Llamadas a la API de proveedores (CU-11).
 */

const cabeceras = { 'Content-Type': 'application/json' };

async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo completar la operacion');
  }
  return datos;
}

/** Devuelve todos los proveedores, ordenados por razon social. */
export async function listarProveedores() {
  const respuesta = await fetch('/api/proveedores', { credentials: 'same-origin' });
  return (await procesar(respuesta)).proveedores;
}

/** Registra un proveedor. Solo la razon social es obligatoria. */
export async function crearProveedor(datos) {
  const respuesta = await fetch('/api/proveedores', {
    method: 'POST',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify(datos),
  });
  return (await procesar(respuesta)).proveedor;
}

/** Actualiza los datos de un proveedor. */
export async function editarProveedor(idProveedor, datos) {
  const respuesta = await fetch(`/api/proveedores/${idProveedor}`, {
    method: 'PUT',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify(datos),
  });
  return (await procesar(respuesta)).proveedor;
}
