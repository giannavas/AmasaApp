import { useEffect, useState } from 'react';
import { obtenerPanel } from '../api/panel.js';
import './Panel.css';

const redondear = (numero) => Math.round(numero * 100) / 100;
// Espacio que no se corta, para que el "$" no quede solo al final de un renglon.
const pesos = (numero) => `$\u00a0${redondear(numero).toLocaleString('es-AR')}`;
const cantidad = (numero) => numero.toLocaleString('es-AR');

/** 2026-03-07 -> 07/03. Se arma a mano y no con Date para no correr el dia
    por la zona horaria: new Date('2026-03-07') es medianoche UTC, que en
    Argentina todavia es el 6. */
function diaMes(fechaIso) {
  const [, mes, dia] = fechaIso.split('-');
  return `${dia}/${mes}`;
}

function fechaLarga(fechaIso) {
  const [anio, mes, dia] = fechaIso.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** Fecha de hoy en formato ISO, con la hora local del navegador. */
function hoyIso() {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

function haceDias(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

const ATAJOS = [
  { texto: 'Hoy', periodo: () => ({ desde: hoyIso(), hasta: hoyIso() }) },
  { texto: '7 dias', periodo: () => ({ desde: haceDias(6), hasta: hoyIso() }) },
  { texto: '30 dias', periodo: () => ({ desde: haceDias(29), hasta: hoyIso() }) },
  { texto: 'Este mes', periodo: () => ({ desde: `${hoyIso().slice(0, 8)}01`, hasta: hoyIso() }) },
];

/**
 * CU-12 - Panel de control del Encargado.
 *
 * Es la pantalla de inicio del Encargado: junta en un solo lugar lo que
 * hasta ahora habia que ir a buscar a cada seccion. Todo lo calcula el
 * servidor (PanelControl), asi los numeros coinciden con los de las otras
 * pantallas y no se traen todas las ventas al navegador para sumarlas.
 */
export default function Panel({ usuario, alIrA }) {
  const [datos, setDatos] = useState(null);
  const [filtros, setFiltros] = useState({ desde: '', hasta: '' });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    cargar({});
  }, []);

  async function cargar(periodo) {
    setCargando(true);
    setError(null);
    try {
      const panel = await obtenerPanel(periodo);
      setDatos(panel);
      // Se reflejan en los campos las fechas que uso el servidor, que pudo
      // haber completado alguna que quedo vacia.
      setFiltros(panel.periodo);
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  function aplicar(evento) {
    evento.preventDefault();
    cargar(filtros);
  }

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Panel de control</h2>
          <p className="seccion__ayuda">
            Hola, {usuario.nombre}. Ventas, produccion y compras del periodo elegido, y
            el estado del stock ahora.
          </p>
        </div>
      </header>

      <form className="filtros" onSubmit={aplicar}>
        <div className="campo">
          <label htmlFor="panelDesde">Desde</label>
          <input
            id="panelDesde"
            type="date"
            value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
          />
        </div>
        <div className="campo">
          <label htmlFor="panelHasta">Hasta</label>
          <input
            id="panelHasta"
            type="date"
            value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
          />
        </div>
        <div className="filtros__acciones">
          <button type="submit" className="boton boton--primario" disabled={cargando}>
            Ver
          </button>
        </div>
        <div className="panel-atajos" role="group" aria-label="Periodos rapidos">
          {ATAJOS.map((atajo) => (
            <button
              key={atajo.texto}
              type="button"
              className="boton boton--secundario boton--chico"
              onClick={() => cargar(atajo.periodo())}
              disabled={cargando}
            >
              {atajo.texto}
            </button>
          ))}
        </div>
      </form>

      {error && <p className="mensaje-error" role="alert">{error}</p>}

      {!datos ? (
        cargando && <p className="seccion__ayuda">Cargando el panel...</p>
      ) : (
        <div className={`panel-control ${cargando ? 'panel-control--cargando' : ''}`} aria-busy={cargando}>
          <Indicadores datos={datos} />
          <GraficoVentas dias={datos.ventasPorDia} />
          <div className="panel-control__columnas">
            <MasVendidos productos={datos.productosMasVendidos} />
            <AlertasPanel alertas={datos.alertas} alIrA={alIrA} />
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ indicadores */

function Variacion({ ventas }) {
  const { variacion, periodoAnterior } = ventas;
  const referencia = `vs. ${diaMes(periodoAnterior.desde)} al ${diaMes(periodoAnterior.hasta)}`;

  if (variacion === null) {
    return <dd className="indicador__detalle">Sin ventas en el periodo anterior para comparar</dd>;
  }
  // La flecha y el signo dicen lo mismo que el color, para quien no lo distingue.
  const sube = variacion >= 0;
  return (
    <dd className={`indicador__detalle panel-variacion ${sube ? 'panel-variacion--sube' : 'panel-variacion--baja'}`}>
      {sube ? '▲' : '▼'} {sube ? '+' : ''}{variacion.toLocaleString('es-AR')} % {referencia}
    </dd>
  );
}

function Indicadores({ datos }) {
  const { ventas, produccion, compras } = datos;
  return (
    <dl className="indicadores" aria-label="Indicadores del periodo">
      <div className="indicador">
        <dt>Facturado</dt>
        <dd className="dato">{pesos(ventas.total)}</dd>
        <Variacion ventas={ventas} />
      </div>
      <div className="indicador">
        <dt>Ventas</dt>
        <dd className="dato">{cantidad(ventas.cantidad)}</dd>
        <dd className="indicador__detalle">
          {cantidad(ventas.unidades)} unidades · ticket promedio {pesos(ventas.ticketPromedio)}
        </dd>
      </div>
      <div className="indicador">
        <dt>Producido</dt>
        <dd className="dato">{cantidad(produccion.unidades)} u</dd>
        <dd className="indicador__detalle">
          {cantidad(produccion.lotes)} {produccion.lotes === 1 ? 'lote' : 'lotes'} · costo {pesos(produccion.costo)}
        </dd>
      </div>
      <div className="indicador">
        <dt>Compras de insumos</dt>
        <dd className="dato">{pesos(compras.total)}</dd>
        <dd className="indicador__detalle">
          {cantidad(compras.ingresos)} {compras.ingresos === 1 ? 'ingreso' : 'ingresos'} de mercaderia
        </dd>
      </div>
    </dl>
  );
}

/* ------------------------------------------------------------ grafico */

/**
 * Barras de lo facturado por dia. Es una sola serie, asi que no lleva
 * leyenda: el titulo dice que es. Cada barra muestra su valor al pasar el
 * mouse, y la misma informacion esta en una tabla para quien usa lector de
 * pantalla o teclado (el grafico queda oculto para ellos: repetirlo dia por
 * dia en barras sin texto no les agregaria nada).
 *
 * Se arma con HTML y CSS en vez de sumar una libreria de graficos: son
 * barras de una sola serie y no justifican una dependencia mas.
 */
function GraficoVentas({ dias }) {
  const maximo = Math.max(...dias.map((d) => d.total), 0);
  const conVentas = dias.filter((d) => d.total > 0).length;

  // Rotulos del eje: primer dia, el del medio y el ultimo, para no amontonar.
  const medio = dias[Math.floor((dias.length - 1) / 2)];

  return (
    <figure className="panel-tarjeta grafico">
      <figcaption className="panel-tarjeta__titulo">
        Facturado por dia
        <span className="panel-tarjeta__nota">
          {conVentas} de {dias.length} {dias.length === 1 ? 'dia' : 'dias'} con ventas
        </span>
      </figcaption>

      {maximo === 0 ? (
        <p className="mensaje-vacio">No hubo ventas en este periodo.</p>
      ) : (
        <>
          <div className="grafico__area" aria-hidden="true">
            <span className="grafico__tope dato">{pesos(maximo)}</span>
            <div className="grafico__barras">
              {dias.map((d) => (
                <div
                  key={d.fecha}
                  className="grafico__columna"
                  data-rotulo={`${diaMes(d.fecha)}: ${pesos(d.total)} (${d.cantidad} ${d.cantidad === 1 ? 'venta' : 'ventas'})`}
                >
                  <span
                    className="grafico__barra"
                    style={{ height: `${(d.total / maximo) * 100}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="grafico__eje" aria-hidden="true">
            <span>{diaMes(dias[0].fecha)}</span>
            {dias.length > 2 && <span>{diaMes(medio.fecha)}</span>}
            {dias.length > 1 && <span>{diaMes(dias[dias.length - 1].fecha)}</span>}
          </div>
        </>
      )}

      <details className="grafico__tabla">
        <summary>Ver como tabla</summary>
        <table className="tabla">
          <thead>
            <tr>
              <th>Dia</th>
              <th className="numero">Ventas</th>
              <th className="numero">Facturado</th>
            </tr>
          </thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.fecha}>
                <td>{fechaLarga(d.fecha)}</td>
                <td className="numero">{d.cantidad}</td>
                <td className="numero">{pesos(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------ mas vendidos */

function MasVendidos({ productos }) {
  return (
    <section className="panel-tarjeta">
      <h3 className="panel-tarjeta__titulo">Mas vendidos</h3>
      {productos.length === 0 ? (
        <p className="mensaje-vacio">Sin ventas en el periodo.</p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="numero">Unidades</th>
              <th className="numero">Facturado</th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.idProducto}>
                <td>{p.nombre}</td>
                <td className="numero">{cantidad(p.unidades)}</td>
                <td className="numero">{pesos(p.importe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ alertas */

function AlertasPanel({ alertas, alIrA }) {
  const { resumen, principales } = alertas;
  return (
    <section className="panel-tarjeta">
      <h3 className="panel-tarjeta__titulo">
        Stock ahora
        <span className="panel-tarjeta__nota">no depende del periodo</span>
      </h3>

      {resumen.total === 0 ? (
        <p className="mensaje-vacio">Todo el stock esta dentro de sus umbrales.</p>
      ) : (
        <>
          <p className="panel-alertas__resumen">
            <span className="etiqueta etiqueta--error">{resumen.criticas} criticas</span>
            {resumen.sinStock > 0 && (
              <span className="etiqueta etiqueta--error">{resumen.sinStock} sin stock</span>
            )}
            <span className="etiqueta etiqueta--aviso">{resumen.sobrestock} sobrestock</span>
          </p>
          {principales.length > 0 && (
            <ul className="panel-alertas__lista">
              {principales.map((a) => (
                <li key={`${a.origen}-${a.id}`}>
                  <span>{a.nombre}</span>
                  <span className="dato panel-alertas__stock">
                    {cantidad(a.stockActual)} / {cantidad(a.stockMinimo)} {a.unidad}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button className="boton boton--secundario boton--chico" onClick={() => alIrA('alertas')}>
        Ver todas las alertas
      </button>
    </section>
  );
}
