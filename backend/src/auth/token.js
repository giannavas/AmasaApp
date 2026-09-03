import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/* Clave con la que se firman los tokens. Vive en .env, que no se versiona.
   Si falta, se genera una al azar: el servidor arranca, pero las sesiones
   se invalidan en cada reinicio. Eso avisa del problema sin bloquear el
   desarrollo, y en la instalacion queda documentado como paso obligatorio. */
const SECRETO = process.env.SESION_SECRETO || randomBytes(32).toString('hex');

if (!process.env.SESION_SECRETO) {
  console.warn(
    '[auth] Falta SESION_SECRETO en .env. Se genero una clave temporal: ' +
    'las sesiones se van a cerrar en cada reinicio del servidor.'
  );
}

/* Ocho horas: la duracion de un turno de trabajo. Vencido el token hay que
   volver a iniciar sesion. */
const DURACION_SEGUNDOS = 8 * 60 * 60;

function firmar(cuerpoB64) {
  return createHmac('sha256', SECRETO).update(cuerpoB64).digest('base64url');
}

/**
 * Arma un token firmado con los datos de la sesion.
 *
 * El contenido viaja legible (codificado en base64, no encriptado): no se
 * guarda nada secreto ahi, solo el id y el rol. Lo que impide falsificarlo
 * es la firma, que requiere el secreto del servidor.
 *
 * El formato es deliberadamente simple, sin campo de algoritmo. Los JWT
 * traen uno, y eso habilita un ataque conocido donde el atacante lo cambia
 * a "none" y el servidor acepta tokens sin firma. Aca no existe ese campo,
 * asi que ese ataque no es posible.
 */
export function firmarToken({ idUsuario, rol }, duracionSegundos = DURACION_SEGUNDOS) {
  const cuerpo = {
    idUsuario,
    rol,
    vence: Math.floor(Date.now() / 1000) + duracionSegundos,
  };
  const cuerpoB64 = Buffer.from(JSON.stringify(cuerpo)).toString('base64url');
  return `${cuerpoB64}.${firmar(cuerpoB64)}`;
}

/**
 * Verifica un token y devuelve su contenido, o null si no es valido.
 *
 * Comprueba dos cosas: que la firma corresponda al contenido (nadie lo
 * modifico) y que no haya vencido.
 */
export function verificarToken(token) {
  try {
    if (typeof token !== 'string') return null;
    const partes = token.split('.');
    if (partes.length !== 2) return null;

    const [cuerpoB64, firmaRecibida] = partes;
    const firmaEsperada = firmar(cuerpoB64);

    const a = Buffer.from(firmaRecibida);
    const b = Buffer.from(firmaEsperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const cuerpo = JSON.parse(Buffer.from(cuerpoB64, 'base64url').toString());
    if (typeof cuerpo.vence !== 'number') return null;
    if (cuerpo.vence < Math.floor(Date.now() / 1000)) return null;

    return cuerpo;
  } catch {
    return null;
  }
}
