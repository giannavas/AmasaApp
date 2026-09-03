import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derivar = promisify(scrypt);

/* Parametros de scrypt.
   N es el costo: cuanta memoria y CPU cuesta calcular un hash. Subirlo
   encarece el ataque por fuerza bruta en la misma proporcion. 16384 es el
   valor recomendado por OWASP para uso general y tarda unos 50 ms, que es
   imperceptible al iniciar sesion y carisimo para quien pruebe millones. */
const COSTO = 16384;
const BLOQUE = 8;
const PARALELISMO = 1;
const LARGO_CLAVE = 32;
const LARGO_SALT = 16;

/**
 * Convierte una contraseña en un hash seguro para guardar en la base.
 *
 * Cada llamada genera un salt aleatorio distinto, de modo que dos usuarios
 * con la misma contraseña producen hashes diferentes. Sin eso, ver dos
 * hashes iguales delataria que ambos usan la misma clave.
 *
 * El resultado es "scrypt$salt$hash", con el salt incluido: al verificar
 * hace falta el mismo salt, asi que viaja junto al hash.
 */
export async function hashearPassword(password) {
  const salt = randomBytes(LARGO_SALT);
  const clave = await derivar(password, salt, LARGO_CLAVE, {
    N: COSTO, r: BLOQUE, p: PARALELISMO,
  });
  return `scrypt$${salt.toString('base64')}$${clave.toString('base64')}`;
}

/**
 * Verifica una contraseña contra un hash almacenado.
 *
 * La comparacion usa timingSafeEqual y no ===. Comparar cadenas con ===
 * corta apenas encuentra una diferencia, y esa diferencia de tiempo, medida
 * muchas veces, permite deducir el valor correcto caracter por caracter.
 * timingSafeEqual siempre tarda lo mismo.
 *
 * Devuelve false ante cualquier formato invalido: nunca lanza excepcion,
 * para que un dato corrupto en la base no tumbe el inicio de sesion.
 */
export async function verificarPassword(password, hashGuardado) {
  try {
    const [algoritmo, saltB64, claveB64] = String(hashGuardado).split('$');
    if (algoritmo !== 'scrypt' || !saltB64 || !claveB64) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const esperado = Buffer.from(claveB64, 'base64');
    const calculado = await derivar(password, salt, esperado.length, {
      N: COSTO, r: BLOQUE, p: PARALELISMO,
    });
    return timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}
