import { consultar } from '../config/db.js';

/**
 * GestorAlertas - CU-09, generar las alertas de stock.
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
