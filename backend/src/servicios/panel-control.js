import { consultar } from '../config/db.js';
import { obtenerAlertas, resumir } from './gestor-alertas.js';
import { COSTO_UNITARIO_SQL } from './costos.js';

/**
 * PanelControl - CU-12, el tablero del Encargado.
 *
 * RF-08 pide cuatro indicadores: stock critico, produccion del dia, ventas
 * del periodo y rentabilidad estimada. Cuando alguno no se puede calcular
 * (por ejemplo, el ticket promedio sin ventas) se devuelve null, y la
 * pantalla lo muestra como "N/D", segun el flujo alternativo 1.a de CU-12.
 *
 * Igual que GestorAlertas, no tiene tabla propia: resume lo que ya esta en
 * ventas, lotes de produccion e ingresos de mercaderia para un periodo. Los
 * indices por fecha de esas tres tablas (seccion 6 de la especificacion) se
 * crearon justamente para estas consultas.
 *
 * Las fechas viajan como texto aaaa-mm-dd y se comparan en SQL. Pasarlas por
 * un Date de JavaScript las convertiria a la zona horaria del servidor, y una
 * venta del 1 de marzo a las 22 hs podria terminar contada el 2.
 */

/* Cuantos productos muestra el ranking de mas vendidos. */
const LARGO_RANKING = 5;

const redondear = (numero) => Math.round(numero * 100) / 100;

/** Totales de ventas entre dos fechas, ambas incluidas. */
async function totalesVentas(desde, hasta) {
  /* "hasta + 1" con menor estricto, como en CU-08: una venta del ultimo dia
     a las 14:30 tiene que entrar, y compararla contra la medianoche de ese
     dia la dejaria afuera. */
  const { rows } = await consultar(
    `SELECT COUNT(*)                AS cantidad,
            COALESCE(SUM(v.total), 0) AS total
       FROM venta v
      WHERE v.fecha >= $1::date AND v.fecha < $2::date + 1`,
    [desde, hasta]
  );
  return { cantidad: Number(rows[0].cantidad), total: Number(rows[0].total) };
}

async function unidadesVendidas(desde, hasta) {
  const { rows } = await consultar(
    `SELECT COALESCE(SUM(d.cantidad), 0) AS unidades
       FROM detalle_venta d
       JOIN venta v ON v.id_venta = d.id_venta
      WHERE v.fecha >= $1::date AND v.fecha < $2::date + 1`,
    [desde, hasta]
  );
  return Number(rows[0].unidades);
}

/**
 * Las ventas del periodo y su comparacion con el periodo anterior de igual
 * largo (si se miran 7 dias, los 7 dias previos). Sin esa referencia un
 * total suelto no dice si el negocio va mejor o peor.
 */
async function resumenVentas(desde, hasta) {
  const { rows } = await consultar(
    `SELECT to_char($1::date - ($2::date - $1::date + 1), 'YYYY-MM-DD') AS desde,
            to_char($1::date - 1, 'YYYY-MM-DD')                         AS hasta`,
    [desde, hasta]
  );
  const anterior = rows[0];

  const [actual, previo, unidades] = await Promise.all([
    totalesVentas(desde, hasta),
    totalesVentas(anterior.desde, anterior.hasta),
    unidadesVendidas(desde, hasta),
  ]);

  return {
    cantidad: actual.cantidad,
    total: actual.total,
    unidades,
    ticketPromedio: actual.cantidad > 0 ? redondear(actual.total / actual.cantidad) : null,
    periodoAnterior: { ...anterior, total: previo.total },
    // null y no 0 cuando no hubo ventas antes: no hay contra que comparar, y
    // un "+0 %" diria que se vendio lo mismo.
    variacion: previo.total > 0 ? redondear(((actual.total - previo.total) / previo.total) * 100) : null,
  };
}

async function resumenProduccion(desde, hasta) {
  const { rows } = await consultar(
    `SELECT COUNT(*)                          AS lotes,
            COALESCE(SUM(cantidad_producida), 0) AS unidades,
            COALESCE(SUM(costo_total), 0)        AS costo
       FROM lote_produccion
      WHERE fecha BETWEEN $1::date AND $2::date`,
    [desde, hasta]
  );
  return {
    lotes: Number(rows[0].lotes),
    unidades: Number(rows[0].unidades),
    costo: Number(rows[0].costo),
  };
}

