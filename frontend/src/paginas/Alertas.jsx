import { useEffect, useMemo, useRef, useState } from 'react';
import { listarAlertas, listarUmbrales, guardarUmbrales } from '../api/alertas.js';
import AlertasActivas from '../componentes/AlertasActivas.jsx';
import './Alertas.css';

const FILTROS = [
  { valor: '', texto: 'Todas' },
  { valor: 'StockCritico', texto: 'Stock bajo' },
  { valor: 'Sobrestock', texto: 'Sobrestock' },
];

const claveDe = (item) => `${item.origen}-${item.id}`;

/**
 * Pantalla de Alertas, como en el wireframe: a la izquierda la tabla para
 * configurar los umbrales (CU-09) y a la derecha las alertas activas (CU-10).
 *
 * Las dos partes estan conectadas: al guardar umbrales la lista de alertas se
 * recarga sola, y desde el detalle de una alerta se salta a la fila de ese
 * item en la tabla para corregir su umbral.
 */
export default function Alertas({ alCambiarResumen }) {
  const [alertas, setAlertas] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [tipo, setTipo] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [enfocar, setEnfocar] = useState(null);

  useEffect(() => {
    cargarAlertas(tipo);
  }, [tipo]);

  async function cargarAlertas(conTipo) {
    setCargando(true);
    setError(null);
    try {
      const datos = await listarAlertas({ tipo: conTipo });
      setAlertas(datos.alertas);
      setResumen(datos.resumen);
      // Sin filtro, el resumen es el total real: se aprovecha para dejar al
      // dia el contador de la barra sin hacer otro pedido.
      if (!conTipo) alCambiarResumen?.(datos.resumen);
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  function alGuardarUmbrales(resumenNuevo) {
    alCambiarResumen?.(resumenNuevo);
    cargarAlertas(tipo);
  }

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Alertas</h2>
          <p className="seccion__ayuda">
            Cada insumo y producto tiene un stock minimo y un maximo. Cuando el stock
            queda en el minimo o por debajo, o pasa el maximo, aparece una alerta.
            Se recalculan con cada venta, lote o compra: desaparecen solas cuando se
            resuelven.
          </p>
        </div>
      </header>

      <div className="alertas-columnas">
        <ConfigurarUmbrales enfocar={enfocar} alGuardar={alGuardarUmbrales} />

        <section className="panel-tarjeta" aria-labelledby="titulo-alertas-activas">
          <h3 className="panel-tarjeta__titulo" id="titulo-alertas-activas">
            Alertas activas
            {resumen && (
              <span className="panel-tarjeta__nota">
                {resumen.total} {resumen.total === 1 ? 'alerta' : 'alertas'}
                {resumen.sinStock > 0 && ` · ${resumen.sinStock} sin stock`}
              </span>
            )}
          </h3>

          <div className="selector" role="group" aria-label="Filtrar alertas">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={`selector__opcion ${tipo === f.valor ? 'selector__opcion--activa' : ''}`}
                aria-pressed={tipo === f.valor}
                onClick={() => setTipo(f.valor)}
              >
                {f.texto}
              </button>
            ))}
          </div>

          {error && <p className="mensaje-error" role="alert">{error}</p>}

          {cargando && alertas.length === 0 ? (
            <p className="seccion__ayuda">Cargando alertas...</p>
          ) : (
            <AlertasActivas
              alertas={alertas}
              alConfigurar={(item) => setEnfocar({ clave: claveDe(item), vez: Date.now() })}
            />
          )}
        </section>
      </div>
    </section>
  );
}

/* --------------------------------------------- CU-09 configurar umbrales */

/**
 * Tabla con el minimo y el maximo de cada item, editable en el lugar.
 *
 * Solo se mandan las filas que cambiaron. Se valida en el navegador para
 * marcar la fila mal cargada antes de enviar, pero la validacion que vale es
 * la del servidor, que ademas guarda todo o nada.
 */
