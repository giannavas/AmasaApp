import { useEffect, useMemo, useState } from 'react';
import { listarVentas, registrarVenta } from '../api/ventas.js';
import { listarProductos } from '../api/productos.js';

const LINEA_VACIA = { idProducto: '', cantidad: '', precioUnitario: '' };
const FILTROS_VACIOS = { desde: '', hasta: '', idProducto: '' };

/** Redondea para mostrar, sin arrastrar los decimales del punto flotante. */
const redondear = (numero) => Math.round(numero * 100) / 100;

const pesos = (numero) => `$ ${redondear(numero).toLocaleString('es-AR')}`;

/**
 * CU-07 y CU-08 - Registrar venta y consultar el historial.
 *
 * Es la primera pantalla del rol Venta, y tambien la usan el Panificador y el
 * Encargado. Una venta puede llevar varios productos, asi que el formulario
 * trabaja con renglones que se agregan y se quitan, y va mostrando el total a
 * medida que se carga.
 */
export default function Ventas() {
  const [ventas, setVentas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [filtrosAplicados, setFiltrosAplicados] = useState(FILTROS_VACIOS);

  const [abierto, setAbierto] = useState(false);
  const [lineas, setLineas] = useState([LINEA_VACIA]);
  const [fecha, setFecha] = useState('');
  const [errorFormulario, setErrorFormulario] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargar(FILTROS_VACIOS);
    listarProductos().then(setProductos).catch(() => setProductos([]));
  }, []);

  async function cargar(cuales) {
    setCargando(true);
    setError(null);
    try {
      setVentas(await listarVentas(cuales));
      setFiltrosAplicados(cuales);
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  const hayFiltros = Boolean(
    filtrosAplicados.desde || filtrosAplicados.hasta || filtrosAplicados.idProducto
  );

  /* Total de lo que se esta cargando. Se calcula en la pantalla solo para
     mostrarlo; el total que se guarda lo vuelve a calcular el servidor, que
     es el unico que conoce el precio de lista al momento de confirmar. */
  const totalPrevisto = useMemo(() => {
    return lineas.reduce((suma, linea) => {
      const producto = productos.find((p) => String(p.idProducto) === linea.idProducto);
      if (!producto) return suma;

      const cantidad = Number(linea.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) return suma;

      const precio = linea.precioUnitario === ''
        ? producto.precioVenta
        : Number(linea.precioUnitario);
      if (!Number.isFinite(precio) || precio < 0) return suma;

      return suma + cantidad * precio;
    }, 0);
  }, [lineas, productos]);

  function abrir() {
    setLineas([LINEA_VACIA]);
    setFecha('');
    setErrorFormulario(null);
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
    setErrorFormulario(null);
  }

  function cambiarLinea(indice, campo, valor) {
    setLineas((previas) => previas.map((linea, i) => {
      if (i !== indice) return linea;

      const actualizada = { ...linea, [campo]: valor };

      /* Al elegir el producto se propone su precio de lista, pero queda
         editable: CU-07 pide el precio en el formulario justamente para poder
         vender a otro valor (una promocion, un redondeo). */
      if (campo === 'idProducto') {
        const producto = productos.find((p) => String(p.idProducto) === valor);
        actualizada.precioUnitario = producto ? String(producto.precioVenta) : '';
      }
      return actualizada;
    }));
  }

  function agregarLinea() {
    setLineas((previas) => [...previas, LINEA_VACIA]);
  }

  function quitarLinea(indice) {
    setLineas((previas) => previas.filter((_, i) => i !== indice));
  }

  /** Stock que queda disponible para un producto, descontando lo ya cargado. */
  function disponible(idProducto, indiceActual) {
    const producto = productos.find((p) => String(p.idProducto) === idProducto);
    if (!producto) return null;

    const yaCargado = lineas.reduce((suma, linea, i) => {
      if (i === indiceActual || linea.idProducto !== idProducto) return suma;
      const cantidad = Number(linea.cantidad);
      return Number.isFinite(cantidad) && cantidad > 0 ? suma + cantidad : suma;
    }, 0);

    return producto.stockActual - yaCargado;
  }

  async function guardar(evento) {
    evento.preventDefault();
    setErrorFormulario(null);

    const detalles = [];
    for (const linea of lineas) {
      if (!linea.idProducto) {
        return setErrorFormulario('Elegi el producto de cada renglon');
      }
      const cantidad = Number(linea.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        return setErrorFormulario('La cantidad de cada renglon tiene que ser un entero mayor que cero');
      }
      const precio = linea.precioUnitario === '' ? null : Number(linea.precioUnitario);
      if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
        return setErrorFormulario('El precio no puede ser negativo');
      }

      detalles.push({
        idProducto: Number(linea.idProducto),
        cantidad,
        precioUnitario: precio,
      });
    }

    setGuardando(true);
    try {
      await registrarVenta({ detalles, fecha: fecha || null });
      cerrar();
      // Se recargan los productos porque la venta les bajo el stock, y el
      // formulario usa ese stock para avisar cuanto queda.
      listarProductos().then(setProductos).catch(() => {});
      await cargar(filtrosAplicados);
    } catch (fallo) {
      // Aca cae el aviso de stock insuficiente, que ya viene con el nombre
      // del producto que falta.
      setErrorFormulario(fallo.message);
    } finally {
      setGuardando(false);
    }
  }

  function buscar(evento) {
    evento.preventDefault();
    cargar(filtros);
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_VACIOS);
    cargar(FILTROS_VACIOS);
  }

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Ventas</h2>
          <p className="seccion__ayuda">
            Registrar una venta descuenta las unidades del stock de productos. Si
            falta stock de alguno, no se registra nada.
          </p>
        </div>
        <button
          className="boton boton--primario"
          onClick={abrir}
          disabled={productos.length === 0}
        >
          Nueva venta
        </button>
      </header>

      {productos.length === 0 && (
        <p className="seccion__ayuda">
          Para registrar una venta primero hace falta cargar productos.
        </p>
      )}

      {error && <p className="mensaje-error" role="alert">{error}</p>}

      {abierto && (
        <form className="formulario-panel" onSubmit={guardar} noValidate>
          <h3>Nueva venta</h3>

          <div>
            <h4 className="subtitulo-campo">Productos</h4>
            <div className="lista-detalles">
              {lineas.map((linea, indice) => {
                const resto = linea.idProducto ? disponible(linea.idProducto, indice) : null;
                const cantidad = Number(linea.cantidad);
                const seExcede = resto !== null && Number.isFinite(cantidad) && cantidad > resto;

                return (
                  <div className="lista-detalles__fila lista-detalles__fila--venta" key={indice}>
                    <div className="campo">
                      <label htmlFor={`producto-${indice}`}>Producto</label>
                      <select
                        id={`producto-${indice}`}
                        value={linea.idProducto}
                        onChange={(e) => cambiarLinea(indice, 'idProducto', e.target.value)}
                      >
                        <option value="">Elegir...</option>
                        {productos.map((p) => (
                          <option key={p.idProducto} value={p.idProducto}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                      {resto !== null && (
                        <p className="campo__pista">
                          {resto > 0 ? `Quedan ${resto} en stock` : 'Sin stock disponible'}
                        </p>
                      )}
                    </div>

                    <div className="campo">
                      <label htmlFor={`cantidad-${indice}`}>Cantidad</label>
                      <input
                        id={`cantidad-${indice}`}
                        type="number"
                        min="1"
                        step="1"
                        value={linea.cantidad}
                        onChange={(e) => cambiarLinea(indice, 'cantidad', e.target.value)}
                      />
                      {seExcede && (
                        <p className="campo__pista campo__pista--aviso">
                          Supera el stock disponible
                        </p>
                      )}
                    </div>

                    <div className="campo">
                      <label htmlFor={`precio-${indice}`}>Precio x unidad</label>
                      <input
                        id={`precio-${indice}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={linea.precioUnitario}
                        onChange={(e) => cambiarLinea(indice, 'precioUnitario', e.target.value)}
                      />
                    </div>

                    <button
                      type="button"
                      className="boton boton--secundario boton--chico"
                      onClick={() => quitarLinea(indice)}
                      disabled={lineas.length === 1}
                    >
                      Quitar
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="boton boton--secundario boton--chico"
              onClick={agregarLinea}
            >
              Agregar producto
            </button>
          </div>

          <div className="formulario-panel__campos">
            <div className="campo">
              <label htmlFor="fechaVenta">Fecha</label>
              <input
                id="fechaVenta"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
              <p className="campo__pista">Si se deja vacia, se usa la de hoy.</p>
            </div>
          </div>

          <p className="total-venta">
            Total <strong>{pesos(totalPrevisto)}</strong>
          </p>

          {errorFormulario && (
            <p className="mensaje-error" role="alert" aria-live="polite">{errorFormulario}</p>
          )}

          <div className="formulario-panel__acciones">
            <button type="submit" className="boton boton--primario" disabled={guardando}>
              {guardando ? 'Registrando...' : 'Registrar venta'}
            </button>
            <button
              type="button"
              className="boton boton--secundario"
              onClick={cerrar}
              disabled={guardando}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <form className="filtros" onSubmit={buscar}>
        <div className="campo">
          <label htmlFor="desde">Desde</label>
          <input
            id="desde"
            type="date"
            value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
          />
        </div>

        <div className="campo">
          <label htmlFor="hasta">Hasta</label>
          <input
            id="hasta"
            type="date"
            value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
          />
        </div>

        <div className="campo">
          <label htmlFor="filtroProducto">Producto</label>
          <select
            id="filtroProducto"
            value={filtros.idProducto}
            onChange={(e) => setFiltros({ ...filtros, idProducto: e.target.value })}
          >
            <option value="">Todos</option>
            {productos.map((p) => (
              <option key={p.idProducto} value={p.idProducto}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="filtros__acciones">
          <button type="submit" className="boton boton--secundario boton--chico">
            Buscar
          </button>
          {hayFiltros && (
            <button
              type="button"
              className="boton boton--secundario boton--chico"
              onClick={limpiarFiltros}
            >
              Limpiar
            </button>
          )}
        </div>
      </form>

      {cargando ? (
        <p className="seccion__ayuda">Cargando ventas...</p>
      ) : (
        <div className="tabla-envoltorio">
          {ventas.length === 0 ? (
            <p className="mensaje-vacio">
              {hayFiltros
                ? 'No se encontraron ventas con esos filtros.'
                : 'Todavia no se registro ninguna venta.'}
            </p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Productos</th>
                  <th className="numero">Total</th>
                  <th>Responsable</th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.idVenta}>
                    <td>{String(v.fecha).slice(0, 10)}</td>
                    <td>
                      <ul className="renglones">
                        {v.detalles.map((d) => (
                          <li key={d.idDetalleVenta}>
                            {d.cantidad} x {d.producto}
                            <span className="renglones__precio">
                              {pesos(d.precioUnitario)} c/u
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="numero">{pesos(v.total)}</td>
                    <td>{v.usuario}</td>
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
