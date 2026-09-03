/**
 * Llamadas a la API de sesion.
 *
 * Todas usan credentials: 'same-origin' para que el navegador envie la
 * cookie de sesion. El proxy de Vite hace que el frontend y el backend
 * compartan origen, asi que no hace falta configurar nada mas.
 */

const cabeceras = { 'Content-Type': 'application/json' };

/** CU-01. Devuelve el usuario si las credenciales son correctas. */
export async function iniciarSesion(email, password) {
  const respuesta = await fetch('/api/sesion', {
    method: 'POST',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify({ email, password }),
  });

  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo iniciar sesion');
  }
  return datos.usuario;
}

/**
 * Devuelve el usuario de la sesion actual, o null si no hay ninguna.
 *
 * Se llama al cargar la aplicacion: si el navegador todavia tiene una cookie
 * valida, se entra directo sin volver a pedir la contraseña.
 */
export async function obtenerSesion() {
  const respuesta = await fetch('/api/sesion', { credentials: 'same-origin' });
  if (!respuesta.ok) return null;
  const datos = await respuesta.json().catch(() => ({}));
  return datos.usuario ?? null;
}

/** Cierra la sesion: el servidor borra la cookie. */
export async function cerrarSesion() {
  await fetch('/api/sesion', { method: 'DELETE', credentials: 'same-origin' });
}
