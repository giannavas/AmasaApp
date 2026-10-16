import { consultar } from '../config/db.js';
import { COSTO_UNITARIO_SQL } from './costos.js';

/**
 * GestorAlertas - CU-09 (configurar umbrales) y CU-10 (visualizar alertas
 * activas).
 *
 * Las alertas se generan aca, en el paso 1 de CU-10: "evalua el stock actual
 * contra los umbrales configurados".
 *
 * Segun el diseño (seccion 3 de la especificacion), las alertas no tienen
 * tabla propia: se calculan comparando el stock contra los umbrales cada vez
 * que se piden. Guardarlas obligaria a mantenerlas sincronizadas en cada
 * venta, lote, ingreso y cambio de umbral, y una alerta que quedara colgada
 * despues de reponer avisaria de un problema que ya no existe. Calculadas en
 * el momento, nunca pueden contradecir al stock.
 *
 * Cubre los dos stocks del sistema: los insumos (lo que se compra) y los
 * productos terminados (lo que se vende). El criterio es el mismo que usan
 * CU-05 y la pantalla de productos para el estado: en el minimo ya es
 * critico, y el maximo se excede recien al superarlo.
 */

/* TipoAlerta del diseño de clases. */
export const TIPOS_ALERTA = ['StockCritico', 'Sobrestock'];

/* De que stock sale la alerta. */
export const ORIGENES_ALERTA = ['Insumo', 'Producto'];

/* Una sola consulta para los dos stocks. UNION ALL y no UNION: las filas de
   insumos y de productos nunca se repiten entre si, y UNION gastaria un
   ordenamiento extra solo para buscar duplicados que no existen.

   Los productos no tienen unidad de medida en la base porque se cuentan por
   unidad; se completa con 'u' para que la pantalla los muestre igual que a
   los insumos. */
const SELECT_ALERTAS = `
  SELECT *
    FROM (
      SELECT 'Insumo' AS origen, m.id_materia_prima AS id, m.nombre,
             m.unidad_medida AS unidad, m.stock_actual, m.stock_minimo,
             m.stock_maximo, p.razon_social AS proveedor,
             p.telefono AS telefono_proveedor
        FROM materia_prima m
        LEFT JOIN proveedor p ON p.id_proveedor = m.id_proveedor_habitual
      UNION ALL
      SELECT 'Producto', id_producto, nombre, 'u', stock_actual, stock_minimo,
             stock_maximo, NULL, NULL
        FROM producto
    ) s
   WHERE s.stock_actual <= s.stock_minimo
      OR s.stock_actual >  s.stock_maximo`;

/* Lo mas urgente primero: lo que ya se agoto, despues lo critico ordenado por
   cuanto le queda respecto de su minimo, y al final el sobrestock, que no
   frena la produccion ni las ventas. NULLIF evita dividir por cero cuando el
   minimo configurado es 0. */
const ORDEN_ALERTAS = `
  ORDER BY
    CASE
      WHEN s.stock_actual = 0               THEN 0
      WHEN s.stock_actual <= s.stock_minimo THEN 1
      ELSE 2
    END,
    s.stock_actual / NULLIF(s.stock_minimo, 0),
    s.nombre`;

/**
 * Arma una alerta a partir de una fila.
 *
 * cantidadSugerida responde la pregunta que sigue a cada alerta:
 * - en un faltante, cuanto comprar (insumo) o producir (producto) para
 *   volver al maximo, que es el nivel que el Encargado definio como ideal;
 * - en un sobrestock, cuanto sobra por encima del maximo.
 */
