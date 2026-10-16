import { Router } from 'express';
import { consultar, conTransaccion } from '../config/db.js';
import { autenticar, exigirRol } from '../middleware/autenticar.js';

export const rutasMateriasPrimas = Router();

// CU-03, CU-04 y CU-05 son del Encargado.
rutasMateriasPrimas.use(autenticar, exigirRol('Encargado'));

/* Estado de stock de CU-05, calculado en SQL y no en JavaScript para que el
   filtro y el orden puedan usarlo sin traerse la tabla entera.

   En el minimo ya se considera critico: llegar al umbral es justamente la
   señal de que hay que reponer. El maximo, en cambio, se considera excedido
   solo al superarlo, porque estar en el tope todavia es una carga valida. */
const ESTADO_SQL = `
  CASE
    WHEN m.stock_actual <= m.stock_minimo THEN 'Critico'
    WHEN m.stock_actual >  m.stock_maximo THEN 'Sobrestock'
    ELSE 'OK'
  END`;

const SELECT_MATERIA_PRIMA = `
  SELECT m.id_materia_prima, m.nombre, m.unidad_medida, m.stock_actual,
         m.stock_minimo, m.stock_maximo, m.costo_promedio,
         m.id_proveedor_habitual, p.razon_social AS proveedor_habitual,
         ${ESTADO_SQL} AS estado
    FROM materia_prima m
    LEFT JOIN proveedor p ON p.id_proveedor = m.id_proveedor_habitual`;

/* Los DECIMAL de PostgreSQL llegan como texto para no perder precision al
   convertirlos. Se pasan a numero aca, una sola vez, asi el frontend no tiene
   que acordarse de hacerlo en cada pantalla. */
function aSalida(fila) {
  return {
    idMateriaPrima: fila.id_materia_prima,
    nombre: fila.nombre,
    unidadMedida: fila.unidad_medida,
    stockActual: Number(fila.stock_actual),
    stockMinimo: Number(fila.stock_minimo),
    stockMaximo: Number(fila.stock_maximo),
    costoPromedio: Number(fila.costo_promedio),
    idProveedorHabitual: fila.id_proveedor_habitual,
    proveedorHabitual: fila.proveedor_habitual,
    estado: fila.estado,
  };
}

function leerId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

