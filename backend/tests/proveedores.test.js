import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* Pruebas de CU-11: gestionar proveedores.
   Los datos de prueba llevan el prefijo ZTEST11 para no pisarse con los de
   las otras pruebas, que corren en paralelo contra la misma base. */

let servidor, base, cookieEncargado, cookieVenta;

const ENCARGADO = 'cu11.encargado@amasapan.test';
const VENDEDOR = 'cu11.venta@amasapan.test';
const CLAVE = 'proveedores2026';

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
  return fetch(`${base}/api/proveedores${ruta}`, opciones);
}

async function limpiar() {
  await consultar("DELETE FROM proveedor WHERE razon_social LIKE 'ZTEST11%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'cu11.%'");
}

before(async () => {
  await limpiar();
  await sembrarUsuario('Encargada CU11', ENCARGADO, 'Encargado');
  await sembrarUsuario('Vendedor CU11', VENDEDOR, 'Venta');

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

test('sin sesion no se pueden ver los proveedores', async () => {
  const r = await fetch(`${base}/api/proveedores`);
  assert.equal(r.status, 401);
});

test('un usuario de Venta no puede ver los proveedores', async () => {
  const r = await pedir('', { cookie: cookieVenta });
  assert.equal(r.status, 403);
});

/* ------------------------------------------------------------------ crear */

test('el Encargado registra un proveedor con todos sus datos', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: {
      razonSocial: 'ZTEST11 Molinos del Sur',
      cuit: '30-11111111-9',
      telefono: '341 4445555',
      email: 'ventas@molinos.test',
      direccion: 'Av. Siempre Viva 123',
    },
  });

  assert.equal(r.status, 201);
  const { proveedor } = await r.json();
  assert.equal(proveedor.razonSocial, 'ZTEST11 Molinos del Sur');
  assert.equal(proveedor.cuit, '30-11111111-9');
  assert.ok(proveedor.idProveedor, 'debe devolver el id del proveedor creado');
});

test('la razon social es el unico dato obligatorio', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { razonSocial: 'ZTEST11 Levaduras Rosario' },
  });

  assert.equal(r.status, 201);
  const { proveedor } = await r.json();
  assert.equal(proveedor.cuit, null);
});

test('rechaza un proveedor sin razon social', async () => {
  const r = await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: { telefono: '341' } });
  assert.equal(r.status, 400);
});

test('rechaza un CUIT que ya esta registrado', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { razonSocial: 'ZTEST11 Repetido', cuit: '30-11111111-9' },
  });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /CUIT/i);
});

test('permite varios proveedores sin CUIT', async () => {
  // El indice de unicidad es parcial: solo aplica cuando el CUIT tiene valor.
  // Sin esto, el segundo proveedor sin CUIT seria rechazado.
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { razonSocial: 'ZTEST11 Sin Cuit Dos' },
  });
  assert.equal(r.status, 201);
});

/* ----------------------------------------------------------------- listar */

test('el Encargado lista los proveedores registrados', async () => {
  const r = await pedir('', { cookie: cookieEncargado });
  assert.equal(r.status, 200);

  const { proveedores } = await r.json();
  assert.ok(Array.isArray(proveedores));

  const molinos = proveedores.find((p) => p.razonSocial === 'ZTEST11 Molinos del Sur');
  assert.ok(molinos, 'el proveedor cargado tiene que aparecer en el listado');
  assert.equal(molinos.telefono, '341 4445555');
});

/* ----------------------------------------------------------------- editar */

test('el Encargado edita los datos de un proveedor', async () => {
  const { proveedores } = await (await pedir('', { cookie: cookieEncargado })).json();
  const { idProveedor } = proveedores.find((p) => p.razonSocial === 'ZTEST11 Levaduras Rosario');

  const r = await pedir(`/${idProveedor}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: {
      razonSocial: 'ZTEST11 Levaduras Rosario SA',
      cuit: '30-22222222-7',
      telefono: '341 9998888',
      email: 'nuevo@levaduras.test',
      direccion: 'Mitre 900',
    },
  });

  assert.equal(r.status, 200);
  const { proveedor } = await r.json();
  assert.equal(proveedor.razonSocial, 'ZTEST11 Levaduras Rosario SA');
  assert.equal(proveedor.cuit, '30-22222222-7');
});

test('editar con el CUIT de otro proveedor da conflicto', async () => {
  const { proveedores } = await (await pedir('', { cookie: cookieEncargado })).json();
  const { idProveedor } = proveedores.find((p) => p.razonSocial === 'ZTEST11 Sin Cuit Dos');

  const r = await pedir(`/${idProveedor}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: { razonSocial: 'ZTEST11 Sin Cuit Dos', cuit: '30-11111111-9' },
  });
  assert.equal(r.status, 409);
});

test('editar un proveedor inexistente da 404', async () => {
  const r = await pedir('/999999', {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: { razonSocial: 'ZTEST11 Fantasma' },
  });
  assert.equal(r.status, 404);
});
