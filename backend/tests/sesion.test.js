import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

let servidor, base;
const EMAIL = 'prueba.sesion@amasapan.test';
const CLAVE = 'medialunas2026';

before(async () => {
  const hash = await hashearPassword(CLAVE);
  const { rows } = await consultar(
    `INSERT INTO usuario (nombre, email, password_hash, id_rol)
     VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = 'Encargado'))
     RETURNING id_usuario`,
    ['Usuario de prueba', EMAIL, hash]
  );
  global.__idPrueba = rows[0].id_usuario;
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await consultar('DELETE FROM usuario WHERE email = $1', [EMAIL]);
  servidor.close();
  await pool.end();
});

const entrar = (email, password) =>
  fetch(`${base}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

test('inicia sesion con credenciales correctas', async () => {
  const r = await entrar(EMAIL, CLAVE);
  assert.equal(r.status, 200);
  const datos = await r.json();
  assert.equal(datos.usuario.email, EMAIL);
  assert.equal(datos.usuario.rol, 'Encargado');
  assert.ok(!('password_hash' in datos.usuario), 'el hash no debe salir en la respuesta');
});

test('la sesion viaja en una cookie httpOnly', async () => {
  const r = await entrar(EMAIL, CLAVE);
  const cookie = r.headers.get('set-cookie') || '';
  assert.match(cookie, /sesion=/);
  assert.match(cookie, /HttpOnly/i, 'sin HttpOnly, un script de la pagina podria robarla');
  assert.match(cookie, /SameSite/i);
});

test('rechaza la contraseña incorrecta', async () => {
  const r = await entrar(EMAIL, 'clave-equivocada');
  assert.equal(r.status, 401);
});

test('rechaza un email inexistente', async () => {
  const r = await entrar('nadie@amasapan.test', CLAVE);
  assert.equal(r.status, 401);
});

test('el mensaje de error no revela si el email existe', async () => {
  const a = await (await entrar(EMAIL, 'mal')).json();
  const b = await (await entrar('nadie@amasapan.test', 'mal')).json();
  assert.deepEqual(a, b, 'mensajes distintos permiten averiguar que emails estan registrados');
});

test('sin cookie, la ruta protegida responde 401', async () => {
  const r = await fetch(`${base}/api/sesion`);
  assert.equal(r.status, 401);
});

test('con cookie valida devuelve el usuario', async () => {
  const login = await entrar(EMAIL, CLAVE);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(`${base}/api/sesion`, { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).usuario.email, EMAIL);
});

test('un usuario desactivado pierde el acceso de inmediato', async () => {
  const login = await entrar(EMAIL, CLAVE);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  await consultar('UPDATE usuario SET activo = false WHERE email = $1', [EMAIL]);
  const r = await fetch(`${base}/api/sesion`, { headers: { cookie } });
  await consultar('UPDATE usuario SET activo = true WHERE email = $1', [EMAIL]);

  assert.equal(r.status, 401, 'el token seguia sirviendo despues de desactivar al usuario');
});

test('un usuario desactivado no puede iniciar sesion', async () => {
  await consultar('UPDATE usuario SET activo = false WHERE email = $1', [EMAIL]);
  const r = await entrar(EMAIL, CLAVE);
  await consultar('UPDATE usuario SET activo = true WHERE email = $1', [EMAIL]);
  assert.equal(r.status, 401);
});

test('cerrar sesion borra la cookie', async () => {
  const login = await entrar(EMAIL, CLAVE);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(`${base}/api/sesion`, { method: 'DELETE', headers: { cookie } });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('set-cookie') || '', /sesion=;|sesion=;\s*Max-Age=0/i);
});
