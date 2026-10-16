import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* CU-07: registrar venta. Prefijo ZTV para aislar los datos de prueba.

   Hay dos productos cargados: el cañoncito a $500 con 100 unidades de stock,
   y el pan a $2000 con 20 unidades. Alcanza para probar una venta de varias
   lineas y una venta que se pasa del stock disponible. */

let servidor, base;
let cookieVenta, cookieEncargado, cookiePanificador;
let idCañoncito, idPan;

const VENDEDOR = 'venta.vendedor@amasapan.test';
const ENCARGADO = 'venta.encargado@amasapan.test';
const PANIFICADOR = 'venta.panificador@amasapan.test';
const CLAVE = 'mostrador2026';

const PRECIO_CAÑONCITO = 500;
const PRECIO_PAN = 2000;
const STOCK_CAÑONCITO = 100;
const STOCK_PAN = 20;

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
  return fetch(`${base}/api/ventas${ruta}`, opciones);
}

/** Lee el stock actual de un producto directo de la base. */
async function stock(idProducto) {
  const { rows } = await consultar(
    'SELECT stock_actual FROM producto WHERE id_producto = $1',
    [idProducto]
  );
  return Number(rows[0].stock_actual);
}

/** Deja los stocks como al principio y borra las ventas de la prueba. */
async function reiniciar() {
  await consultar(
    `DELETE FROM detalle_venta
      WHERE id_producto IN (SELECT id_producto FROM producto WHERE nombre LIKE 'ZTV%')`
  );
  await consultar("DELETE FROM venta WHERE id_usuario IN (SELECT id_usuario FROM usuario WHERE email LIKE 'venta.%')");
  await consultar('UPDATE producto SET stock_actual = $1 WHERE id_producto = $2', [STOCK_CAÑONCITO, idCañoncito]);
  await consultar('UPDATE producto SET stock_actual = $1 WHERE id_producto = $2', [STOCK_PAN, idPan]);
}

async function limpiar() {
  await consultar(
    `DELETE FROM detalle_venta
      WHERE id_producto IN (SELECT id_producto FROM producto WHERE nombre LIKE 'ZTV%')`
  );
  await consultar("DELETE FROM venta WHERE id_usuario IN (SELECT id_usuario FROM usuario WHERE email LIKE 'venta.%')");
  await consultar("DELETE FROM producto WHERE nombre LIKE 'ZTV%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'venta.%'");
}

before(async () => {
  await limpiar();
  await sembrarUsuario('Vendedora mostrador', VENDEDOR, 'Venta');
  await sembrarUsuario('Encargada ventas', ENCARGADO, 'Encargado');
  await sembrarUsuario('Panificador ventas', PANIFICADOR, 'Panificador');

  const producto = async (nombre, precio, stockInicial) => {
    const { rows } = await consultar(
      `INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
       VALUES ($1, $2, $3, 5, 1000) RETURNING id_producto`,
      [nombre, stockInicial, precio]
    );
    return rows[0].id_producto;
  };
  idCañoncito = await producto('ZTV Cañoncito', PRECIO_CAÑONCITO, STOCK_CAÑONCITO);
  idPan = await producto('ZTV Pan frances', PRECIO_PAN, STOCK_PAN);

  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  cookieVenta = await entrar(VENDEDOR);
  cookieEncargado = await entrar(ENCARGADO);
  cookiePanificador = await entrar(PANIFICADOR);
});

after(async () => {
  await limpiar();
  servidor.close();
  await pool.end();
});

/* ---------------------------------------------------------------- permisos */

test('sin sesion no se puede registrar una venta', async () => {
  const r = await fetch(`${base}/api/ventas`, { method: 'POST' });
  assert.equal(r.status, 401);
});

test('el rol Venta puede registrar una venta', async () => {
  // CU-07 es el primer caso de uso del rol Venta: hasta ahora entraba al
  // sistema y no tenia ninguna pantalla propia.
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idCañoncito, cantidad: 3 }] },
  });
  assert.equal(r.status, 201);
});

test('el Encargado tambien puede registrar una venta', async () => {
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idCañoncito, cantidad: 1 }] },
  });
  assert.equal(r.status, 201);
});

test('el Panificador tambien puede registrar una venta', async () => {
  await reiniciar();
  const r = await pedir('', {
    cookie: cookiePanificador,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idCañoncito, cantidad: 1 }] },
  });
  assert.equal(r.status, 201);
});

/* -------------------------------------------------- la venta y sus efectos */

test('registrar una venta descuenta el stock del producto', async () => {
  await reiniciar();
  await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idCañoncito, cantidad: 12 }] },
  });

  assert.equal(await stock(idCañoncito), STOCK_CAÑONCITO - 12);
});

