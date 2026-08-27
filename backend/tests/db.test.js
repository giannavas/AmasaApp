import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, consultar, conTransaccion } from '../src/config/db.js';

after(() => pool.end());

test('la conexion a PostgreSQL responde', async () => {
  const { rows } = await consultar('SELECT 1 AS uno');
  assert.equal(rows[0].uno, 1);
});

test('los tres roles del sistema estan cargados', async () => {
  const { rows } = await consultar('SELECT nombre FROM rol ORDER BY nombre');
  assert.deepEqual(rows.map((r) => r.nombre), ['Encargado', 'Panificador', 'Venta']);
});

test('conTransaccion confirma los cambios cuando todo sale bien', async () => {
  const nombre = 'RolPruebaOk';
  await conTransaccion(async (cliente) => {
    await cliente.query('INSERT INTO rol (nombre, descripcion) VALUES ($1, $2)',
      [nombre, 'Creado dentro de una transaccion']);
  });

  const { rows } = await consultar('SELECT COUNT(*)::int AS n FROM rol WHERE nombre = $1', [nombre]);
  assert.equal(rows[0].n, 1, 'el rol deberia haberse guardado');

  await consultar('DELETE FROM rol WHERE nombre = $1', [nombre]);
});

test('conTransaccion revierte todo si algo falla en el medio', async () => {
  const nombre = 'RolPruebaFalla';

  await assert.rejects(
    conTransaccion(async (cliente) => {
      await cliente.query('INSERT INTO rol (nombre, descripcion) VALUES ($1, $2)',
        [nombre, 'No deberia sobrevivir']);
      // Falla a proposito: el mismo nombre viola la restriccion de unicidad
      await cliente.query('INSERT INTO rol (nombre, descripcion) VALUES ($1, $2)',
        [nombre, 'Duplicado']);
    })
  );

  const { rows } = await consultar('SELECT COUNT(*)::int AS n FROM rol WHERE nombre = $1', [nombre]);
  assert.equal(rows[0].n, 0, 'el primer INSERT tendria que haberse revertido');
});

test('el usuario de la aplicacion no puede borrar tablas', async () => {
  // Se verifica el codigo de error, no el texto: PostgreSQL traduce sus
  // mensajes segun el idioma del servidor, pero 42501 (privilegio
  // insuficiente) es el mismo en cualquier instalacion.
  await assert.rejects(
    consultar('DROP TABLE rol'),
    (error) => error.code === '42501',
    'el usuario amasaapp no deberia poder borrar tablas'
  );
});
