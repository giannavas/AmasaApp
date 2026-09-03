import { Router } from 'express';
import { consultar } from '../config/db.js';
import { verificarPassword } from '../auth/password.js';
import { firmarToken } from '../auth/token.js';
import { autenticar, NOMBRE_COOKIE } from '../middleware/autenticar.js';

export const rutasSesion = Router();

const OCHO_HORAS_MS = 8 * 60 * 60 * 1000;

/* Opciones de la cookie de sesion.
   httpOnly: el JavaScript de la pagina no puede leerla, asi que un script
     inyectado no puede robarse la sesion.
   sameSite lax: el navegador no la manda en pedidos que vengan de otro sitio,
     lo que corta los ataques de peticion forzada.
   secure: solo en produccion. En desarrollo el sitio es http y una cookie
     secure no viajaria nunca. */
const opcionesCookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: OCHO_HORAS_MS,
};

/**
 * CU-01 - Iniciar sesion.
 */
rutasSesion.post('/', async (req, res, siguiente) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Ingresa tu correo y tu contraseña' });
    }

    const { rows } = await consultar(
      `SELECT u.id_usuario, u.nombre, u.email, u.password_hash, u.activo, r.nombre AS rol
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
        WHERE u.email = $1`,
      [email]
    );
    const usuario = rows[0];

    /* Se verifica la contraseña incluso cuando el email no existe, contra un
       hash descartable. Si se saltara ese paso, la respuesta llegaria mucho
       mas rapido para un email inexistente, y midiendo esa diferencia se
       podria averiguar que correos estan registrados. */
    const hash = usuario?.password_hash ?? 'scrypt$AAAA$AAAA';
    const coincide = await verificarPassword(password, hash);

    if (!usuario || !usuario.activo || !coincide) {
      // Un solo mensaje para los tres casos, por el mismo motivo.
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }

    const token = firmarToken({ idUsuario: usuario.id_usuario, rol: usuario.rol });
    res.cookie(NOMBRE_COOKIE, token, opcionesCookie);
    res.json({
      usuario: {
        idUsuario: usuario.id_usuario,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
    });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * Devuelve el usuario de la sesion actual. El frontend la consulta al cargar
 * para saber si hay que mostrar el login o la aplicacion.
 */
rutasSesion.get('/', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

/**
 * Cerrar sesion. Borra la cookie del navegador.
 */
rutasSesion.delete('/', (_req, res) => {
  res.clearCookie(NOMBRE_COOKIE, { ...opcionesCookie, maxAge: undefined });
  res.status(204).end();
});
