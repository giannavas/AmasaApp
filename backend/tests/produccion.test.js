import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* CU-06: registrar lote de produccion. Prefijo ZTL para aislar los datos.

   La receta de prueba rinde 24 unidades y lleva 2,5 kg de harina (a $800) y
   0,8 kg de azucar (a $600). Producir 24 unidades deberia consumir
   exactamente eso y costar 2,5 x 800 + 0,8 x 600 = 2480. */

let servidor, base;
let cookiePanificador, cookieEncargado, cookieVenta;
let idReceta, idProducto, idHarina, idAzucar;

const PANIFICADOR = 'lote.panificador@amasapan.test';
const ENCARGADO = 'lote.encargado@amasapan.test';
const VENDEDOR = 'lote.venta@amasapan.test';
const CLAVE = 'facturas2026';

const STOCK_HARINA = 100;
const STOCK_AZUCAR = 50;

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
  return fetch(`${base}/api/produccion${ruta}`, opciones);
}

/** Lee el stock actual de un insumo directo de la base. */
async function stockInsumo(idMateriaPrima) {
  const { rows } = await consultar(
    'SELECT stock_actual FROM materia_prima WHERE id_materia_prima = $1',
    [idMateriaPrima]
  );
  return Number(rows[0].stock_actual);
}

async function stockProducto() {
  const { rows } = await consultar(
    'SELECT stock_actual FROM producto WHERE id_producto = $1',
    [idProducto]
  );
  return Number(rows[0].stock_actual);
}

/** Deja los stocks como al principio, para que cada prueba parta de lo mismo. */
async function reiniciarStocks() {
  await consultar('UPDATE materia_prima SET stock_actual = $1 WHERE id_materia_prima = $2', [STOCK_HARINA, idHarina]);
  await consultar('UPDATE materia_prima SET stock_actual = $1 WHERE id_materia_prima = $2', [STOCK_AZUCAR, idAzucar]);
  await consultar('UPDATE producto SET stock_actual = 0 WHERE id_producto = $1', [idProducto]);
  await consultar('DELETE FROM lote_produccion WHERE id_receta = $1', [idReceta]);
}

async function limpiar() {
  await consultar("DELETE FROM lote_produccion WHERE id_receta IN (SELECT id_receta FROM receta WHERE nombre LIKE 'ZTL%')");
  await consultar("DELETE FROM receta WHERE nombre LIKE 'ZTL%'");
  await consultar("DELETE FROM producto WHERE nombre LIKE 'ZTL%'");
  await consultar("DELETE FROM materia_prima WHERE nombre LIKE 'ZTL%'");
  await consultar("DELETE FROM proveedor WHERE razon_social LIKE 'ZTL%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'lote.%'");
}

before(async () => {
  await limpiar();
  await sembrarUsuario('Panificador lotes', PANIFICADOR, 'Panificador');
  await sembrarUsuario('Encargada lotes', ENCARGADO, 'Encargado');
  await sembrarUsuario('Vendedor lotes', VENDEDOR, 'Venta');

  const { rows: prov } = await consultar(
    'INSERT INTO proveedor (razon_social) VALUES ($1) RETURNING id_proveedor',
    ['ZTL Proveedor']
  );

  const insumo = async (nombre, stock, costo) => {
    const { rows } = await consultar(
      `INSERT INTO materia_prima
         (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo,
          costo_promedio, id_proveedor_habitual)
       VALUES ($1, 'kg', $2, 5, 1000, $3, $4) RETURNING id_materia_prima`,
      [nombre, stock, costo, prov[0].id_proveedor]
    );
    return rows[0].id_materia_prima;
  };
  idHarina = await insumo('ZTL Harina', STOCK_HARINA, 800);
  idAzucar = await insumo('ZTL Azucar', STOCK_AZUCAR, 600);

  const { rows: prod } = await consultar(
    `INSERT INTO producto (nombre, precio_venta, stock_minimo, stock_maximo)
     VALUES ('ZTL Cañoncito', 500, 10, 1000) RETURNING id_producto`
  );
  idProducto = prod[0].id_producto;

  const { rows: rec } = await consultar(
    `INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
     VALUES ('ZTL Receta', 24, $1) RETURNING id_receta`,
    [idProducto]
  );
  idReceta = rec[0].id_receta;

  await consultar(
    `INSERT INTO receta_detalle (cantidad_requerida, id_receta, id_materia_prima)
     VALUES (2.5, $1, $2), (0.8, $1, $3)`,
    [idReceta, idHarina, idAzucar]
  );

  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  cookiePanificador = await entrar(PANIFICADOR);
  cookieEncargado = await entrar(ENCARGADO);
  cookieVenta = await entrar(VENDEDOR);
});

after(async () => {
  await limpiar();
  servidor.close();
  await pool.end();
});

/* ---------------------------------------------------------------- permisos */

