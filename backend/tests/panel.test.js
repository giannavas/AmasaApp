import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* CU-12: panel de control. Prefijo ZTD para aislar los datos.

   Los movimientos se cargan en marzo de 2001. Las otras pruebas registran
   ventas y lotes con la fecha de hoy y corren en paralelo sobre la misma
   base: con un periodo tan lejano, los numeros de esta prueba no se mezclan
   con los de nadie y se pueden comparar exactos.

   Periodo principal: del 1 al 7 de marzo de 2001.

   Ventas                                   total   en el periodo
     25/02 12:00  3 pan                      6000   no (periodo anterior)
     01/03 10:00  2 pan + 6 facturas         7000   si
     03/03 23:30  4 facturas                 2000   si (tarde, pero ese dia)
     07/03 14:30  1 torta                   10000   si (ultimo dia, de tarde)
     08/03 08:00  10 pan                    20000   no

   Lotes: 02/03 20 pan ($8000), 05/03 50 facturas ($6000), 09/03 fuera.
   Ingresos: 04/03 25 kg x $900, 06/03 10 kg x $1500.50, 20/02 fuera. */

let servidor, base;
let cookieEncargado, cookieVenta, cookiePanificador;
let idUsuario;
const ids = {};

const ENCARGADO = 'panel.encargado@amasapan.test';
const VENDEDOR = 'panel.venta@amasapan.test';
const PANIFICADOR = 'panel.panificador@amasapan.test';
const CLAVE = 'tablero2026';

const PERIODO = '?desde=2001-03-01&hasta=2001-03-07';

async function sembrarUsuario(nombre, email, rol) {
  const hash = await hashearPassword(CLAVE);
  const { rows } = await consultar(
    `INSERT INTO usuario (nombre, email, password_hash, id_rol)
     VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4))
     RETURNING id_usuario`,
    [nombre, email, hash, rol]
  );
  return rows[0].id_usuario;
}

async function entrar(email) {
  const r = await fetch(`${base}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}

function pedir(consulta = '', cookie = cookieEncargado) {
  return fetch(`${base}/api/panel${consulta}`, { headers: { cookie } });
}

async function panel(consulta) {
  const r = await pedir(consulta);
  assert.equal(r.status, 200);
  return r.json();
}

async function producto(nombre, precio) {
  const { rows } = await consultar(
    `INSERT INTO producto (nombre, precio_venta, stock_minimo, stock_maximo, stock_actual)
     VALUES ($1, $2, 0, 1000, 500) RETURNING id_producto`,
    [nombre, precio]
  );
  ids[nombre] = rows[0].id_producto;
}

/** Carga una venta con sus lineas: [[producto, cantidad, precio], ...]. */
async function venta(fecha, lineas) {
  const total = lineas.reduce((suma, [, cantidad, precio]) => suma + cantidad * precio, 0);
  const { rows } = await consultar(
    'INSERT INTO venta (fecha, total, id_usuario) VALUES ($1, $2, $3) RETURNING id_venta',
    [fecha, total, idUsuario]
  );
  for (const [nombre, cantidad, precio] of lineas) {
    await consultar(
      `INSERT INTO detalle_venta (cantidad, precio_unitario, subtotal, id_venta, id_producto)
       VALUES ($1, $2, $3, $4, $5)`,
      [cantidad, precio, cantidad * precio, rows[0].id_venta, ids[nombre]]
    );
  }
}

async function lote(fecha, receta, cantidad, costo) {
  await consultar(
    `INSERT INTO lote_produccion (fecha, cantidad_producida, costo_total, id_receta, id_usuario)
     VALUES ($1, $2, $3, $4, $5)`,
    [fecha, cantidad, costo, ids[receta], idUsuario]
  );
}

async function ingreso(fecha, cantidad, precio) {
  await consultar(
    `INSERT INTO ingreso_materia_prima
       (fecha_ingreso, cantidad, precio_unitario, id_materia_prima, id_usuario, id_proveedor)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [fecha, cantidad, precio, ids.harina, idUsuario, ids.proveedor]
  );
}

