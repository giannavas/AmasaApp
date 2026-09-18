import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* Pruebas de CU-02: gestion de usuarios.
   Los correos llevan el prefijo "cu02." para no pisarse con los de las otras
   pruebas, que corren en paralelo contra la misma base. */

let servidor, base, cookieEncargado, cookieVenta, idEncargado, idVenta;

const ENCARGADO = 'cu02.encargado@amasapan.test';
const VENDEDOR = 'cu02.venta@amasapan.test';
const CLAVE = 'facturas2026';

/** Da de alta un usuario directo en la base y devuelve su id. */
async function sembrar(nombre, email, rol) {
  const hash = await hashearPassword(CLAVE);
  const { rows } = await consultar(
    `INSERT INTO usuario (nombre, email, password_hash, id_rol)
     VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4))
     RETURNING id_usuario`,
    [nombre, email, hash, rol]
  );
  return rows[0].id_usuario;
}

/** Inicia sesion y devuelve la cookie lista para reenviar. */
async function entrar(email) {
  const r = await fetch(`${base}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}

/** Pedido a /api/usuarios con la cookie indicada. */
function pedir(ruta, { cookie, metodo = 'GET', cuerpo } = {}) {
  const opciones = { method: metodo, headers: { cookie } };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  return fetch(`${base}/api/usuarios${ruta}`, opciones);
}

before(async () => {
  await consultar("DELETE FROM usuario WHERE email LIKE 'cu02.%'");
  idEncargado = await sembrar('Encargada de prueba', ENCARGADO, 'Encargado');
  idVenta = await sembrar('Vendedor de prueba', VENDEDOR, 'Venta');

  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  cookieEncargado = await entrar(ENCARGADO);
  cookieVenta = await entrar(VENDEDOR);
});

after(async () => {
  await consultar("DELETE FROM usuario WHERE email LIKE 'cu02.%'");
  servidor.close();
  await pool.end();
});

/* ---------------------------------------------------------------- permisos */

test('sin sesion no se puede listar usuarios', async () => {
  const r = await fetch(`${base}/api/usuarios`);
  assert.equal(r.status, 401);
});

test('un usuario de Venta no puede listar usuarios', async () => {
  const r = await pedir('', { cookie: cookieVenta });
  assert.equal(r.status, 403);
});

test('un usuario de Venta no puede crear usuarios', async () => {
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { nombre: 'Colado', email: 'cu02.colado@amasapan.test', password: 'clave12345', rol: 'Venta' },
  });
  assert.equal(r.status, 403);
});

/* ---------------------------------------------------------------- listar */

test('el Encargado lista los usuarios', async () => {
  const r = await pedir('', { cookie: cookieEncargado });
  assert.equal(r.status, 200);

  const { usuarios } = await r.json();
  assert.ok(Array.isArray(usuarios), 'la respuesta debe traer un arreglo de usuarios');

  const encargada = usuarios.find((u) => u.email === ENCARGADO);
  assert.ok(encargada, 'la encargada sembrada tiene que aparecer en el listado');
  assert.equal(encargada.rol, 'Encargado');
  assert.equal(encargada.activo, true);
});

test('el listado nunca incluye el hash de la contraseña', async () => {
  const { usuarios } = await (await pedir('', { cookie: cookieEncargado })).json();
  for (const u of usuarios) {
    assert.ok(!('password_hash' in u), 'el hash no puede salir de la base');
    assert.ok(!('passwordHash' in u), 'el hash no puede salir de la base');
  }
});

/* ---------------------------------------------------------------- crear */

test('el Encargado crea un usuario nuevo', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: {
      nombre: 'Panadero Nuevo',
      email: 'cu02.nuevo@amasapan.test',
      password: 'amasijo2026',
      rol: 'Panificador',
    },
  });

  assert.equal(r.status, 201);
  const { usuario } = await r.json();
  assert.equal(usuario.email, 'cu02.nuevo@amasapan.test');
  assert.equal(usuario.rol, 'Panificador');
  assert.equal(usuario.activo, true);
  assert.ok(usuario.idUsuario, 'debe devolver el id del usuario creado');
});

test('el usuario creado puede iniciar sesion con su contraseña', async () => {
  const r = await fetch(`${base}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cu02.nuevo@amasapan.test', password: 'amasijo2026' }),
  });
  assert.equal(r.status, 200, 'si falla, la contraseña no se hasheo con el mismo modulo');
});

