import { useState } from 'react';
import { iniciarSesion } from '../api/sesion.js';
import './Login.css';

/**
 * CU-01 - Iniciar sesion.
 *
 * A diferencia del prototipo, no trae usuario ni contraseña precargados:
 * las credenciales son reales y se validan contra la base de datos.
 */
export default function Login({ alEntrar }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const usuario = await iniciarSesion(email.trim().toLowerCase(), password);
      alEntrar(usuario);
    } catch (fallo) {
      setError(fallo.message);
      setPassword('');
      setEnviando(false);
    }
  }

  return (
    <main className="login">
      <section className="login__portada" aria-label="AmasaApp">
        <div className="login__marca">
          <span className="login__logo" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21V8" />
              <path d="M12 8c0-2.5 1.5-4.5 3.5-5c.3 2.5-1 4.6-3.5 5Z" />
              <path d="M12 8c0-2.5-1.5-4.5-3.5-5c-.3 2.5 1 4.6 3.5 5Z" />
              <path d="M12 13c1-2.3 3-3.6 5.3-3.4c-.6 2.4-2.6 3.8-5.3 3.4Z" />
              <path d="M12 13c-1-2.3-3-3.6-5.3-3.4c.6 2.4 2.6 3.8 5.3 3.4Z" />
              <path d="M12 18c1-2.3 3-3.6 5.3-3.4c-.6 2.4-2.6 3.8-5.3 3.4Z" />
              <path d="M12 18c-1-2.3-3-3.6-5.3-3.4c.6 2.4 2.6 3.8 5.3 3.4Z" />
            </svg>
          </span>
          <div>
            <h1>AmasaApp</h1>
            <p>Panificadora AmasaPan</p>
          </div>
        </div>
        <div className="login__lema">
          <p className="login__titular">Del horno al mostrador, todo en un lugar.</p>
          <p>Insumos, recetas, producción, ventas y alertas de stock. Cada movimiento actualiza el stock y los costos solo.</p>
        </div>
      </section>

      <form className="login__tarjeta" onSubmit={enviar} noValidate>
        <header className="login__saludo">
          <h2>Buen día</h2>
          <p>Ingresá con tu correo para empezar el turno.</p>
        </header>

        <div className="campo">
          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </div>

        <div className="campo">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {/* aria-live avisa a los lectores de pantalla cuando aparece el error,
            que si no pasaria desapercibido para quien no ve la pantalla. */}
        <p className="login__error" role="alert" aria-live="polite">
          {error}
        </p>

        <button type="submit" className="boton boton--primario" disabled={enviando}>
          {enviando ? 'Verificando...' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}