async function limpiar() {
  const usuarios = "(SELECT id_usuario FROM usuario WHERE email LIKE 'panel.%')";
  await consultar(`DELETE FROM venta WHERE id_usuario IN ${usuarios}`);
  await consultar(`DELETE FROM lote_produccion WHERE id_usuario IN ${usuarios}`);
  await consultar(`DELETE FROM ingreso_materia_prima WHERE id_usuario IN ${usuarios}`);
  await consultar("DELETE FROM receta WHERE nombre LIKE 'ZTD%'");
  await consultar("DELETE FROM producto WHERE nombre LIKE 'ZTD%'");
  await consultar("DELETE FROM materia_prima WHERE nombre LIKE 'ZTD%'");
  await consultar("DELETE FROM proveedor WHERE razon_social LIKE 'ZTD%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'panel.%'");
}

before(async () => {
  await limpiar();
  idUsuario = await sembrarUsuario('Encargada panel', ENCARGADO, 'Encargado');
  await sembrarUsuario('Vendedor panel', VENDEDOR, 'Venta');
  await sembrarUsuario('Panificador panel', PANIFICADOR, 'Panificador');

  await producto('ZTD Pan', 2000);
  await producto('ZTD Factura', 500);
  await producto('ZTD Torta', 10000);

  for (const [receta, prod] of [['ZTD Receta pan', 'ZTD Pan'], ['ZTD Receta facturas', 'ZTD Factura']]) {
    const { rows } = await consultar(
      `INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
       VALUES ($1, 10, $2) RETURNING id_receta`,
      [receta, ids[prod]]
    );
    ids[receta] = rows[0].id_receta;
  }

  const { rows: proveedores } = await consultar(
    "INSERT INTO proveedor (razon_social) VALUES ('ZTD Molino') RETURNING id_proveedor"
  );
  ids.proveedor = proveedores[0].id_proveedor;
  const { rows: insumos } = await consultar(
    `INSERT INTO materia_prima (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo)
     VALUES ('ZTD Harina', 'kg', 100, 10, 200) RETURNING id_materia_prima`
  );
  ids.harina = insumos[0].id_materia_prima;

  await venta('2001-02-25 12:00', [['ZTD Pan', 3, 2000]]);
  await venta('2001-03-01 10:00', [['ZTD Pan', 2, 2000], ['ZTD Factura', 6, 500]]);
  await venta('2001-03-03 23:30', [['ZTD Factura', 4, 500]]);
  await venta('2001-03-07 14:30', [['ZTD Torta', 1, 10000]]);
  await venta('2001-03-08 08:00', [['ZTD Pan', 10, 2000]]);

  await lote('2001-03-02', 'ZTD Receta pan', 20, 8000);
  await lote('2001-03-05', 'ZTD Receta facturas', 50, 6000);
  await lote('2001-03-09', 'ZTD Receta pan', 30, 12000);

  await ingreso('2001-03-04', 25, 900);
  await ingreso('2001-03-06', 10, 1500.5);
  await ingreso('2001-02-20', 40, 900);

  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  cookieEncargado = await entrar(ENCARGADO);
  cookieVenta = await entrar(VENDEDOR);
  cookiePanificador = await entrar(PANIFICADOR);
});

after(async () => {
  await limpiar();
  servidor.close();
  await pool.end();
});

/* ---------------------------------------------------------------- permisos */

test('sin sesion no se puede ver el panel', async () => {
  const r = await fetch(`${base}/api/panel`);
  assert.equal(r.status, 401);
});

test('un usuario de Venta no puede ver el panel', async () => {
  assert.equal((await pedir('', cookieVenta)).status, 403);
});

test('un Panificador no puede ver el panel', async () => {
  assert.equal((await pedir('', cookiePanificador)).status, 403);
});

/* ------------------------------------------------------------------ ventas */

test('suma las ventas del periodo, incluidas las del ultimo dia a la tarde', async () => {
  const { ventas } = await panel(PERIODO);
  assert.equal(ventas.cantidad, 3);
  assert.equal(ventas.total, 19000); // 7000 + 2000 + 10000
  assert.equal(ventas.unidades, 13); // 2 + 6 + 4 + 1
});

test('calcula el ticket promedio', async () => {
  const { ventas } = await panel(PERIODO);
  assert.equal(ventas.ticketPromedio, 6333.33);
});

test('compara contra el periodo anterior de igual largo', async () => {
  const { ventas } = await panel(PERIODO);
  assert.deepEqual(ventas.periodoAnterior, {
    desde: '2001-02-22',
    hasta: '2001-02-28',
    total: 6000,
  });
  assert.equal(ventas.variacion, 216.67); // (19000 - 6000) / 6000
});

