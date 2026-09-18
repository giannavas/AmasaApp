import { useEffect, useState } from 'react';
import {
  listarMateriasPrimas,
  crearMateriaPrima,
  editarMateriaPrima,
} from '../api/materiasPrimas.js';
import { listarProveedores } from '../api/proveedores.js';

const ESTADOS = ['OK', 'Critico', 'Sobrestock'];

const ORDENES = [
  { valor: 'nombre', texto: 'Nombre' },
  { valor: 'stock', texto: 'Stock' },
  { valor: 'estado', texto: 'Estado' },
];

const FORMULARIO_VACIO = {
  nombre: '',
  unidadMedida: 'kg',
  stockMinimo: '',
  stockMaximo: '',
  cantidad: '',
  precioUnitario: '',
  fechaVencimiento: '',
  idProveedor: '',
};

/** Traduce el estado que manda el servidor a la clase de color que le toca. */
const CLASE_ESTADO = {
  OK: 'etiqueta--ok',
  Critico: 'etiqueta--error',
  Sobrestock: 'etiqueta--aviso',
};

/** Con acento para mostrar, sin acento para comparar con lo que da la API. */
const TEXTO_ESTADO = {
  OK: 'OK',
  Critico: 'Critico',
  Sobrestock: 'Sobrestock',
};

/**
 * CU-03, CU-04 y CU-05 - Insumos.
 *
 * Las tres van juntas en una pantalla porque son la misma tabla vista de tres
 * maneras: el listado con su estado, el alta y la edicion.
 */
