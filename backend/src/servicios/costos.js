/**
 * RF-06 - Costo unitario de cada producto segun su receta.
 *
 * Es la suma de lo que cuesta cada insumo de la receta (cantidad requerida
 * por su costo promedio actual), dividida por las unidades que rinde. Se usa
 * el costo promedio de hoy y no el de un lote viejo: el panel estima la
 * rentabilidad de lo que se vende con lo que cuesta reponerlo.
 *
 * Es una subconsulta para unir con JOIN: devuelve una fila por producto que
 * tenga receta. Un producto sin receta no aparece, y quien la use tiene que
 * tratarlo como costo desconocido, no como costo cero.
 */
export const COSTO_UNITARIO_SQL = `
  SELECT r.id_producto,
         SUM(d.cantidad_requerida * m.costo_promedio) / r.rendimiento_unidades AS costo_unitario
    FROM receta r
    JOIN receta_detalle d ON d.id_receta = r.id_receta
    JOIN materia_prima m  ON m.id_materia_prima = d.id_materia_prima
   GROUP BY r.id_producto, r.rendimiento_unidades`;
