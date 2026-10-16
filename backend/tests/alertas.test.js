import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* CU-09 y CU-10: umbrales y alertas de stock. Prefijo ZTA para aislar los datos.

   Las pruebas corren en paralelo con las de los otros modulos sobre la misma
   base, asi que el listado puede traer alertas ajenas. Por eso cada prueba
   mira solo las filas ZTA, y ninguna supone que el total global es fijo.

   El escenario cubre cada caso del criterio de estado:

     Insumo     actual  min  max   esperado
     Harina        0     10   50   critico, sin stock
     Azucar        5     10   40   critico
     Sal          10     10   20   critico (justo en el minimo)
     Levadura     15     10   20   sin alerta
     Agua         20      5   20   sin alerta (justo en el maximo)
     Manteca      30      5   20   sobrestock

     Producto   actual  min  max
     Pan           3     10   60   critico
     Medialuna    20     10   50   sin alerta
     Torta        12      2   10   sobrestock */

let servidor, base;
let cookieEncargado, cookieVenta, cookiePanificador;
const ids = {};

const ENCARGADO = 'alerta.encargado@amasapan.test';
const VENDEDOR = 'alerta.venta@amasapan.test';
const PANIFICADOR = 'alerta.panificador@amasapan.test';
const CLAVE = 'reponer2026';

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
  return fetch(`${base}${ruta}`, opciones);
}

/** Pide las alertas y se queda solo con las de esta prueba. */
async function alertasZTA(consulta = '') {
  const r = await pedir(`/api/alertas${consulta}`, { cookie: cookieEncargado });
  assert.equal(r.status, 200);
  const { alertas, resumen } = await r.json();
  return { alertas: alertas.filter((a) => a.nombre.startsWith('ZTA')), resumen };
}

const buscar = (alertas, nombre) => alertas.find((a) => a.nombre === nombre);

async function insumo(nombre, actual, minimo, maximo, idProveedor) {
  const { rows } = await consultar(
    `INSERT INTO materia_prima
       (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo, id_proveedor_habitual)
     VALUES ($1, 'kg', $2, $3, $4, $5)
     RETURNING id_materia_prima`,
    [nombre, actual, minimo, maximo, idProveedor]
  );
  ids[nombre] = rows[0].id_materia_prima;
}

async function producto(nombre, actual, minimo, maximo) {
  const { rows } = await consultar(
    `INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
     VALUES ($1, $2, 1000, $3, $4)
     RETURNING id_producto`,
    [nombre, actual, minimo, maximo]
  );
  ids[nombre] = rows[0].id_producto;
}

async function limpiar() {
  await consultar(
    `DELETE FROM venta WHERE id_usuario IN
       (SELECT id_usuario FROM usuario WHERE email LIKE 'alerta.%')`
  );
  await consultar("DELETE FROM receta WHERE nombre LIKE 'ZTA%'");
  await consultar("DELETE FROM producto WHERE nombre LIKE 'ZTA%'");
  await consultar("DELETE FROM materia_prima WHERE nombre LIKE 'ZTA%'");
  await consultar("DELETE FROM proveedor WHERE razon_social LIKE 'ZTA%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'alerta.%'");
}

