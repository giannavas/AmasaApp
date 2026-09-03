import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashearPassword, verificarPassword } from '../src/auth/password.js';
import { firmarToken, verificarToken } from '../src/auth/token.js';

/* ---------------- Contraseñas ---------------- */

test('el hash no contiene la contraseña en claro', async () => {
  const hash = await hashearPassword('medialunas2026');
  assert.ok(!hash.includes('medialunas2026'), 'la contraseña quedo visible en el hash');
});

test('la misma contraseña da hashes distintos cada vez', async () => {
  const a = await hashearPassword('medialunas2026');
  const b = await hashearPassword('medialunas2026');
  assert.notEqual(a, b, 'sin salt aleatorio, dos usuarios con la misma clave darian el mismo hash');
});

test('verifica la contraseña correcta', async () => {
  const hash = await hashearPassword('medialunas2026');
  assert.equal(await verificarPassword('medialunas2026', hash), true);
});

test('rechaza la contraseña incorrecta', async () => {
  const hash = await hashearPassword('medialunas2026');
  assert.equal(await verificarPassword('medialunas2027', hash), false);
});

test('el hash entra en la columna password_hash de 255 caracteres', async () => {
  const hash = await hashearPassword('medialunas2026');
  assert.ok(hash.length <= 255, `el hash mide ${hash.length}`);
});

test('un hash corrupto no rompe: devuelve false', async () => {
  assert.equal(await verificarPassword('lo que sea', 'basura-sin-formato'), false);
});

/* ---------------- Token de sesión ---------------- */

test('el token lleva el id y el rol del usuario', () => {
  const token = firmarToken({ idUsuario: 3, rol: 'Encargado' });
  const datos = verificarToken(token);
  assert.equal(datos.idUsuario, 3);
  assert.equal(datos.rol, 'Encargado');
});

test('rechaza un token con la firma alterada', () => {
  const token = firmarToken({ idUsuario: 3, rol: 'Venta' });
  const alterado = token.slice(0, -4) + 'AAAA';
  assert.equal(verificarToken(alterado), null);
});

test('rechaza un token cuyo contenido fue modificado', () => {
  // Un usuario que intenta ascenderse a Encargado editando el token
  const token = firmarToken({ idUsuario: 3, rol: 'Venta' });
  const [cuerpo, firma] = token.split('.');
  const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  datos.rol = 'Encargado';
  const falsificado =
    Buffer.from(JSON.stringify(datos)).toString('base64url') + '.' + firma;
  assert.equal(verificarToken(falsificado), null, 'se acepto un token manipulado');
});

test('rechaza un token vencido', () => {
  const token = firmarToken({ idUsuario: 3, rol: 'Venta' }, -1);
  assert.equal(verificarToken(token), null);
});

test('rechaza cualquier cosa que no sea un token', () => {
  for (const basura of ['', 'abc', 'a.b.c', null, undefined]) {
    assert.equal(verificarToken(basura), null, `acepto: ${basura}`);
  }
});
