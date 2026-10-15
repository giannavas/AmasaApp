import { Router } from 'express';
import { autenticar, exigirRol } from '../middleware/autenticar.js';
import { armarPanel, periodoPorDefecto } from '../servicios/panel-control.js';

export const rutasPanel = Router();

// CU-12 es del Encargado: muestra la facturacion y los costos del negocio.
rutasPanel.use(autenticar, exigirRol('Encargado'));

/* El panel arma un punto por dia para el grafico. Un año alcanza para
   cualquier consulta razonable y evita que un rango absurdo (desde el año 1)
   genere cientos de miles de filas. */
const DIAS_MAXIMOS = 366;

const UN_DIA = 24 * 60 * 60 * 1000;

/**
 * Valida una fecha del filtro, con el mismo criterio que el historial de
 * ventas (CU-08): solo formato ISO, que es lo que manda el input date. Ademas
 * se controla que la fecha exista, porque new Date('2026-02-31') no falla:
 * la corre al 3 de marzo.
 */
function validarFecha(valor) {
  if (valor === undefined || valor === '') return { fecha: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return { error: true };
  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
    return { error: true };
  }
  return { fecha: valor };
}

/** Resta dias a una fecha ISO, en UTC para no tropezar con la zona horaria. */
function restarDias(fechaIso, dias) {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * CU-12 - Consultar el panel de control.
 *
 * Acepta ?desde= y ?hasta= (aaaa-mm-dd). Sin fechas muestra los ultimos 30
 * dias. Si llega solo "desde", el periodo termina hoy; si llega solo
 * "hasta", son los 30 dias que terminan esa fecha.
 */
rutasPanel.get('/', async (req, res, siguiente) => {
  try {
    const desde = validarFecha(req.query.desde);
    const hasta = validarFecha(req.query.hasta);
    if (desde.error || hasta.error) {
      return res.status(400).json({ error: 'Las fechas van en formato aaaa-mm-dd' });
    }

    const porDefecto = await periodoPorDefecto();
    const fin = hasta.fecha ?? porDefecto.hasta;
    const periodo = {
      // Con solo "hasta", se miran los 30 dias que terminan ese dia.
      desde: desde.fecha ?? (hasta.fecha ? restarDias(fin, 29) : porDefecto.desde),
      hasta: fin,
    };

    // Las fechas ISO se pueden comparar como texto: el orden alfabetico
    // coincide con el cronologico.
    if (periodo.desde > periodo.hasta) {
      return res.status(400).json({ error: 'La fecha desde no puede ser posterior a la fecha hasta' });
    }

    const dias = (Date.parse(periodo.hasta) - Date.parse(periodo.desde)) / UN_DIA + 1;
    if (dias > DIAS_MAXIMOS) {
      return res.status(400).json({ error: 'El periodo no puede superar un año' });
    }

    res.json(await armarPanel(periodo.desde, periodo.hasta));
  } catch (error) {
    siguiente(error);
  }
});
