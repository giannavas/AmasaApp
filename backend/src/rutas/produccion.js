import { Router } from 'express';
import { consultar, conTransaccion } from '../config/db.js';
import { autenticar, exigirRol } from '../middleware/autenticar.js';

export const rutasProduccion = Router();

/* CU-06 es del Panificador y del Encargado. Es la primera pantalla que no es
   exclusiva de la administracion: el Panificador es quien produce. */
rutasProduccion.use(autenticar, exigirRol('Panificador', 'Encargado'));

const SELECT_LOTE = `
  SELECT l.id_lote, l.fecha, l.cantidad_producida, l.costo_total,
         r.nombre AS receta, p.nombre AS producto, u.nombre AS usuario
    FROM lote_produccion l
    JOIN receta r   ON r.id_receta   = l.id_receta
    JOIN producto p ON p.id_producto = r.id_producto
    JOIN usuario u  ON u.id_usuario  = l.id_usuario`;

function aSalida(fila) {
  const cantidad = Number(fila.cantidad_producida);
  const costo = Number(fila.costo_total);
  return {
    idLote: fila.id_lote,
    fecha: fila.fecha,
    cantidadProducida: cantidad,
    costoTotal: costo,
    // Lo que costo fabricar cada unidad. Es el dato que sirve para decidir el
    // precio de venta, y por eso se calcula aca y no en cada pantalla.
    costoUnitario: cantidad > 0 ? costo / cantidad : 0,
    receta: fila.receta,
    producto: fila.producto,
    usuario: fila.usuario,
  };
}

/**
 * CU-06 - Listar los lotes producidos.
 */
rutasProduccion.get('/', async (_req, res, siguiente) => {
  try {
    const { rows } = await consultar(`${SELECT_LOTE} ORDER BY l.fecha DESC, l.id_lote DESC`);
    res.json({ lotes: rows.map(aSalida) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-06 - Registrar un lote de produccion.
 *
 * Es la operacion mas delicada del sistema: toca el stock de varios insumos y
 * el del producto terminado, y deja un registro contable. Todo ocurre dentro
 * de una transaccion, de modo que un fallo a mitad de camino no pueda dejar
 * insumos descontados sin lote, ni un lote sin sus insumos descontados.
 *
 * Los insumos se bloquean con SELECT ... FOR UPDATE antes de comprobar el
 * stock. Sin ese bloqueo, dos lotes registrados al mismo tiempo podrian leer
 * el mismo stock disponible, los dos encontrarlo suficiente, y entre ambos
 * descontar mas de lo que habia.
 */
rutasProduccion.post('/', async (req, res, siguiente) => {
  try {
    const { idReceta, cantidadProducida, fecha } = req.body ?? {};

    const cantidad = Number(cantidadProducida);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({
        error: 'La cantidad a producir tiene que ser un numero entero mayor que cero',
      });
    }
    if (!Number.isInteger(Number(idReceta))) {
      return res.status(400).json({ error: 'Elegi la receta a producir' });
    }

    const resultado = await conTransaccion(async (cliente) => {
      const { rows: recetas } = await cliente.query(
        `SELECT r.id_receta, r.rendimiento_unidades, r.id_producto
           FROM receta r WHERE r.id_receta = $1`,
        [Number(idReceta)]
      );
      if (recetas.length === 0) {
        return { error: { estado: 400, mensaje: 'La receta indicada no existe' } };
      }
      const receta = recetas[0];

      /* Cuantas veces entra la receta en lo que se quiere producir. Si la
         receta rinde 24 y se piden 48, el factor es 2 y cada insumo se
         consume al doble. No se exige que sea entero: se puede producir
         media receta. */
      const factor = cantidad / Number(receta.rendimiento_unidades);

      /* Se piden los insumos de la receta junto con su stock y su costo, y se
         bloquean las filas de materia_prima hasta que termine la transaccion. */
      const { rows: insumos } = await cliente.query(
        `SELECT d.id_materia_prima, d.cantidad_requerida,
                m.nombre, m.stock_actual, m.costo_promedio
           FROM receta_detalle d
           JOIN materia_prima m ON m.id_materia_prima = d.id_materia_prima
          WHERE d.id_receta = $1
          ORDER BY d.id_materia_prima
            FOR UPDATE OF m`,
        [receta.id_receta]
      );
      if (insumos.length === 0) {
        return { error: { estado: 400, mensaje: 'La receta no tiene insumos cargados' } };
      }

      // Se calcula todo antes de escribir, para poder avisar que insumo falta
      // sin haber modificado nada todavia.
      const consumos = insumos.map((insumo) => {
        const necesaria = Number(insumo.cantidad_requerida) * factor;
        const costoUnitario = Number(insumo.costo_promedio);
        return {
          idMateriaPrima: insumo.id_materia_prima,
          nombre: insumo.nombre,
          disponible: Number(insumo.stock_actual),
          cantidad: necesaria,
          costoUnitario,
          subtotal: necesaria * costoUnitario,
        };
      });

      const faltante = consumos.find((c) => c.disponible < c.cantidad);
      if (faltante) {
        return {
          error: {
            estado: 409,
            mensaje: `Stock insuficiente de ${faltante.nombre}: ` +
                     `hacen falta ${faltante.cantidad} y hay ${faltante.disponible}`,
          },
        };
      }

      const costoTotal = consumos.reduce((suma, c) => suma + c.subtotal, 0);

      const { rows: lotes } = await cliente.query(
        `INSERT INTO lote_produccion
           (fecha, cantidad_producida, costo_total, id_receta, id_usuario)
         VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5)
         RETURNING id_lote`,
        [fecha || null, cantidad, costoTotal, receta.id_receta, req.usuario.idUsuario]
      );
      const idLote = lotes[0].id_lote;

      for (const consumo of consumos) {
        /* Queda guardado el costo del insumo al momento de producir. Si la
           proxima compra cambia el promedio, este lote conserva lo que
           realmente costo. */
        await cliente.query(
          `INSERT INTO consumo_materia_prima
             (cantidad, costo_unitario, subtotal, id_lote, id_materia_prima)
           VALUES ($1, $2, $3, $4, $5)`,
          [consumo.cantidad, consumo.costoUnitario, consumo.subtotal,
           idLote, consumo.idMateriaPrima]
        );

        await cliente.query(
          `UPDATE materia_prima SET stock_actual = stock_actual - $1
            WHERE id_materia_prima = $2`,
          [consumo.cantidad, consumo.idMateriaPrima]
        );
      }

      await cliente.query(
        'UPDATE producto SET stock_actual = stock_actual + $1 WHERE id_producto = $2',
        [cantidad, receta.id_producto]
      );

      return { idLote };
    });

    if (resultado.error) {
      return res.status(resultado.error.estado).json({ error: resultado.error.mensaje });
    }

    const { rows } = await consultar(`${SELECT_LOTE} WHERE l.id_lote = $1`, [resultado.idLote]);
    res.status(201).json({ lote: aSalida(rows[0]) });
  } catch (error) {
    siguiente(error);
  }
});
