import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* Matriz de permisos: que puede y que no puede cada rol en cada ruta.

   Las demas pruebas cubren el control de acceso "por el lado de lo que no se
   puede": casi todas esperan un 403. Eso deja un hueco, porque un permiso de
   mas se ve exactamente igual que seguridad que funciona — nada se pone rojo
   cuando a un rol le falta un permiso que necesita. Asi sobrevivio seis
   sprints el bug del Panificador, que no podia leer las recetas y por lo tanto
   no podia producir, aunque el POST de produccion si lo autorizaba.

   Por eso esta prueba recorre la matriz en las dos direcciones, y cierra con
   lo que de verdad importa: que cada rol pueda completar las pantallas que su
   menu le ofrece. Prefijos ZTM y matriz. para no chocar con los demas
   archivos, que corren en paralelo sobre la misma base. */

let servidor, base;
const cookies = {};

const CLAVE = 'matriz2026';
const USUARIOS = {
  encargado: ['matriz.encargado@amasapan.test', 'Encargado'],
  panificador: ['matriz.panificador@amasapan.test', 'Panificador'],
  venta: ['matriz.venta@amasapan.test', 'Venta'],
};

/* Lo que espera cada celda de la matriz:
     'ok'  -> el rol pasa el portero. En las escrituras no exigimos un 2xx,
              porque mandamos un cuerpo vacio a proposito: lo que se prueba es
              la autorizacion, no la validacion. Basta con que no sea 401/403.
     403   -> el rol queda afuera. */
const E = 'encargado', P = 'panificador', V = 'venta';

const MATRIZ = [
  // [metodo, ruta, cuerpo, { rol: esperado }]
  ['GET', '/api/usuarios', null, { [E]: 'ok', [P]: 403, [V]: 403 }],
  ['POST', '/api/usuarios', {}, { [E]: 'ok', [P]: 403, [V]: 403 }],
  ['GET', '/api/proveedores', null, { [E]: 'ok', [P]: 403, [V]: 403 }],
  ['POST', '/api/proveedores', {}, { [E]: 'ok', [P]: 403, [V]: 403 }],
  ['GET', '/api/materias-primas', null, { [E]: 'ok', [P]: 403, [V]: 403 }],
  ['POST', '/api/materias-primas', {}, { [E]: 'ok', [P]: 403, [V]: 403 }],

  /* Productos: el catalogo lo lee cualquiera porque CU-07 lo necesita para
     armar la venta; administrarlo es del Encargado. */
  ['GET', '/api/productos', null, { [E]: 'ok', [P]: 'ok', [V]: 'ok' }],
  ['POST', '/api/productos', {}, { [E]: 'ok', [P]: 403, [V]: 403 }],

  /* Recetas: las lee quien produce, el mismo par de roles que /api/produccion.
     El Venta queda afuera porque el mostrador no produce. */
  ['GET', '/api/recetas', null, { [E]: 'ok', [P]: 'ok', [V]: 403 }],
  ['POST', '/api/recetas', {}, { [E]: 'ok', [P]: 403, [V]: 403 }],

  ['GET', '/api/produccion', null, { [E]: 'ok', [P]: 'ok', [V]: 403 }],
  ['POST', '/api/produccion', {}, { [E]: 'ok', [P]: 'ok', [V]: 403 }],

  // CU-07 y CU-08 son de los tres roles.
  ['GET', '/api/ventas', null, { [E]: 'ok', [P]: 'ok', [V]: 'ok' }],
  ['POST', '/api/ventas', {}, { [E]: 'ok', [P]: 'ok', [V]: 'ok' }],

  ['GET', '/api/alertas', null, { [E]: 'ok', [P]: 403, [V]: 403 }],
  ['GET', '/api/alertas/resumen', null, { [E]: 'ok', [P]: 403, [V]: 403 }],
  ['GET', '/api/alertas/umbrales', null, { [E]: 'ok', [P]: 403, [V]: 403 }],
  ['PUT', '/api/alertas/umbrales', { umbrales: [] }, { [E]: 'ok', [P]: 403, [V]: 403 }],

  ['GET', '/api/panel', null, { [E]: 'ok', [P]: 403, [V]: 403 }],
];

/* Lo que pide cada pantalla apenas se abre, segun las secciones que App.jsx le
   muestra a cada rol. Si una de estas devuelve 403, esa pantalla nace rota:
   es exactamente la forma del bug del Panificador. */
