import { Router } from 'express';
import { conTransaccion } from '../config/db.js';
import { autenticar, exigirRol } from '../middleware/autenticar.js';
import {
  obtenerAlertas,
  obtenerDetalle,
  resumir,
  listarUmbrales,
  validarUmbrales,
  guardarUmbrales,
  TIPOS_ALERTA,
  ORIGENES_ALERTA,
} from '../servicios/gestor-alertas.js';

export const rutasAlertas = Router();

/* CU-09 y CU-10 son del Encargado: es quien decide las compras y los umbrales
   (los datos iniciales del rol lo dicen asi: "insumos, produccion, ventas,
   alertas y usuarios"). */
rutasAlertas.use(autenticar, exigirRol('Encargado'));

/**
 * CU-10 - Visualizar las alertas activas.
 *
 * Acepta ?tipo= (StockCritico o Sobrestock) y ?origen= (Insumo o Producto).
 * Un valor que no existe se rechaza en lugar de ignorarse: un filtro mal
 * escrito que devolviera la lista completa haria creer que hay alertas de un
 * tipo que en realidad no hay.
 *
 * El resumen siempre cuenta las alertas filtradas, asi los numeros que ve
 * el usuario coinciden con la tabla que tiene adelante.
 */
rutasAlertas.get('/', async (req, res, siguiente) => {
  try {
    const { tipo, origen } = req.query;

    if (tipo !== undefined && tipo !== '' && !TIPOS_ALERTA.includes(tipo)) {
      return res.status(400).json({ error: 'El tipo de alerta pedido no existe' });
    }
    if (origen !== undefined && origen !== '' && !ORIGENES_ALERTA.includes(origen)) {
      return res.status(400).json({ error: 'El origen de alerta pedido no existe' });
    }

    const alertas = await obtenerAlertas({ tipo: tipo || null, origen: origen || null });
    res.json({ alertas, resumen: resumir(alertas) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-10 - Cuantas alertas hay ahora.
 *
 * Lo usa el aviso de la barra superior, que se consulta cada vez que se
 * cambia de pantalla: devuelve solo los numeros y no la lista completa.
 */
rutasAlertas.get('/resumen', async (_req, res, siguiente) => {
  try {
    res.json({ resumen: resumir(await obtenerAlertas()) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-09 - Configurar umbrales de stock: la tabla con todos los items.
 */
rutasAlertas.get('/umbrales', async (_req, res, siguiente) => {
  try {
    res.json({ umbrales: await listarUmbrales() });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-09 - Guardar los umbrales.
 *
 * Recibe { umbrales: [{ origen, id, stockMinimo, stockMaximo }] } con los
 * items que se cambiaron. Si uno solo esta mal no se guarda ninguno: el
 * formulario es uno y el Encargado lo confirma de una vez.
 *
 * Al guardar, las alertas se recalculan solas en el proximo pedido: no hay
 * nada que "habilitar" aparte, porque se evaluan contra estos mismos valores.
 */
rutasAlertas.put('/umbrales', async (req, res, siguiente) => {
  try {
    const validacion = validarUmbrales(req.body?.umbrales);
    if (validacion.error) return res.status(400).json({ error: validacion.error });

    const existenTodos = await conTransaccion(async (cliente) => {
      const ok = await guardarUmbrales(cliente, validacion.umbrales);
      // Lanzar fuerza el ROLLBACK de lo que ya se hubiera actualizado.
      if (!ok) throw Object.assign(new Error('item inexistente'), { itemInexistente: true });
      return ok;
    }).catch((error) => {
      if (error.itemInexistente) return false;
      throw error;
    });

    if (!existenTodos) {
      return res.status(404).json({ error: 'Alguno de los items ya no existe. No se guardo ningun cambio' });
    }

    res.json({ umbrales: await listarUmbrales(), alertas: resumir(await obtenerAlertas()) });
  } catch (error) {
    siguiente(error);
  }
});

/**
 * CU-10, paso 3 - Detalle ampliado de un item.
 *
 * Va al final porque /:origen/:id atraparia tambien /umbrales si estuviera
 * antes.
 */
rutasAlertas.get('/:origen/:id', async (req, res, siguiente) => {
  try {
    const { origen } = req.params;
    const id = Number(req.params.id);
    if (!ORIGENES_ALERTA.includes(origen) || !Number.isInteger(id)) {
      return res.status(404).json({ error: 'El item no existe' });
    }

    const detalle = await obtenerDetalle(origen, id);
    if (!detalle) return res.status(404).json({ error: 'El item no existe' });

    res.json({ detalle });
  } catch (error) {
    siguiente(error);
  }
});
