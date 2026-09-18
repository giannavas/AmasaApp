import { useEffect, useState } from 'react';
import { obtenerSesion, cerrarSesion } from './api/sesion.js';
import Login from './paginas/Login.jsx';
import Usuarios from './paginas/Usuarios.jsx';
import Proveedores from './paginas/Proveedores.jsx';
import Insumos from './paginas/Insumos.jsx';
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

  // Insumos, proveedores y usuarios son secciones del Encargado. El backend lo
  // verifica igual en cada pedido: esconder el enlace evita el clic inutil, no
  // es la medida de seguridad.
  const esEncargado = usuario.rol === 'Encargado';

  const secciones = [
    { clave: 'inicio', texto: 'Inicio' },
    ...(esEncargado
      ? [
          { clave: 'insumos', texto: 'Insumos' },
          { clave: 'proveedores', texto: 'Proveedores' },
          { clave: 'usuarios', texto: 'Usuarios' },
        ]
      : []),
  ];

  // Si el rol no habilita la pantalla elegida, se cae a Inicio.
  const seccionValida = secciones.some((s) => s.clave === pantalla) ? pantalla : 'inicio';

  return (
    <div className="aplicacion">
      <header className="barra">
        <div className="barra__marco">
          <div className="marca">
            <h1>AmasaApp</h1>
            <p>Panificadora AmasaPan</p>
          </div>

          <nav className="navegacion" aria-label="Secciones">
            {secciones.map(({ clave, texto }) => (
              <button
                key={clave}
                className={`navegacion__enlace ${pantalla === clave ? 'navegacion__enlace--activo' : ''}`}
                onClick={() => setPantalla(clave)}
                aria-current={pantalla === clave ? 'page' : undefined}
              >
                {texto}
              </button>
            ))}
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
        {seccionValida === 'usuarios' ? (
          <Usuarios usuarioActual={usuario} />
        ) : seccionValida === 'proveedores' ? (
          <Proveedores />
        ) : seccionValida === 'insumos' ? (
          <Insumos />
        ) : (
          <section className="panel">
            <h2 className="panel__titulo">Sesion iniciada</h2>
            <dl className="datos-usuario">
              <dt>Usuario</dt><dd>{usuario.nombre}</dd>
              <dt>Correo</dt><dd>{usuario.email}</dd>
              <dt>Rol</dt><dd>{usuario.rol}</dd>
            </dl>
            <p className="proximo">
              Las pantallas de produccion, ventas y alertas se incorporan en los
              sprints siguientes.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