const PANTALLAS = {
  [V]: {
    Ventas: ['/api/ventas', '/api/productos'],
  },
  [P]: {
    Ventas: ['/api/ventas', '/api/productos'],
    Produccion: ['/api/produccion', '/api/recetas'],
  },
  [E]: {
    Ventas: ['/api/ventas', '/api/productos'],
    Produccion: ['/api/produccion', '/api/recetas'],
    Panel: ['/api/panel'],
    Alertas: ['/api/alertas', '/api/alertas/umbrales'],
    Insumos: ['/api/materias-primas', '/api/proveedores'],
    Productos: ['/api/productos'],
    Recetas: ['/api/recetas', '/api/productos', '/api/materias-primas'],
    Proveedores: ['/api/proveedores'],
    Usuarios: ['/api/usuarios'],
  },
};

async function entrar(email) {
  const r = await fetch(`${base}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}

/** Pide la ruta como el rol indicado y devuelve solo el codigo. */
async function estado(quien, ruta, metodo = 'GET', cuerpo = null) {
  const opciones = { method: metodo, headers: { cookie: cookies[quien] } };
  if (cuerpo !== null) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  return (await fetch(`${base}${ruta}`, opciones)).status;
}

async function limpiar() {
  await consultar("DELETE FROM usuario WHERE email LIKE 'matriz.%'");
}

before(async () => {
  await limpiar();
  const hash = await hashearPassword(CLAVE);
  for (const [email, rol] of Object.values(USUARIOS)) {
    await consultar(
      `INSERT INTO usuario (nombre, email, password_hash, id_rol)
       VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4))`,
      [`ZTM ${rol}`, email, hash, rol]
    );
  }

  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  for (const [quien, [email]] of Object.entries(USUARIOS)) {
    cookies[quien] = await entrar(email);
  }
});

after(async () => {
  await limpiar();
  servidor.close();
  await pool.end();
});

/* ------------------------------------------------- lo que cada rol NO puede */

test('cada rol queda afuera de las rutas que no le corresponden', async () => {
  const inesperados = [];
  for (const [metodo, ruta, cuerpo, esperado] of MATRIZ) {
    for (const [rol, quiere] of Object.entries(esperado)) {
      if (quiere !== 403) continue;
      const codigo = await estado(rol, ruta, metodo, cuerpo);
      if (codigo !== 403) inesperados.push(`${rol} ${metodo} ${ruta} -> ${codigo}, esperaba 403`);
    }
  }
  assert.deepEqual(inesperados, []);
});

/* ------------------------------------------------- lo que cada rol SI puede */

test('cada rol entra a todas las rutas que su trabajo necesita', async () => {
  /* La mitad que faltaba. Un portero de mas no rompe ninguna prueba que mire
     solo el lado negativo, pero deja a un rol sin poder trabajar. */
  const bloqueados = [];
  for (const [metodo, ruta, cuerpo, esperado] of MATRIZ) {
    for (const [rol, quiere] of Object.entries(esperado)) {
      if (quiere !== 'ok') continue;
      const codigo = await estado(rol, ruta, metodo, cuerpo);
      if (codigo === 401 || codigo === 403) {
        bloqueados.push(`${rol} ${metodo} ${ruta} -> ${codigo}, no deberia estar bloqueado`);
      }
    }
  }
  assert.deepEqual(bloqueados, []);
});

/* --------------------------------------------- las pantallas de cada rol */

test('ninguna pantalla nace rota: todo lo que pide al abrirse esta permitido', async () => {
  /* Esta es la prueba que habria cazado el bug del Panificador. No alcanza con
     que el rol pueda entrar a su pantalla: tiene que poder leer todo lo que la
     pantalla pide al montarse, o se abre vacia y sin explicacion. */
  const rotas = [];
  for (const [rol, pantallas] of Object.entries(PANTALLAS)) {
    for (const [pantalla, rutas] of Object.entries(pantallas)) {
      for (const ruta of rutas) {
        const codigo = await estado(rol, ruta);
        if (codigo !== 200) rotas.push(`${rol} abre ${pantalla}: GET ${ruta} -> ${codigo}`);
      }
    }
  }
  assert.deepEqual(rotas, []);
});

/* ------------------------------------------------------------- sin sesion */

test('sin sesion ninguna ruta de datos responde', async () => {
  const abiertas = [];
  for (const [metodo, ruta] of MATRIZ) {
    const r = await fetch(`${base}${ruta}`, { method: metodo });
    if (r.status !== 401) abiertas.push(`${metodo} ${ruta} -> ${r.status}, esperaba 401`);
  }
  assert.deepEqual(abiertas, []);
});
