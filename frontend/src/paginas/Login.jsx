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
      <form className="login__tarjeta" onSubmit={enviar} noValidate>
        <header className="login__marca">
          <h1>AmasaApp</h1>
          <p>Panificadora AmasaPan</p>
        </header>

        <div className="campo">
          <label htmlFor="email">Correo electronico</label>
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