/**
 * Lo producido hoy, aparte del periodo. RF-08 lo pide como indicador propio:
 * es lo que el Encargado mira a la mañana para saber si el horno ya rindio,
 * aunque el panel este mostrando el mes entero.
 */
async function produccionDelDia() {
  const { rows } = await consultar(
    `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD')  AS fecha,
            COUNT(*)                             AS lotes,
            COALESCE(SUM(cantidad_producida), 0) AS unidades
       FROM lote_produccion
      WHERE fecha = CURRENT_DATE`
  );
  return {
    fecha: rows[0].fecha,
    lotes: Number(rows[0].lotes),
    unidades: Number(rows[0].unidades),
  };
}

/**
 * Rentabilidad estimada del periodo: lo vendido menos lo que costo
 * fabricarlo, con el costo unitario de cada producto segun su receta (RF-06,
 * y el caso de prueba 15 del documento).
 *
 * Es una estimacion por dos motivos, y por eso se llama asi: usa el costo de
 * los insumos de hoy, no el del dia en que se produjo; y no incluye gastos
 * que el sistema no registra (sueldos, alquiler, luz).
 *
 * Un producto vendido que no tiene receta no tiene costo conocido. Contarlo
 * con costo cero inflaria la ganancia, asi que queda afuera del calculo y se
 * informa aparte para que la pantalla lo aclare.
 */
async function rentabilidadEstimada(desde, hasta) {
  const { rows } = await consultar(
    `SELECT p.nombre,
            c.costo_unitario,
            SUM(d.cantidad) AS unidades,
            SUM(d.subtotal) AS importe
       FROM detalle_venta d
       JOIN venta v    ON v.id_venta    = d.id_venta
       JOIN producto p ON p.id_producto = d.id_producto
       LEFT JOIN (${COSTO_UNITARIO_SQL}) c ON c.id_producto = d.id_producto
      WHERE v.fecha >= $1::date AND v.fecha < $2::date + 1
      GROUP BY p.id_producto, p.nombre, c.costo_unitario`,
    [desde, hasta]
  );

  let ingresos = 0;
  let costo = 0;
  let conCosto = 0;
  const sinReceta = [];
  for (const fila of rows) {
    if (fila.costo_unitario === null) {
      sinReceta.push({ nombre: fila.nombre, importe: Number(fila.importe) });
      continue;
    }
    conCosto += 1;
    ingresos += Number(fila.importe);
    costo += Number(fila.unidades) * Number(fila.costo_unitario);
  }

  // Sin ventas con costo conocido no hay nada que estimar: N/D.
  if (conCosto === 0) {
    return { ganancia: null, margen: null, ingresos: 0, costo: 0, productosSinReceta: sinReceta };
  }

  const ganancia = ingresos - costo;
  return {
    ganancia: redondear(ganancia),
    margen: ingresos > 0 ? redondear((ganancia / ingresos) * 100) : null,
    ingresos: redondear(ingresos),
    costo: redondear(costo),
    productosSinReceta: sinReceta,
  };
}

/** Lo que se gasto en mercaderia: cada ingreso es cantidad por precio. */
async function resumenCompras(desde, hasta) {
  const { rows } = await consultar(
    `SELECT COUNT(*)                                  AS ingresos,
            COALESCE(SUM(cantidad * precio_unitario), 0) AS total
       FROM ingreso_materia_prima
      WHERE fecha_ingreso BETWEEN $1::date AND $2::date`,
    [desde, hasta]
  );
  return { ingresos: Number(rows[0].ingresos), total: redondear(Number(rows[0].total)) };
}

/**
 * Lo facturado dia por dia, incluidos los dias sin ventas.
 *
 * generate_series arma la lista completa de dias y las ventas se le pegan con
 * LEFT JOIN. Sin eso un dia sin ventas desapareceria del grafico en vez de
 * verse en cero, y el hueco es justamente lo que interesa ver.
 *
 * La serie se arma como timestamp sin zona, igual que venta.fecha: con las
 * fechas solas PostgreSQL elegiria la version con zona horaria y la
 * comparacion dependeria de la configuracion del servidor.
 */
