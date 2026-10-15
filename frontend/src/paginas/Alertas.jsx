import { useEffect, useState } from 'react';
import { listarAlertas } from '../api/alertas.js';

const FILTROS_VACIOS = { tipo: '', origen: '' };

const cantidad = (numero) => numero.toLocaleString('es-AR');

/** Texto y color de la etiqueta. "Sin stock" se distingue de "Critico"
    porque no es lo mismo quedar corto que no tener nada para producir. */
function etiquetaDe(alerta) {
  if (alerta.sinStock) return { texto: 'Sin stock', clase: 'etiqueta--error' };
  if (alerta.tipo === 'StockCritico') return { texto: 'Critico', clase: 'etiqueta--error' };
  return { texto: 'Sobrestock', clase: 'etiqueta--aviso' };
}

/** Que hacer con cada alerta, dicho en el idioma del mostrador. */
function sugerenciaDe(alerta) {
  const unidades = `${cantidad(alerta.cantidadSugerida)} ${alerta.unidad}`;
  if (alerta.tipo === 'Sobrestock') return `Sobran ${unidades}`;
  return alerta.origen === 'Insumo' ? `Comprar ${unidades}` : `Producir ${unidades}`;
}

/**
 * CU-10 - Consultar las alertas de stock.
 *
 * Las alertas las genera el servidor (CU-09) comparando el stock contra los
 * umbrales en el momento del pedido, asi que esta pantalla siempre muestra
 * la situacion actual: no hay alertas viejas que cerrar a mano. Para que una
 * alerta desaparezca hay que resolver la causa: comprar, producir, o ajustar
 * el umbral si estaba mal configurado.
 */
export default function Alertas({ alCambiarResumen }) {
  const [alertas, setAlertas] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    cargar(filtros);
    // Los filtros se aplican al elegirlos: son dos listas cortas y no hace
    // falta un boton de buscar como en el historial de ventas.
  }, [filtros]);

  async function cargar(conFiltros) {
    setCargando(true);
    setError(null);
    try {
      const datos = await listarAlertas(conFiltros);
      setAlertas(datos.alertas);
      setResumen(datos.resumen);
      // Sin filtros, el resumen es el total real: se aprovecha para dejar al
      // dia el aviso de la barra sin hacer otro pedido.
      if (!conFiltros.tipo && !conFiltros.origen) alCambiarResumen?.(datos.resumen);
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  const hayFiltros = filtros.tipo !== '' || filtros.origen !== '';

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Alertas de stock</h2>
          <p className="seccion__ayuda">
            Insumos y productos que llegaron a su stock minimo o pasaron el maximo.
            Se recalculan con cada venta, lote o compra: una alerta desaparece sola
            cuando se resuelve.
          </p>
        </div>
        <button className="boton boton--secundario" onClick={() => cargar(filtros)} disabled={cargando}>
          Actualizar
        </button>
      </header>

      {error && <p className="mensaje-error" role="alert">{error}</p>}

      {resumen && (
        <dl className="indicadores" aria-label="Resumen de alertas">
          <div className="indicador indicador--error">
            <dt>Sin stock</dt>
            <dd className="dato">{resumen.sinStock}</dd>
          </div>
          <div className="indicador indicador--error">
            <dt>Criticas</dt>
            <dd className="dato">{resumen.criticas}</dd>
            <dd className="indicador__detalle">Incluye las que estan sin stock</dd>
          </div>
          <div className="indicador indicador--aviso">
            <dt>Sobrestock</dt>
            <dd className="dato">{resumen.sobrestock}</dd>
          </div>
        </dl>
      )}

      <div className="filtros" role="group" aria-label="Filtros">
        <div className="campo">
          <label htmlFor="filtroTipo">Tipo</label>
          <select
            id="filtroTipo"
            value={filtros.tipo}
            onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="StockCritico">Stock critico</option>
            <option value="Sobrestock">Sobrestock</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="filtroOrigen">Stock de</label>
          <select
            id="filtroOrigen"
            value={filtros.origen}
            onChange={(e) => setFiltros({ ...filtros, origen: e.target.value })}
          >
            <option value="">Insumos y productos</option>
            <option value="Insumo">Insumos</option>
            <option value="Producto">Productos</option>
          </select>
        </div>
        {hayFiltros && (
          <div className="filtros__acciones">
            <button className="boton boton--secundario" onClick={() => setFiltros(FILTROS_VACIOS)}>
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {cargando && alertas.length === 0 ? (
        <p className="seccion__ayuda">Cargando alertas...</p>
      ) : (
        <div className="tabla-envoltorio">
          {alertas.length === 0 ? (
            <p className="mensaje-vacio">
              {hayFiltros
                ? 'No hay alertas con esos filtros.'
                : 'No hay alertas: todo el stock esta dentro de sus umbrales.'}
            </p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th className="numero">Stock</th>
                  <th className="numero">Minimo</th>
                  <th className="numero">Maximo</th>
                  <th>Que hacer</th>
                  <th>Proveedor habitual</th>
                </tr>
              </thead>
              <tbody>
                {alertas.map((a) => {
                  const etiqueta = etiquetaDe(a);
                  return (
                    <tr key={`${a.origen}-${a.id}`}>
                      <td>
                        <span className={`etiqueta ${etiqueta.clase}`}>{etiqueta.texto}</span>
                      </td>
                      <td>{a.nombre}</td>
                      <td>{a.origen}</td>
                      <td className="numero">{cantidad(a.stockActual)} {a.unidad}</td>
                      <td className="numero">{cantidad(a.stockMinimo)}</td>
                      <td className="numero">{cantidad(a.stockMaximo)}</td>
                      <td className="sin-corte">{sugerenciaDe(a)}</td>
                      <td>
                        {a.proveedor ? (
                          <>
                            {a.proveedor}
                            {a.telefonoProveedor && (
                              <span className="tabla__secundario">{a.telefonoProveedor}</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
