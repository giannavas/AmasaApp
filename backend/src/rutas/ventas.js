import { Router } from 'express';
import { consultar, conTransaccion } from '../config/db.js';
import { autenticar, exigirRol } from '../middleware/autenticar.js';

export const rutasVentas = Router();

/* CU-07 es de los tres roles. El mostrador es quien vende, pero el
   Panificador y el Encargado tambien pueden registrar una venta cuando
   atienden ellos.

   Hoy los tres roles del sistema estan en la lista, asi que exigirRol no
   rechaza a nadie. Se deja igual por dos motivos: deja escrito en el codigo
   quienes son los actores del caso de uso, y si mañana se suma un rol nuevo
   queda afuera por defecto en vez de entrar sin que nadie lo decida. */
rutasVentas.use(autenticar, exigirRol('Venta', 'Panificador', 'Encargado'));

const SELECT_VENTA = `
  SELECT v.id_venta, v.fecha, v.total, u.nombre AS usuario
    FROM venta v
    JOIN usuario u ON u.id_usuario = v.id_usuario`;

const SELECT_DETALLE = `
  SELECT d.id_detalle_venta, d.id_venta, d.cantidad, d.precio_unitario,
         d.subtotal, d.id_producto, p.nombre AS producto
    FROM detalle_venta d
    JOIN producto p ON p.id_producto = d.id_producto`;

/* Los DECIMAL de PostgreSQL llegan como texto para no perder precision. Se
   convierten aca, una sola vez, y no en cada pantalla. */
function aSalidaDetalle(fila) {
  return {
    idDetalleVenta: fila.id_detalle_venta,
    idProducto: fila.id_producto,
    producto: fila.producto,
    cantidad: Number(fila.cantidad),
    precioUnitario: Number(fila.precio_unitario),
    subtotal: Number(fila.subtotal),
  };
}

function aSalida(fila, detalles) {
  return {
    idVenta: fila.id_venta,
    fecha: fila.fecha,
    total: Number(fila.total),
    usuario: fila.usuario,
    detalles,
  };
}

/** Lee una venta con su detalle. */
async function leerVenta(idVenta) {
  const { rows } = await consultar(`${SELECT_VENTA} WHERE v.id_venta = $1`, [idVenta]);
  if (rows.length === 0) return undefined;

  const { rows: detalles } = await consultar(
    `${SELECT_DETALLE} WHERE d.id_venta = $1 ORDER BY d.id_detalle_venta`,
    [idVenta]
  );
  return aSalida(rows[0], detalles.map(aSalidaDetalle));
}

/**
 * Valida las lineas que llegan en el pedido.
 *
 * Devuelve { error } con el mensaje para el usuario, o { lineas } ya
 * normalizadas a numeros.
 */
function validarDetalles(detalles) {
  if (!Array.isArray(detalles) || detalles.length === 0) {
    return { error: 'Carga al menos un producto en la venta' };
  }

  const lineas = [];
  for (const detalle of detalles) {
    const idProducto = Number(detalle?.idProducto);
    if (!Number.isInteger(idProducto)) {
      return { error: 'Elegi el producto de cada linea de la venta' };
    }

    const cantidad = Number(detalle?.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      return { error: 'La cantidad vendida tiene que ser un numero entero mayor que cero' };
    }

    /* El precio es opcional: si no viene, se toma el de lista del producto.
       Si viene, tiene que ser un numero no negativo. */
    let precioUnitario = null;
    if (detalle?.precioUnitario !== undefined && detalle?.precioUnitario !== null
        && detalle?.precioUnitario !== '') {
      precioUnitario = Number(detalle.precioUnitario);
      if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
        return { error: 'El precio de venta no puede ser negativo' };
      }
    }

    lineas.push({ idProducto, cantidad, precioUnitario });
  }

  return { lineas };
}

