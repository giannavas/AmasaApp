import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* Productos terminados. Son la precondicion de las recetas, y estas a su vez
   la de CU-06. Prefijo ZTP para aislar los datos de prueba. */

let servidor, base, cookieEncargado, cookieVenta;

const ENCARGADO = 'prod.encargado@amasapan.test';
const VENDEDOR = 'prod.venta@amasapan.test';
const CLAVE = 'facturas2026';

async function sembrarUsuario(nombre, email, rol) {
  const hash = await hashearPassword(CLAVE);
  await consultar(
    `INSERT INTO usuario (nombre, email, password_hash, id_rol)
     VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4))`,
    [nombre, email, hash, rol]
  );
}

async function entrar(email) {
  const r = await fetch(`${base}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}

function pedir(ruta, { cookie, metodo = 'GET', cuerpo } = {}) {
  const opciones = { method: metodo, headers: { cookie } };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  return fetch(`${base}/api/productos${ruta}`, opciones);
}

/** Alta valida. Se le pisan los campos que haga falta. */
function alta(cambios = {}) {
  return {
    nombre: 'ZTP Cañoncito',
    descripcion: 'Relleno de dulce de leche',
    precioVenta: 850,
    stockMinimo: 20,
    stockMaximo: 200,
    ...cambios,
  };
}

async function limpiar() {
  await consultar("DELETE FROM producto WHERE nombre LIKE 'ZTP%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'prod.%'");
}

before(async () => {
  await limpiar();
  await sembrarUsuario('Encargada productos', ENCARGADO, 'Encargado');
  await sembrarUsuario('Vendedor productos', VENDEDOR, 'Venta');

  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  cookieEncargado = await entrar(ENCARGADO);
  cookieVenta = await entrar(VENDEDOR);
});

after(async () => {
  await limpiar();
  servidor.close();
  await pool.end();
});

/* ---------------------------------------------------------------- permisos */

test('sin sesion no se pueden ver los productos', async () => {
  const r = await fetch(`${base}/api/productos`);
  assert.equal(r.status, 401);
});

test('un usuario de Venta no puede crear productos', async () => {
  const r = await pedir('', { cookie: cookieVenta, metodo: 'POST', cuerpo: alta() });
  assert.equal(r.status, 403);
});

/* ------------------------------------------------------------------ crear */

test('el Encargado da de alta un producto', async () => {
  const r = await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: alta() });

  assert.equal(r.status, 201);
  const { producto } = await r.json();
  assert.equal(producto.nombre, 'ZTP Cañoncito');
  assert.equal(producto.precioVenta, 850);
  assert.equal(producto.stockMinimo, 20);
  assert.ok(producto.idProducto, 'debe devolver el id del producto creado');
});

test('el producto nace con stock en cero', async () => {
  // El stock de un producto terminado solo sube produciendo (CU-06) y baja
  // vendiendo (CU-07). No se carga a mano en el alta.
  const { productos } = await (await pedir('', { cookie: cookieEncargado })).json();
  const canoncito = productos.find((p) => p.nombre === 'ZTP Cañoncito');
  assert.equal(canoncito.stockActual, 0);
});

test('la descripcion es opcional', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTP Medialuna', descripcion: '' }),
  });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).producto.descripcion, null);
});

test('rechaza un producto sin nombre', async () => {
  const r = await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: alta({ nombre: '' }) });
  assert.equal(r.status, 400);
});

test('rechaza un precio de venta negativo', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTP Negativo', precioVenta: -5 }),
  });
  assert.equal(r.status, 400);
});

test('rechaza un stock maximo menor que el minimo', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTP Umbrales', stockMinimo: 100, stockMaximo: 10 }),
  });
  assert.equal(r.status, 400);
});

/* ----------------------------------------------------------------- listar */

test('el listado trae los productos con su estado de stock', async () => {
  const r = await pedir('', { cookie: cookieEncargado });
  assert.equal(r.status, 200);

  const { productos } = await r.json();
  assert.ok(Array.isArray(productos));

  const canoncito = productos.find((p) => p.nombre === 'ZTP Cañoncito');
  assert.ok(canoncito, 'el producto cargado tiene que aparecer');
  assert.equal(canoncito.estado, 'Critico', 'con stock 0 y minimo 20 esta en critico');
});

/* ----------------------------------------------------------------- editar */

test('el Encargado edita un producto', async () => {
  const { productos } = await (await pedir('', { cookie: cookieEncargado })).json();
  const { idProducto } = productos.find((p) => p.nombre === 'ZTP Medialuna');

  const r = await pedir(`/${idProducto}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: {
      nombre: 'ZTP Medialuna de manteca',
      descripcion: 'Docena',
      precioVenta: 1200,
      stockMinimo: 24,
      stockMaximo: 240,
    },
  });

  assert.equal(r.status, 200);
  const { producto } = await r.json();
  assert.equal(producto.nombre, 'ZTP Medialuna de manteca');
  assert.equal(producto.precioVenta, 1200);
  assert.equal(producto.stockMinimo, 24);
});

test('editar no toca el stock del producto', async () => {
  const { productos } = await (await pedir('', { cookie: cookieEncargado })).json();
  const medialuna = productos.find((p) => p.nombre === 'ZTP Medialuna de manteca');
  assert.equal(medialuna.stockActual, 0, 'la edicion no puede cambiar el stock');
});

test('editar un producto inexistente da 404', async () => {
  const r = await pedir('/999999', {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: { nombre: 'ZTP Fantasma', precioVenta: 10, stockMinimo: 1, stockMaximo: 2 },
  });
  assert.equal(r.status, 404);
});
