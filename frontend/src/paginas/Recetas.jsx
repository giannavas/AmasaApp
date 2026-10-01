import { useEffect, useState } from 'react';
import { listarRecetas, crearReceta, editarReceta } from '../api/recetas.js';
import { listarProductos } from '../api/productos.js';
import { listarMateriasPrimas } from '../api/materiasPrimas.js';

const FILA_VACIA = { idMateriaPrima: '', cantidadRequerida: '' };

const FORMULARIO_VACIO = {
  nombre: '',
  rendimientoUnidades: '',
  idProducto: '',
  detalles: [{ ...FILA_VACIA }],
};

/**
 * Recetas: que insumos lleva cada producto y en que cantidad.
 *
 * Es lo que CU-06 usa para saber cuanto descontar del stock al producir.
 * Cada producto tiene una sola receta.
 */
export default function Recetas() {
  const [recetas, setRecetas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [editando, setEditando] = useState(null);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
  const [errorFormulario, setErrorFormulario] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const esAlta = editando === 'nuevo';

  useEffect(() => {
    cargar();
    listarProductos().then(setProductos).catch(() => setProductos([]));
    listarMateriasPrimas().then(setInsumos).catch(() => setInsumos([]));
  }, []);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      setRecetas(await listarRecetas());
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  // Un producto que ya tiene receta no puede recibir otra, asi que no se
  // ofrece en el desplegable del alta.
  const productosDisponibles = productos.filter(
    (p) => !recetas.some((r) => r.idProducto === p.idProducto)
  );

  function abrirAlta() {
    setFormulario({
      ...FORMULARIO_VACIO,
      detalles: [{ ...FILA_VACIA }],
      idProducto: String(productosDisponibles[0]?.idProducto ?? ''),
    });
    setErrorFormulario(null);
    setEditando('nuevo');
  }

  function abrirEdicion(receta) {
    setFormulario({
      nombre: receta.nombre,
      rendimientoUnidades: String(receta.rendimientoUnidades),
      idProducto: String(receta.idProducto),
      detalles: receta.detalles.map((d) => ({
        idMateriaPrima: String(d.idMateriaPrima),
        cantidadRequerida: String(d.cantidadRequerida),
      })),
    });
    setErrorFormulario(null);
    setEditando(receta.idReceta);
  }

  function cerrarFormulario() {
    setEditando(null);
    setErrorFormulario(null);
  }

  function cambiar(campo, valor) {
    setFormulario((previo) => ({ ...previo, [campo]: valor }));
  }

  function cambiarDetalle(indice, campo, valor) {
    setFormulario((previo) => ({
      ...previo,
      detalles: previo.detalles.map((d, i) => (i === indice ? { ...d, [campo]: valor } : d)),
    }));
  }

  function agregarFila() {
    setFormulario((previo) => ({ ...previo, detalles: [...previo.detalles, { ...FILA_VACIA }] }));
  }

  function quitarFila(indice) {
    setFormulario((previo) => ({
      ...previo,
      detalles: previo.detalles.filter((_, i) => i !== indice),
    }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    setErrorFormulario(null);

    const nombre = formulario.nombre.trim();
    const rendimiento = Number(formulario.rendimientoUnidades);

    if (!nombre) return setErrorFormulario('El nombre de la receta es obligatorio');
    if (!Number.isInteger(rendimiento) || rendimiento <= 0) {
      return setErrorFormulario('El rendimiento tiene que ser un numero entero mayor que cero');
    }

    const detalles = formulario.detalles
      .filter((d) => d.idMateriaPrima !== '')
      .map((d) => ({
        idMateriaPrima: Number(d.idMateriaPrima),
        cantidadRequerida: Number(d.cantidadRequerida),
      }));

    if (detalles.length === 0) {
      return setErrorFormulario('La receta tiene que llevar al menos un insumo');
    }
    if (detalles.some((d) => !Number.isFinite(d.cantidadRequerida) || d.cantidadRequerida <= 0)) {
      return setErrorFormulario('Cada insumo necesita una cantidad mayor que cero');
    }

    const repetidos = new Set(detalles.map((d) => d.idMateriaPrima)).size !== detalles.length;
    if (repetidos) {
      return setErrorFormulario('Un insumo no puede repetirse dentro de la misma receta');
    }

    setGuardando(true);
    try {
      if (esAlta) {
        if (!formulario.idProducto) throw new Error('Elegi el producto que elabora esta receta');
        await crearReceta({
          nombre,
          rendimientoUnidades: rendimiento,
          idProducto: Number(formulario.idProducto),
          detalles,
        });
      } else {
        await editarReceta(editando, { nombre, rendimientoUnidades: rendimiento, detalles });
      }
      cerrarFormulario();
      await cargar();
    } catch (fallo) {
      setErrorFormulario(fallo.message);
    } finally {
      setGuardando(false);
    }
  }

  const sinProductos = esAlta && productosDisponibles.length === 0;

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Recetas</h2>
          <p className="seccion__ayuda">
            Que insumos lleva cada producto y en que cantidad. Es lo que el sistema
            usa para saber cuanto descontar del stock al registrar una produccion.
          </p>
        </div>
        <button
          className="boton boton--primario"
          onClick={abrirAlta}
          disabled={productosDisponibles.length === 0}
        >
          Nueva receta
        </button>
      </header>

      {productos.length > 0 && productosDisponibles.length === 0 && (
        <p className="seccion__ayuda">
          Todos los productos ya tienen receta. Para cargar una nueva, primero hace
          falta dar de alta otro producto.
        </p>
      )}

      {productos.length === 0 && (
        <p className="seccion__ayuda">
          Para cargar una receta primero hace falta dar de alta al menos un producto.
        </p>
      )}

      {error && <p className="mensaje-error" role="alert">{error}</p>}

      {editando !== null && (
        <form className="formulario-panel" onSubmit={guardar} noValidate>
          <h3>{esAlta ? 'Nueva receta' : 'Editar receta'}</h3>

          <div className="formulario-panel__campos">
            <div className="campo">
              <label htmlFor="nombreReceta">Nombre</label>
              <input
                id="nombreReceta"
                value={formulario.nombre}
                onChange={(e) => cambiar('nombre', e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="idProductoReceta">Producto que elabora</label>
              <select
                id="idProductoReceta"
                value={formulario.idProducto}
                onChange={(e) => cambiar('idProducto', e.target.value)}
                disabled={!esAlta}
                required
              >
                {esAlta
                  ? productosDisponibles.map((p) => (
                      <option key={p.idProducto} value={p.idProducto}>{p.nombre}</option>
                    ))
                  : productos.map((p) => (
                      <option key={p.idProducto} value={p.idProducto}>{p.nombre}</option>
                    ))}
              </select>
              {!esAlta && (
                <p className="campo__pista">El producto no se cambia una vez creada la receta.</p>
              )}
            </div>

            <div className="campo">
              <label htmlFor="rendimiento">Rendimiento (unidades)</label>
              <input
                id="rendimiento"
                type="number"
                min="1"
                step="1"
                value={formulario.rendimientoUnidades}
                onChange={(e) => cambiar('rendimientoUnidades', e.target.value)}
                required
              />
              <p className="campo__pista">Cuantas unidades salen de una receta completa.</p>
            </div>
          </div>

          <div>
            <h4 className="subtitulo-campo">Insumos</h4>
            <div className="lista-detalles">
              {formulario.detalles.map((detalle, indice) => (
                <div className="lista-detalles__fila" key={indice}>
                  <div className="campo">
                    <label htmlFor={`insumo-${indice}`}>Insumo</label>
                    <select
                      id={`insumo-${indice}`}
                      value={detalle.idMateriaPrima}
                      onChange={(e) => cambiarDetalle(indice, 'idMateriaPrima', e.target.value)}
                    >
                      <option value="">Elegir...</option>
                      {insumos.map((m) => (
                        <option key={m.idMateriaPrima} value={m.idMateriaPrima}>
                          {m.nombre} ({m.unidadMedida})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="campo">
                    <label htmlFor={`cantidad-${indice}`}>Cantidad</label>
                    <input
                      id={`cantidad-${indice}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={detalle.cantidadRequerida}
                      onChange={(e) => cambiarDetalle(indice, 'cantidadRequerida', e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    className="boton boton--secundario boton--chico"
                    onClick={() => quitarFila(indice)}
                    disabled={formulario.detalles.length === 1}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="boton boton--secundario boton--chico" onClick={agregarFila}>
              Agregar insumo
            </button>
          </div>

          {errorFormulario && (
            <p className="mensaje-error" role="alert" aria-live="polite">{errorFormulario}</p>
          )}

          <div className="formulario-panel__acciones">
            <button type="submit" className="boton boton--primario" disabled={guardando || sinProductos}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" className="boton boton--secundario" onClick={cerrarFormulario} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {cargando ? (
        <p className="seccion__ayuda">Cargando recetas...</p>
      ) : (
        <div className="tabla-envoltorio">
          {recetas.length === 0 ? (
            <p className="mensaje-vacio">No hay recetas cargadas.</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Receta</th>
                  <th>Producto</th>
                  <th className="numero">Rinde</th>
                  <th>Insumos</th>
                  <th><span className="visualmente-oculto">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {recetas.map((r) => (
                  <tr key={r.idReceta}>
                    <td>{r.nombre}</td>
                    <td>{r.producto}</td>
                    <td className="numero">{r.rendimientoUnidades} u.</td>
                    <td>
                      {r.detalles.map((d) => (
                        <div key={d.idMateriaPrima}>
                          {d.materiaPrima}: {d.cantidadRequerida} {d.unidadMedida}
                        </div>
                      ))}
                    </td>
                    <td className="tabla__acciones">
                      <button className="boton boton--secundario boton--chico" onClick={() => abrirEdicion(r)}>
                        Editar
                      </button>
                    </td>
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
