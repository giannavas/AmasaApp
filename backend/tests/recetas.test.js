import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

/* Recetas: que insumos y en que cantidad lleva cada producto. Es la
   precondicion de CU-06. Prefijo ZTR para aislar los datos de prueba. */

let servidor, base, cookieEncargado, cookieVenta;
let idProducto, idProductoSinReceta, idHarina, idAzucar;

const ENCARGADO = 'rec.encargado@amasapan.test';
const VENDEDOR = 'rec.venta@amasapan.test';
const CLAVE = 'facturas2026';

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
  return fetch(`${base}/api/recetas${ruta}`, opciones);
}

function alta(cambios = {}) {
  return {
    nombre: 'ZTR Receta de cañoncitos',
    rendimientoUnidades: 24,
    idProducto,
    detalles: [
      { idMateriaPrima: idHarina, cantidadRequerida: 2.5 },
      { idMateriaPrima: idAzucar, cantidadRequerida: 0.8 },
    ],
    ...cambios,
  };
}

async function limpiar() {
  // receta_detalle cae en cascada con su receta; materia_prima y producto
  // estan protegidos por RESTRICT, asi que las recetas van primero.
  await consultar("DELETE FROM receta WHERE nombre LIKE 'ZTR%'");
  await consultar("DELETE FROM producto WHERE nombre LIKE 'ZTR%'");
  await consultar("DELETE FROM materia_prima WHERE nombre LIKE 'ZTR%'");
  await consultar("DELETE FROM proveedor WHERE razon_social LIKE 'ZTR%'");
  await consultar("DELETE FROM usuario WHERE email LIKE 'rec.%'");
}

before(async () => {
  await limpiar();
  await sembrarUsuario('Encargada recetas', ENCARGADO, 'Encargado');
  await sembrarUsuario('Vendedor recetas', VENDEDOR, 'Venta');

  const { rows: prov } = await consultar(
    'INSERT INTO proveedor (razon_social) VALUES ($1) RETURNING id_proveedor',
    ['ZTR Proveedor']
  );

  const insumo = async (nombre) => {
    const { rows } = await consultar(
      `INSERT INTO materia_prima
         (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo,
          costo_promedio, id_proveedor_habitual)
       VALUES ($1, 'kg', 100, 10, 500, 800, $2) RETURNING id_materia_prima`,
      [nombre, prov[0].id_proveedor]
    );
    return rows[0].id_materia_prima;
  };
  idHarina = await insumo('ZTR Harina');
  idAzucar = await insumo('ZTR Azucar');

  const producto = async (nombre) => {
    const { rows } = await consultar(
      `INSERT INTO producto (nombre, precio_venta, stock_minimo, stock_maximo)
       VALUES ($1, 500, 10, 100) RETURNING id_producto`,
      [nombre]
    );
    return rows[0].id_producto;
  };
  idProducto = await producto('ZTR Cañoncito');
  idProductoSinReceta = await producto('ZTR Pan frances');

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

test('sin sesion no se pueden ver las recetas', async () => {
  const r = await fetch(`${base}/api/recetas`);
  assert.equal(r.status, 401);
});

test('un usuario de Venta no puede crear recetas', async () => {
  const r = await pedir('', { cookie: cookieVenta, metodo: 'POST', cuerpo: alta() });
  assert.equal(r.status, 403);
});

/* ------------------------------------------------------------------ crear */

test('el Encargado crea una receta con sus insumos', async () => {
  const r = await pedir('', { cookie: cookieEncargado, metodo: 'POST', cuerpo: alta() });

  assert.equal(r.status, 201);
  const { receta } = await r.json();
  assert.equal(receta.nombre, 'ZTR Receta de cañoncitos');
  assert.equal(receta.rendimientoUnidades, 24);
  assert.equal(receta.producto, 'ZTR Cañoncito', 'tiene que traer el nombre del producto');
  assert.equal(receta.detalles.length, 2);
});

test('cada insumo de la receta trae su nombre y su unidad', async () => {
  const { recetas } = await (await pedir('', { cookie: cookieEncargado })).json();
  const receta = recetas.find((r) => r.nombre === 'ZTR Receta de cañoncitos');

  const harina = receta.detalles.find((d) => d.materiaPrima === 'ZTR Harina');
  assert.ok(harina, 'la harina tiene que estar entre los insumos');
  assert.equal(harina.cantidadRequerida, 2.5);
  assert.equal(harina.unidadMedida, 'kg');
});

test('un producto no puede tener dos recetas', async () => {
  // La relacion producto-receta es 1:1 segun el diseño de clases.
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTR Receta repetida' }),
  });
  assert.equal(r.status, 409);
});