async function ventasPorDia(desde, hasta) {
  const { rows } = await consultar(
    `SELECT to_char(dia, 'YYYY-MM-DD')   AS fecha,
            COUNT(v.id_venta)            AS cantidad,
            COALESCE(SUM(v.total), 0)    AS total
       FROM generate_series($1::date::timestamp, $2::date::timestamp, interval '1 day') AS dia
       LEFT JOIN venta v
              ON v.fecha >= dia AND v.fecha < dia + interval '1 day'
      GROUP BY dia
      ORDER BY dia`,
    [desde, hasta]
  );
  return rows.map((fila) => ({
    fecha: fila.fecha,
    cantidad: Number(fila.cantidad),
    total: Number(fila.total),
  }));
}

/** Los productos con mas unidades vendidas en el periodo. */
async function productosMasVendidos(desde, hasta) {
  const { rows } = await consultar(
    `SELECT p.id_producto, p.nombre, c.costo_unitario,
            SUM(d.cantidad) AS unidades,
            SUM(d.subtotal) AS importe
       FROM detalle_venta d
       JOIN venta v    ON v.id_venta    = d.id_venta
       JOIN producto p ON p.id_producto = d.id_producto
       LEFT JOIN (${COSTO_UNITARIO_SQL}) c ON c.id_producto = p.id_producto
      WHERE v.fecha >= $1::date AND v.fecha < $2::date + 1
      GROUP BY p.id_producto, p.nombre, c.costo_unitario
      ORDER BY unidades DESC, importe DESC, p.nombre
      LIMIT ${LARGO_RANKING}`,
    [desde, hasta]
  );
  return rows.map((fila) => ({
    idProducto: fila.id_producto,
    nombre: fila.nombre,
    unidades: Number(fila.unidades),
    importe: Number(fila.importe),
    costoUnitario: fila.costo_unitario === null ? null : redondear(Number(fila.costo_unitario)),
  }));
}

/**
 * Arma el panel completo para el periodo [desde, hasta], ambas fechas
 * incluidas y ya validadas.
 *
 * Las consultas son independientes entre si y corren en paralelo, cada una
 * con su propia conexion del pool.
 *
 * Las alertas no dependen del periodo: muestran el stock de ahora, que es
 * lo que hay que resolver hoy aunque se este mirando el mes pasado.
 */
export async function armarPanel(desde, hasta) {
  const [ventas, produccion, delDia, rentabilidad, compras, porDia, masVendidos, alertas] = await Promise.all([
    resumenVentas(desde, hasta),
    resumenProduccion(desde, hasta),
    produccionDelDia(),
    rentabilidadEstimada(desde, hasta),
    resumenCompras(desde, hasta),
    ventasPorDia(desde, hasta),
    productosMasVendidos(desde, hasta),
    obtenerAlertas(),
  ]);

  const resumenAlertas = resumir(alertas);

  return {
    periodo: { desde, hasta },
    // Los cuatro indicadores de RF-08, en el orden del wireframe.
    indicadores: {
      stockCritico: resumenAlertas.criticas,
      produccionDelDia: delDia,
      ventasDelPeriodo: ventas.total,
      rentabilidadEstimada: rentabilidad.ganancia,
    },
    ventas,
    produccion,
    rentabilidad,
    compras,
    ventasPorDia: porDia,
    productosMasVendidos: masVendidos,
    alertas: {
      resumen: resumenAlertas,
      /* CU-10 muestra las alertas activas en el panel principal, de stock
         bajo y de sobrestock. Van las mas urgentes primero, hasta cinco; la
         lista completa esta en la pantalla de alertas. */
      principales: alertas.slice(0, 5),
    },
  };
}

/** El periodo por defecto: los ultimos 30 dias, hoy incluido. */
export async function periodoPorDefecto() {
  const { rows } = await consultar(
    `SELECT to_char(CURRENT_DATE - 29, 'YYYY-MM-DD') AS desde,
            to_char(CURRENT_DATE,      'YYYY-MM-DD') AS hasta`
  );
  return rows[0];
}
