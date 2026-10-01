import { Router } from 'express';
import { consultar, conTransaccion } from '../config/db.js';
import { autenticar, exigirRol } from '../middleware/autenticar.js';

export const rutasRecetas = Router();

rutasRecetas.use(autenticar, exigirRol('Encargado'));

/* Unicidad violada. Sobre estas tablas puede venir de dos lugares:
   uq_receta_producto, porque un producto tiene una sola receta, y
   uq_receta_detalle_insumo, porque un insumo no se repite en una receta. */
const REPETIDO = '23505';

const SELECT_RECETA = `
  SELECT r.id_receta, r.nombre, r.rendimiento_unidades,
         r.id_producto, p.nombre AS producto
    FROM receta r
    JOIN producto p ON p.id_producto = r.id_producto`;

const SELECT_DETALLES = `
  SELECT d.id_receta, d.id_materia_prima, d.cantidad_requerida,
         m.nombre AS materia_prima, m.unidad_medida
    FROM receta_detalle d
    JOIN materia_prima m ON m.id_materia_prima = d.id_materia_prima
   WHERE d.id_receta = ANY($1)
   ORDER BY m.nombre`;

function aSalida(fila, detalles) {
  return {
    idReceta: fila.id_receta,
    nombre: fila.nombre,
    rendimientoUnidades: Number(fila.rendimiento_unidades),
    idProducto: fila.id_producto,
    producto: fila.producto,
    detalles: detalles.map((d) => ({
      idMateriaPrima: d.id_materia_prima,
      materiaPrima: d.materia_prima,
      unidadMedida: d.unidad_medida,
      cantidadRequerida: Number(d.cantidad_requerida),
    })),
  };
}

function leerId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

/**
 * Lee recetas junto con sus insumos.
 *
 * Trae los detalles de todas las recetas en una sola consulta, en vez de una
 * por receta. Con pocas recetas da igual, pero es la diferencia entre una
 * consulta y N+1 cuando la lista crece.
 */
async function leerRecetas(filtroId = null) {
  const { rows: cabeceras } = filtroId
    ? await consultar(`${SELECT_RECETA} WHERE r.id_receta = $1`, [filtroId])
    : await consultar(`${SELECT_RECETA} ORDER BY r.nombre`);

  if (cabeceras.length === 0) return [];

  const { rows: detalles } = await consultar(
    SELECT_DETALLES,
    [cabeceras.map((c) => c.id_receta)]
  );

  return cabeceras.map((c) =>
    aSalida(c, detalles.filter((d) => d.id_receta === c.id_receta))
  );
}

/**
 * Valida nombre, rendimiento y la lista de insumos.
 * Devuelve null si estan bien, o el mensaje de error si no.
 */
function validar({ nombre, rendimientoUnidades, detalles }) {
  if (!nombre || !String(nombre).trim()) {
    return 'El nombre de la receta es obligatorio';
  }

  const rendimiento = Number(rendimientoUnidades);
  if (!Number.isInteger(rendimiento) || rendimiento <= 0) {
    return 'El rendimiento tiene que ser un numero entero mayor que cero';
  }

  if (!Array.isArray(detalles) || detalles.length === 0) {
    return 'La receta tiene que llevar al menos un insumo';
  }

  for (const detalle of detalles) {
    const cantidad = Number(detalle?.cantidadRequerida);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return 'Cada insumo necesita una cantidad mayor que cero';
    }
    if (!Number.isInteger(Number(detalle?.idMateriaPrima))) {
      return 'Hay un insumo sin identificar en la receta';
    }
  }
  return null;
}

/** Escribe los insumos de una receta. Se usa en el alta y en la edicion. */
async function guardarDetalles(cliente, idReceta, detalles) {
  for (const { idMateriaPrima, cantidadRequerida } of detalles) {
    await cliente.query(
      `INSERT INTO receta_detalle (cantidad_requerida, id_receta, id_materia_prima)
       VALUES ($1, $2, $3)`,
      [Number(cantidadRequerida), idReceta, Number(idMateriaPrima)]
    );
  }
}

/**
 * Traduce un error de la base en una respuesta con mensaje entendible.
 * Devuelve true si lo manejo, false si hay que propagarlo.
 */
function responderError(error, res) {
  if (error.code === REPETIDO) {
    const mensaje = error.constraint === 'uq_receta_detalle_insumo'
      ? 'Un insumo no puede repetirse dentro de la misma receta'
      : 'Ese producto ya tiene una receta';
    res.status(409).json({ error: mensaje });
    return true;
  }
  // Clave foranea rota: el producto o el insumo indicado no existe.
  if (error.code === '23503') {
    res.status(400).json({ error: 'El producto o alguno de los insumos no existe' });
    return true;
  }
  return false;
}

/**
 * Listar recetas con sus insumos.
 */
rutasRecetas.get('/', async (_req, res, siguiente) => {
  try {
    res.json({ recetas: await leerRecetas() });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * Crear una receta junto con su lista de insumos.
 *
 * Cabecera y detalles van en una transaccion: una receta sin insumos no sirve
 * para producir nada, asi que o se guarda entera o no se guarda.
 */
rutasRecetas.post('/', async (req, res, siguiente) => {
  try {
    const { nombre, rendimientoUnidades, idProducto, detalles } = req.body ?? {};

    const error = validar(req.body ?? {});
    if (error) return res.status(400).json({ error });

    if (!Number.isInteger(Number(idProducto))) {
      return res.status(400).json({ error: 'Elegi el producto que elabora esta receta' });
    }

    const idReceta = await conTransaccion(async (cliente) => {
      const { rows } = await cliente.query(
        `INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
         VALUES ($1, $2, $3) RETURNING id_receta`,
        [String(nombre).trim(), Number(rendimientoUnidades), Number(idProducto)]
      );
      const nueva = rows[0].id_receta;
      await guardarDetalles(cliente, nueva, detalles);
      return nueva;
    });

    const [receta] = await leerRecetas(idReceta);
    res.status(201).json({ receta });
  } catch (error) {
    if (responderError(error, res)) return;
    siguiente(error);
  }
});

/**
 * Editar una receta y su lista de insumos.
 *
 * Los insumos se reemplazan por completo: se borran los anteriores y se
 * escriben los nuevos. Es mas simple que calcular que cambio, y como los
 * lotes ya producidos guardan su propio consumo en consumo_materia_prima,
 * modificar la receta no altera el historial de lo que ya se fabrico.
 *
 * El producto no se cambia: la receta pertenece a un producto desde que se
 * crea, y moverla a otro dejaria al original sin receta de forma silenciosa.
 */
rutasRecetas.put('/:id', async (req, res, siguiente) => {
  try {
    const id = leerId(req);
    if (id === null) return res.status(404).json({ error: 'La receta no existe' });

    const error = validar(req.body ?? {});
    if (error) return res.status(400).json({ error });

    const { nombre, rendimientoUnidades, detalles } = req.body;

    const existe = await conTransaccion(async (cliente) => {
      const { rowCount } = await cliente.query(
        `UPDATE receta SET nombre = $1, rendimiento_unidades = $2
          WHERE id_receta = $3`,
        [String(nombre).trim(), Number(rendimientoUnidades), id]
      );
      if (rowCount === 0) return false;

      await cliente.query('DELETE FROM receta_detalle WHERE id_receta = $1', [id]);
      await guardarDetalles(cliente, id, detalles);
      return true;
    });

    if (!existe) return res.status(404).json({ error: 'La receta no existe' });

    const [receta] = await leerRecetas(id);
    res.json({ receta });
  } catch (error) {
    if (responderError(error, res)) return;
    siguiente(error);
  }
});