/** Numero valido y no negativo. Devuelve null si no lo es. */
function aNumero(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

async function leerMateriaPrima(idMateriaPrima) {
  const { rows } = await consultar(
    `${SELECT_MATERIA_PRIMA} WHERE m.id_materia_prima = $1`,
    [idMateriaPrima]
  );
  return rows[0];
}

/**
 * CU-05 - Consultar el stock de insumos.
 *
 * Acepta ?estado= para filtrar y ?orden= para ordenar. El orden no se arma
 * concatenando lo que llega del cliente: se traduce contra una lista fija,
 * porque ORDER BY no admite parametros y concatenarlo abriria una inyeccion.
 */
rutasMateriasPrimas.get('/', async (req, res, siguiente) => {
  try {
    const ORDENES = {
      nombre: 'm.nombre',
      stock: 'm.stock_actual',
      estado: 'estado, m.nombre',
    };
    const ESTADOS = ['OK', 'Critico', 'Sobrestock'];

    const orden = ORDENES[req.query.orden] ?? ORDENES.nombre;
    const estado = req.query.estado;

    if (estado !== undefined && !ESTADOS.includes(estado)) {
      return res.status(400).json({ error: 'El estado pedido no existe' });
    }

    const filtro = estado ? `WHERE ${ESTADO_SQL} = $1` : '';
    const valores = estado ? [estado] : [];

    const { rows } = await consultar(
      `${SELECT_MATERIA_PRIMA} ${filtro} ORDER BY ${orden}`,
      valores
    );
    res.json({ materiasPrimas: rows.map(aSalida) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-03 - Registrar una materia prima.
 *
 * El alta hace dos cosas: crea la ficha del insumo y registra la primera
 * entrada de mercaderia. Van juntas dentro de una transaccion porque el stock
 * inicial sale de esa entrada: si se guardara la ficha y fallara el ingreso,
 * quedaria un insumo con stock en cero y sin rastro de la compra.
 *
 * El ingreso ademas es el unico lugar donde viven el precio pagado y la fecha
 * de vencimiento, que la ficha del insumo no tiene.
 */
rutasMateriasPrimas.post('/', async (req, res, siguiente) => {
  try {
    const {
      nombre, unidadMedida, stockMinimo, stockMaximo,
      cantidad, precioUnitario, fechaVencimiento, idProveedor,
    } = req.body ?? {};

    if (!nombre || !String(nombre).trim() || !unidadMedida || !String(unidadMedida).trim()) {
      return res.status(400).json({ error: 'Completa el nombre y la unidad de medida' });
    }

    const minimo = aNumero(stockMinimo);
    const maximo = aNumero(stockMaximo);
    const cantidadInicial = aNumero(cantidad);
    const precio = aNumero(precioUnitario);

    if (minimo === null || maximo === null || cantidadInicial === null || precio === null) {
      return res.status(400).json({
        error: 'Completa los umbrales de stock, la cantidad y el precio unitario',
      });
    }
    if (minimo < 0 || precio < 0) {
      return res.status(400).json({ error: 'Los valores no pueden ser negativos' });
    }
    if (maximo < minimo) {
      return res.status(400).json({ error: 'El stock maximo no puede ser menor que el minimo' });
    }
    if (cantidadInicial <= 0) {
      return res.status(400).json({ error: 'La cantidad inicial tiene que ser mayor que cero' });
    }

    const { rows: proveedores } = await consultar(
      'SELECT 1 FROM proveedor WHERE id_proveedor = $1',
      [idProveedor]
    );
    if (proveedores.length === 0) {
      return res.status(400).json({ error: 'El proveedor indicado no existe' });
    }

    const idMateriaPrima = await conTransaccion(async (cliente) => {
      const { rows } = await cliente.query(
        `INSERT INTO materia_prima
           (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo,
            costo_promedio, id_proveedor_habitual)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id_materia_prima`,
        [String(nombre).trim(), String(unidadMedida).trim(), cantidadInicial,
         minimo, maximo, precio, idProveedor]
      );
      const nuevo = rows[0].id_materia_prima;

      await cliente.query(
        `INSERT INTO ingreso_materia_prima
           (cantidad, precio_unitario, fecha_vencimiento,
            id_materia_prima, id_usuario, id_proveedor)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cantidadInicial, precio, fechaVencimiento || null,
         nuevo, req.usuario.idUsuario, idProveedor]
      );

      return nuevo;
    });

    res.status(201).json({ materiaPrima: aSalida(await leerMateriaPrima(idMateriaPrima)) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-04 - Editar una materia prima.
 *
 * Se editan los datos de la ficha y los umbrales, nunca el stock ni el costo.
 * Esos dos son resultado de los movimientos: el stock sube con los ingresos y
 * baja con la produccion, y el costo es el promedio ponderado de las compras.
 * Dejarlos editar a mano desincronizaria la ficha de su propio historial.
 */
rutasMateriasPrimas.put('/:id', async (req, res, siguiente) => {
  try {
    const id = leerId(req);
    if (id === null) return res.status(404).json({ error: 'La materia prima no existe' });

    const { nombre, unidadMedida, stockMinimo, stockMaximo, idProveedorHabitual } = req.body ?? {};

    if (!nombre || !String(nombre).trim() || !unidadMedida || !String(unidadMedida).trim()) {
      return res.status(400).json({ error: 'Completa el nombre y la unidad de medida' });
    }

    const minimo = aNumero(stockMinimo);
    const maximo = aNumero(stockMaximo);
    if (minimo === null || maximo === null) {
      return res.status(400).json({ error: 'Completa los umbrales de stock' });
    }
    if (minimo < 0) {
      return res.status(400).json({ error: 'Los valores no pueden ser negativos' });
    }
    if (maximo < minimo) {
      return res.status(400).json({ error: 'El stock maximo no puede ser menor que el minimo' });
    }

    // El proveedor habitual es opcional: la relacion es 0..1.
    if (idProveedorHabitual !== null && idProveedorHabitual !== undefined) {
      const { rows } = await consultar(
        'SELECT 1 FROM proveedor WHERE id_proveedor = $1',
        [idProveedorHabitual]
      );
      if (rows.length === 0) {
        return res.status(400).json({ error: 'El proveedor indicado no existe' });
      }
    }

    const { rowCount } = await consultar(
      `UPDATE materia_prima
          SET nombre = $1, unidad_medida = $2, stock_minimo = $3,
              stock_maximo = $4, id_proveedor_habitual = $5
        WHERE id_materia_prima = $6`,
      [String(nombre).trim(), String(unidadMedida).trim(), minimo, maximo,
       idProveedorHabitual ?? null, id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'La materia prima no existe' });

    res.json({ materiaPrima: aSalida(await leerMateriaPrima(id)) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * Registrar un ingreso de mercaderia sobre un insumo ya existente.
 *
 * Es la unica forma de que el stock de un insumo suba despues del alta. Sin
 * esta ruta el stock solo podia bajar al producir, y un insumo que llegaba a
 * cero dejaba trabada para siempre toda receta que lo usara.
 *
 * Hace dos cosas en una sola transaccion:
 *
 *  1. Deja asentada la compra en ingreso_materia_prima, con su precio y su
 *     proveedor, que es el historial de a cuanto se fue comprando.
 *  2. Suma la cantidad al stock y vuelve a calcular el costo promedio.
 *
 * El costo se recalcula con un promedio ponderado movil:
 *
 *     nuevo = (stock x costo + cantidad x precio) / (stock + cantidad)
 *
 * Se pondera contra el stock que queda y no contra todo lo comprado alguna
 * vez, porque lo que ya se consumio no deberia seguir influyendo en cuanto
 * vale lo que hay hoy en el deposito. De ese costo salen el valor de cada
 * lote producido y la rentabilidad del panel de control.
 *
 * La fila del insumo se bloquea con FOR UPDATE antes de leer el stock. Acá
 * el bloqueo pesa mas que en una venta: dos ingresos simultaneos leerian el
 * mismo costo viejo y el promedio quedaria mal de forma permanente, porque
 * ninguna operacion posterior lo corrige.
 */
rutasMateriasPrimas.post('/:id/ingresos', async (req, res, siguiente) => {
  try {
    const id = leerId(req);
    if (id === null) return res.status(404).json({ error: 'La materia prima no existe' });

    const { cantidad, precioUnitario, fechaVencimiento, idProveedor } = req.body ?? {};

    const cantidadIngresada = aNumero(cantidad);
    const precio = aNumero(precioUnitario);

    if (cantidadIngresada === null || precio === null) {
      return res.status(400).json({ error: 'Completa la cantidad y el precio unitario' });
    }
    if (cantidadIngresada <= 0) {
      return res.status(400).json({ error: 'La cantidad ingresada tiene que ser mayor que cero' });
    }
    if (precio < 0) {
      return res.status(400).json({ error: 'El precio unitario no puede ser negativo' });
    }

    /* El proveedor es obligatorio: la columna id_proveedor del ingreso no
       admite nulos, porque una compra siempre se le hace a alguien. */
    const { rows: proveedores } = await consultar(
      'SELECT 1 FROM proveedor WHERE id_proveedor = $1',
      [idProveedor]
    );
    if (proveedores.length === 0) {
      return res.status(400).json({ error: 'El proveedor indicado no existe' });
    }

    const resultado = await conTransaccion(async (cliente) => {
      const { rows } = await cliente.query(
        `SELECT stock_actual, costo_promedio
           FROM materia_prima
          WHERE id_materia_prima = $1
            FOR UPDATE`,
        [id]
      );
      if (rows.length === 0) return { noExiste: true };

      const stockPrevio = Number(rows[0].stock_actual);
      const costoPrevio = Number(rows[0].costo_promedio);

      const stockNuevo = stockPrevio + cantidadIngresada;
      /* Con el stock en cero la formula da exactamente el precio nuevo, asi
         que el caso no necesita un if aparte. */
      const costoNuevo =
        (stockPrevio * costoPrevio + cantidadIngresada * precio) / stockNuevo;

      await cliente.query(
        `INSERT INTO ingreso_materia_prima
           (cantidad, precio_unitario, fecha_vencimiento,
            id_materia_prima, id_usuario, id_proveedor)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cantidadIngresada, precio, fechaVencimiento || null,
         id, req.usuario.idUsuario, idProveedor]
      );

      await cliente.query(
        `UPDATE materia_prima
            SET stock_actual = $1, costo_promedio = $2
          WHERE id_materia_prima = $3`,
        [stockNuevo, costoNuevo, id]
      );

      return {};
    });

    if (resultado.noExiste) {
      return res.status(404).json({ error: 'La materia prima no existe' });
    }

    res.status(201).json({ materiaPrima: aSalida(await leerMateriaPrima(id)) });
  } catch (error) {
    siguiente(error);
  }
});