test('rechaza una receta sin insumos', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTR Vacia', idProducto: idProductoSinReceta, detalles: [] }),
  });
  assert.equal(r.status, 400);
});

test('rechaza el mismo insumo repetido dentro de una receta', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({
      nombre: 'ZTR Repetida',
      idProducto: idProductoSinReceta,
      detalles: [
        { idMateriaPrima: idHarina, cantidadRequerida: 1 },
        { idMateriaPrima: idHarina, cantidadRequerida: 2 },
      ],
    }),
  });
  assert.equal(r.status, 409);
});

test('rechaza un producto que no existe', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({ nombre: 'ZTR Sin producto', idProducto: 999999 }),
  });
  assert.equal(r.status, 400);
});

test('rechaza un insumo que no existe', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({
      nombre: 'ZTR Insumo fantasma',
      idProducto: idProductoSinReceta,
      detalles: [{ idMateriaPrima: 999999, cantidadRequerida: 1 }],
    }),
  });
  assert.equal(r.status, 400);
});

test('rechaza un rendimiento de cero unidades', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({
      nombre: 'ZTR Sin rendimiento',
      idProducto: idProductoSinReceta,
      rendimientoUnidades: 0,
    }),
  });
  assert.equal(r.status, 400);
});

test('rechaza una cantidad requerida de cero', async () => {
  const r = await pedir('', {
    cookie: cookieEncargado,
    metodo: 'POST',
    cuerpo: alta({
      nombre: 'ZTR Cantidad cero',
      idProducto: idProductoSinReceta,
      detalles: [{ idMateriaPrima: idHarina, cantidadRequerida: 0 }],
    }),
  });
  assert.equal(r.status, 400);
});

test('una receta rechazada no deja nada a medias', async () => {
  const { rows } = await consultar("SELECT 1 FROM receta WHERE nombre LIKE 'ZTR%' AND nombre <> 'ZTR Receta de cañoncitos'");
  assert.equal(rows.length, 0, 'las altas fallidas tienen que haber revertido');
});

/* ----------------------------------------------------------------- editar */

test('editar una receta reemplaza su lista de insumos', async () => {
  const { recetas } = await (await pedir('', { cookie: cookieEncargado })).json();
  const { idReceta } = recetas.find((r) => r.nombre === 'ZTR Receta de cañoncitos');

  const r = await pedir(`/${idReceta}`, {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: {
      nombre: 'ZTR Receta de cañoncitos grandes',
      rendimientoUnidades: 12,
      detalles: [{ idMateriaPrima: idHarina, cantidadRequerida: 4 }],
    },
  });

  assert.equal(r.status, 200);
  const { receta } = await r.json();
  assert.equal(receta.rendimientoUnidades, 12);
  assert.equal(receta.detalles.length, 1, 'el azucar tenia que desaparecer');
  assert.equal(receta.detalles[0].cantidadRequerida, 4);
});

test('editar una receta inexistente da 404', async () => {
  const r = await pedir('/999999', {
    cookie: cookieEncargado,
    metodo: 'PUT',
    cuerpo: {
      nombre: 'ZTR Fantasma',
      rendimientoUnidades: 10,
      detalles: [{ idMateriaPrima: idHarina, cantidadRequerida: 1 }],
    },
  });
  assert.equal(r.status, 404);
});
