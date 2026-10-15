import { Router } from 'express';
import { autenticar, exigirRol } from '../middleware/autenticar.js';
import {
  obtenerAlertas,
  resumir,
  TIPOS_ALERTA,
  ORIGENES_ALERTA,
} from '../servicios/gestor-alertas.js';

export const rutasAlertas = Router();

/* CU-09 y CU-10 son del Encargado: es quien decide las compras y los umbrales
   (los datos iniciales del rol lo dicen asi: "insumos, produccion, ventas,
   alertas y usuarios"). */
rutasAlertas.use(autenticar, exigirRol('Encargado'));

/**
 * CU-10 - Consultar las alertas de stock.
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
 * CU-09 - Cuantas alertas hay ahora.
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
