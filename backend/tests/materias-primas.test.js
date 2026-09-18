import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* Pruebas de CU-03 (registrar materia prima), CU-04 (editarla) y CU-05
   (consultar el stock con su estado). Prefijo ZTEST03 para aislarlas. */

let servidor, base, cookieEncargado, cookieVenta, idProveedor;

const ENCARGADO = 'cu03.encargado@amasapan.test';
const VENDEDOR = 'cu03.venta@amasapan.test';
const CLAVE = 'harina2026';

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
  return fetch(`${base}/api/materias-primas${ruta}`, opciones);
}

/** Alta valida, con los campos que pide CU-03. Se le pisan los que hagan falta. */
function alta(cambios = {}) {
  return {
    nombre: 'ZTEST03 Harina',
    unidadMedida: 'kg',
    stockMinimo: 10,
    stockMaximo: 100,
    cantidad: 50,
    precioUnitario: 800,
    fechaVencimiento: '2027-06-30',
    idProveedor,
    ...cambios,
  };
}

async function limpiar() {
  await consultar("DELETE FROM ingreso_materia_prima WHERE id_materia_prima IN (SELECT id_materia_prima FROM materia_prima WHERE nombre LIKE 'ZTEST03%')");
  await consultar("DELETE FROM materia_prima WHERE nombre LIKE 'ZTEST03%'");
  await consultar("DELETE FROM proveedor WHERE razon_social LIKE 'ZTEST03%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'cu03.%'");
}

before(async () => {
  await limpiar();
  await sembrarUsuario('Encargada CU03', ENCARGADO, 'Encargado');
  await sembrarUsuario('Vendedor CU03', VENDEDOR, 'Venta');

  const { rows } = await consultar(
    'INSERT INTO proveedor (razon_social) VALUES ($1) RETURNING id_proveedor',
    ['ZTEST03 Proveedor de prueba']
  );
  idProveedor = rows[0].id_proveedor;

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

test('sin sesion no se puede consultar el stock', async () => {
  const r = await fetch(`${base}/api/materias-primas`);
  assert.equal(r.status, 401);
});

test('un usuario de Venta no puede consultar el stock', async () => {
  const r = await pedir('', { cookie: cookieVenta });
  assert.equal(r.status, 403);
});

/* ------------------------------------------ CU-03: registrar materia prima */

test('el Encargado registra una materia prima con su stock inicial', async () => {
  const r = await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: alta() });

  assert.equal(r.status, 201);
  const { materiaPrima } = await r.json();
  assert.equal(materiaPrima.nombre, 'ZTEST03 Harina');
  assert.equal(materiaPrima.unidadMedida, 'kg');
  assert.equal(materiaPrima.stockActual, 50, 'el stock inicial es la cantidad ingresada');
  assert.equal(materiaPrima.costoPromedio, 800, 'el costo arranca en el precio pagado');
  assert.equal(materiaPrima.stockMinimo, 10);
  assert.equal(materiaPrima.stockMaximo, 100);
});

test('el alta deja registrado el ingreso de mercaderia', async () => {
  // Sin este registro se perderia de donde salio el stock inicial, a que
  // precio se compro y cuando vence.
  const { rows } = await consultar(
    `SELECT i.cantidad, i.precio_unitario, i.fecha_vencimiento, i.id_proveedor
       FROM ingreso_materia_prima i
       JOIN materia_prima m ON m.id_materia_prima = i.id_materia_prima
      WHERE m.nombre = 'ZTEST03 Harina'`
  );

  assert.equal(rows.length, 1, 'el alta tiene que generar un ingreso');
  assert.equal(Number(rows[0].cantidad), 50);
  assert.equal(Number(rows[0].precio_unitario), 800);
  assert.equal(rows[0].id_proveedor, idProveedor);
  assert.ok(rows[0].fecha_vencimiento, 'la fecha de vencimiento tiene que quedar guardada');
});

test('la fecha de vencimiento es opcional', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTEST03 Sal', fechaVencimiento: null }),
  });
  assert.equal(r.status, 201);
});

test('rechaza un proveedor que no existe y no crea nada', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTEST03 Fantasma', idProveedor: 999999 }),
  });
  assert.equal(r.status, 400);

  const { rows } = await consultar(
    "SELECT 1 FROM materia_prima WHERE nombre = 'ZTEST03 Fantasma'"
  );
  assert.equal(rows.length, 0, 'la transaccion tiene que haber revertido el alta');
});

test('rechaza una cantidad inicial de cero', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTEST03 Cero', cantidad: 0 }),
  });
  assert.equal(r.status, 400);
});