before(async () => {
  await limpiar();
  await sembrarUsuario('Encargada alertas', ENCARGADO, 'Encargado');
  await sembrarUsuario('Vendedor alertas', VENDEDOR, 'Venta');
  await sembrarUsuario('Panificador alertas', PANIFICADOR, 'Panificador');

  const { rows } = await consultar(
    `INSERT INTO proveedor (razon_social, telefono)
     VALUES ('ZTA Molino del Sur', '341-555-0101')
     RETURNING id_proveedor`
  );
  const idMolino = rows[0].id_proveedor;

  await insumo('ZTA Harina', 0, 10, 50, idMolino);
  await insumo('ZTA Azucar', 5, 10, 40, null);
  await insumo('ZTA Sal', 10, 10, 20, null);
  await insumo('ZTA Levadura', 15, 10, 20, null);
  await insumo('ZTA Agua', 20, 5, 20, null);
  await insumo('ZTA Manteca', 30, 5, 20, null);

  await producto('ZTA Pan', 3, 10, 60);
  await producto('ZTA Medialuna', 20, 10, 50);
  await producto('ZTA Torta', 12, 2, 10);

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

test('sin sesion no se pueden ver las alertas', async () => {
  const r = await fetch(`${base}/api/alertas`);
  assert.equal(r.status, 401);
});

test('un usuario de Venta no puede ver las alertas', async () => {
  const r = await pedir('/api/alertas', { cookie: cookieVenta });
  assert.equal(r.status, 403);
});

test('un Panificador no puede ver las alertas', async () => {
  const r = await pedir('/api/alertas', { cookie: cookiePanificador });
  assert.equal(r.status, 403);
});

test('el resumen tambien es solo del Encargado', async () => {
  const r = await pedir('/api/alertas/resumen', { cookie: cookieVenta });
  assert.equal(r.status, 403);
});

/* ------------------------------------------- CU-10: deteccion de alertas */

test('un insumo por debajo del minimo genera una alerta de stock critico', async () => {
  const { alertas } = await alertasZTA();
  const azucar = buscar(alertas, 'ZTA Azucar');
  assert.ok(azucar, 'el azucar tiene 5 contra un minimo de 10');
  assert.equal(azucar.tipo, 'StockCritico');
  assert.equal(azucar.origen, 'Insumo');
  assert.equal(azucar.sinStock, false);
});

test('llegar justo al minimo ya es critico', async () => {
  const { alertas } = await alertasZTA();
  assert.equal(buscar(alertas, 'ZTA Sal')?.tipo, 'StockCritico');
});

test('un insumo en cero se marca ademas como sin stock', async () => {
  const { alertas } = await alertasZTA();
  const harina = buscar(alertas, 'ZTA Harina');
  assert.equal(harina.tipo, 'StockCritico');
  assert.equal(harina.sinStock, true);
});

test('un insumo por encima del maximo genera una alerta de sobrestock', async () => {
  const { alertas } = await alertasZTA();
  const manteca = buscar(alertas, 'ZTA Manteca');
  assert.equal(manteca.tipo, 'Sobrestock');
  assert.equal(manteca.sinStock, false);
});

test('los insumos dentro de los umbrales no generan alerta', async () => {
  const { alertas } = await alertasZTA();
  assert.equal(buscar(alertas, 'ZTA Levadura'), undefined);
  // Estar en el tope todavia es una carga valida, igual que en CU-05.
  assert.equal(buscar(alertas, 'ZTA Agua'), undefined, 'en el maximo no hay sobrestock');
});

test('los productos terminados tambien generan alertas', async () => {
  const { alertas } = await alertasZTA();
  const pan = buscar(alertas, 'ZTA Pan');
  assert.equal(pan.tipo, 'StockCritico');
  assert.equal(pan.origen, 'Producto');
  assert.equal(pan.unidad, 'u');
  assert.equal(buscar(alertas, 'ZTA Torta')?.tipo, 'Sobrestock');
  assert.equal(buscar(alertas, 'ZTA Medialuna'), undefined);
});

test('en un faltante sugiere cuanto reponer para volver al maximo', async () => {
  const { alertas } = await alertasZTA();
  assert.equal(buscar(alertas, 'ZTA Azucar').cantidadSugerida, 35); // 40 - 5
  assert.equal(buscar(alertas, 'ZTA Harina').cantidadSugerida, 50); // 50 - 0
  assert.equal(buscar(alertas, 'ZTA Pan').cantidadSugerida, 57);    // 60 - 3
});

test('en un sobrestock informa cuanto sobra por encima del maximo', async () => {
  const { alertas } = await alertasZTA();
  assert.equal(buscar(alertas, 'ZTA Manteca').cantidadSugerida, 10); // 30 - 20
  assert.equal(buscar(alertas, 'ZTA Torta').cantidadSugerida, 2);    // 12 - 10
});

test('la alerta de un insumo trae su proveedor habitual para pedirle', async () => {
  const { alertas } = await alertasZTA();
  const harina = buscar(alertas, 'ZTA Harina');
  assert.equal(harina.proveedor, 'ZTA Molino del Sur');
  assert.equal(harina.telefonoProveedor, '341-555-0101');
  assert.equal(buscar(alertas, 'ZTA Azucar').proveedor, null);
});

test('las alertas vienen de la mas urgente a la menos urgente', async () => {
  const { alertas } = await alertasZTA();
  /* Primero lo agotado, despues lo critico segun cuanto le queda respecto de
     su minimo (pan 3/10, azucar 5/10, sal 10/10) y al final el sobrestock. */
  assert.deepEqual(
    alertas.map((a) => a.nombre),
    ['ZTA Harina', 'ZTA Pan', 'ZTA Azucar', 'ZTA Sal', 'ZTA Manteca', 'ZTA Torta']
  );
});

/* ---------------------------------------------------- CU-10: filtros */

test('filtra por tipo de alerta', async () => {
  const { alertas } = await alertasZTA('?tipo=Sobrestock');
  assert.deepEqual(alertas.map((a) => a.nombre).sort(), ['ZTA Manteca', 'ZTA Torta']);
});

test('filtra por origen', async () => {
  const { alertas } = await alertasZTA('?origen=Producto');
  assert.ok(alertas.every((a) => a.origen === 'Producto'));
  assert.deepEqual(alertas.map((a) => a.nombre).sort(), ['ZTA Pan', 'ZTA Torta']);
});

test('combina los dos filtros', async () => {
  const { alertas } = await alertasZTA('?tipo=StockCritico&origen=Insumo');
  assert.deepEqual(alertas.map((a) => a.nombre), ['ZTA Harina', 'ZTA Azucar', 'ZTA Sal']);
});

test('un filtro vacio se toma como sin filtro', async () => {
  const { alertas } = await alertasZTA('?tipo=&origen=');
  assert.equal(alertas.length, 6);
});

test('rechaza un tipo de alerta que no existe', async () => {
  const r = await pedir('/api/alertas?tipo=Vencimiento', { cookie: cookieEncargado });
  assert.equal(r.status, 400);
});

test('rechaza un origen que no existe', async () => {
  const r = await pedir('/api/alertas?origen=Proveedor', { cookie: cookieEncargado });
  assert.equal(r.status, 400);
});

test('el resumen cuenta las mismas alertas que trae la lista', async () => {
  const r = await pedir('/api/alertas?origen=Insumo', { cookie: cookieEncargado });
  const { alertas, resumen } = await r.json();
  assert.equal(resumen.total, alertas.length);
  assert.equal(resumen.criticas + resumen.sobrestock, resumen.total);
  assert.equal(resumen.sinStock, alertas.filter((a) => a.sinStock).length);
});

test('el resumen de la barra devuelve solo los numeros', async () => {
  const r = await pedir('/api/alertas/resumen', { cookie: cookieEncargado });
  assert.equal(r.status, 200);
  const { resumen } = await r.json();
  assert.equal(resumen.criticas + resumen.sobrestock, resumen.total);
  // Hay al menos las cuatro criticas y los dos sobrestock de esta prueba.
  assert.ok(resumen.criticas >= 4);
  assert.ok(resumen.sobrestock >= 2);
});

/* ------------------------------------- integracion con los otros modulos */

test('una venta que deja un producto en su minimo genera la alerta en el momento', async () => {
  let { alertas } = await alertasZTA();
  assert.equal(buscar(alertas, 'ZTA Medialuna'), undefined);

  const r = await pedir('/api/ventas', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: ids['ZTA Medialuna'], cantidad: 10 }] },
  });
  assert.equal(r.status, 201);

  ({ alertas } = await alertasZTA());
  const medialuna = buscar(alertas, 'ZTA Medialuna');
  assert.equal(medialuna?.tipo, 'StockCritico', 'quedan 10 contra un minimo de 10');
  assert.equal(medialuna.cantidadSugerida, 40);
});

