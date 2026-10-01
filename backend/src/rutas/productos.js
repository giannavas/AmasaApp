import { Router } from 'express';
import { consultar } from '../config/db.js';
import { autenticar, exigirRol } from '../middleware/autenticar.js';

export const rutasProductos = Router();

rutasProductos.use(autenticar, exigirRol('Encargado'));

/* Mismo criterio de estado que en los insumos: en el minimo ya se considera
   critico, y el maximo se considera excedido solo al superarlo. */
const ESTADO_SQL = `
  CASE
    WHEN stock_actual <= stock_minimo THEN 'Critico'
    WHEN stock_actual >  stock_maximo THEN 'Sobrestock'
    ELSE 'OK'
  END`;

const SELECT_PRODUCTO = `
  SELECT id_producto, nombre, descripcion, stock_actual, precio_venta,
         stock_minimo, stock_maximo, ${ESTADO_SQL} AS estado
    FROM producto`;

function aSalida(fila) {
  return {
    idProducto: fila.id_producto,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    stockActual: Number(fila.stock_actual),
    precioVenta: Number(fila.precio_venta),
    stockMinimo: Number(fila.stock_minimo),
    stockMaximo: Number(fila.stock_maximo),
    estado: fila.estado,
  };
}

function aNumero(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function leerId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

async function leerProducto(idProducto) {
  const { rows } = await consultar(`${SELECT_PRODUCTO} WHERE id_producto = $1`, [idProducto]);
  return rows[0];
}

/**
 * Valida los datos comunes al alta y a la edicion.
 * Devuelve null si estan bien, o el mensaje de error si no.
 */
function validar({ nombre, precioVenta, stockMinimo, stockMaximo }) {
  if (!nombre || !String(nombre).trim()) {
    return 'El nombre del producto es obligatorio';
  }
  const precio = aNumero(precioVenta);
  const minimo = aNumero(stockMinimo);
  const maximo = aNumero(stockMaximo);

  if (precio === null || minimo === null || maximo === null) {
    return 'Completa el precio de venta y los umbrales de stock';
  }
  if (precio < 0 || minimo < 0) {
    return 'Los valores no pueden ser negativos';
  }
  if (maximo < minimo) {
    return 'El stock maximo no puede ser menor que el minimo';
  }
  return null;
}

/**
 * Listar productos con su estado de stock.
 */
rutasProductos.get('/', async (_req, res, siguiente) => {
  try {
    const { rows } = await consultar(`${SELECT_PRODUCTO} ORDER BY nombre`);
    res.json({ productos: rows.map(aSalida) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * Dar de alta un producto terminado.
 *
 * No recibe stock inicial. El stock de un producto solo sube al producir un
 * lote (CU-06) y baja al vender (CU-07): cargarlo a mano dejaria un stock sin
 * ningun lote que lo respalde.
 */
rutasProductos.post('/', async (req, res, siguiente) => {
  try {
    const { nombre, descripcion, precioVenta, stockMinimo, stockMaximo } = req.body ?? {};

    const error = validar(req.body ?? {});
    if (error) return res.status(400).json({ error });

    const limpia = typeof descripcion === 'string' ? descripcion.trim() : null;

    const { rows } = await consultar(
      `INSERT INTO producto (nombre, descripcion, precio_venta, stock_minimo, stock_maximo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_producto`,
      [String(nombre).trim(), limpia || null, Number(precioVenta),
       Number(stockMinimo), Number(stockMaximo)]
    );

    res.status(201).json({ producto: aSalida(await leerProducto(rows[0].id_producto)) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * Editar un producto. No toca el stock, por el mismo motivo que el alta.
 */
rutasProductos.put('/:id', async (req, res, siguiente) => {
  try {
    const id = leerId(req);
    if (id === null) return res.status(404).json({ error: 'El producto no existe' });

    const error = validar(req.body ?? {});
    if (error) return res.status(400).json({ error });

    const { nombre, descripcion, precioVenta, stockMinimo, stockMaximo } = req.body;
    const limpia = typeof descripcion === 'string' ? descripcion.trim() : null;

    const { rowCount } = await consultar(
      `UPDATE producto
          SET nombre = $1, descripcion = $2, precio_venta = $3,
              stock_minimo = $4, stock_maximo = $5
        WHERE id_producto = $6`,
      [String(nombre).trim(), limpia || null, Number(precioVenta),
       Number(stockMinimo), Number(stockMaximo), id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'El producto no existe' });

    res.json({ producto: aSalida(await leerProducto(id)) });
  } catch (error) {
    siguiente(error);
  }
});