test('la contraseña se guarda hasheada, nunca en texto plano', async () => {
  const { rows } = await consultar(
    'SELECT password_hash FROM usuario WHERE email = $1',
    ['cu02.nuevo@amasapan.test']
  );
  assert.notEqual(rows[0].password_hash, 'amasijo2026');
  assert.match(rows[0].password_hash, /^scrypt\$/);
});

test('rechaza un correo que ya existe', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { nombre: 'Repetido', email: ENCARGADO, password: 'clave12345', rol: 'Venta' },
  });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /correo/i);
});

test('rechaza un rol que no existe', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { nombre: 'Inventado', email: 'cu02.rol@amasapan.test', password: 'clave12345', rol: 'Administrador' },
  });
  assert.equal(r.status, 400);
});

test('rechaza una contraseña de menos de 8 caracteres', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { nombre: 'Corta', email: 'cu02.corta@amasapan.test', password: 'siete77', rol: 'Venta' },
  });
  assert.equal(r.status, 400);
});

test('rechaza el alta sin los datos obligatorios', async () => {
  const r = await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: { nombre: 'Pelado' } });
  assert.equal(r.status, 400);
});

/* ---------------------------------------------------------------- editar */

test('el Encargado edita nombre, correo y rol', async () => {
  const r = await pedir(`/${idVenta}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: { nombre: 'Vendedor Editado', email: 'cu02.editado@amasapan.test', rol: 'Panificador' },
  });

  assert.equal(r.status, 200);
  const { usuario } = await r.json();
  assert.equal(usuario.nombre, 'Vendedor Editado');
  assert.equal(usuario.email, 'cu02.editado@amasapan.test');
  assert.equal(usuario.rol, 'Panificador');
});

test('editar con un correo de otro usuario da conflicto', async () => {
  const r = await pedir(`/${idVenta}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: { nombre: 'Choque', email: ENCARGADO, rol: 'Venta' },
  });
  assert.equal(r.status, 409);
});

test('editar un usuario inexistente da 404', async () => {
  const r = await pedir('/999999', {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: { nombre: 'Fantasma', email: 'cu02.fantasma@amasapan.test', rol: 'Venta' },
  });
  assert.equal(r.status, 404);
});

/* ------------------------------------------------------- activar / desactivar */

test('el Encargado desactiva a otro usuario', async () => {
  const r = await pedir(`/${idVenta}/estado`, {
    cookie: cookieEncargado,
    metodo: 'PATCH',
    cuerpo: { activo: false },
  });

  assert.equal(r.status, 200);
  assert.equal((await r.json()).usuario.activo, false);
});

test('desactivar corta el acceso en el pedido siguiente', async () => {
  const r = await fetch(`${base}/api/sesion`, { headers: { cookie: cookieVenta } });
  assert.equal(r.status, 401, 'la sesion del usuario desactivado seguia sirviendo');
});

test('el Encargado vuelve a activar al usuario', async () => {
  const r = await pedir(`/${idVenta}/estado`, {
    cookie: cookieEncargado,
    metodo: 'PATCH',
    cuerpo: { activo: true },
  });

  assert.equal(r.status, 200);
  assert.equal((await r.json()).usuario.activo, true);
});

test('un Encargado no puede desactivarse a si mismo', async () => {
  const r = await pedir(`/${idEncargado}/estado`, {
    cookie: cookieEncargado,
    metodo: 'PATCH',
    cuerpo: { activo: false },
  });

  assert.equal(r.status, 409, 'si se desactiva a si mismo queda afuera del sistema');

  const { rows } = await consultar('SELECT activo FROM usuario WHERE id_usuario = $1', [idEncargado]);
  assert.equal(rows[0].activo, true, 'no debe haber tocado la base');
});

test('cambiar el estado de un usuario inexistente da 404', async () => {
  const r = await pedir('/999999/estado', {
    cookie: cookieEncargado,
    metodo: 'PATCH',
    cuerpo: { activo: false },
  });
  assert.equal(r.status, 404);
});
