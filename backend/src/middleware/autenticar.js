import { verificarToken } from '../auth/token.js';
import { consultar } from '../config/db.js';

export const NOMBRE_COOKIE = 'sesion';

/**
 * Lee una cookie del pedido.
 *
 * Express no parsea cookies por si solo. Son pocas lineas, asi que se hace
 * a mano en vez de sumar una dependencia mas al proyecto.
 */
export function leerCookie(req, nombre) {
  const cabecera = req.headers.cookie;
  if (!cabecera) return null;
  for (const parte of cabecera.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nombre) {
      return decodeURIComponent(parte.slice(i + 1).trim());
    }
  }
  return null;
}

/**
 * Exige una sesion valida para continuar.
 *
 * Hace dos comprobaciones, y las dos son necesarias:
 *
 * 1. Que el token sea autentico y no haya vencido. Eso dice QUIEN es.
 * 2. Que el usuario siga existiendo y activo en la base. Eso dice si TODAVIA
 *    puede entrar.
 *
 * El segundo paso es el que permite que desactivar a alguien desde CU-02
 * tenga efecto inmediato. Un token firmado no se puede anular: sin esta
 * consulta, un usuario dado de baja seguiria operando hasta que su token
 * venciera, ocho horas despues.
 *
 * El costo es una consulta por clave primaria sobre una tabla chica.
 */
export async function autenticar(req, res, siguiente) {
  const token = leerCookie(req, NOMBRE_COOKIE);
  const datos = verificarToken(token);
  if (!datos) return res.status(401).json({ error: 'Sesion no valida' });

  const { rows } = await consultar(
    `SELECT u.id_usuario, u.nombre, u.email, u.activo, r.nombre AS rol
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = $1`,
    [datos.idUsuario]
  );

  const usuario = rows[0];
  if (!usuario || !usuario.activo) {
    return res.status(401).json({ error: 'Sesion no valida' });
  }

  // El rol se toma de la base, no del token: si a alguien le cambian el rol,
  // el cambio rige desde el proximo pedido y no cuando venza su token.
  req.usuario = {
    idUsuario: usuario.id_usuario,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
  };
  siguiente();
}

/**
 * Exige ademas que el usuario tenga alguno de los roles indicados.
 * Se usa asi:  router.post('/usuarios', autenticar, exigirRol('Encargado'), ...)
 */
export function exigirRol(...rolesPermitidos) {
  return (req, res, siguiente) => {
    if (!rolesPermitidos.includes(req.usuario?.rol)) {
      return res.status(403).json({ error: 'No tenes permiso para esta accion' });
    }
    siguiente();
  };
}
