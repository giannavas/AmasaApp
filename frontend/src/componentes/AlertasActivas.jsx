import { useState } from 'react';
import { obtenerDetalleAlerta } from '../api/alertas.js';
import './AlertasActivas.css';

const redondear = (numero) => Math.round(numero * 100) / 100;
const cantidad = (numero) => redondear(numero).toLocaleString('es-AR');
const pesos = (numero) => `$ ${redondear(numero).toLocaleString('es-AR')}`;

function fechaCorta(fechaIso) {
  const [anio, mes, dia] = fechaIso.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** Texto y color de la etiqueta. "Sin stock" se distingue de "Critico"
    porque no es lo mismo quedar corto que no tener nada para producir. */
export function etiquetaDe(alerta) {
  if (alerta.tipo === null) return { texto: 'OK', clase: 'etiqueta--ok' };
  if (alerta.sinStock) return { texto: 'Sin stock', clase: 'etiqueta--error' };
  if (alerta.tipo === 'StockCritico') return { texto: 'Critico', clase: 'etiqueta--error' };
  return { texto: 'Sobrestock', clase: 'etiqueta--aviso' };
}

/** Que hacer con cada alerta, dicho en el idioma del mostrador. */
export function sugerenciaDe(alerta) {
  if (alerta.tipo === null) return 'Dentro de los umbrales';
  const unidades = `${cantidad(alerta.cantidadSugerida)} ${alerta.unidad}`;
  if (alerta.tipo === 'Sobrestock') return `Sobran ${unidades}`;
  return alerta.origen === 'Insumo' ? `Comprar ${unidades}` : `Producir ${unidades}`;
}

/**
 * CU-10 - Lista de alertas activas, en tarjetas como en el wireframe.
 *
 * La usan la pantalla de Alertas y el panel principal. Al seleccionar una
 * alerta se despliega su detalle ampliado (paso 3 del caso de uso) debajo
 * de la tarjeta, y se vuelve a plegar con otro clic.
 *
 * alConfigurar, si llega, agrega al detalle un boton para ir a editar los
 * umbrales de ese item (CU-09).
 */
export default function AlertasActivas({ alertas, alConfigurar }) {
  const [abierta, setAbierta] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  // Flujo alternativo 1.a de CU-10, con el texto exacto del documento.
  if (alertas.length === 0) {
    return <p className="mensaje-vacio">Sin alertas activas</p>;
  }

  async function alternar(alerta) {
    const clave = `${alerta.origen}-${alerta.id}`;
    if (abierta === clave) {
      setAbierta(null);
      return;
    }
    setAbierta(clave);
    setDetalle(null);
    setError(null);
    setCargando(true);
    try {
      setDetalle(await obtenerDetalleAlerta(alerta.origen, alerta.id));
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <ul className="alertas-activas">
      {alertas.map((alerta) => {
        const clave = `${alerta.origen}-${alerta.id}`;
        const estaAbierta = abierta === clave;
        const etiqueta = etiquetaDe(alerta);
        return (
          <li key={clave} className={`alerta ${estaAbierta ? 'alerta--abierta' : ''}`}>
            <button
              type="button"
              className="alerta__resumen"
              onClick={() => alternar(alerta)}
              aria-expanded={estaAbierta}
              aria-controls={`detalle-${clave}`}
            >
              <span className="alerta__textos">
                <span className="alerta__nombre">{alerta.nombre}</span>
                <span className="alerta__linea">
                  {alerta.origen} · {cantidad(alerta.stockActual)} {alerta.unidad} de{' '}
                  {cantidad(alerta.stockMinimo)}–{cantidad(alerta.stockMaximo)} · {sugerenciaDe(alerta)}
                </span>
              </span>
              <span className={`etiqueta ${etiqueta.clase}`}>{etiqueta.texto}</span>
            </button>

            {estaAbierta && (
              <div className="alerta__detalle" id={`detalle-${clave}`}>
                {cargando && <p className="seccion__ayuda">Cargando detalle...</p>}
                {error && <p className="mensaje-error" role="alert">{error}</p>}
                {detalle && <Detalle detalle={detalle} alConfigurar={alConfigurar} />}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Informacion ampliada del item en alerta. */
function Detalle({ detalle, alConfigurar }) {
  const esInsumo = detalle.origen === 'Insumo';
  return (
    <>
      <dl className="detalle-datos">
        <div><dt>Stock actual</dt><dd className="dato">{cantidad(detalle.stockActual)} {detalle.unidad}</dd></div>
        <div><dt>Minimo</dt><dd className="dato">{cantidad(detalle.stockMinimo)}</dd></div>
        <div><dt>Maximo</dt><dd className="dato">{cantidad(detalle.stockMaximo)}</dd></div>
        <div><dt>Que hacer</dt><dd>{sugerenciaDe(detalle)}</dd></div>

        {esInsumo ? (
          <>
            <div><dt>Costo promedio</dt><dd className="dato">{pesos(detalle.costoPromedio)}</dd></div>
            <div>
              <dt>Consumo 30 dias</dt>
              <dd className="dato">{cantidad(detalle.consumoUltimos30Dias)} {detalle.unidad}</dd>
            </div>
          </>
        ) : (
          <>
            <div><dt>Precio de venta</dt><dd className="dato">{pesos(detalle.precioVenta)}</dd></div>
            <div>
              <dt>Costo segun receta</dt>
              <dd className="dato">{detalle.costoUnitario === null ? 'N/D' : pesos(detalle.costoUnitario)}</dd>
            </div>
            <div>
              <dt>Vendido 7 dias</dt>
              <dd className="dato">{cantidad(detalle.vendidoUltimos7Dias)} u</dd>
            </div>
          </>
        )}
      </dl>

      {esInsumo && (
        <>
          <p className="detalle-linea">
            <strong>Proveedor habitual:</strong>{' '}
            {detalle.proveedor
              ? [detalle.proveedor.razonSocial, detalle.proveedor.telefono, detalle.proveedor.email]
                  .filter(Boolean)
                  .join(' · ')
              : 'sin asignar'}
          </p>
          <p className="detalle-linea">
            <strong>Se usa en:</strong>{' '}
            {detalle.recetas.length > 0 ? detalle.recetas.join(', ') : 'ninguna receta'}
          </p>
          <Movimientos
            titulo="Ultimos ingresos"
            vacio="Sin ingresos registrados."
            filas={detalle.ultimosIngresos.map((i) => [
              fechaCorta(i.fecha),
              `${cantidad(i.cantidad)} ${detalle.unidad}`,
              `${pesos(i.precioUnitario)} c/u`,
              i.proveedor,
            ])}
          />
        </>
      )}

      {!esInsumo && (
        <>
          {detalle.costoUnitario === null && (
            <p className="detalle-linea">
              No tiene receta cargada: sin receta no se puede calcular su costo.
            </p>
          )}
          <Movimientos
            titulo="Ultimos lotes"
            vacio="Sin lotes producidos."
            filas={detalle.ultimosLotes.map((l) => [fechaCorta(l.fecha), `${cantidad(l.cantidad)} u`])}
          />
        </>
      )}

      {alConfigurar && (
        <button
          type="button"
          className="boton boton--secundario boton--chico"
          onClick={() => alConfigurar(detalle)}
        >
          Configurar umbrales
        </button>
      )}
    </>
  );
}

function Movimientos({ titulo, vacio, filas }) {
  return (
    <div>
      <p className="subtitulo-campo">{titulo}</p>
      {filas.length === 0 ? (
        <p className="detalle-linea">{vacio}</p>
      ) : (
        <ul className="detalle-movimientos">
          {filas.map((fila, i) => (
            <li key={i}>
              {fila.map((dato, j) => <span key={j}>{dato}</span>)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