export default function Insumos() {
  const [materiasPrimas, setMateriasPrimas] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // Filtros de CU-05.
  const [filtroEstado, setFiltroEstado] = useState('');
  const [orden, setOrden] = useState('nombre');

  const [editando, setEditando] = useState(null);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
  const [errorFormulario, setErrorFormulario] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const esAlta = editando === 'nuevo';

  useEffect(() => {
    cargar();
  }, [filtroEstado, orden]);

  useEffect(() => {
    listarProveedores().then(setProveedores).catch(() => setProveedores([]));
  }, []);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      setMateriasPrimas(await listarMateriasPrimas({ estado: filtroEstado, orden }));
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  function abrirAlta() {
    setFormulario({ ...FORMULARIO_VACIO, idProveedor: String(proveedores[0]?.idProveedor ?? '') });
    setErrorFormulario(null);
    setEditando('nuevo');
  }

  function abrirEdicion(materiaPrima) {
    setFormulario({
      ...FORMULARIO_VACIO,
      nombre: materiaPrima.nombre,
      unidadMedida: materiaPrima.unidadMedida,
      stockMinimo: String(materiaPrima.stockMinimo),
      stockMaximo: String(materiaPrima.stockMaximo),
      idProveedor: String(materiaPrima.idProveedorHabitual ?? ''),
    });
    setErrorFormulario(null);
    setEditando(materiaPrima.idMateriaPrima);
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
    const unidadMedida = formulario.unidadMedida.trim();
    const minimo = Number(formulario.stockMinimo);
    const maximo = Number(formulario.stockMaximo);

    if (!nombre || !unidadMedida) {
      return setErrorFormulario('Completa el nombre y la unidad de medida');
    }
    if (!Number.isFinite(minimo) || !Number.isFinite(maximo)) {
      return setErrorFormulario('Completa los umbrales de stock');
    }
    if (maximo < minimo) {
      return setErrorFormulario('El stock maximo no puede ser menor que el minimo');
    }

    setGuardando(true);
    try {
      if (esAlta) {
        const cantidad = Number(formulario.cantidad);
        const precioUnitario = Number(formulario.precioUnitario);

        if (!Number.isFinite(cantidad) || cantidad <= 0) {
          throw new Error('La cantidad inicial tiene que ser mayor que cero');
        }
        if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
          throw new Error('El precio unitario no es valido');
        }
        if (!formulario.idProveedor) {
          throw new Error('Elegi un proveedor');
        }

        await crearMateriaPrima({
          nombre,
          unidadMedida,
          stockMinimo: minimo,
          stockMaximo: maximo,
          cantidad,
          precioUnitario,
          fechaVencimiento: formulario.fechaVencimiento || null,
          idProveedor: Number(formulario.idProveedor),
        });
      } else {
        await editarMateriaPrima(editando, {
          nombre,
          unidadMedida,
          stockMinimo: minimo,
          stockMaximo: maximo,
          idProveedorHabitual: formulario.idProveedor ? Number(formulario.idProveedor) : null,
        });
      }
      cerrarFormulario();
      await cargar();
    } catch (fallo) {
      setErrorFormulario(fallo.message);
    } finally {
      setGuardando(false);
    }
  }

  const sinProveedores = proveedores.length === 0;

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Insumos</h2>
          <p className="seccion__ayuda">
            Inventario de materias primas con su estado segun los umbrales de cada
            una. El stock solo cambia con las entradas de mercaderia y la produccion,
            nunca editando la ficha.
          </p>
        </div>
        <button className="boton boton--primario" onClick={abrirAlta} disabled={sinProveedores}>
          Nuevo insumo
        </button>
      </header>

      {/* Sin proveedores no se puede dar de alta un insumo, porque la entrada
          de mercaderia necesita saber a quien se le compro. */}
      {sinProveedores && (
        <p className="seccion__ayuda">
          Para cargar un insumo primero hace falta registrar al menos un proveedor.
        </p>
      )}

      {error && (
        <p className="mensaje-error" role="alert">
          {error}
        </p>
      )}

      {editando !== null && (
        <form className="formulario-panel" onSubmit={guardar} noValidate>
          <h3>{esAlta ? 'Nuevo insumo' : 'Editar insumo'}</h3>

          <div className="formulario-panel__campos">
            <div className="campo">
              <label htmlFor="nombreInsumo">Nombre</label>
              <input
                id="nombreInsumo"
                value={formulario.nombre}
                onChange={(e) => cambiar('nombre', e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="unidadMedida">Unidad de medida</label>
              <input
                id="unidadMedida"
                value={formulario.unidadMedida}
                onChange={(e) => cambiar('unidadMedida', e.target.value)}
                placeholder="kg, g, l, unidad"
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="stockMinimo">Stock minimo</label>
              <input
                id="stockMinimo"
                type="number"
                min="0"
                step="0.01"
                value={formulario.stockMinimo}
                onChange={(e) => cambiar('stockMinimo', e.target.value)}
                required
              />
              <p className="campo__pista">Por debajo de este valor, el insumo es critico.</p>
            </div>

            <div className="campo">
              <label htmlFor="stockMaximo">Stock maximo</label>
              <input
                id="stockMaximo"
                type="number"
                min="0"
                step="0.01"
                value={formulario.stockMaximo}
                onChange={(e) => cambiar('stockMaximo', e.target.value)}
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="idProveedor">Proveedor</label>
              <select
                id="idProveedor"
                value={formulario.idProveedor}
                onChange={(e) => cambiar('idProveedor', e.target.value)}
                required={esAlta}
              >
                {!esAlta && <option value="">Sin proveedor habitual</option>}
                {proveedores.map((p) => (
                  <option key={p.idProveedor} value={p.idProveedor}>
                    {p.razonSocial}
                  </option>
                ))}
              </select>
            </div>

            {/* Estos tres campos son de la primera entrada de mercaderia, no de
                la ficha del insumo. Por eso solo aparecen en el alta. */}
            {esAlta && (
              <>
                <div className="campo">
                  <label htmlFor="cantidad">Cantidad inicial</label>
                  <input
                    id="cantidad"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={formulario.cantidad}
                    onChange={(e) => cambiar('cantidad', e.target.value)}
                    required
                  />
                </div>

                <div className="campo">
                  <label htmlFor="precioUnitario">Precio unitario</label>
                  <input
                    id="precioUnitario"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formulario.precioUnitario}
                    onChange={(e) => cambiar('precioUnitario', e.target.value)}
                    required
                  />
                </div>

                <div className="campo">
                  <label htmlFor="fechaVencimiento">Fecha de vencimiento</label>
                  <input
                    id="fechaVencimiento"
                    type="date"
                    value={formulario.fechaVencimiento}
                    onChange={(e) => cambiar('fechaVencimiento', e.target.value)}
                  />
                  <p className="campo__pista">Opcional.</p>
                </div>
              </>
            )}
          </div>

          {errorFormulario && (
            <p className="mensaje-error" role="alert" aria-live="polite">
              {errorFormulario}
            </p>
          )}

          <div className="formulario-panel__acciones">
            <button type="submit" className="boton boton--primario" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              className="boton boton--secundario"
              onClick={cerrarFormulario}
              disabled={guardando}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Filtros de CU-05 */}
      <div className="formulario-panel__campos">
        <div className="campo">
          <label htmlFor="filtroEstado">Filtrar por estado</label>
          <select
            id="filtroEstado"
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
          >
            <option value="">Todos</option>
            {ESTADOS.map((estado) => (
              <option key={estado} value={estado}>
                {TEXTO_ESTADO[estado]}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="orden">Ordenar por</label>
          <select id="orden" value={orden} onChange={(e) => setOrden(e.target.value)}>
            {ORDENES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </select>
        </div>
      </div>

      {cargando ? (
        <p className="seccion__ayuda">Cargando insumos...</p>
      ) : (
        <div className="tabla-envoltorio">
          {materiasPrimas.length === 0 ? (
            <p className="mensaje-vacio">
              {filtroEstado
                ? `No hay insumos en estado ${TEXTO_ESTADO[filtroEstado]}.`
                : 'No hay insumos cargados.'}
            </p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th className="numero">Stock</th>
                  <th className="numero">Minimo</th>
                  <th className="numero">Maximo</th>
                  <th className="numero">Costo prom.</th>
                  <th>Proveedor</th>
                  <th>Estado</th>
                  <th>
                    <span className="visualmente-oculto">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {materiasPrimas.map((m) => (
                  <tr key={m.idMateriaPrima}>
                    <td>{m.nombre}</td>
                    <td className="numero">
                      {m.stockActual} {m.unidadMedida}
                    </td>
                    <td className="numero">{m.stockMinimo}</td>
                    <td className="numero">{m.stockMaximo}</td>
                    <td className="numero">$ {m.costoPromedio}</td>
                    <td>{m.proveedorHabitual ?? '—'}</td>
                    <td>
                      <span className={`etiqueta ${CLASE_ESTADO[m.estado] ?? 'etiqueta--neutro'}`}>
                        {TEXTO_ESTADO[m.estado] ?? m.estado}
                      </span>
                    </td>
                    <td className="tabla__acciones">
                      <button
                        className="boton boton--secundario boton--chico"
                        onClick={() => abrirEdicion(m)}
                      >
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