function aAlerta(fila) {
  const actual = Number(fila.stock_actual);
  const minimo = Number(fila.stock_minimo);
  const maximo = Number(fila.stock_maximo);
  const critica = actual <= minimo;

  // Redondeo a dos decimales: los insumos admiten fracciones (2.5 kg) y la
  // resta en punto flotante puede dejar restos como 7.499999999.
  const diferencia = critica ? maximo - actual : actual - maximo;

  return {
    tipo: critica ? 'StockCritico' : 'Sobrestock',
    origen: fila.origen,
    id: fila.id,
    nombre: fila.nombre,
    unidad: fila.unidad,
    stockActual: actual,
    stockMinimo: minimo,
    stockMaximo: maximo,
    sinStock: actual === 0,
    cantidadSugerida: Math.round(diferencia * 100) / 100,
    proveedor: fila.proveedor,
    telefonoProveedor: fila.telefono_proveedor,
  };
}

/** Cuenta las alertas por tipo. */
export function resumir(alertas) {
  const criticas = alertas.filter((a) => a.tipo === 'StockCritico');
  return {
    total: alertas.length,
    criticas: criticas.length,
    sinStock: criticas.filter((a) => a.sinStock).length,
    sobrestock: alertas.length - criticas.length,
  };
}

/**
 * Devuelve las alertas vigentes, de la mas urgente a la menos urgente.
 *
 * Los filtros son opcionales y se validan antes de llegar aca: el tipo contra
 * TIPOS_ALERTA y el origen contra ORIGENES_ALERTA.
 */
export async function obtenerAlertas({ tipo, origen } = {}) {
  const condiciones = [];
  const valores = [];

  if (origen) {
    valores.push(origen);
    condiciones.push(`s.origen = $${valores.length}`);
  }
  if (tipo === 'StockCritico') condiciones.push('s.stock_actual <= s.stock_minimo');
  if (tipo === 'Sobrestock') condiciones.push('s.stock_actual > s.stock_maximo');

  const extra = condiciones.length > 0 ? ` AND ${condiciones.join(' AND ')}` : '';

  /* La consulta base se envuelve en una subconsulta en vez de pegarle los
     filtros al final: su WHERE termina en un OR, y un AND agregado ahi se
     ligaria solo con el ultimo termino y filtraria mal. */
  const texto = `SELECT * FROM (${SELECT_ALERTAS}) s WHERE TRUE${extra} ${ORDEN_ALERTAS}`;

  const { rows } = await consultar(texto, valores);
  return rows.map(aAlerta);
}

/* ------------------------------------------------------------------------
   CU-09 - Configurar umbrales de stock
   ------------------------------------------------------------------------ */

/** Todos los items con sus umbrales, para la tabla de configuracion. */
export async function listarUmbrales() {
  const { rows } = await consultar(
    `SELECT 'Insumo' AS origen, id_materia_prima AS id, nombre, unidad_medida AS unidad,
            stock_actual, stock_minimo, stock_maximo
       FROM materia_prima
     UNION ALL
     SELECT 'Producto', id_producto, nombre, 'u', stock_actual, stock_minimo, stock_maximo
       FROM producto
     ORDER BY origen, nombre`
  );
  return rows.map((fila) => ({
    origen: fila.origen,
    id: fila.id,
    nombre: fila.nombre,
    unidad: fila.unidad,
    stockActual: Number(fila.stock_actual),
    stockMinimo: Number(fila.stock_minimo),
    stockMaximo: Number(fila.stock_maximo),
  }));
}

/**
 * Valida la lista de umbrales que llega del formulario.
 *
 * Devuelve { error } o { umbrales } ya convertidos a numero. Se valida todo
 * antes de escribir nada, para poder decir que item esta mal sin haber
 * guardado la mitad.
 *
 * El minimo tiene que ser MENOR que el maximo, como pide el flujo
 * alternativo 2.a de CU-09: con los dos iguales, cualquier stock distinto de
 * ese valor exacto dispararia una alerta, y el umbral dejaria de servir.
 */