function ConfigurarUmbrales({ enfocar, alGuardar }) {
  const [umbrales, setUmbrales] = useState([]);
  const [cambios, setCambios] = useState({});
  const [busqueda, setBusqueda] = useState('');
  const [origen, setOrigen] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [resaltada, setResaltada] = useState(null);
  const filas = useRef({});

  useEffect(() => {
    listarUmbrales()
      .then(setUmbrales)
      .catch((fallo) => setError(fallo.message))
      .finally(() => setCargando(false));
  }, []);

  // Paso 1 de CU-09 desde una alerta: se muestra la fila del item y se pone
  // el foco en su minimo. Se limpian los filtros para que la fila este.
  useEffect(() => {
    if (!enfocar) return;
    setBusqueda('');
    setOrigen('');
    setResaltada(enfocar.clave);
    requestAnimationFrame(() => {
      const fila = filas.current[enfocar.clave];
      fila?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fila?.querySelector('input')?.focus({ preventScroll: true });
    });
  }, [enfocar]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return umbrales.filter(
      (u) => (!origen || u.origen === origen) && (!texto || u.nombre.toLowerCase().includes(texto))
    );
  }, [umbrales, busqueda, origen]);

  /** El valor que muestra cada campo: el editado si lo hay, si no el guardado. */
  function valor(item, campo) {
    return cambios[claveDe(item)]?.[campo] ?? String(item[campo]);
  }

  function cambiar(item, campo, nuevo) {
    setAviso(null);
    const clave = claveDe(item);
    const fila = {
      stockMinimo: valor(item, 'stockMinimo'),
      stockMaximo: valor(item, 'stockMaximo'),
      [campo]: nuevo,
    };
    const igualQueGuardado =
      fila.stockMinimo === String(item.stockMinimo) && fila.stockMaximo === String(item.stockMaximo);

    setCambios((previos) => {
      const siguientes = { ...previos };
      if (igualQueGuardado) delete siguientes[clave];
      else siguientes[clave] = fila;
      return siguientes;
    });
  }

  /** Mismo criterio que el servidor: completos, no negativos y minimo < maximo. */
  function errorDe(item) {
    const cambio = cambios[claveDe(item)];
    if (!cambio) return null;
    if (cambio.stockMinimo === '' || cambio.stockMaximo === '') return 'Completa los dos valores';
    const minimo = Number(cambio.stockMinimo);
    const maximo = Number(cambio.stockMaximo);
    if (minimo < 0) return 'No puede ser negativo';
    if (minimo >= maximo) return 'El minimo tiene que ser menor que el maximo';
    if (item.origen === 'Producto' && (!Number.isInteger(minimo) || !Number.isInteger(maximo))) {
      return 'En productos van unidades enteras';
    }
    return null;
  }

  const pendientes = umbrales.filter((u) => cambios[claveDe(u)]);
  const hayErrores = pendientes.some((u) => errorDe(u));

  async function guardar(evento) {
    evento.preventDefault();
    if (pendientes.length === 0 || hayErrores) return;

    setGuardando(true);
    setError(null);
    try {
      const respuesta = await guardarUmbrales(
        pendientes.map((u) => ({
          origen: u.origen,
          id: u.id,
          nombre: u.nombre,
          stockMinimo: Number(cambios[claveDe(u)].stockMinimo),
          stockMaximo: Number(cambios[claveDe(u)].stockMaximo),
        }))
      );
      setUmbrales(respuesta.umbrales);
      setCambios({});
      setAviso(
        pendientes.length === 1
          ? 'Umbral guardado. Las alertas ya estan actualizadas.'
          : `${pendientes.length} umbrales guardados. Las alertas ya estan actualizadas.`
      );
      alGuardar(respuesta.alertas);
    } catch (fallo) {
      // Flujo alternativo 2.a: no se guardo nada y se puede corregir.
      setError(fallo.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="panel-tarjeta" onSubmit={guardar} aria-labelledby="titulo-umbrales">
      <h3 className="panel-tarjeta__titulo" id="titulo-umbrales">Configurar umbrales</h3>

      <div className="umbrales-filtros">
        <div className="campo">
          <label htmlFor="buscarUmbral">Buscar</label>
          <input
            id="buscarUmbral"
            type="search"
            placeholder="Nombre del insumo o producto"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="origenUmbral">Mostrar</label>
          <select id="origenUmbral" value={origen} onChange={(e) => setOrigen(e.target.value)}>
            <option value="">Todo</option>
            <option value="Insumo">Insumos</option>
            <option value="Producto">Productos</option>
          </select>
        </div>
      </div>

      {cargando ? (
        <p className="seccion__ayuda">Cargando umbrales...</p>
      ) : visibles.length === 0 ? (
        <p className="mensaje-vacio">
          {umbrales.length === 0
            ? 'Todavia no hay insumos ni productos cargados.'
            : 'Ningun item coincide con la busqueda.'}
        </p>
      ) : (
        <div className="tabla-envoltorio umbrales-tabla">
          <table className="tabla">
            <thead>
              <tr>
                <th>Item</th>
                <th className="numero">Minimo</th>
                <th className="numero">Maximo</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((u) => {
                const clave = claveDe(u);
                const fallo = errorDe(u);
                const idError = `error-${clave}`;
                return (
                  <tr
                    key={clave}
                    ref={(nodo) => { filas.current[clave] = nodo; }}
                    className={[
                      cambios[clave] ? 'umbral--cambiado' : '',
                      resaltada === clave ? 'umbral--resaltado' : '',
                    ].join(' ')}
                  >
                    <td>
                      {u.nombre}
                      <span className="tabla__secundario">
                        {u.origen} · stock {u.stockActual.toLocaleString('es-AR')} {u.unidad}
                      </span>
                      {fallo && <span className="umbral__error" id={idError}>{fallo}</span>}
                    </td>
                    {['stockMinimo', 'stockMaximo'].map((campo) => (
                      <td key={campo} className="numero">
                        <input
                          className="umbral__campo"
                          type="number"
                          min="0"
                          step={u.origen === 'Producto' ? 1 : 'any'}
                          inputMode="decimal"
                          value={valor(u, campo)}
                          onChange={(e) => cambiar(u, campo, e.target.value)}
                          aria-label={`${campo === 'stockMinimo' ? 'Minimo' : 'Maximo'} de ${u.nombre}`}
                          aria-invalid={Boolean(fallo)}
                          aria-describedby={fallo ? idError : undefined}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="mensaje-error" role="alert">{error}</p>}
      {aviso && <p className="mensaje-exito" role="status">{aviso}</p>}

      <div className="formulario-panel__acciones">
        <button
          type="submit"
          className="boton boton--primario"
          disabled={guardando || pendientes.length === 0 || hayErrores}
        >
          {guardando
            ? 'Guardando...'
            : pendientes.length > 0
              ? `Guardar umbrales (${pendientes.length})`
              : 'Guardar umbrales'}
        </button>
        {pendientes.length > 0 && (
          <button
            type="button"
            className="boton boton--secundario"
            onClick={() => { setCambios({}); setError(null); }}
            disabled={guardando}
          >
            Descartar cambios
          </button>
        )}
      </div>
    </form>
  );
}
