import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* Integracion de todos los modulos (Sprint 6). Prefijo ZTI.

   Las otras pruebas verifican cada caso de uso por separado. Esta recorre un
   dia completo de la panaderia solo a traves de la API, con el usuario que
   corresponde a cada paso, y comprueba que lo que hace un modulo se refleje
   en los demas:

     Encargado    CU-11 alta del proveedor
                  CU-03 alta de la harina: 20 kg a $1000 (minimo 5)
                        alta del pan ($3000, minimo 5) y su receta: 5 kg cada 10
                  CU-09 sube el minimo de la harina a 8
     Panificador  CU-06 produce 30 panes: consume 15 kg, la harina queda en 5
     Encargado    CU-10 la harina aparece en alerta, con su proveedor
     Venta        CU-07 vende 27 panes: el pan queda en 3
     Encargado    CU-10 el pan tambien aparece en alerta
                  CU-08 la venta figura en el historial
                  CU-12 el panel muestra la venta, el lote y la rentabilidad
                        estimada con el costo segun la receta
     Panificador  CU-06 no puede producir otros 20: faltan insumos

   Los movimientos llevan fecha 10/06/2002 para que el panel de ese dia solo
   cuente los de esta prueba, aunque las demas corran en paralelo. */

const DIA = '2002-06-10';
const CLAVE = 'integracion2026';
const USUARIOS = {
  encargado: ['integra.encargado@amasapan.test', 'Encargado'],
  panificador: ['integra.panificador@amasapan.test', 'Panificador'],
  venta: ['integra.venta@amasapan.test', 'Venta'],
};

let servidor, base;
const cookies = {};
const ids = {};