test('bajar el umbral minimo de un insumo (CU-04) apaga su alerta', async () => {
  /* Las alertas no se guardan: se recalculan con cada pedido. Por eso no hay
     que "cerrar" nada a mano cuando cambia la situacion. */
  const r = await pedir(`/api/materias-primas/${ids['ZTA Azucar']}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: { nombre: 'ZTA Azucar', unidadMedida: 'kg', stockMinimo: 4, stockMaximo: 40 },
  });
  assert.equal(r.status, 200);

  const { alertas } = await alertasZTA();
  assert.equal(buscar(alertas, 'ZTA Azucar'), undefined);
});

/* ------------------------------------------ CU-09: configurar umbrales */

function guardar(umbrales, cookie = cookieEncargado) {
  return pedir('/api/alertas/umbrales', { cookie, metodo: 'PUT', cuerpo: { umbrales } });
}

async function umbralesDe(nombre) {
  const { umbrales } = await (await pedir('/api/alertas/umbrales', { cookie: cookieEncargado })).json();
  return umbrales.find((u) => u.nombre === nombre);
}

test('la tabla de umbrales trae todos los insumos y productos, esten o no en alerta', async () => {
  const r = await pedir('/api/alertas/umbrales', { cookie: cookieEncargado });
  assert.equal(r.status, 200);
  const { umbrales } = await r.json();
  const levadura = umbrales.find((u) => u.nombre === 'ZTA Levadura');
  assert.deepEqual(
    { origen: levadura.origen, minimo: levadura.stockMinimo, maximo: levadura.stockMaximo },
    { origen: 'Insumo', minimo: 10, maximo: 20 }
  );
  assert.equal(umbrales.find((u) => u.nombre === 'ZTA Medialuna').unidad, 'u');
});

test('solo el Encargado configura umbrales', async () => {
  assert.equal((await pedir('/api/alertas/umbrales', { cookie: cookieVenta })).status, 403);
  const r = await guardar(
    [{ origen: 'Insumo', id: ids['ZTA Levadura'], stockMinimo: 1, stockMaximo: 2 }],
    cookiePanificador
  );
  assert.equal(r.status, 403);
});

test('subir el minimo por encima del stock genera la alerta en el momento', async () => {
  /* Caso de prueba 14 del documento: se configura el umbral y el sistema
     muestra el item en estado critico. La levadura tiene 15. */
  const r = await guardar([
    { origen: 'Insumo', id: ids['ZTA Levadura'], stockMinimo: 20, stockMaximo: 40 },
  ]);
  assert.equal(r.status, 200);

  const { alertas } = await alertasZTA();
  const levadura = buscar(alertas, 'ZTA Levadura');
  assert.equal(levadura?.tipo, 'StockCritico');
  assert.equal(levadura.cantidadSugerida, 25); // hasta el nuevo maximo de 40
});

test('guarda varios items de una vez, insumos y productos', async () => {
  const r = await guardar([
    { origen: 'Insumo', id: ids['ZTA Agua'], stockMinimo: 2, stockMaximo: 30 },
    { origen: 'Producto', id: ids['ZTA Torta'], stockMinimo: 2, stockMaximo: 15 },
  ]);
  assert.equal(r.status, 200);
  assert.equal((await umbralesDe('ZTA Agua')).stockMaximo, 30);
  assert.equal((await umbralesDe('ZTA Torta')).stockMaximo, 15);

  // La torta (12) ya no supera el maximo: su sobrestock se apago.
  const { alertas } = await alertasZTA();
  assert.equal(buscar(alertas, 'ZTA Torta'), undefined);
});

test('rechaza un minimo igual al maximo (flujo alternativo 2.a)', async () => {
  const r = await guardar([
    { origen: 'Insumo', id: ids['ZTA Sal'], nombre: 'ZTA Sal', stockMinimo: 10, stockMaximo: 10 },
  ]);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ZTA Sal tiene que ser menor que el maximo/);
});

test('rechaza un minimo mayor que el maximo', async () => {
  const r = await guardar([
    { origen: 'Producto', id: ids['ZTA Pan'], stockMinimo: 50, stockMaximo: 20 },
  ]);
  assert.equal(r.status, 400);
});

test('si un item esta mal no se guarda ninguno', async () => {
  // Postcondicion de fracaso de CU-09: "los umbrales no se guardan".
  const r = await guardar([
    { origen: 'Insumo', id: ids['ZTA Agua'], stockMinimo: 1, stockMaximo: 99 },
    { origen: 'Insumo', id: ids['ZTA Sal'], stockMinimo: 30, stockMaximo: 20 },
  ]);
  assert.equal(r.status, 400);
  assert.equal((await umbralesDe('ZTA Agua')).stockMaximo, 30, 'el agua conserva su umbral anterior');
});

test('si un item no existe tampoco se guarda el resto', async () => {
  const r = await guardar([
    { origen: 'Insumo', id: ids['ZTA Agua'], stockMinimo: 1, stockMaximo: 99 },
    { origen: 'Insumo', id: 999999999, stockMinimo: 1, stockMaximo: 2 },
  ]);
  assert.equal(r.status, 404);
  assert.equal((await umbralesDe('ZTA Agua')).stockMaximo, 30);
});

test('rechaza umbrales negativos, vacios o con decimales en productos', async () => {
  const casos = [
    { origen: 'Insumo', id: ids['ZTA Sal'], stockMinimo: -1, stockMaximo: 5 },
    { origen: 'Insumo', id: ids['ZTA Sal'], stockMinimo: '', stockMaximo: 5 },
    { origen: 'Producto', id: ids['ZTA Pan'], stockMinimo: 2.5, stockMaximo: 10 },
    { origen: 'Proveedor', id: 1, stockMinimo: 1, stockMaximo: 2 },
  ];
  for (const caso of casos) {
    assert.equal((await guardar([caso])).status, 400, JSON.stringify(caso));
  }
});

test('los insumos aceptan umbrales con decimales', async () => {
  const r = await guardar([
    { origen: 'Insumo', id: ids['ZTA Sal'], stockMinimo: 10.5, stockMaximo: 20.25 },
  ]);
  assert.equal(r.status, 200);
  assert.equal((await umbralesDe('ZTA Sal')).stockMinimo, 10.5);
});

test('rechaza una lista vacia o un item repetido', async () => {
  assert.equal((await guardar([])).status, 400);
  const item = { origen: 'Insumo', id: ids['ZTA Sal'], stockMinimo: 1, stockMaximo: 2 };
  assert.equal((await guardar([item, item])).status, 400);
});

/* ----------------------------------------- CU-10: detalle ampliado */

async function detalle(origen, id) {
  const r = await pedir(`/api/alertas/${origen}/${id}`, { cookie: cookieEncargado });
  return { estado: r.status, datos: (await r.json()).detalle };
}

test('el detalle de un insumo trae el proveedor, los ingresos y las recetas', async () => {
  const { estado, datos } = await detalle('Insumo', ids['ZTA Harina']);
  assert.equal(estado, 200);
  assert.equal(datos.tipo, 'StockCritico');
  assert.equal(datos.sinStock, true);
  assert.deepEqual(datos.proveedor, {
    razonSocial: 'ZTA Molino del Sur', telefono: '341-555-0101', email: null,
  });
  assert.deepEqual(datos.ultimosIngresos, []);
  assert.equal(datos.consumoUltimos30Dias, 0);
  assert.deepEqual(datos.recetas, []);
});

test('el detalle de un producto trae su precio, su costo segun receta y lo vendido', async () => {
  // Receta: 2 kg de harina a $1000 rinden 4 panes -> $500 por pan (RF-06).
  await consultar('UPDATE materia_prima SET costo_promedio = 1000 WHERE id_materia_prima = $1', [ids['ZTA Harina']]);
  const { rows } = await consultar(
    `INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
     VALUES ('ZTA Receta pan', 4, $1) RETURNING id_receta`,
    [ids['ZTA Pan']]
  );
  await consultar(
    `INSERT INTO receta_detalle (cantidad_requerida, id_receta, id_materia_prima)
     VALUES (2, $1, $2)`,
    [rows[0].id_receta, ids['ZTA Harina']]
  );

  const { datos } = await detalle('Producto', ids['ZTA Pan']);
  assert.equal(datos.precioVenta, 1000);
  assert.equal(datos.costoUnitario, 500);
  assert.deepEqual(datos.ultimosLotes, []);

  // La harina ahora figura como insumo de esa receta.
  assert.deepEqual((await detalle('Insumo', ids['ZTA Harina'])).datos.recetas, ['ZTA Receta pan']);
});

test('un producto sin receta tiene costo desconocido, no cero', async () => {
  const { datos } = await detalle('Producto', ids['ZTA Medialuna']);
  assert.equal(datos.costoUnitario, null);
  assert.equal(datos.vendidoUltimos7Dias, 10); // la venta de la prueba de integracion
});

test('el detalle de un item sin alerta informa su estado sin sugerencia', async () => {
  const { datos } = await detalle('Insumo', ids['ZTA Agua']);
  assert.equal(datos.tipo, null);
  assert.equal(datos.cantidadSugerida, null);
});

test('el detalle de un item que no existe da 404', async () => {
  assert.equal((await detalle('Insumo', 999999999)).estado, 404);
  assert.equal((await detalle('Proveedor', ids['ZTA Harina'])).estado, 404);
});