test('rechaza un stock maximo menor que el minimo', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTEST03 Umbrales', stockMinimo: 100, stockMaximo: 10 }),
  });
  assert.equal(r.status, 400);
});

test('rechaza el alta sin los datos obligatorios', async () => {
  const r = await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: { nombre: 'ZTEST03 Pelada' } });
  assert.equal(r.status, 400);
});

/* ------------------------------------------- CU-05: consultar stock/estado */

test('el listado calcula el estado de cada insumo', async () => {
  await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: alta({ nombre: 'ZTEST03 Critica', cantidad: 5 }) });
  await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: alta({ nombre: 'ZTEST03 Sobrante', cantidad: 150 }) });

  const { materiasPrimas } = await (await pedir('', { cookie: cookieEncargado })).json();
  const porNombre = (n) => materiasPrimas.find((m) => m.nombre === n);

  assert.equal(porNombre('ZTEST03 Critica').estado, 'Critico', '5 esta por debajo del minimo de 10');
  assert.equal(porNombre('ZTEST03 Harina').estado, 'OK', '50 esta entre 10 y 100');
  assert.equal(porNombre('ZTEST03 Sobrante').estado, 'Sobrestock', '150 supera el maximo de 100');
});

test('el listado trae el nombre del proveedor, no solo su id', async () => {
  const { materiasPrimas } = await (await pedir('', { cookie: cookieEncargado })).json();
  const harina = materiasPrimas.find((m) => m.nombre === 'ZTEST03 Harina');
  assert.equal(harina.proveedorHabitual, 'ZTEST03 Proveedor de prueba');
});

test('se puede filtrar el listado por estado', async () => {
  const r = await pedir('?estado=Critico', { cookie: cookieEncargado });
  assert.equal(r.status, 200);

  const { materiasPrimas } = await r.json();
  assert.ok(materiasPrimas.length > 0, 'tiene que haber al menos un insumo critico');
  assert.ok(
    materiasPrimas.every((m) => m.estado === 'Critico'),
    'el filtro dejo pasar insumos de otro estado'
  );
});

test('se puede ordenar el listado por stock', async () => {
  const { materiasPrimas } = await (await pedir('?orden=stock', { cookie: cookieEncargado })).json();
  const stocks = materiasPrimas.map((m) => m.stockActual);
  const ordenados = [...stocks].sort((a, b) => a - b);
  assert.deepEqual(stocks, ordenados, 'el listado no vino ordenado por stock');
});

/* --------------------------------------------- CU-04: editar materia prima */

test('el Encargado edita una materia prima', async () => {
  const { materiasPrimas } = await (await pedir('', { cookie: cookieEncargado })).json();
  const { idMateriaPrima } = materiasPrimas.find((m) => m.nombre === 'ZTEST03 Sal');

  const r = await pedir(`/${idMateriaPrima}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: {
      nombre: 'ZTEST03 Sal fina',
      unidadMedida: 'g',
      stockMinimo: 20,
      stockMaximo: 200,
      idProveedorHabitual: idProveedor,
    },
  });

  assert.equal(r.status, 200);
  const { materiaPrima } = await r.json();
  assert.equal(materiaPrima.nombre, 'ZTEST03 Sal fina');
  assert.equal(materiaPrima.unidadMedida, 'g');
  assert.equal(materiaPrima.stockMinimo, 20);
});

test('editar no toca el stock ni el costo', async () => {
  // El stock solo cambia por ingresos y consumos, nunca editando la ficha.
  const { materiasPrimas } = await (await pedir('', { cookie: cookieEncargado })).json();
  const sal = materiasPrimas.find((m) => m.nombre === 'ZTEST03 Sal fina');

  assert.equal(sal.stockActual, 50, 'la edicion piso el stock');
  assert.equal(sal.costoPromedio, 800, 'la edicion piso el costo');
});

test('editar deja quitar el proveedor habitual', async () => {
  const { materiasPrimas } = await (await pedir('', { cookie: cookieEncargado })).json();
  const { idMateriaPrima } = materiasPrimas.find((m) => m.nombre === 'ZTEST03 Sal fina');

  const r = await pedir(`/${idMateriaPrima}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: {
      nombre: 'ZTEST03 Sal fina',
      unidadMedida: 'g',
      stockMinimo: 20,
      stockMaximo: 200,
      idProveedorHabitual: null,
    },
  });

  assert.equal(r.status, 200);
  assert.equal((await r.json()).materiaPrima.proveedorHabitual, null);
});

test('editar una materia prima inexistente da 404', async () => {
  const r = await pedir('/999999', {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: { nombre: 'ZTEST03 Fantasma', unidadMedida: 'kg', stockMinimo: 1, stockMaximo: 2 },
  });
  assert.equal(r.status, 404);
});
