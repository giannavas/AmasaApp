import { Router } from 'express';
import { consultar } from '../config/db.js';
import { autenticar, exigirRol } from '../middleware/autenticar.js';

export const rutasProveedores = Router();

/* Unicidad violada. Sobre esta tabla solo puede venir del indice parcial
   uq_proveedor_cuit, que impide dos proveedores con el mismo CUIT pero deja
   cargar varios sin CUIT, porque el dato es opcional. */
const CUIT_REPETIDO = '23505';

// CU-11 es del Encargado, igual que el resto de la administracion.
rutasProveedores.use(autenticar, exigirRol('Encargado'));

const SELECT_PROVEEDOR = `
  SELECT id_proveedor, razon_social, cuit, telefono, email, direccion
    FROM proveedor`;

function aSalida(fila) {
  return {
    idProveedor: fila.id_proveedor,
    razonSocial: fila.razon_social,
    cuit: fila.cuit,
    telefono: fila.telefono,
    email: fila.email,
    direccion: fila.direccion,
  };
}

/** Deja en null lo que venga vacio: la base distingue "sin dato" de "". */
function oNulo(valor) {
  const texto = typeof valor === 'string' ? valor.trim() : valor;
  return texto === '' || texto === undefined ? null : texto;
}

function leerId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

async function leerProveedor(idProveedor) {
  const { rows } = await consultar(`${SELECT_PROVEEDOR} WHERE id_proveedor = $1`, [idProveedor]);
  return rows[0];
}

/**
 * CU-11 - Listar proveedores.
 */
rutasProveedores.get('/', async (_req, res, siguiente) => {
  try {
    const { rows } = await consultar(`${SELECT_PROVEEDOR} ORDER BY razon_social`);
    res.json({ proveedores: rows.map(aSalida) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-11 - Registrar un proveedor.
 *
 * Solo la razon social es obligatoria. El resto de los datos de contacto se
 * cargan cuando se los tiene: exigirlos frenaria el alta de un proveedor del
 * que todavia falta el CUIT o el telefono.
 */
rutasProveedores.post('/', async (req, res, siguiente) => {
  try {
    const { razonSocial, cuit, telefono, email, direccion } = req.body ?? {};

    if (!razonSocial || !String(razonSocial).trim()) {
      return res.status(400).json({ error: 'La razon social es obligatoria' });
    }

    const { rows } = await consultar(
      `INSERT INTO proveedor (razon_social, cuit, telefono, email, direccion)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_proveedor`,
      [String(razonSocial).trim(), oNulo(cuit), oNulo(telefono), oNulo(email), oNulo(direccion)]
    );

    res.status(201).json({ proveedor: aSalida(await leerProveedor(rows[0].id_proveedor)) });
  } catch (error) {
    if (error.code === CUIT_REPETIDO) {
      return res.status(409).json({ error: 'Ya hay un proveedor con ese CUIT' });
    }
    siguiente(error);
  }
});

/**
 * CU-11 - Editar un proveedor.
 */
rutasProveedores.put('/:id', async (req, res, siguiente) => {
  try {
    const id = leerId(req);
    if (id === null) return res.status(404).json({ error: 'El proveedor no existe' });

    const { razonSocial, cuit, telefono, email, direccion } = req.body ?? {};
    if (!razonSocial || !String(razonSocial).trim()) {
      return res.status(400).json({ error: 'La razon social es obligatoria' });
    }

    const { rowCount } = await consultar(
      `UPDATE proveedor
          SET razon_social = $1, cuit = $2, telefono = $3, email = $4, direccion = $5
        WHERE id_proveedor = $6`,
      [String(razonSocial).trim(), oNulo(cuit), oNulo(telefono), oNulo(email), oNulo(direccion), id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'El proveedor no existe' });

    res.json({ proveedor: aSalida(await leerProveedor(id)) });
  } catch (error) {
    if (error.code === CUIT_REPETIDO) {
      return res.status(409).json({ error: 'Ya hay un proveedor con ese CUIT' });
    }
    siguiente(error);
  }
});
