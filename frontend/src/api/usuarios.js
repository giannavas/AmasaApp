/**
 * Llamadas a la API de usuarios (CU-02).
 *
 * Igual que en sesion.js, todas mandan la cookie con credentials y el proxy
 * de Vite hace que frontend y backend compartan origen.
 */

const cabeceras = { 'Content-Type': 'application/json' };

/**
 * Lee la respuesta y convierte un error del servidor en una excepcion con su
 * mensaje. Asi cada pantalla muestra el texto que escribio el backend en vez
 * de uno generico: "Ya hay un usuario con ese correo" en lugar de "Error 409".
 */
async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo completar la operacion');
  }
  return datos;
}

/** Devuelve todos los usuarios, ordenados por nombre. */
export async function listarUsuarios() {
  const respuesta = await fetch('/api/usuarios', { credentials: 'same-origin' });
  return (await procesar(respuesta)).usuarios;
}

/** Da de alta un usuario y devuelve el creado. */
export async function crearUsuario({ nombre, email, password, rol }) {
  const respuesta = await fetch('/api/usuarios', {
    method: 'POST',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify({ nombre, email, password, rol }),
  });
  return (await procesar(respuesta)).usuario;
}

/** Edita nombre, correo y rol. La contraseña no se toca desde aca. */
export async function editarUsuario(idUsuario, { nombre, email, rol }) {
  const respuesta = await fetch(`/api/usuarios/${idUsuario}`, {
    method: 'PUT',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify({ nombre, email, rol }),
  });
  return (await procesar(respuesta)).usuario;
}

/** Activa o desactiva un usuario. */
export async function cambiarEstado(idUsuario, activo) {
  const respuesta = await fetch(`/api/usuarios/${idUsuario}/estado`, {
    method: 'PATCH',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify({ activo }),
  });
  return (await procesar(respuesta)).usuario;
}
