import { Router } from 'express';
import { consultar } from '../config/db.js';
import { hashearPassword } from '../auth/password.js';
import { autenticar, exigirRol } from '../middleware/autenticar.js';

export const rutasUsuarios = Router();

const LARGO_MINIMO_CLAVE = 8;

/* PostgreSQL devuelve este codigo cuando se viola una restriccion UNIQUE.
   Acá solo puede venir de uq_usuario_email. Se atrapa el error en vez de
   consultar antes si el correo existe: entre la consulta y el INSERT otro
   pedido podria insertar el mismo correo, y la restriccion de la base es la
   unica comprobacion que no tiene esa ventana. */
const CORREO_REPETIDO = '23505';

// Todo CU-02 es exclusivo del Encargado. Va una sola vez acá y no ruta por ruta:
// asi no hay forma de agregar una operacion mas adelante y olvidarse el permiso.
rutasUsuarios.use(autenticar, exigirRol('Encargado'));

const SELECT_USUARIO = `
  SELECT u.id_usuario, u.nombre, u.email, u.activo, r.nombre AS rol
    FROM usuario u JOIN rol r ON r.id_rol = u.id_rol`;

/**
 * Da forma a la respuesta. Convierte snake_case a camelCase y, sobre todo,
 * deja afuera password_hash: la consulta ya no lo trae, y esta funcion es la
 * segunda barrera para que no se escape nunca.
 */
function aSalida(fila) {
  return {
    idUsuario: fila.id_usuario,
    nombre: fila.nombre,
    email: fila.email,
    rol: fila.rol,
    activo: fila.activo,
  };
}

/** Devuelve el id del rol, o null si el nombre no corresponde a ninguno. */
async function buscarIdRol(nombre) {
  const { rows } = await consultar('SELECT id_rol FROM rol WHERE nombre = $1', [nombre]);
  return rows[0]?.id_rol ?? null;
}

/** Relee un usuario ya modificado para devolverlo con el nombre del rol. */
async function leerUsuario(idUsuario) {
  const { rows } = await consultar(`${SELECT_USUARIO} WHERE u.id_usuario = $1`, [idUsuario]);
  return rows[0];
}

/** Lee el :id de la URL. Devuelve null si no es un entero. */
function leerId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

/**
 * CU-02 - Listar usuarios.
 */
rutasUsuarios.get('/', async (_req, res, siguiente) => {
  try {
    const { rows } = await consultar(`${SELECT_USUARIO} ORDER BY u.nombre`);
    res.json({ usuarios: rows.map(aSalida) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-02 - Crear un usuario.
 */
rutasUsuarios.post('/', async (req, res, siguiente) => {
  try {
    const { nombre, email, password, rol } = req.body ?? {};

    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: 'Completa nombre, correo, contraseña y rol' });
    }
    if (password.length < LARGO_MINIMO_CLAVE) {
      return res.status(400).json({
        error: `La contraseña necesita al menos ${LARGO_MINIMO_CLAVE} caracteres`,
      });
    }

    const idRol = await buscarIdRol(rol);
    if (!idRol) {
      return res.status(400).json({ error: 'El rol indicado no existe' });
    }

    // El mismo modulo que usa el script de alta por consola. Si se hashearan
    // distinto, el usuario quedaria creado pero no podria iniciar sesion.
    const passwordHash = await hashearPassword(password);

    const { rows } = await consultar(
      `INSERT INTO usuario (nombre, email, password_hash, id_rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id_usuario`,
      [nombre, email, passwordHash, idRol]
    );

    res.status(201).json({ usuario: aSalida(await leerUsuario(rows[0].id_usuario)) });
  } catch (error) {
    if (error.code === CORREO_REPETIDO) {
      return res.status(409).json({ error: 'Ya hay un usuario con ese correo' });
    }
    siguiente(error);
  }
});

/**
 * CU-02 - Editar nombre, correo o rol.
 *
 * La contraseña no se toca desde acá: cambiarla es otra operacion, con otras
 * precauciones, y mezclarla con la edicion de datos haria que un descuido en
 * el formulario pise la clave de alguien.
 */
rutasUsuarios.put('/:id', async (req, res, siguiente) => {
  try {
    const id = leerId(req);
    if (id === null) return res.status(404).json({ error: 'El usuario no existe' });

    const { nombre, email, rol } = req.body ?? {};
    if (!nombre || !email || !rol) {
      return res.status(400).json({ error: 'Completa nombre, correo y rol' });
    }

    const idRol = await buscarIdRol(rol);
    if (!idRol) {
      return res.status(400).json({ error: 'El rol indicado no existe' });
    }

    const { rowCount } = await consultar(
      `UPDATE usuario SET nombre = $1, email = $2, id_rol = $3
        WHERE id_usuario = $4`,
      [nombre, email, idRol, id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'El usuario no existe' });

    res.json({ usuario: aSalida(await leerUsuario(id)) });
  } catch (error) {
    if (error.code === CORREO_REPETIDO) {
      return res.status(409).json({ error: 'Ya hay un usuario con ese correo' });
    }
    siguiente(error);
  }
});

/**
 * CU-02 - Activar o desactivar un usuario.
 *
 * Desactivar es la baja del sistema. No se borra el usuario porque sus ventas,
 * ingresos y lotes quedan asociados a el: borrarlo dejaria el historial sin
 * responsable, y la base lo impide con ON DELETE RESTRICT.
 */
rutasUsuarios.patch('/:id/estado', async (req, res, siguiente) => {
  try {
    const id = leerId(req);
    if (id === null) return res.status(404).json({ error: 'El usuario no existe' });

    const { activo } = req.body ?? {};
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ error: 'Indica si el usuario queda activo o inactivo' });
    }

    /* Un Encargado que se desactiva a si mismo pierde el acceso en el pedido
       siguiente, y como solo un Encargado puede reactivarlo, si era el unico
       el sistema queda sin nadie que pueda administrarlo. Recuperarlo exige
       entrar a la base a mano. La base no puede impedirlo porque no sabe
       quien hace el pedido, asi que la regla vive acá. */
    if (id === req.usuario.idUsuario && activo === false) {
      return res.status(409).json({ error: 'No podes desactivar tu propio usuario' });
    }

    const { rowCount } = await consultar(
      'UPDATE usuario SET activo = $1 WHERE id_usuario = $2',
      [activo, id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'El usuario no existe' });

    res.json({ usuario: aSalida(await leerUsuario(id)) });
  } catch (error) {
    siguiente(error);
  }
});
