import { useEffect, useState } from 'react';
import './App.css';

/**
 * Pantalla de verificacion del entorno.
 *
 * Confirma que el frontend, el backend y la base de datos se comunican entre
 * si. Es provisoria: en el Sprint 1 la reemplaza el inicio de sesion (CU-01).
 */
export default function App() {
  const [estado, setEstado] = useState({ cargando: true });

  useEffect(() => {
    // La llamada va a /api, que vite.config.js redirige al backend.
    fetch('/api/salud')
      .then((respuesta) => {
        if (!respuesta.ok) throw new Error(`El servidor respondio ${respuesta.status}`);
        return respuesta.json();
      })
      .then((datos) => setEstado({ cargando: false, datos }))
      .catch((error) => setEstado({ cargando: false, error: error.message }));
  }, []);

  return (
    <main className="pantalla-estado">
      <div className="pantalla-estado__marco">
        <header className="marca">
          <h1>AmasaApp</h1>
          <p>Panificadora AmasaPan</p>
        </header>

        <section className="panel">
          <h2 className="panel__titulo">Estado del entorno</h2>

          {estado.cargando && <p>Verificando la conexion...</p>}

          {estado.error && (
            <>
              <p className="aviso-error">Sin conexion con el backend</p>
              <p className="aviso-detalle">{estado.error}</p>
              <p className="aviso-detalle">
                Levanta el servidor con <code>cd backend &amp;&amp; npm run dev</code>
              </p>
            </>
          )}

          {estado.datos && (
            <>
              <ul className="capas">
                <li className="capa">
                  <span className="etiqueta">Activo</span>
                  <span>Frontend — React y Vite</span>
                </li>
                <li className="capa">
                  <span className="etiqueta">Activo</span>
                  <span>Backend — Express</span>
                </li>
                <li className="capa">
                  <span className="etiqueta">Activo</span>
                  <span>Base de datos — PostgreSQL</span>
                </li>
              </ul>
              <p className="hora">
                Hora del servidor{' '}
                <span className="dato">
                  {new Date(estado.datos.hora).toLocaleString('es-AR')}
                </span>
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
