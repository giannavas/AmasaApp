import { useEffect, useState } from 'react';
import { listarProductos, crearProducto, editarProducto } from '../api/productos.js';

const FORMULARIO_VACIO = {
  nombre: '',
  descripcion: '',
  precioVenta: '',
  stockMinimo: '',
  stockMaximo: '',
};

const CLASE_ESTADO = {
  OK: 'etiqueta--ok',
  Critico: 'etiqueta--error',
  Sobrestock: 'etiqueta--aviso',
};

/**
 * Productos terminados: lo que la panaderia vende.
 *
 * No existe como caso de uso en el documento, pero sin productos no hay
 * recetas, y sin recetas CU-06 no puede producir nada.
 */
export default function Productos() {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [editando, setEditando] = useState(null);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
  const [errorFormulario, setErrorFormulario] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const esAlta = editando === 'nuevo';

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      setProductos(await listarProductos());
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  function abrirAlta() {
    setFormulario(FORMULARIO_VACIO);
    setErrorFormulario(null);
    setEditando('nuevo');
  }

  function abrirEdicion(producto) {
    setFormulario({
      nombre: producto.nombre,
      descripcion: producto.descripcion ?? '',
      precioVenta: String(producto.precioVenta),
      stockMinimo: String(producto.stockMinimo),
      stockMaximo: String(producto.stockMaximo),
    });
    setErrorFormulario(null);
    setEditando(producto.idProducto);
  }

  function cerrarFormulario() {
    setEditando(null);
    setErrorFormulario(null);
  }

  function cambiar(campo, valor) {
    setFormulario((previo) => ({ ...previo, [campo]: valor }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    setErrorFormulario(null);

    const nombre = formulario.nombre.trim();
    const precio = Number(formulario.precioVenta);
    const minimo = Number(formulario.stockMinimo);
    const maximo = Number(formulario.stockMaximo);

    if (!nombre) return setErrorFormulario('El nombre del producto es obligatorio');
    if (!Number.isFinite(precio) || precio < 0) {
      return setErrorFormulario('El precio de venta no es valido');
    }
    if (!Number.isFinite(minimo) || !Number.isFinite(maximo)) {
      return setErrorFormulario('Completa los umbrales de stock');
    }
    if (maximo < minimo) {
      return setErrorFormulario('El stock maximo no puede ser menor que el minimo');
    }

    const datos = {
      nombre,
      descripcion: formulario.descripcion.trim(),
      precioVenta: precio,
      stockMinimo: minimo,
      stockMaximo: maximo,
    };

    setGuardando(true);
    try {
      if (esAlta) await crearProducto(datos);
      else await editarProducto(editando, datos);
      cerrarFormulario();
      await cargar();
    } catch (fallo) {
      setErrorFormulario(fallo.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Productos</h2>
          <p className="seccion__ayuda">
            Lo que la panaderia vende. El stock de un producto no se carga a mano:
            sube al producir un lote y baja al vender.
          </p>
        </div>
        <button className="boton boton--primario" onClick={abrirAlta}>
          Nuevo producto
        </button>
      </header>

      {error && <p className="mensaje-error" role="alert">{error}</p>}

      {editando !== null && (
        <form className="formulario-panel" onSubmit={guardar} noValidate>
          <h3>{esAlta ? 'Nuevo producto' : 'Editar producto'}</h3>

          <div className="formulario-panel__campos">
            <div className="campo">
              <label htmlFor="nombreProducto">Nombre</label>
              <input
                id="nombreProducto"
                value={formulario.nombre}
                onChange={(e) => cambiar('nombre', e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="descripcionProducto">Descripcion</label>
              <input
                id="descripcionProducto"
                value={formulario.descripcion}
                onChange={(e) => cambiar('descripcion', e.target.value)}
              />
              <p className="campo__pista">Opcional.</p>
            </div>

            <div className="campo">
              <label htmlFor="precioVenta">Precio de venta</label>
              <input
                id="precioVenta"
                type="number"
                min="0"
                step="0.01"
                value={formulario.precioVenta}
                onChange={(e) => cambiar('precioVenta', e.target.value)}
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="stockMinimoProducto">Stock minimo</label>
              <input
                id="stockMinimoProducto"
                type="number"
                min="0"
                value={formulario.stockMinimo}
                onChange={(e) => cambiar('stockMinimo', e.target.value)}
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="stockMaximoProducto">Stock maximo</label>
              <input
                id="stockMaximoProducto"
                type="number"
                min="0"
                value={formulario.stockMaximo}
                onChange={(e) => cambiar('stockMaximo', e.target.value)}
                required
              />
            </div>
          </div>

          {errorFormulario && (
            <p className="mensaje-error" role="alert" aria-live="polite">{errorFormulario}</p>
          )}

          <div className="formulario-panel__acciones">
            <button type="submit" className="boton boton--primario" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" className="boton boton--secundario" onClick={cerrarFormulario} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {cargando ? (
        <p className="seccion__ayuda">Cargando productos...</p>
      ) : (
        <div className="tabla-envoltorio">
          {productos.length === 0 ? (
            <p className="mensaje-vacio">No hay productos cargados.</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Descripcion</th>
                  <th className="numero">Precio</th>
                  <th className="numero">Stock</th>
                  <th className="numero">Minimo</th>
                  <th className="numero">Maximo</th>
                  <th>Estado</th>
                  <th><span className="visualmente-oculto">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <tr key={p.idProducto}>
                    <td>{p.nombre}</td>
                    <td>{p.descripcion ?? '—'}</td>
                    <td className="numero">$ {p.precioVenta}</td>
                    <td className="numero">{p.stockActual}</td>
                    <td className="numero">{p.stockMinimo}</td>
                    <td className="numero">{p.stockMaximo}</td>
                    <td>
                      <span className={`etiqueta ${CLASE_ESTADO[p.estado] ?? 'etiqueta--neutro'}`}>
                        {p.estado}
                      </span>
                    </td>
                    <td className="tabla__acciones">
                      <button className="boton boton--secundario boton--chico" onClick={() => abrirEdicion(p)}>
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
