import { useEffect, useState } from 'react';
import { obtenerSesion, cerrarSesion } from './api/sesion.js';
import Login from './paginas/Login.jsx';
import Usuarios from './paginas/Usuarios.jsx';
import './App.css';

/**
 * Decide que mostrar segun haya sesion abierta o no.
 *
 * Al cargar consulta al servidor si la cookie sigue siendo valida. Mientras
 * espera no muestra el login: si lo hiciera, alguien con la sesion abierta
 * veria el formulario un instante antes de que la pantalla lo reemplace.
 */
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [verificando, setVerificando] = useState(true);
  const [pantalla, setPantalla] = useState('inicio');

  useEffect(() => {
    obtenerSesion()
      .then(setUsuario)
      .finally(() => setVerificando(false));
  }, []);

  async function salir() {
    await cerrarSesion();
    setUsuario(null);
    setPantalla('inicio');
  }

  if (verificando) {
    return (
      <main className="cargando">
        <p>Verificando sesion...</p>
      </main>
    );
  }

  if (!usuario) {
    return <Login alEntrar={setUsuario} />;
  }

  // CU-02 es solo del Encargado. El backend lo verifica igual en cada pedido:
  // esconder el enlace evita el clic inutil, no es la medida de seguridad.
  const esEncargado = usuario.rol === 'Encargado';

  return (
    <div className="aplicacion">
      <header className="barra">
        <div className="barra__marco">
          <div className="marca">
            <h1>AmasaApp</h1>
            <p>Panificadora AmasaPan</p>
          </div>

          <nav className="navegacion" aria-label="Secciones">
            <button
              className={`navegacion__enlace ${pantalla === 'inicio' ? 'navegacion__enlace--activo' : ''}`}
              onClick={() => setPantalla('inicio')}
              aria-current={pantalla === 'inicio' ? 'page' : undefined}
            >
              Inicio
            </button>

            {esEncargado && (
              <button
                className={`navegacion__enlace ${pantalla === 'usuarios' ? 'navegacion__enlace--activo' : ''}`}
                onClick={() => setPantalla('usuarios')}
                aria-current={pantalla === 'usuarios' ? 'page' : undefined}
              >
                Usuarios
              </button>
            )}
          </nav>

          <div className="barra__sesion">
            <span className="barra__usuario">
              {usuario.nombre} · {usuario.rol}
            </span>
            <button className="boton boton--secundario boton--chico" onClick={salir}>
              Cerrar sesion
            </button>
          </div>
        </div>
      </header>

      <main className="contenido">
        {pantalla === 'usuarios' && esEncargado ? (
          <Usuarios usuarioActual={usuario} />
        ) : (
          <section className="panel">
            <h2 className="panel__titulo">Sesion iniciada</h2>
            <dl className="datos-usuario">
              <dt>Usuario</dt><dd>{usuario.nombre}</dd>
              <dt>Correo</dt><dd>{usuario.email}</dd>
              <dt>Rol</dt><dd>{usuario.rol}</dd>
            </dl>
            <p className="proximo">
              Las pantallas de insumos, produccion y ventas se incorporan en los
              sprints siguientes.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
