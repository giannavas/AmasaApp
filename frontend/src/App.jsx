import { useEffect, useState } from 'react';

/**
 * Pantalla de verificacion del entorno.
 *
 * Es provisoria: existe para confirmar que el frontend, el backend y la base
 * de datos se comunican entre si. En el Sprint 1 la reemplaza la pantalla de
 * inicio de sesion (CU-01).
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
    <main className="contenedor">
      <h1>AmasaApp</h1>
      <p className="subtitulo">Sistema de administracion de panificadora</p>

      <section className="tarjeta">
        <h2>Estado del entorno</h2>

        {estado.cargando && <p>Verificando la conexion...</p>}

        {estado.error && (
          <>
            <p className="error">Sin conexion con el backend</p>
            <p className="detalle">{estado.error}</p>
            <p className="ayuda">
              Verifica que el backend este corriendo: <code>cd backend &amp;&amp; npm start</code>
            </p>
          </>
        )}

        {estado.datos && (
          <ul className="lista-estado">
            <li><span className="ok">OK</span> Frontend (React + Vite)</li>
            <li><span className="ok">OK</span> Backend (Express)</li>
            <li>
              <span className="ok">OK</span> Base de datos ({estado.datos.baseDeDatos})
            </li>
            <li className="hora">Hora del servidor: {estado.datos.hora}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
