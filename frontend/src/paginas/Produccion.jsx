import { useEffect, useMemo, useState } from 'react';
import { listarLotes, registrarLote } from '../api/produccion.js';
import { listarRecetas } from '../api/recetas.js';

const FORMULARIO_VACIO = { idReceta: '', cantidadProducida: '', fecha: '' };

/** Redondea para mostrar, sin arrastrar los decimales del punto flotante. */
const redondear = (numero) => Math.round(numero * 100) / 100;

/**
 * CU-06 - Registrar lote de produccion.
 *
 * La abren el Panificador y el Encargado. Antes de confirmar muestra cuanto
 * de cada insumo va a consumir el lote, para que no haya que registrarlo
 * para enterarse.
 */
export default function Produccion() {
  const [lotes, setLotes] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [abierto, setAbierto] = useState(false);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
  const [errorFormulario, setErrorFormulario] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargar();
    listarRecetas().then(setRecetas).catch(() => setRecetas([]));
  }, []);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      setLotes(await listarLotes());
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  const recetaElegida = recetas.find((r) => String(r.idReceta) === formulario.idReceta);

  /* Vista previa del consumo. Repite el calculo que hace el servidor, pero
     solo para mostrarlo: el descuento real y la verificacion de stock los
     hace el backend, que es el unico que ve el stock al momento de guardar. */
  const consumoPrevisto = useMemo(() => {
    const cantidad = Number(formulario.cantidadProducida);
    if (!recetaElegida || !Number.isFinite(cantidad) || cantidad <= 0) return null;

    const factor = cantidad / recetaElegida.rendimientoUnidades;
    return recetaElegida.detalles.map((d) => ({
      ...d,
      cantidadTotal: redondear(d.cantidadRequerida * factor),
    }));
  }, [recetaElegida, formulario.cantidadProducida]);

  function abrir() {
    setFormulario({ ...FORMULARIO_VACIO, idReceta: String(recetas[0]?.idReceta ?? '') });
    setErrorFormulario(null);
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
    setErrorFormulario(null);
  }

  function cambiar(campo, valor) {
    setFormulario((previo) => ({ ...previo, [campo]: valor }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    setErrorFormulario(null);

    const cantidad = Number(formulario.cantidadProducida);
    if (!formulario.idReceta) return setErrorFormulario('Elegi la receta a producir');
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      return setErrorFormulario('La cantidad tiene que ser un numero entero mayor que cero');
    }

    setGuardando(true);
    try {
      await registrarLote({
        idReceta: Number(formulario.idReceta),
        cantidadProducida: cantidad,
        fecha: formulario.fecha || null,
      });
      cerrar();
      await cargar();
    } catch (fallo) {
      // Aca cae el aviso de stock insuficiente, que ya viene con el nombre
      // del insumo que falta.
      setErrorFormulario(fallo.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Produccion</h2>
          <p className="seccion__ayuda">
            Registrar un lote descuenta los insumos que indica la receta y suma el
            producto terminado. Si falta stock de alguno, no se registra nada.
          </p>
        </div>
        <button className="boton boton--primario" onClick={abrir} disabled={recetas.length === 0}>
          Nuevo lote
        </button>
      </header>

      {recetas.length === 0 && (
        <p className="seccion__ayuda">
          Para registrar un lote primero hace falta cargar una receta.
        </p>
      )}

      {error && <p className="mensaje-error" role="alert">{error}</p>}

      {abierto && (
        <form className="formulario-panel" onSubmit={guardar} noValidate>
          <h3>Nuevo lote de produccion</h3>

          <div className="formulario-panel__campos">
            <div className="campo">
              <label htmlFor="idReceta">Receta</label>
              <select
                id="idReceta"
                value={formulario.idReceta}
                onChange={(e) => cambiar('idReceta', e.target.value)}
                autoFocus
                required
              >
                {recetas.map((r) => (
                  <option key={r.idReceta} value={r.idReceta}>
                    {r.nombre} — {r.producto}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo">
              <label htmlFor="cantidadProducida">Cantidad a producir</label>
              <input
                id="cantidadProducida"
                type="number"
                min="1"
                step="1"
                value={formulario.cantidadProducida}
                onChange={(e) => cambiar('cantidadProducida', e.target.value)}
                required
              />
              {recetaElegida && (
                <p className="campo__pista">
                  Unidades de {recetaElegida.producto}. La receta rinde{' '}
                  {recetaElegida.rendimientoUnidades}.
                </p>
              )}
            </div>

            <div className="campo">
              <label htmlFor="fechaLote">Fecha</label>
              <input
                id="fechaLote"
                type="date"
                value={formulario.fecha}
                onChange={(e) => cambiar('fecha', e.target.value)}
              />
              <p className="campo__pista">Si se deja vacia, se usa la de hoy.</p>
            </div>
          </div>

          {consumoPrevisto && (
            <div>
              <h4 className="subtitulo-campo">Va a consumir</h4>
              <ul className="lista-consumo">
                {consumoPrevisto.map((d) => (
                  <li key={d.idMateriaPrima}>
                    <span>{d.materiaPrima}</span>
                    <span className="dato">{d.cantidadTotal} {d.unidadMedida}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {errorFormulario && (
            <p className="mensaje-error" role="alert" aria-live="polite">{errorFormulario}</p>
          )}

          <div className="formulario-panel__acciones">
            <button type="submit" className="boton boton--primario" disabled={guardando}>
              {guardando ? 'Registrando...' : 'Registrar lote'}
            </button>
            <button type="button" className="boton boton--secundario" onClick={cerrar} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {cargando ? (
        <p className="seccion__ayuda">Cargando lotes...</p>
      ) : (
        <div className="tabla-envoltorio">
          {lotes.length === 0 ? (
            <p className="mensaje-vacio">Todavia no se registro ningun lote.</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Receta</th>
                  <th>Producto</th>
                  <th className="numero">Cantidad</th>
                  <th className="numero">Costo total</th>
                  <th className="numero">Costo x unidad</th>
                  <th>Responsable</th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((l) => (
                  <tr key={l.idLote}>
                    <td>{String(l.fecha).slice(0, 10)}</td>
                    <td>{l.receta}</td>
                    <td>{l.producto}</td>
                    <td className="numero">{l.cantidadProducida}</td>
                    <td className="numero">$ {redondear(l.costoTotal)}</td>
                    <td className="numero">$ {redondear(l.costoUnitario)}</td>
                    <td>{l.usuario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