test('sin sesion no se puede registrar produccion', async () => {
  const r = await fetch(`${base}/api/produccion`);
  assert.equal(r.status, 401);
});

test('un usuario de Venta no puede registrar un lote', async () => {
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 },
  });
  assert.equal(r.status, 403);
});

test('el Panificador si puede registrar un lote', async () => {
  // A diferencia del resto de la administracion, CU-06 tambien es del
  // Panificador: es quien produce.
  await reiniciarStocks();
  const r = await pedir('', {
    cookie: cookiePanificador,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 },
  });
  assert.equal(r.status, 201);
});

/* --------------------------------------------------- el lote y sus efectos */

test('registrar un lote descuenta los insumos del stock', async () => {
  await reiniciarStocks();
  await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 },
  });

  assert.equal(await stockInsumo(idHarina), STOCK_HARINA - 2.5);
  assert.equal(await stockInsumo(idAzucar), STOCK_AZUCAR - 0.8);
});

test('registrar un lote suma el stock del producto terminado', async () => {
  await reiniciarStocks();
  await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 },
  });

  assert.equal(await stockProducto(), 24);
});

test('producir el doble consume el doble de insumos', async () => {
  // La receta rinde 24; pedir 48 son dos veces la receta.
  await reiniciarStocks();
  await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 48 },
  });

  assert.equal(await stockInsumo(idHarina), STOCK_HARINA - 5);
  assert.equal(await stockInsumo(idAzucar), STOCK_AZUCAR - 1.6);
  assert.equal(await stockProducto(), 48);
});

test('el lote deja registrado que consumio y a que costo', async () => {
  await reiniciarStocks();
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 },
  });
  const { lote } = await r.json();

  const { rows } = await consultar(
    `SELECT c.cantidad, c.costo_unitario, c.subtotal, m.nombre
       FROM consumo_materia_prima c
       JOIN materia_prima m ON m.id_materia_prima = c.id_materia_prima
      WHERE c.id_lote = $1 ORDER BY m.nombre`,
    [lote.idLote]
  );

  assert.equal(rows.length, 2, 'tiene que haber un consumo por insumo');

  const azucar = rows.find((c) => c.nombre === 'ZTL Azucar');
  assert.equal(Number(azucar.cantidad), 0.8);
  assert.equal(Number(azucar.costo_unitario), 600, 'guarda el costo del momento de producir');
  assert.equal(Number(azucar.subtotal), 480);
});

test('el costo del lote es la suma de sus consumos', async () => {
  await reiniciarStocks();
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 },
  });

  const { lote } = await r.json();
  assert.equal(lote.costoTotal, 2480, '2,5 x 800 + 0,8 x 600');
  assert.equal(lote.costoUnitario, 2480 / 24, 'el costo por unidad producida');
});

/* ------------------------------------------------------- stock insuficiente */

test('avisa cual es el insumo que falta', async () => {
  await reiniciarStocks();
  // El azucar alcanza para 50 / 0,8 = 62,5 recetas; la harina para 100 / 2,5 = 40.
  // Pidiendo 24 x 50 unidades, la harina es la primera que no alcanza.
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 * 50 },
  });

  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /ZTL Harina/, 'el mensaje tiene que nombrar el insumo');
});

test('si falta stock no se modifica nada', async () => {
  await reiniciarStocks();
  await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 * 50 },
  });

  assert.equal(await stockInsumo(idHarina), STOCK_HARINA, 'la harina no se tenia que tocar');
  assert.equal(await stockInsumo(idAzucar), STOCK_AZUCAR, 'el azucar no se tenia que tocar');
  assert.equal(await stockProducto(), 0, 'no se tenia que dar de alta produccion');

  const { rows } = await consultar(
    'SELECT 1 FROM lote_produccion WHERE id_receta = $1',
    [idReceta]
  );
  assert.equal(rows.length, 0, 'no tenia que quedar ningun lote registrado');
});

/* -------------------------------------------------------------- validacion */

test('rechaza una cantidad de cero', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 0 },
  });
  assert.equal(r.status, 400);
});

test('rechaza una receta que no existe', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { idReceta: 999999, cantidadProducida: 24 },
  });
  assert.equal(r.status, 400);
});

/* ----------------------------------------------------------------- listado */

test('el listado trae los lotes con su producto y su responsable', async () => {
  await reiniciarStocks();
  await pedir('', {
    cookie: cookiePanificador,
    metodo: 'POST',
    cuerpo: { idReceta, cantidadProducida: 24 },
  });

  const r = await pedir('', { cookie: cookieEncargado });
  assert.equal(r.status, 200);

  const { lotes } = await r.json();
  const lote = lotes.find((l) => l.receta === 'ZTL Receta');

  assert.ok(lote, 'el lote recien registrado tiene que aparecer');
  assert.equal(lote.producto, 'ZTL Cañoncito');
  assert.equal(lote.usuario, 'Panificador lotes');
  assert.equal(lote.cantidadProducida, 24);
});