export function validarUmbrales(lista) {
  if (!Array.isArray(lista) || lista.length === 0) {
    return { error: 'No hay umbrales para guardar' };
  }

  const vistos = new Set();
  const umbrales = [];
  for (const item of lista) {
    const origen = item?.origen;
    const id = Number(item?.id);
    if (!ORIGENES_ALERTA.includes(origen) || !Number.isInteger(id)) {
      return { error: 'Alguno de los items no es valido' };
    }

    const clave = `${origen}-${id}`;
    if (vistos.has(clave)) return { error: 'Un mismo item vino dos veces' };
    vistos.add(clave);

    const nombre = item.nombre ? ` de ${item.nombre}` : '';
    const minimo = item.stockMinimo === '' ? NaN : Number(item.stockMinimo);
    const maximo = item.stockMaximo === '' ? NaN : Number(item.stockMaximo);

    if (!Number.isFinite(minimo) || !Number.isFinite(maximo)) {
      return { error: `Completa el minimo y el maximo${nombre}` };
    }
    if (minimo < 0) {
      return { error: `El minimo${nombre} no puede ser negativo` };
    }
    if (minimo >= maximo) {
      return { error: `El minimo${nombre} tiene que ser menor que el maximo` };
    }
    // Los productos se cuentan por unidad: la base guarda sus umbrales como enteros.
    if (origen === 'Producto' && (!Number.isInteger(minimo) || !Number.isInteger(maximo))) {
      return { error: `Los umbrales${nombre} van en unidades enteras` };
    }

    umbrales.push({ origen, id, minimo, maximo });
  }
  return { umbrales };
}

/**
 * Guarda los umbrales en una sola transaccion: o se guardan todos o ninguno,
 * que es la postcondicion de fracaso de CU-09 ("los umbrales no se guardan").
 *
 * Devuelve false si alguno de los items no existe; en ese caso no se guardo
 * nada.
 */
export async function guardarUmbrales(cliente, umbrales) {
  for (const { origen, id, minimo, maximo } of umbrales) {
    const texto = origen === 'Insumo'
      ? 'UPDATE materia_prima SET stock_minimo = $1, stock_maximo = $2 WHERE id_materia_prima = $3'
      : 'UPDATE producto SET stock_minimo = $1, stock_maximo = $2 WHERE id_producto = $3';
    const { rowCount } = await cliente.query(texto, [minimo, maximo, id]);
    if (rowCount === 0) return false;
  }
  return true;
}

/* ------------------------------------------------------------------------
   CU-10 - Detalle ampliado de un item en alerta
   ------------------------------------------------------------------------ */

async function detalleInsumo(id) {
  const { rows } = await consultar(
    `SELECT m.costo_promedio, p.razon_social, p.telefono, p.email
       FROM materia_prima m
       LEFT JOIN proveedor p ON p.id_proveedor = m.id_proveedor_habitual
      WHERE m.id_materia_prima = $1`,
    [id]
  );
  const ficha = rows[0];

  const [ingresos, consumo, recetas] = await Promise.all([
    consultar(
      `SELECT to_char(i.fecha_ingreso, 'YYYY-MM-DD') AS fecha, i.cantidad,
              i.precio_unitario, p.razon_social AS proveedor
         FROM ingreso_materia_prima i
         JOIN proveedor p ON p.id_proveedor = i.id_proveedor
        WHERE i.id_materia_prima = $1
        ORDER BY i.fecha_ingreso DESC, i.id_ingreso DESC
        LIMIT 5`,
      [id]
    ),
    // Cuanto se uso en los ultimos 30 dias: da una idea de cuanto dura lo que hay.
    consultar(
      `SELECT COALESCE(SUM(c.cantidad), 0) AS cantidad
         FROM consumo_materia_prima c
         JOIN lote_produccion l ON l.id_lote = c.id_lote
        WHERE c.id_materia_prima = $1 AND l.fecha > CURRENT_DATE - 30`,
      [id]
    ),
    consultar(
      `SELECT r.nombre
         FROM receta_detalle d
         JOIN receta r ON r.id_receta = d.id_receta
        WHERE d.id_materia_prima = $1
        ORDER BY r.nombre`,
      [id]
    ),
  ]);

  return {
    costoPromedio: Number(ficha.costo_promedio),
    proveedor: ficha.razon_social
      ? { razonSocial: ficha.razon_social, telefono: ficha.telefono, email: ficha.email }
      : null,
    ultimosIngresos: ingresos.rows.map((fila) => ({
      fecha: fila.fecha,
      cantidad: Number(fila.cantidad),
      precioUnitario: Number(fila.precio_unitario),
      proveedor: fila.proveedor,
    })),
    consumoUltimos30Dias: Number(consumo.rows[0].cantidad),
    recetas: recetas.rows.map((fila) => fila.nombre),
  };
}