test('el total de la venta es la suma de los subtotales', async () => {
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: {
      detalles: [
        { idProducto: idCañoncito, cantidad: 10 },
        { idProducto: idPan, cantidad: 2 },
      ],
    },
  });
  const { venta } = await r.json();

  // 10 x 500 + 2 x 2000 = 9000
  assert.equal(venta.total, 10 * PRECIO_CAÑONCITO + 2 * PRECIO_PAN);
});

test('una venta de varias lineas descuenta el stock de cada producto', async () => {
  await reiniciar();
  await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: {
      detalles: [
        { idProducto: idCañoncito, cantidad: 10 },
        { idProducto: idPan, cantidad: 2 },
      ],
    },
  });

  assert.equal(await stock(idCañoncito), STOCK_CAÑONCITO - 10);
  assert.equal(await stock(idPan), STOCK_PAN - 2);
});

test('sin precio en el pedido se usa el precio de lista del producto', async () => {
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idCañoncito, cantidad: 2 }] },
  });
  const { venta } = await r.json();

  assert.equal(venta.detalles[0].precioUnitario, PRECIO_CAÑONCITO);
});

test('guarda el precio que se cargo y no el de lista', async () => {
  /* CU-07 pide el precio en el formulario, asi que se puede vender a un
     precio distinto del de lista (una promocion, un redondeo). El precio de
     la venta queda congelado en detalle_venta. */
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idCañoncito, cantidad: 2, precioUnitario: 450 }] },
  });
  const { venta } = await r.json();

  assert.equal(venta.detalles[0].precioUnitario, 450);
  assert.equal(venta.total, 900);
});

/* -------------------------------------------------------- falta de stock */

test('una venta sin stock suficiente da 409', async () => {
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idPan, cantidad: STOCK_PAN + 1 }] },
  });

  assert.equal(r.status, 409);
});

test('el mensaje de stock insuficiente nombra el producto faltante', async () => {
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idPan, cantidad: STOCK_PAN + 1 }] },
  });
  const { error } = await r.json();

  assert.match(error, /ZTV Pan frances/);
});

test('una venta sin stock no modifica nada', async () => {
  /* La venta entera se cae: ni se descuenta la linea que si tenia stock, ni
     queda la venta registrada a medias. */
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: {
      detalles: [
        { idProducto: idCañoncito, cantidad: 5 },
        { idProducto: idPan, cantidad: STOCK_PAN + 1 },
      ],
    },
  });

  assert.equal(r.status, 409);
  assert.equal(await stock(idCañoncito), STOCK_CAÑONCITO);
  assert.equal(await stock(idPan), STOCK_PAN);
});

test('el mismo producto en dos lineas suma para controlar el stock', async () => {
  // Dos lineas de 15 contra un stock de 20: por separado cada una entra, pero
  // juntas se pasan. El control tiene que mirar el total por producto.
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: {
      detalles: [
        { idProducto: idPan, cantidad: 15 },
        { idProducto: idPan, cantidad: 15 },
      ],
    },
  });

  assert.equal(r.status, 409);
  assert.equal(await stock(idPan), STOCK_PAN);
});

/* ------------------------------------------------------------ validaciones */

test('rechaza una cantidad que no es un entero mayor que cero', async () => {
  await reiniciar();
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idCañoncito, cantidad: 0 }] },
  });

  assert.equal(r.status, 400);
});

test('rechaza una venta sin productos', async () => {
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [] },
  });

  assert.equal(r.status, 400);
});

test('rechaza un producto que no existe', async () => {
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: 999999, cantidad: 1 }] },
  });

  assert.equal(r.status, 400);
});

test('rechaza un precio negativo', async () => {
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles: [{ idProducto: idCañoncito, cantidad: 1, precioUnitario: -10 }] },
  });

  assert.equal(r.status, 400);
});

/* ------------------------------------------- CU-08: historial de ventas */

/** Registra una venta y devuelve el cuerpo de la respuesta. */
async function vender(detalles, fecha) {
  const r = await pedir('', {
    cookie: cookieVenta,
    metodo: 'POST',
    cuerpo: { detalles, fecha },
  });
  const { venta } = await r.json();
  return venta;
}

/** Pide el historial con los filtros indicados. */
async function historial(consulta = '') {
  const r = await pedir(consulta, { cookie: cookieVenta });
  return { estado: r.status, cuerpo: await r.json() };
}

/* Las ventas de prueba se fechan en 2024 y el historial se consulta acotado a
   ese año. El listado devuelve todas las ventas de la base, no solo las de la
   prueba, asi que contar el total haria que estos tests se rompieran en
   cuanto la base tenga ventas de verdad. */
