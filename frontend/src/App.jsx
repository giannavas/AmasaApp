import { useEffect, useState } from 'react';
import { obtenerSesion, cerrarSesion } from './api/sesion.js';
import Login from './paginas/Login.jsx';
import Usuarios from './paginas/Usuarios.jsx';
import Proveedores from './paginas/Proveedores.jsx';
import Insumos from './paginas/Insumos.jsx';
import Productos from './paginas/Productos.jsx';
import Recetas from './paginas/Recetas.jsx';
import Produccion from './paginas/Produccion.jsx';
import Ventas from './paginas/Ventas.jsx';
import Alertas from './paginas/Alertas.jsx';
import Panel from './paginas/Panel.jsx';
import { obtenerResumenAlertas } from './api/alertas.js';
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
  const [resumenAlertas, setResumenAlertas] = useState(null);

  useEffect(() => {
    obtenerSesion()
      .then(setUsuario)
      .finally(() => setVerificando(false));
  }, []);

  const esEncargado = usuario?.rol === 'Encargado';

  /* CU-09: el aviso de alertas de la barra se actualiza al entrar y cada vez
     que se cambia de pantalla. Es el momento en que el stock pudo haber
     cambiado (se vendio, se produjo o se compro algo) y no hace falta
     consultar al servidor cada pocos segundos para enterarse. */
  useEffect(() => {
    if (!esEncargado) return;
    obtenerResumenAlertas()
      .then(setResumenAlertas)
      .catch(() => setResumenAlertas(null));
  }, [esEncargado, pantalla]);

  async function salir() {
    await cerrarSesion();
    setUsuario(null);
    setResumenAlertas(null);
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

  // Alertas, insumos, proveedores y usuarios son secciones del Encargado
  // (esEncargado se calcula mas arriba porque lo usa el aviso de alertas). El
  // backend lo verifica igual en cada pedido: esconder el enlace evita el clic
  // inutil, no es la medida de seguridad.

  // CU-06 tambien lo opera el Panificador; el resto es administracion.
  const puedeProducir = esEncargado || usuario.rol === 'Panificador';

  /* CU-07 y CU-08 son de los tres roles: el mostrador vende, pero el
     Panificador y el Encargado tambien registran ventas cuando atienden. */
  const secciones = [
    { clave: 'inicio', texto: 'Inicio' },
    { clave: 'ventas', texto: 'Ventas' },
    ...(puedeProducir ? [{ clave: 'produccion', texto: 'Produccion' }] : []),
    ...(esEncargado
      ? [
          { clave: 'alertas', texto: 'Alertas' },
          { clave: 'insumos', texto: 'Insumos' },
          { clave: 'productos', texto: 'Productos' },
          { clave: 'recetas', texto: 'Recetas' },
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
                {clave === 'alertas' && resumenAlertas?.total > 0 && (
                  <span
                    className={`navegacion__contador ${resumenAlertas.criticas > 0 ? 'navegacion__contador--error' : ''}`}
                  >
                    {resumenAlertas.total}
                    <span className="visualmente-oculto"> alertas activas</span>
                  </span>
                )}
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
        {seccionValida === 'alertas' ? (
          <Alertas alCambiarResumen={setResumenAlertas} />
        ) : seccionValida === 'usuarios' ? (
          <Usuarios usuarioActual={usuario} />
        ) : seccionValida === 'proveedores' ? (
          <Proveedores />
        ) : seccionValida === 'insumos' ? (
          <Insumos />
        ) : seccionValida === 'productos' ? (
          <Productos />
        ) : seccionValida === 'recetas' ? (
          <Recetas />
        ) : seccionValida === 'produccion' ? (
          <Produccion />
        ) : seccionValida === 'ventas' ? (
          <Ventas />
        ) : esEncargado ? (
          /* CU-12: el Encargado entra directo a su panel de control. */
          <Panel usuario={usuario} alIrA={setPantalla} />
        ) : (
          /* Venta y Panificador no tienen panel: el inicio les muestra su
             sesion y los lleva en un clic a las secciones que usan. */
          <section className="panel">
            <h2 className="panel__titulo">Sesion iniciada</h2>
            <dl className="datos-usuario">
              <dt>Usuario</dt><dd>{usuario.nombre}</dd>
              <dt>Correo</dt><dd>{usuario.email}</dd>
              <dt>Rol</dt><dd>{usuario.rol}</dd>
            </dl>
            <div className="accesos">
              {secciones
                .filter((s) => s.clave !== 'inicio')
                .map(({ clave, texto }) => (
                  <button
                    key={clave}
                    className="boton boton--primario"
                    onClick={() => setPantalla(clave)}
                  >
                    Ir a {texto}
                  </button>
                ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