async function detalleProducto(id) {
  const { rows } = await consultar(
    `SELECT p.precio_venta, c.costo_unitario
       FROM producto p
       LEFT JOIN (${COSTO_UNITARIO_SQL}) c ON c.id_producto = p.id_producto
      WHERE p.id_producto = $1`,
    [id]
  );
  const ficha = rows[0];

  const [lotes, vendido] = await Promise.all([
    consultar(
      `SELECT to_char(l.fecha, 'YYYY-MM-DD') AS fecha, l.cantidad_producida
         FROM lote_produccion l
         JOIN receta r ON r.id_receta = l.id_receta
        WHERE r.id_producto = $1
        ORDER BY l.fecha DESC, l.id_lote DESC
        LIMIT 5`,
      [id]
    ),
    consultar(
      `SELECT COALESCE(SUM(d.cantidad), 0) AS unidades
         FROM detalle_venta d
         JOIN venta v ON v.id_venta = d.id_venta
        WHERE d.id_producto = $1 AND v.fecha >= CURRENT_DATE - 6`,
      [id]
    ),
  ]);

  return {
    precioVenta: Number(ficha.precio_venta),
    // null si no tiene receta: el costo es desconocido, no cero.
    costoUnitario: ficha.costo_unitario === null ? null : Math.round(Number(ficha.costo_unitario) * 100) / 100,
    ultimosLotes: lotes.rows.map((fila) => ({
      fecha: fila.fecha,
      cantidad: Number(fila.cantidad_producida),
    })),
    vendidoUltimos7Dias: Number(vendido.rows[0].unidades),
  };
}

/**
 * Lo que se muestra al seleccionar una alerta (paso 3 de CU-10): el estado
 * del item y los datos que hacen falta para decidir que hacer con el.
 *
 * Devuelve undefined si el item no existe. Funciona tambien con un item que
 * no esta en alerta: la alerta pudo resolverse entre que se cargo la lista y
 * se hizo clic, y en ese caso se informa el estado actual.
 */
export async function obtenerDetalle(origen, id) {
  const tabla = origen === 'Insumo'
    ? `SELECT 'Insumo' AS origen, id_materia_prima AS id, nombre, unidad_medida AS unidad,
              stock_actual, stock_minimo, stock_maximo, NULL AS proveedor, NULL AS telefono_proveedor
         FROM materia_prima WHERE id_materia_prima = $1`
    : `SELECT 'Producto' AS origen, id_producto AS id, nombre, 'u' AS unidad,
              stock_actual, stock_minimo, stock_maximo, NULL AS proveedor, NULL AS telefono_proveedor
         FROM producto WHERE id_producto = $1`;

  const { rows } = await consultar(tabla, [id]);
  if (rows.length === 0) return undefined;

  const fila = rows[0];
  const actual = Number(fila.stock_actual);
  const enAlerta = actual <= Number(fila.stock_minimo) || actual > Number(fila.stock_maximo);
  const base = aAlerta(fila);

  const item = {
    origen: base.origen,
    id: base.id,
    nombre: base.nombre,
    unidad: base.unidad,
    stockActual: base.stockActual,
    stockMinimo: base.stockMinimo,
    stockMaximo: base.stockMaximo,
    // tipo y sugerencia solo tienen sentido si hay alerta.
    tipo: enAlerta ? base.tipo : null,
    sinStock: base.sinStock,
    cantidadSugerida: enAlerta ? base.cantidadSugerida : null,
  };

  const extra = origen === 'Insumo' ? await detalleInsumo(id) : await detalleProducto(id);
  return { ...item, ...extra };
}
