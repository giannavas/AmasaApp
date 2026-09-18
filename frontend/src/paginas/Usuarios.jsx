import { useEffect, useState } from 'react';
import {
  listarUsuarios,
  crearUsuario,
  editarUsuario,
  cambiarEstado,
} from '../api/usuarios.js';

const ROLES = ['Venta', 'Panificador', 'Encargado'];
const LARGO_MINIMO_CLAVE = 8;

const FORMULARIO_VACIO = {
  nombre: '',
  email: '',
  rol: 'Venta',
  password: '',
  repetirPassword: '',
};

/**
 * CU-02 - Gestion de usuarios.
 *
 * Solo la abre un Encargado. El backend igual verifica el rol en cada pedido:
 * ocultar la pantalla es comodidad, no seguridad, porque cualquiera puede
 * escribir la direccion a mano.
 */
export default function Usuarios({ usuarioActual }) {
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // null = formulario cerrado. Si no, trae el id del usuario que se edita,
  // o 'nuevo' cuando es un alta.
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
      setUsuarios(await listarUsuarios());
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

  function abrirEdicion(usuario) {
    setFormulario({
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      password: '',
      repetirPassword: '',
    });
    setErrorFormulario(null);
    setEditando(usuario.idUsuario);
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
    const email = formulario.email.trim().toLowerCase();

    if (!nombre || !email) {
      return setErrorFormulario('Completa el nombre y el correo');
    }

    /* En el alta se comprueban las dos contraseñas antes de llamar al
       servidor. No reemplaza a la validacion del backend, pero evita que un
       error de tipeo se descubra recien despues de mandar el formulario. */
    if (esAlta) {
      if (formulario.password.length < LARGO_MINIMO_CLAVE) {
        return setErrorFormulario(
          `La contraseña necesita al menos ${LARGO_MINIMO_CLAVE} caracteres`
        );
      }
      if (formulario.password !== formulario.repetirPassword) {
        return setErrorFormulario('Las dos contraseñas no coinciden');
      }
    }

    setGuardando(true);
    try {
      if (esAlta) {
        await crearUsuario({ nombre, email, rol: formulario.rol, password: formulario.password });
      } else {
        await editarUsuario(editando, { nombre, email, rol: formulario.rol });
      }
      cerrarFormulario();
      await cargar();
    } catch (fallo) {
      setErrorFormulario(fallo.message);
    } finally {
      setGuardando(false);
    }
  }

  async function alternarEstado(usuario) {
    setError(null);
    try {
      const actualizado = await cambiarEstado(usuario.idUsuario, !usuario.activo);
      setUsuarios((previos) =>
        previos.map((u) => (u.idUsuario === actualizado.idUsuario ? actualizado : u))
      );
    } catch (fallo) {
      setError(fallo.message);
    }
  }

  return (
    <section className="seccion">
      <header className="seccion__encabezado">
        <div>
          <h2>Usuarios</h2>
          <p className="seccion__ayuda">
            Altas, bajas y cambios de rol. Desactivar a alguien le corta el acceso
            en el momento.
          </p>
        </div>
        <button className="boton boton--primario" onClick={abrirAlta}>
          Nuevo usuario
        </button>
      </header>

      {error && (
        <p className="mensaje-error" role="alert">
          {error}
        </p>
      )}

      {editando !== null && (
        <form className="formulario-panel" onSubmit={guardar} noValidate>
          <h3>{esAlta ? 'Nuevo usuario' : 'Editar usuario'}</h3>

          <div className="campo">
            <label htmlFor="nombre">Nombre</label>
            <input
              id="nombre"
              value={formulario.nombre}
              onChange={(e) => cambiar('nombre', e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="campo">
            <label htmlFor="email">Correo electronico</label>
            <input
              id="email"
              type="email"
              value={formulario.email}
              onChange={(e) => cambiar('email', e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="campo">
            <label htmlFor="rol">Rol</label>
            <select
              id="rol"
              value={formulario.rol}
              onChange={(e) => cambiar('rol', e.target.value)}
            >
              {ROLES.map((rol) => (
                <option key={rol} value={rol}>
                  {rol}
                </option>
              ))}
            </select>
          </div>

          {esAlta && (
            <>
              <div className="campo">
                <label htmlFor="password">Contraseña inicial</label>
                <input
                  id="password"
                  type="password"
                  value={formulario.password}
                  onChange={(e) => cambiar('password', e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <p className="campo__pista">Minimo {LARGO_MINIMO_CLAVE} caracteres.</p>
              </div>

              <div className="campo">
                <label htmlFor="repetirPassword">Repetir contraseña</label>
                <input
                  id="repetirPassword"
                  type="password"
                  value={formulario.repetirPassword}
                  onChange={(e) => cambiar('repetirPassword', e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </>
          )}

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
        <p className="seccion__ayuda">Cargando usuarios...</p>
      ) : (
        <div className="tabla-envoltorio">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>
                  <span className="visualmente-oculto">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((usuario) => {
                const esUnoMismo = usuario.idUsuario === usuarioActual.idUsuario;
                return (
                  <tr key={usuario.idUsuario}>
                    <td>{usuario.nombre}</td>
                    <td>{usuario.email}</td>
                    <td>{usuario.rol}</td>
                    <td>
                      {/* La etiqueta lleva color y texto. Con el color solo,
                          quien no distingue rojo de verde no puede leerla. */}
                      <span
                        className={`etiqueta ${
                          usuario.activo ? 'etiqueta--ok' : 'etiqueta--neutro'
                        }`}
                      >
                        {usuario.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="tabla__acciones">
                      <button
                        className="boton boton--secundario boton--chico"
                        onClick={() => abrirEdicion(usuario)}
                      >
                        Editar
                      </button>
                      <button
                        className="boton boton--secundario boton--chico"
                        onClick={() => alternarEstado(usuario)}
                        disabled={esUnoMismo}
                        title={
                          esUnoMismo
                            ? 'No podes desactivar tu propio usuario'
                            : undefined
                        }
                      >
                        {usuario.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