const ANIO = '?desde=2024-01-01&hasta=2024-12-31';
const enAnio = (resto = '') => `${ANIO}${resto}`;

test('sin sesion no se puede consultar el historial', async () => {
  const r = await fetch(`${base}/api/ventas`);
  assert.equal(r.status, 401);
});

test('el historial lista las ventas registradas', async () => {
  await reiniciar();
  await vender([{ idProducto: idCañoncito, cantidad: 2 }], '2024-05-01');
  await vender([{ idProducto: idPan, cantidad: 1 }], '2024-05-02');

  const { estado, cuerpo } = await historial(enAnio());

  assert.equal(estado, 200);
  assert.equal(cuerpo.ventas.length, 2);
});

test('el historial trae las ventas mas nuevas primero', async () => {
  await reiniciar();
  const vieja = await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-03-01');
  const nueva = await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-09-01');

  const { cuerpo } = await historial(enAnio());

  assert.equal(cuerpo.ventas[0].idVenta, nueva.idVenta);
  assert.equal(cuerpo.ventas[1].idVenta, vieja.idVenta);
});

test('cada venta del historial trae su detalle', async () => {
  await reiniciar();
  await vender([
    { idProducto: idCañoncito, cantidad: 4 },
    { idProducto: idPan, cantidad: 1 },
  ], '2024-07-01');

  const { cuerpo } = await historial(enAnio());
  const [venta] = cuerpo.ventas;

  assert.equal(venta.detalles.length, 2);
  assert.equal(venta.total, 4 * PRECIO_CAÑONCITO + PRECIO_PAN);
});

test('el historial se puede filtrar por producto', async () => {
  await reiniciar();
  await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-04-01');
  await vender([{ idProducto: idPan, cantidad: 1 }], '2024-04-02');

  const { cuerpo } = await historial(enAnio(`&idProducto=${idPan}`));

  assert.equal(cuerpo.ventas.length, 1);
  assert.equal(cuerpo.ventas[0].detalles[0].idProducto, idPan);
});

test('filtrar por producto trae la venta completa, no solo esa linea', async () => {
  /* Si una venta llevo dos productos y se filtra por uno, la venta aparece
     con su detalle entero: el total que se muestra es el que se cobro. */
  await reiniciar();
  await vender([
    { idProducto: idCañoncito, cantidad: 2 },
    { idProducto: idPan, cantidad: 1 },
  ], '2024-04-03');

  const { cuerpo } = await historial(enAnio(`&idProducto=${idPan}`));

  assert.equal(cuerpo.ventas.length, 1);
  assert.equal(cuerpo.ventas[0].detalles.length, 2);
});

test('el historial se puede filtrar desde una fecha', async () => {
  await reiniciar();
  await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-03-01');
  const nueva = await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-09-01');

  const { cuerpo } = await historial('?desde=2024-06-01&hasta=2024-12-31');

  assert.equal(cuerpo.ventas.length, 1);
  assert.equal(cuerpo.ventas[0].idVenta, nueva.idVenta);
});

test('el historial se puede filtrar hasta una fecha', async () => {
  await reiniciar();
  const vieja = await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-03-01');
  await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-09-01');

  const { cuerpo } = await historial('?desde=2024-01-01&hasta=2024-06-01');

  assert.equal(cuerpo.ventas.length, 1);
  assert.equal(cuerpo.ventas[0].idVenta, vieja.idVenta);
});

test('el filtro hasta incluye las ventas de ese mismo dia', async () => {
  // Una venta del 1 de marzo a las 14:30 tiene que entrar en "hasta el 1 de
  // marzo". Comparar el timestamp crudo contra la medianoche la dejaria afuera.
  await reiniciar();
  await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-03-01 14:30');

  const { cuerpo } = await historial('?desde=2024-03-01&hasta=2024-03-01');

  assert.equal(cuerpo.ventas.length, 1);
});

test('el historial sin resultados devuelve una lista vacia', async () => {
  await reiniciar();
  await vender([{ idProducto: idCañoncito, cantidad: 1 }], '2024-03-01');

  const { estado, cuerpo } = await historial('?desde=2024-08-01&hasta=2024-12-31');

  assert.equal(estado, 200);
  assert.deepEqual(cuerpo.ventas, []);
});

test('rechaza una fecha que no se entiende', async () => {
  const { estado } = await historial('?desde=el-martes');
  assert.equal(estado, 400);
});

test('rechaza un idProducto que no es un numero', async () => {
  const { estado } = await historial('?idProducto=cañoncito');
  assert.equal(estado, 400);
});