/**
 * CU-07 - Registrar una venta.
 *
 * Es la operacion espejo de CU-06: donde producir suma unidades al stock de
 * productos, vender se las resta. Y como ahi, todo ocurre dentro de una
 * transaccion para que no pueda quedar una venta sin stock descontado ni
 * stock descontado sin venta.
 *
 * Los productos se bloquean con SELECT ... FOR UPDATE antes de comprobar el
 * stock. Sin ese bloqueo, dos ventas simultaneas del mismo producto podrian
 * leer el mismo stock disponible, las dos encontrarlo suficiente, y entre
 * ambas vender mas unidades de las que habia. En el mostrador de una
 * panaderia eso no es hipotetico: es la hora pico con dos cajas abiertas.
 */
rutasVentas.post('/', async (req, res, siguiente) => {
  try {
    const { detalles, fecha } = req.body ?? {};

    const validacion = validarDetalles(detalles);
    if (validacion.error) {
      return res.status(400).json({ error: validacion.error });
    }
    const { lineas } = validacion;

    const resultado = await conTransaccion(async (cliente) => {
      /* Cuanto se pide de cada producto en total. Se agrupa porque el mismo
         producto puede venir en dos lineas, y el stock hay que controlarlo
         contra la suma: dos lineas de 15 contra un stock de 20 entran por
         separado pero no juntas. */
      const pedidoPorProducto = new Map();
      for (const linea of lineas) {
        const acumulado = pedidoPorProducto.get(linea.idProducto) ?? 0;
        pedidoPorProducto.set(linea.idProducto, acumulado + linea.cantidad);
      }

      const ids = [...pedidoPorProducto.keys()];

      /* Se traen los productos con su stock y su precio, y se bloquean sus
         filas hasta el final de la transaccion. El ORDER BY importa: si dos
         ventas bloquean los mismos productos en el mismo orden no puede
         haber un abrazo mortal entre ellas. */
      const { rows: productos } = await cliente.query(
        `SELECT id_producto, nombre, stock_actual, precio_venta
           FROM producto
          WHERE id_producto = ANY($1::int[])
          ORDER BY id_producto
            FOR UPDATE`,
        [ids]
      );

      if (productos.length !== ids.length) {
        return { error: { estado: 400, mensaje: 'Alguno de los productos elegidos no existe' } };
      }

      const porId = new Map(productos.map((p) => [p.id_producto, p]));

      // Se controla todo antes de escribir, para poder avisar que producto
      // falta sin haber modificado nada todavia.
      for (const [idProducto, pedido] of pedidoPorProducto) {
        const producto = porId.get(idProducto);
        const disponible = Number(producto.stock_actual);
        if (disponible < pedido) {
          return {
            error: {
              estado: 409,
              mensaje: `Stock insuficiente de ${producto.nombre}: ` +
                       `se piden ${pedido} y hay ${disponible}`,
            },
          };
        }
      }

      /* Cada linea queda con su precio: el que cargo el vendedor, o el de
         lista si no cargo ninguno. Guardarlo en detalle_venta y no mirar el
         producto cada vez es lo que hace que una venta vieja conserve el
         precio al que realmente se vendio, aunque despues cambie la lista. */
      const conPrecio = lineas.map((linea) => {
        const producto = porId.get(linea.idProducto);
        const precioUnitario = linea.precioUnitario ?? Number(producto.precio_venta);
        return { ...linea, precioUnitario, subtotal: linea.cantidad * precioUnitario };
      });

      const total = conPrecio.reduce((suma, linea) => suma + linea.subtotal, 0);

      const { rows: ventas } = await cliente.query(
        `INSERT INTO venta (fecha, total, id_usuario)
         VALUES (COALESCE($1::timestamp, CURRENT_TIMESTAMP), $2, $3)
         RETURNING id_venta`,
        [fecha || null, total, req.usuario.idUsuario]
      );
      const idVenta = ventas[0].id_venta;

      for (const linea of conPrecio) {
        await cliente.query(
          `INSERT INTO detalle_venta
             (cantidad, precio_unitario, subtotal, id_venta, id_producto)
           VALUES ($1, $2, $3, $4, $5)`,
          [linea.cantidad, linea.precioUnitario, linea.subtotal, idVenta, linea.idProducto]
        );
      }

      for (const [idProducto, pedido] of pedidoPorProducto) {
        await cliente.query(
          'UPDATE producto SET stock_actual = stock_actual - $1 WHERE id_producto = $2',
          [pedido, idProducto]
        );
      }

      return { idVenta };
    });

    if (resultado.error) {
      return res.status(resultado.error.estado).json({ error: resultado.error.mensaje });
    }

    res.status(201).json({ venta: await leerVenta(resultado.idVenta) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * Valida una fecha del filtro.
 *
 * Solo se acepta el formato ISO (2026-03-01), que es el que manda el input
 * date del navegador. No se usa `new Date(valor)` a secas porque acepta
 * cualquier cosa: "el-martes" daria una fecha invalida y un listado vacio
 * en lugar de un error, y el usuario no sabria por que no ve nada.
 */
function validarFecha(valor) {
  if (valor === undefined || valor === '') return { fecha: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return { error: true };
  const fecha = new Date(`${valor}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return { error: true };
  return { fecha: valor };
}

/**
 * CU-08 - Consultar el historial de ventas.
 *
 * Acepta ?desde= y ?hasta= (fechas ISO) y ?idProducto= para filtrar.
 *
 * El filtro por producto usa EXISTS y no un JOIN: con JOIN, una venta de dos
 * productos apareceria duplicada en el listado. Con EXISTS la venta aparece
 * una sola vez y con su detalle completo, que es lo que corresponde mostrar
 * porque el total de la venta es el que se cobro.
 */
rutasVentas.get('/', async (req, res, siguiente) => {
  try {
    const desde = validarFecha(req.query.desde);
    const hasta = validarFecha(req.query.hasta);
    if (desde.error || hasta.error) {
      return res.status(400).json({ error: 'Las fechas van en formato aaaa-mm-dd' });
    }

    let idProducto = null;
    if (req.query.idProducto !== undefined && req.query.idProducto !== '') {
      idProducto = Number(req.query.idProducto);
      if (!Number.isInteger(idProducto)) {
        return res.status(400).json({ error: 'El producto del filtro no es valido' });
      }
    }

    const condiciones = [];
    const valores = [];

    if (desde.fecha) {
      valores.push(desde.fecha);
      condiciones.push(`v.fecha >= $${valores.length}::date`);
    }
    if (hasta.fecha) {
      /* Se suma un dia y se compara con "menor que", asi una venta del mismo
         dia a las 14:30 entra en "hasta el 1 de marzo". Comparar contra la
         medianoche de ese dia la dejaria afuera. */
      valores.push(hasta.fecha);
      condiciones.push(`v.fecha < $${valores.length}::date + 1`);
    }
    if (idProducto !== null) {
      valores.push(idProducto);
      condiciones.push(
        `EXISTS (SELECT 1 FROM detalle_venta d
                  WHERE d.id_venta = v.id_venta AND d.id_producto = $${valores.length})`
      );
    }

    const donde = condiciones.length > 0 ? ` WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await consultar(
      `${SELECT_VENTA}${donde} ORDER BY v.fecha DESC, v.id_venta DESC`,
      valores
    );

    if (rows.length === 0) {
      return res.json({ ventas: [] });
    }

    /* Todos los detalles en una sola consulta. Pedirlos venta por venta
       serian N+1 consultas: con 200 ventas en el listado, 201 viajes a la
       base en lugar de dos. */
    const { rows: detalles } = await consultar(
      `${SELECT_DETALLE}
        WHERE d.id_venta = ANY($1::int[])
        ORDER BY d.id_venta, d.id_detalle_venta`,
      [rows.map((fila) => fila.id_venta)]
    );

    const porVenta = new Map();
    for (const detalle of detalles) {
      const lista = porVenta.get(detalle.id_venta) ?? [];
      lista.push(aSalidaDetalle(detalle));
      porVenta.set(detalle.id_venta, lista);
    }

    res.json({
      ventas: rows.map((fila) => aSalida(fila, porVenta.get(fila.id_venta) ?? [])),
    });
  } catch (error) {
    siguiente(error);
  }
});