test('sin ventas en el periodo anterior la variacion queda en null y no en cero', async () => {
  const { ventas } = await panel('?desde=2001-02-22&hasta=2001-02-28');
  assert.equal(ventas.total, 6000);
  assert.equal(ventas.variacion, null);
});

test('arma un punto por dia, con los dias sin ventas en cero', async () => {
  const { ventasPorDia } = await panel(PERIODO);
  assert.equal(ventasPorDia.length, 7);
  assert.deepEqual(ventasPorDia.map((d) => d.fecha), [
    '2001-03-01', '2001-03-02', '2001-03-03', '2001-03-04',
    '2001-03-05', '2001-03-06', '2001-03-07',
  ]);
  assert.deepEqual(ventasPorDia.map((d) => d.total), [7000, 0, 2000, 0, 0, 0, 10000]);
  // La venta de las 23:30 queda en su dia y no pasa al siguiente.
  assert.equal(ventasPorDia[2].cantidad, 1);
});

test('ordena los productos mas vendidos por unidades', async () => {
  const { productosMasVendidos } = await panel(PERIODO);
  assert.deepEqual(
    productosMasVendidos.map((p) => [p.nombre, p.unidades, p.importe]),
    [
      ['ZTD Factura', 10, 5000],
      ['ZTD Pan', 2, 4000],
      ['ZTD Torta', 1, 10000],
    ]
  );
});

/* ---------------------------------------------------- produccion y compras */

test('resume los lotes producidos en el periodo', async () => {
  const { produccion } = await panel(PERIODO);
  assert.deepEqual(produccion, { lotes: 2, unidades: 70, costo: 14000 });
});

test('suma lo gastado en mercaderia como cantidad por precio', async () => {
  const { compras } = await panel(PERIODO);
  assert.deepEqual(compras, { ingresos: 2, total: 37505 }); // 22500 + 15005
});

/* -------------------------------------------------------------- alertas */

test('incluye el resumen de alertas vigentes', async () => {
  const { alertas } = await panel(PERIODO);
  assert.equal(alertas.resumen.criticas + alertas.resumen.sobrestock, alertas.resumen.total);
  assert.ok(Array.isArray(alertas.principales));
  assert.ok(alertas.principales.length <= 5);
  assert.ok(alertas.principales.every((a) => a.tipo === 'StockCritico'));
});

/* ------------------------------------------------------------- periodos */

test('un periodo sin movimientos devuelve todo en cero', async () => {
  const datos = await panel('?desde=1990-01-01&hasta=1990-01-03');
  assert.equal(datos.ventas.total, 0);
  assert.equal(datos.ventas.ticketPromedio, 0);
  assert.deepEqual(datos.produccion, { lotes: 0, unidades: 0, costo: 0 });
  assert.deepEqual(datos.compras, { ingresos: 0, total: 0 });
  assert.deepEqual(datos.productosMasVendidos, []);
  assert.equal(datos.ventasPorDia.length, 3);
});

test('sin fechas muestra los ultimos 30 dias hasta hoy', async () => {
  const datos = await panel('');
  const { rows } = await consultar("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS hoy");
  assert.equal(datos.periodo.hasta, rows[0].hoy);
  assert.equal(datos.ventasPorDia.length, 30);
});

test('con solo la fecha hasta toma los 30 dias que terminan ese dia', async () => {
  const datos = await panel('?hasta=2001-03-07');
  assert.deepEqual(datos.periodo, { desde: '2001-02-06', hasta: '2001-03-07' });
  assert.equal(datos.ventas.total, 25000); // incluye la del 25 de febrero
});

test('un solo dia es un periodo valido', async () => {
  const datos = await panel('?desde=2001-03-07&hasta=2001-03-07');
  assert.equal(datos.ventas.total, 10000);
  assert.equal(datos.ventasPorDia.length, 1);
});

test('rechaza fechas con otro formato', async () => {
  assert.equal((await pedir('?desde=07/03/2001')).status, 400);
});

test('rechaza una fecha que no existe', async () => {
  assert.equal((await pedir('?desde=2001-02-30&hasta=2001-03-07')).status, 400);
});

test('rechaza un periodo invertido', async () => {
  assert.equal((await pedir('?desde=2001-03-07&hasta=2001-03-01')).status, 400);
});

test('rechaza un periodo de mas de un año', async () => {
  assert.equal((await pedir('?desde=2000-01-01&hasta=2001-03-07')).status, 400);
});
