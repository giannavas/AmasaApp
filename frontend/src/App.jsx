import { useEffect, useState } from 'react';
import { obtenerSesion, cerrarSesion } from './api/sesion.js';
import Login from './paginas/Login.jsx';
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

  useEffect(() => {
    obtenerSesion()
      .then(setUsuario)
      .finally(() => setVerificando(false));
  }, []);

  async function salir() {
    await cerrarSesion();
    setUsuario(null);
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

  return (
    <main className="sesion-abierta">
      <div className="sesion-abierta__marco">
        <header className="marca">
          <h1>AmasaApp</h1>
          <p>Panificadora AmasaPan</p>
        </header>

        <section className="panel">
          <h2 className="panel__titulo">Sesion iniciada</h2>
          <dl className="datos-usuario">
            <dt>Usuario</dt><dd>{usuario.nombre}</dd>
            <dt>Correo</dt><dd>{usuario.email}</dd>
            <dt>Rol</dt><dd>{usuario.rol}</dd>
          </dl>
          <button className="boton boton--secundario" onClick={salir}>
            Cerrar sesion
          </button>
        </section>

        <p className="proximo">
          Las pantallas del sistema se incorporan en los sprints siguientes.
        </p>
      </div>
    </main>
  );
}