async function entrar(email) {
  const r = await fetch(`${base}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}

/** Hace un pedido como el usuario indicado y devuelve { estado, datos }. */
async function como(quien, ruta, { metodo = 'GET', cuerpo } = {}) {
  const opciones = { method: metodo, headers: { cookie: cookies[quien] } };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  const r = await fetch(`${base}${ruta}`, opciones);
  return { estado: r.status, datos: await r.json() };
}

async function alertasZTI() {
  const { datos } = await como('encargado', '/api/alertas');
  return datos.alertas.filter((a) => a.nombre.startsWith('ZTI'));
}

async function limpiar() {
  const usuarios = "(SELECT id_usuario FROM usuario WHERE email LIKE 'integra.%')";
  await consultar(`DELETE FROM venta WHERE id_usuario IN ${usuarios}`);
  await consultar(`DELETE FROM lote_produccion WHERE id_usuario IN ${usuarios}`);
  await consultar(`DELETE FROM ingreso_materia_prima WHERE id_usuario IN ${usuarios}`);
  await consultar("DELETE FROM receta WHERE nombre LIKE 'ZTI%'");
  await consultar("DELETE FROM producto WHERE nombre LIKE 'ZTI%'");
  await consultar("DELETE FROM materia_prima WHERE nombre LIKE 'ZTI%'");
  await consultar("DELETE FROM proveedor WHERE razon_social LIKE 'ZTI%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'integra.%'");
}

before(async () => {
  await limpiar();
  const hash = await hashearPassword(CLAVE);
  for (const [email, rol] of Object.values(USUARIOS)) {
    await consultar(
      `INSERT INTO usuario (nombre, email, password_hash, id_rol)
       VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4))`,
      [`Integracion ${rol}`, email, hash, rol]
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

test('el Encargado carga el proveedor, el insumo, el producto y la receta', async () => {
  const proveedor = await como('encargado', '/api/proveedores', {
    metodo: 'POST',
    cuerpo: { razonSocial: 'ZTI Molino', telefono: '341-000-1111' },
  });
  assert.equal(proveedor.estado, 201);
  ids.proveedor = proveedor.datos.proveedor.idProveedor;

  const harina = await como('encargado', '/api/materias-primas', {
    metodo: 'POST',
    cuerpo: {
      nombre: 'ZTI Harina', unidadMedida: 'kg', stockMinimo: 5, stockMaximo: 50,
      cantidad: 20, precioUnitario: 1000, idProveedor: ids.proveedor,
    },
  });
  assert.equal(harina.estado, 201);
  ids.harina = harina.datos.materiaPrima.idMateriaPrima;

  const pan = await como('encargado', '/api/productos', {
    metodo: 'POST',
    cuerpo: { nombre: 'ZTI Pan', precioVenta: 3000, stockMinimo: 5, stockMaximo: 40 },
  });
  assert.equal(pan.estado, 201);
  ids.pan = pan.datos.producto.idProducto;

  const receta = await como('encargado', '/api/recetas', {
    metodo: 'POST',
    cuerpo: {
      nombre: 'ZTI Receta pan', rendimientoUnidades: 10, idProducto: ids.pan,
      detalles: [{ idMateriaPrima: ids.harina, cantidadRequerida: 5 }],
    },
  });
  assert.equal(receta.estado, 201);
  ids.receta = receta.datos.receta.idReceta;
});

test('recien cargado, el pan sin stock ya figura en alerta y la harina no', async () => {
  const alertas = await alertasZTI();
  assert.deepEqual(alertas.map((a) => [a.nombre, a.sinStock]), [['ZTI Pan', true]]);
});

test('el Encargado configura el umbral minimo de la harina (CU-09)', async () => {
  // Caso de prueba 14 del documento, paso 1.
  const { estado } = await como('encargado', '/api/alertas/umbrales', {
    metodo: 'PUT',
    cuerpo: { umbrales: [{ origen: 'Insumo', id: ids.harina, stockMinimo: 8, stockMaximo: 50 }] },
  });
  assert.equal(estado, 200);
});

test('el Panificador produce un lote y la harina queda por debajo del minimo', async () => {
  const lote = await como('panificador', '/api/produccion', {
    metodo: 'POST',
    cuerpo: { idReceta: ids.receta, cantidadProducida: 30, fecha: DIA },
  });
  assert.equal(lote.estado, 201);

  // 30 panes con 5 kg cada 10 son 15 kg, al costo de compra de $1000.
  const { datos } = await como('encargado', '/api/materias-primas');
  const harina = datos.materiasPrimas.find((m) => m.idMateriaPrima === ids.harina);
  assert.equal(harina.stockActual, 5);
  assert.equal(harina.estado, 'Critico');
});

test('la alerta de la harina aparece sola y trae el proveedor para pedirle', async () => {
  const alertas = await alertasZTI();
  const harina = alertas.find((a) => a.nombre === 'ZTI Harina');
  assert.equal(harina.tipo, 'StockCritico');
  assert.equal(harina.cantidadSugerida, 45); // hasta el maximo de 50
  assert.equal(harina.proveedor, 'ZTI Molino');
  assert.equal(harina.telefonoProveedor, '341-000-1111');
  // El pan, con 30 unidades, salio de la alerta.
  assert.equal(alertas.find((a) => a.nombre === 'ZTI Pan'), undefined);
});

test('el mostrador vende y el pan entra en alerta', async () => {
  const venta = await como('venta', '/api/ventas', {
    metodo: 'POST',
    cuerpo: { fecha: `${DIA} 12:00`, detalles: [{ idProducto: ids.pan, cantidad: 27 }] },
  });
  assert.equal(venta.estado, 201);
  assert.equal(venta.datos.venta.total, 81000);

  const pan = (await alertasZTI()).find((a) => a.nombre === 'ZTI Pan');
  assert.equal(pan.tipo, 'StockCritico');
  assert.equal(pan.stockActual, 3);
  assert.equal(pan.cantidadSugerida, 37);
});

test('la venta figura en el historial del dia', async () => {
  const { datos } = await como(
    'encargado',
    `/api/ventas?desde=${DIA}&hasta=${DIA}&idProducto=${ids.pan}`
  );
  assert.equal(datos.ventas.length, 1);
  assert.equal(datos.ventas[0].detalles[0].cantidad, 27);
});

test('el panel del dia muestra la venta, el lote, la rentabilidad y el mas vendido', async () => {
  const { estado, datos } = await como('encargado', `/api/panel?desde=${DIA}&hasta=${DIA}`);
  assert.equal(estado, 200);
  assert.equal(datos.ventas.total, 81000);
  assert.equal(datos.ventas.unidades, 27);
  assert.deepEqual(datos.produccion, { lotes: 1, unidades: 30, costo: 15000 });
  assert.deepEqual(
    datos.productosMasVendidos.map((p) => [p.nombre, p.unidades, p.costoUnitario]),
    [['ZTI Pan', 27, 500]]
  );
  /* Caso de prueba 15: costo unitario segun la receta, 5 kg de harina a $1000
     cada 10 panes = $500. Vendidos 27 a $3000: $81000 - $13500 = $67500. */
  assert.equal(datos.indicadores.rentabilidadEstimada, 67500);
  assert.equal(datos.rentabilidad.margen, 83.33);
  assert.ok(datos.alertas.resumen.criticas >= 2);
});

test('sin harina suficiente no se puede producir otro lote, y nada cambia', async () => {
  const lote = await como('panificador', '/api/produccion', {
    metodo: 'POST',
    cuerpo: { idReceta: ids.receta, cantidadProducida: 20, fecha: DIA },
  });
  assert.equal(lote.estado, 409); // hacen falta 10 kg y hay 5

  const { datos } = await como('encargado', `/api/panel?desde=${DIA}&hasta=${DIA}`);
  assert.equal(datos.produccion.lotes, 1);
});

test('cada rol ve solo lo suyo: ni Venta ni Panificador entran a alertas o al panel', async () => {
  for (const quien of ['venta', 'panificador']) {
    assert.equal((await como(quien, '/api/alertas')).estado, 403);
    assert.equal((await como(quien, '/api/panel')).estado, 403);
  }
});
