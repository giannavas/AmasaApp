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
/* Iconos del menu: trazos de 24x24 dibujados con linea, sin relleno, para
   que tomen el color del texto del boton. */
const ICONOS = {
  marca: ['M12 21V8', 'M12 8c0-2.5 1.5-4.5 3.5-5c.3 2.5-1 4.6-3.5 5Z', 'M12 8c0-2.5-1.5-4.5-3.5-5c-.3 2.5 1 4.6 3.5 5Z', 'M12 13c1-2.3 3-3.6 5.3-3.4c-.6 2.4-2.6 3.8-5.3 3.4Z', 'M12 13c-1-2.3-3-3.6-5.3-3.4c.6 2.4 2.6 3.8 5.3 3.4Z'],
  inicio: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  ventas: ['M6 2h12v20l-3-2-3 2-3-2-3 2z', 'M9 7h6', 'M9 11h6', 'M9 15h4'],
  produccion: ['M3 5h18v15H3z', 'M3 9h18', 'M7 13h10v4H7z'],
  alertas: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  insumos: ['M21 8l-9-5-9 5v8l9 5 9-5z', 'M3 8l9 5 9-5', 'M12 13v8'],
  productos: ['M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z', 'M7.5 7.5h.01'],
  recetas: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  proveedores: ['M1 4h14v12H1z', 'M15 8h4l3 3v5h-7z', 'M7.5 18.5a2 2 0 1 1-4 0a2 2 0 0 1 4 0', 'M20.5 18.5a2 2 0 1 1-4 0a2 2 0 0 1 4 0'],
  usuarios: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 1 0 8a4 4 0 0 1 0-8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  salir: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
};

const GRUPOS_MENU = [
  { titulo: 'Día a día', claves: ['inicio', 'ventas', 'produccion', 'alertas'] },
  { titulo: 'Gestión', claves: ['insumos', 'productos', 'recetas', 'proveedores', 'usuarios'] },
];

function Icono({ trazos }) {
  return (
    <svg className="icono" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {trazos.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

function iniciales(nombre) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [verificando, setVerificando] = useState(true);
  const [pantalla, setPantalla] = useState('inicio');
  const [resumenAlertas, setResumenAlertas] = useState(null);

  useEffect(() => {
    obtenerSesion()
      .then(setUsuario)
      // Sin servidor la promesa rechaza; se cae al login en vez de quedar
      // colgada con un error sin atender en la consola.
      .catch(() => setUsuario(null))
      .finally(() => setVerificando(false));
  }, []);

  const esEncargado = usuario?.rol === 'Encargado';

  /* CU-10: el aviso de alertas de la barra se actualiza al entrar y cada vez
     que se cambia de pantalla. Es el momento en que el stock pudo haber
     cambiado (se vendio, se produjo o se compro algo) y no hace falta
     consultar al servidor cada pocos segundos para enterarse. */
  useEffect(() => {
    if (!esEncargado) return;
    /* Si la consulta falla no se deja el aviso en blanco: sin contador, el
       Encargado lee "no hay alertas" justo cuando el sistema no pudo
       fijarse. Se marca el fallo y la barra muestra un signo en vez de un
       numero. */
    obtenerResumenAlertas()
      .then(setResumenAlertas)
      .catch(() => setResumenAlertas({ total: 0, criticas: 0, fallo: true }));
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
    ...(puedeProducir ? [{ clave: 'produccion', texto: 'Producción' }] : []),
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
      <aside className="barra">
        <div className="marca">
          <span className="marca__logo"><Icono trazos={ICONOS.marca} /></span>
          <div>
            <h1>AmasaApp</h1>
            <p>Panificadora AmasaPan</p>
          </div>
        </div>

        {/* El menu se agrupa en lo que se usa todo el dia (atender, hornear,
            mirar alertas) y la administracion, que se toca de vez en cuando.
            Los grupos son solo visuales: las secciones son las mismas. */}
        <nav className="navegacion" aria-label="Secciones">
          {GRUPOS_MENU.map(({ titulo, claves }) => {
            const enGrupo = secciones.filter((s) => claves.includes(s.clave));
            if (enGrupo.length === 0) return null;
            return (
              <div key={titulo} className="navegacion__grupo">
                <p className="navegacion__titulo">{titulo}</p>
                {enGrupo.map(({ clave, texto }) => (
                  <button
                    key={clave}
                    className={`navegacion__enlace ${pantalla === clave ? 'navegacion__enlace--activo' : ''}`}
                    onClick={() => setPantalla(clave)}
                    aria-current={pantalla === clave ? 'page' : undefined}
                  >
                    <Icono trazos={ICONOS[clave]} />
                    <span className="navegacion__texto">{texto}</span>
                    {clave === 'alertas' && (resumenAlertas?.fallo || resumenAlertas?.total > 0) && (
                      <span
                        className={`navegacion__contador ${
                          resumenAlertas.fallo || resumenAlertas.criticas > 0
                            ? 'navegacion__contador--error'
                            : ''
                        }`}
                      >
                        {resumenAlertas.fallo ? '!' : resumenAlertas.total}
                        <span className="visualmente-oculto">
                          {resumenAlertas.fallo
                            ? ' no se pudieron consultar las alertas'
                            : ' alertas activas'}
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="barra__sesion">
          <span className="barra__avatar" aria-hidden="true">{iniciales(usuario.nombre)}</span>
          <div className="barra__usuario">
            <span className="barra__nombre">{usuario.nombre}</span>
            <span className="barra__rol">{usuario.rol}</span>
          </div>
          <button className="barra__salir" onClick={salir} aria-label="Cerrar sesión" title="Cerrar sesión">
            <Icono trazos={ICONOS.salir} />
          </button>
        </div>
      </aside>

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
