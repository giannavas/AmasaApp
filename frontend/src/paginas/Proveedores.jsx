import { useEffect, useState } from 'react';
import { listarProveedores, crearProveedor, editarProveedor } from '../api/proveedores.js';

const FORMULARIO_VACIO = {
  razonSocial: '',
  cuit: '',
  telefono: '',
  email: '',
  direccion: '',
};

/**
 * CU-11 - Gestionar proveedores.
 *
 * Va antes que los insumos aunque tenga el numero mas alto: una materia prima
 * necesita un proveedor cargado para poder darse de alta.
 */
export default function Proveedores() {
  const [proveedores, setProveedores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // null = formulario cerrado. Si no, el id que se edita o 'nuevo' en el alta.
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
      setProveedores(await listarProveedores());
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

  function abrirEdicion(proveedor) {
    setFormulario({
      razonSocial: proveedor.razonSocial,
      cuit: proveedor.cuit ?? '',
      telefono: proveedor.telefono ?? '',
      email: proveedor.email ?? '',
      direccion: proveedor.direccion ?? '',
    });
    setErrorFormulario(null);
    setEditando(proveedor.idProveedor);
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

    if (!formulario.razonSocial.trim()) {
      return setErrorFormulario('La razon social es obligatoria');
    }

    const datos = {
      razonSocial: formulario.razonSocial.trim(),
      cuit: formulario.cuit.trim(),
      telefono: formulario.telefono.trim(),
      email: formulario.email.trim(),
      direccion: formulario.direccion.trim(),
    };

    setGuardando(true);
    try {
      if (esAlta) {
        await crearProveedor(datos);
      } else {
        await editarProveedor(editando, datos);
      }
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
          <h2>Proveedores</h2>
          <p className="seccion__ayuda">
            Quienes nos venden los insumos. Solo la razon social es obligatoria: el
            resto de los datos se completan cuando se los tiene.
          </p>
        </div>
        <button className="boton boton--primario" onClick={abrirAlta}>
          Nuevo proveedor
        </button>
      </header>

      {error && (
        <p className="mensaje-error" role="alert">
          {error}
        </p>
      )}

      {editando !== null && (
        <form className="formulario-panel" onSubmit={guardar} noValidate>
          <h3>{esAlta ? 'Nuevo proveedor' : 'Editar proveedor'}</h3>

          <div className="formulario-panel__campos">
            <div className="campo">
              <label htmlFor="razonSocial">Razon social</label>
              <input
                id="razonSocial"
                value={formulario.razonSocial}
                onChange={(e) => cambiar('razonSocial', e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="cuit">CUIT</label>
              <input
                id="cuit"
                value={formulario.cuit}
                onChange={(e) => cambiar('cuit', e.target.value)}
                placeholder="30-12345678-9"
              />
              <p className="campo__pista">Opcional, pero no puede repetirse.</p>
            </div>

            <div className="campo">
              <label htmlFor="telefono">Telefono</label>
              <input
                id="telefono"
                value={formulario.telefono}
                onChange={(e) => cambiar('telefono', e.target.value)}
              />
            </div>

            <div className="campo">
              <label htmlFor="emailProveedor">Correo electronico</label>
              <input
                id="emailProveedor"
                type="email"
                value={formulario.email}
                onChange={(e) => cambiar('email', e.target.value)}
              />
            </div>

            <div className="campo">
              <label htmlFor="direccion">Direccion</label>
              <input
                id="direccion"
                value={formulario.direccion}
                onChange={(e) => cambiar('direccion', e.target.value)}
              />
            </div>
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

      {cargando ? (
        <p className="seccion__ayuda">Cargando proveedores...</p>
      ) : (
        <div className="tabla-envoltorio">
          {proveedores.length === 0 ? (
            <p className="mensaje-vacio">No hay proveedores cargados.</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Razon social</th>
                  <th>CUIT</th>
                  <th>Telefono</th>
                  <th>Correo</th>
                  <th>Direccion</th>
                  <th>
                    <span className="visualmente-oculto">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {proveedores.map((proveedor) => (
                  <tr key={proveedor.idProveedor}>
                    <td>{proveedor.razonSocial}</td>
                    <td>{proveedor.cuit ?? '—'}</td>
                    <td>{proveedor.telefono ?? '—'}</td>
                    <td>{proveedor.email ?? '—'}</td>
                    <td>{proveedor.direccion ?? '—'}</td>
                    <td className="tabla__acciones">
                      <button
                        className="boton boton--secundario boton--chico"
                        onClick={() => abrirEdicion(proveedor)}
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
