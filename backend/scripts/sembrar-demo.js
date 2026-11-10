/**
 * Siembra los datos de demostracion de la defensa.
 *
 * ATENCION: este script NO es parte del sistema. Existe solo para que la base
 * de la demostracion tenga 60 dias de actividad, que es lo que muestra la
 * presentacion: 4391 ventas, 384 lotes, 134 compras, 12 insumos y 8 productos.
 * Esta pensado para correrse UNA sola vez sobre la base de demostracion. Si
 * detecta que ya se sembro (los productos nuevos ya existen) no hace nada y
 * avisa, asi una segunda corrida por error no duplica el historial.
 *
 * Que respeta:
 *
 *  - No borra ni modifica usuarios. Las ventas se reparten entre los tres
 *    (los tres roles pueden vender, CU-07) y los lotes solo entre Panificador
 *    y Encargado (CU-06). Las compras las registra el Encargado, que es el
 *    unico rol con acceso a insumos (CU-03 a CU-05).
 *  - No toca ninguna fila de las pruebas automaticas (prefijos ZT...).
 *  - Las mismas reglas que las rutas del backend: cada lote escribe sus filas
 *    en consumo_materia_prima y su costo_total es la suma de los subtotales;
 *    cada venta escribe su detalle_venta y su total es la suma de los
 *    subtotales; cada compra sube el stock y recalcula el costo promedio
 *    ponderado movil.
 *  - El orden cronologico cierra: la jornada se simula dia por dia y dentro
 *    del dia en el orden real (primero llega la mercaderia, despues se
 *    produce, despues se vende), asi nunca se vende lo que no se produjo ni
 *    se produce sin insumos.
 *  - El stock nunca queda negativo, ni al final ni en ningun momento
 *    intermedio de la simulacion. Si algo no cerrara, el script lanza el
 *    error dentro de la transaccion y no queda nada escrito.
 *
 * Uso:  npm run sembrar-demo
 */
import { pool, consultar, conTransaccion } from '../src/config/db.js';

// ------------------------------------------------------------------
// Parametros de la siembra
// ------------------------------------------------------------------

/** Ultimo dia de la ventana; la presentacion habla de los 60 dias previos. */
const DIA_FINAL = '2026-11-10';
const DIAS = 60;

/** Totales que tiene que mostrar la base, segun la diapositiva 23. */
const OBJETIVOS = {
  venta: 4391,
  lote_produccion: 384,
  ingreso_materia_prima: 134,
  materia_prima: 12,
  producto: 8,
};

/* Semilla fija: dos corridas del script generan exactamente lo mismo, asi lo
   que se ve en la demo es reproducible y no cambia en cada intento. */
const SEMILLA = 20261110;

/* Con --simular se hace todo el trabajo pero la transaccion se revierte al
   final: sirve para mirar como quedarian los numeros sin escribir nada. */
const SIMULAR = process.argv.includes('--simular');

/** Error centinela: no es una falla, es el corte de la simulacion. */
class SalidaSimulada extends Error {}

/** Dias de venta que se busca tener siempre en el mostrador. */
const COBERTURA_OBJETIVO = 2.0;

/* Cuanto se produce de mas respecto de lo que se estima vender. Un poco por
   encima para que no falte en los picos del fin de semana, pero no tanto que
   el stock final quede en sobrestock. */
const HOLGURA_PRODUCCION = 1.05;

/** Cuanta actividad tiene cada dia de la semana (0 = domingo). */
const PESO_VENTAS = [1.5, 0.8, 0.8, 0.85, 0.9, 1.15, 1.6];
const PESO_LOTES = [1.2, 0.8, 0.85, 0.85, 0.95, 1.3, 1.5];

/* Los primeros dias de la ventana se produce de mas: es el arranque de la
   simulacion y hay que llenar el mostrador de los productos nuevos, que
   empiezan sin stock. */
const ARRANQUE = [2.5, 2.2, 1.6];

/** Insumo que falta para llegar a los 12 de la presentacion. */
const INSUMO_NUEVO = {
  nombre: 'Grasa vacuna refinada',
  unidad: 'kg',
  stockMinimo: 5,
  stockMaximo: 40,
  precioBase: 4200,
  proveedor: 'Distribuidora La Rosarina',
  diasVencimiento: 120,
};

/** Reparto de las unidades vendidas entre los ocho productos. */
const PESO_VENTA_PRODUCTO = {
  'Pan frances': 0.26,
  'Medialuna de manteca': 0.15,
  'Cañoncito': 0.05,
  'Factura de grasa': 0.16,
  'Torta frita': 0.09,
  'Pan de viena': 0.10,
  'Palmerita': 0.08,
  'Bizcocho de grasa': 0.11,
};

/** Los cinco productos que faltan para llegar a los 8, con su receta. */
const PRODUCTOS_NUEVOS = [
  {
    nombre: 'Factura de grasa',
    descripcion: 'Surtido de grasa, por unidad',
    precioVenta: 380,
    stockMinimo: 40,
    stockMaximo: 300,
    receta: {
      nombre: 'Facturas de grasa',
      rendimiento: 120,
      insumos: [
        ['Harina 000', 6.00],
        ['Grasa vacuna refinada', 1.80],
        ['Azucar', 0.90],
        ['Levadura fresca', 0.18],
        ['Sal fina', 0.12],
      ],
    },
  },
  {
    nombre: 'Torta frita',
    descripcion: 'Por unidad, se hace en el dia',
    precioVenta: 300,
    stockMinimo: 20,
    stockMaximo: 180,
    receta: {
      nombre: 'Tortas fritas',
      rendimiento: 90,
      insumos: [
        ['Harina 000', 4.50],
        ['Grasa vacuna refinada', 0.70],
        ['Levadura fresca', 0.10],
        ['Sal fina', 0.09],
      ],
    },
  },
  {
    nombre: 'Pan de viena',
    descripcion: 'Pan de miga tierna, por unidad',
    precioVenta: 420,
    stockMinimo: 25,
    stockMaximo: 200,
    receta: {
      nombre: 'Pan de viena',
      rendimiento: 100,
      insumos: [
        ['Harina 000', 5.00],
        ['Manteca', 0.80],
        ['Azucar', 0.40],
        ['Leche entera', 1.00],
        ['Levadura fresca', 0.15],
        ['Sal fina', 0.10],
      ],
    },
  },
  {
    nombre: 'Palmerita',
    descripcion: 'Hojaldre con azucar, por unidad',
    precioVenta: 600,
    stockMinimo: 20,
    stockMaximo: 160,
    receta: {
      nombre: 'Palmeritas de hojaldre',
      rendimiento: 80,
      insumos: [
        ['Harina 000', 3.20],
        ['Manteca', 1.60],
        ['Azucar', 1.40],
        ['Sal fina', 0.05],
      ],
    },
  },
  {
    nombre: 'Bizcocho de grasa',
    descripcion: 'Bizcochitos salados, por unidad',
    precioVenta: 160,
    stockMinimo: 25,
    stockMaximo: 220,
    receta: {
      nombre: 'Bizcochos de grasa',
      rendimiento: 150,
      insumos: [
        ['Harina 000', 5.50],
        ['Grasa vacuna refinada', 1.50],
        ['Levadura fresca', 0.12],
        ['Sal fina', 0.15],
      ],
    },
  },
];

/* Cuantas compras recibe cada insumo en los 60 dias. Suman las 120 que
   faltan para los 134 de la presentacion. Los que mas se consumen se
   reponen mas seguido; la miel o el almidon entran una vez por mes. */
const COMPRAS_POR_INSUMO = {
  'Harina 000': 26,
  'Levadura fresca': 14,
  'Sal fina': 8,
  'Azucar': 12,
  'Manteca': 14,
  'Leche entera': 12,
  'Huevos': 6,
  'Miel': 3,
  'Aceite de girasol': 3,
  'Almidon de maiz': 3,
  'Dulce de leche repostero': 6,
  'Grasa vacuna refinada': 13,
};

/* Como se compra cada insumo: la cantidad de cada entrega se redondea para
   arriba a un multiplo de este numero, porque nadie compra 0,63 kg de dulce
   de leche. Y cuantos dias dura antes de vencer. */
const PRESENTACION_INSUMO = {
  'Harina 000': { multiplo: 5, diasVencimiento: 180 },
  'Levadura fresca': { multiplo: 0.5, diasVencimiento: 45 },
  'Sal fina': { multiplo: 0.5, diasVencimiento: null },
  'Azucar': { multiplo: 1, diasVencimiento: 365 },
  'Manteca': { multiplo: 1, diasVencimiento: 90 },
  'Leche entera': { multiplo: 1, diasVencimiento: 12 },
  'Huevos': { multiplo: 30, diasVencimiento: 30 },
  'Miel': { multiplo: 0.5, diasVencimiento: 540 },
  'Aceite de girasol': { multiplo: 1, diasVencimiento: 270 },
  'Almidon de maiz': { multiplo: 0.5, diasVencimiento: 365 },
  'Dulce de leche repostero': { multiplo: 1, diasVencimiento: 120 },
  'Grasa vacuna refinada': { multiplo: 1, diasVencimiento: 120 },
};

/** Cuantas lineas tiene un ticket y cuantas unidades lleva cada linea. */
const LINEAS_POR_VENTA = [[1, 0.45], [2, 0.35], [3, 0.20]];
const UNIDADES_POR_LINEA = [[1, 0.30], [2, 0.25], [3, 0.18], [4, 0.12], [5, 0.09], [6, 0.06]];

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------

/* Generador pseudoaleatorio con semilla (mulberry32). Math.random no sirve
   porque cada corrida daria otra base y la demo dejaria de ser reproducible. */
function generador(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const azar = generador(SEMILLA);

/** Todos los DECIMAL de la base son (10,2): se redondea igual que la base. */
const dos = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const entre = (minimo, maximo) => minimo + azar() * (maximo - minimo);
const enteroEntre = (minimo, maximo) => Math.floor(entre(minimo, maximo + 1));

/** Elige un valor de una lista de pares [valor, peso]. */
function elegirPonderado(pares) {
  const total = pares.reduce((suma, [, peso]) => suma + peso, 0);
  let tirada = azar() * total;
  for (const [valor, peso] of pares) {
    tirada -= peso;
    if (tirada <= 0) return valor;
  }
  return pares[pares.length - 1][0];
}

/**
 * Reparte un total entero entre varias ranuras segun sus pesos.
 *
 * Usa el metodo del resto mayor: reparte la parte entera y despues entrega
 * las unidades que sobran a las ranuras con el resto mas grande. Asi la suma
 * da exactamente el total pedido, que es lo que importa para llegar a los
 * numeros de la presentacion.
 */
function repartir(total, pesos) {
  const suma = pesos.reduce((a, b) => a + b, 0);
  const exactos = pesos.map((p) => (total * p) / suma);
  const base = exactos.map(Math.floor);
  const sobrante = total - base.reduce((a, b) => a + b, 0);
  const orden = exactos
    .map((valor, i) => ({ resto: valor - Math.floor(valor), i }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (let k = 0; k < sobrante; k++) base[orden[k % orden.length].i] += 1;
  return base;
}

/** Los 60 dias de la ventana, del mas viejo al mas nuevo. */
function ventana() {
  const [anio, mes, dia] = DIA_FINAL.split('-').map(Number);
  const fin = Date.UTC(anio, mes - 1, dia);
  const dias = [];
  for (let i = DIAS - 1; i >= 0; i--) {
    const fecha = new Date(fin - i * 86_400_000);
    dias.push({
      iso: fecha.toISOString().slice(0, 10),
      diaSemana: fecha.getUTCDay(),
      marca: fecha.getTime(),
    });
  }
  return dias;
}

function sumarDias(iso, cantidad) {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia) + cantidad * 86_400_000)
    .toISOString().slice(0, 10);
}

/** Hora de una venta: el grueso a la mañana, el resto a la tarde. */
function horaDeVenta(diaSemana) {
  const domingo = diaSemana === 0;
  const manana = domingo || azar() < 0.65;
  const desde = manana ? 7 : 16;
  const hasta = manana ? (domingo ? 13 : 12.5) : 20;
  const hora = entre(desde, hasta);
  const h = Math.floor(hora);
  const m = Math.floor((hora - h) * 60);
  const s = enteroEntre(0, 59);
  const dd = (n) => String(n).padStart(2, '0');
  return `${dd(h)}:${dd(m)}:${dd(s)}`;
}

/** Inserta muchas filas en pocas consultas, de a 400 por vez. */
async function insertarMasivo(cliente, tabla, columnas, filas, retorno) {
  const generados = [];
  const TAMANO = 400;
  for (let inicio = 0; inicio < filas.length; inicio += TAMANO) {
    const trozo = filas.slice(inicio, inicio + TAMANO);
    const valores = [];
    const grupos = trozo.map((fila) => {
      const marcadores = fila.map((valor) => {
        valores.push(valor);
        return `$${valores.length}`;
      });
      return `(${marcadores.join(', ')})`;
    });
    const sql = `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ${grupos.join(', ')}`
      + (retorno ? ` RETURNING ${retorno}` : '');
    const { rows } = await cliente.query(sql, valores);
    if (retorno) for (const fila of rows) generados.push(fila[retorno]);
  }
  return generados;
}

// ------------------------------------------------------------------
// Lectura del estado actual
// ------------------------------------------------------------------

async function contar(tabla) {
  const { rows } = await consultar(`SELECT COUNT(*)::int AS n FROM ${tabla}`);
  return rows[0].n;
}

/**
 * Cuenta las ventas y los lotes cuyo total no coincide con la suma de su
 * detalle. Se mide antes y despues de sembrar: lo que importa es que la
 * siembra no agregue ninguno.
 */
async function contarDescuadres() {
  const { rows } = await consultar(
    `SELECT
       (SELECT COUNT(*)::int FROM venta v
         WHERE v.total <> (SELECT COALESCE(SUM(d.subtotal), -1)
                             FROM detalle_venta d WHERE d.id_venta = v.id_venta)) AS ventas,
       (SELECT COUNT(*)::int FROM lote_produccion l
         WHERE l.costo_total <> (SELECT COALESCE(SUM(c.subtotal), -1)
                                   FROM consumo_materia_prima c WHERE c.id_lote = l.id_lote)) AS lotes`
  );
  return rows[0];
}

async function leerEstado() {
  const { rows: usuarios } = await consultar(
    `SELECT u.id_usuario, u.nombre, u.email, r.nombre AS rol
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.email = ANY($1::varchar[])`,
    [['kevin@correo.com', 'gianmarco@correo.com', 'agustin@correo.com']]
  );

  const { rows: proveedores } = await consultar(
    'SELECT id_proveedor, razon_social FROM proveedor WHERE razon_social NOT LIKE \'ZT%\''
  );

  /* Los insumos reales son los que no llevan prefijo de prueba. Las filas ZT
     son de las pruebas automaticas y no se tocan. */
  const { rows: insumos } = await consultar(
    `SELECT id_materia_prima, nombre, unidad_medida, stock_actual, stock_minimo,
            stock_maximo, costo_promedio, id_proveedor_habitual
       FROM materia_prima WHERE nombre NOT LIKE 'ZT%' ORDER BY id_materia_prima`
  );

  const { rows: productos } = await consultar(
    `SELECT p.id_producto, p.nombre, p.stock_actual, p.precio_venta,
            r.id_receta, r.rendimiento_unidades
       FROM producto p
       LEFT JOIN receta r ON r.id_producto = p.id_producto
      WHERE p.nombre NOT LIKE 'ZT%' ORDER BY p.id_producto`
  );

  return { usuarios, proveedores, insumos, productos };
}

// ------------------------------------------------------------------
// Plan de produccion y de ventas
// ------------------------------------------------------------------

/**
 * Simula los 60 dias y devuelve el plan completo.
 *
 * El criterio para elegir que producir es el mismo que usaria el panificador:
 * se hace primero lo que menos dias de venta tiene en el mostrador. Y no se
 * vende mas de lo que hay: si un producto se agota, la linea se recorta o el
 * cliente se lleva otra cosa, como en la vida real.
 */
function planificar(dias, productos, ventasPorDia, lotesPorDia) {
  const lineasPromedio = LINEAS_POR_VENTA.reduce((s, [v, p]) => s + v * p, 0);
  const unidadesPromedio = UNIDADES_POR_LINEA.reduce((s, [v, p]) => s + v * p, 0);
  const totalVentas = ventasPorDia.reduce((a, b) => a + b, 0);
  const demandaTotal = totalVentas * lineasPromedio * unidadesPromedio;

  // Unidades por dia que se espera vender de cada producto.
  for (const producto of productos) {
    producto.demandaDia = (producto.peso * demandaTotal) / DIAS;
  }

  /* Tamaño de la masa de cada producto. Sale de repartir la produccion total
     entre los 384 lotes de forma proporcional a lo que rinde cada receta, de
     manera que una masa sea una fraccion razonable de la receta y no una
     cantidad arbitraria. */
  const totalLotes = lotesPorDia.reduce((a, b) => a + b, 0);
  const suma = productos.reduce((s, p) => s + p.peso / p.rendimiento, 0);
  const factor = (demandaTotal * HOLGURA_PRODUCCION * suma) / totalLotes;
  for (const producto of productos) {
    producto.masa = Math.max(6, Math.round(factor * producto.rendimiento));
  }

  const lotes = [];
  const ventas = [];
  const consumoPorDia = dias.map(() => new Map());

  dias.forEach((dia, indice) => {
    // --- se produce
    for (let i = 0; i < lotesPorDia[indice]; i++) {
      const elegido = productos.reduce((peor, p) => (
        p.stock / p.demandaDia < peor.stock / peor.demandaDia ? p : peor
      ));
      /* Si ya hay de sobra se hace una masa chica; nunca se saltea el lote,
         porque la cantidad de lotes es la que tiene que dar 384. */
      const cobertura = elegido.stock / elegido.demandaDia;
      const ajuste = cobertura > COBERTURA_OBJETIVO * 2 ? 0.4 : entre(0.88, 1.12);
      const cantidad = Math.max(6, Math.round(elegido.masa * ajuste));

      lotes.push({ indiceDia: indice, producto: elegido, cantidad });
      elegido.stock += cantidad;

      const acumulado = consumoPorDia[indice];
      for (const insumo of elegido.receta) {
        const necesaria = Math.max(0.01, dos(insumo.cantidad * (cantidad / elegido.rendimiento)));
        acumulado.set(insumo.nombre, dos((acumulado.get(insumo.nombre) ?? 0) + necesaria));
      }
    }

    // --- se vende
    const horas = [];
    for (let i = 0; i < ventasPorDia[indice]; i++) horas.push(horaDeVenta(dia.diaSemana));
    horas.sort();

    for (const hora of horas) {
      const cuantas = elegirPonderado(LINEAS_POR_VENTA);
      const usados = new Set();
      const lineas = [];

      for (let i = 0; i < cuantas; i++) {
        const candidatos = productos.filter((p) => p.stock >= 1 && !usados.has(p.nombre));
        if (candidatos.length === 0) break;
        const elegido = elegirPonderado(candidatos.map((p) => [p, p.peso]));
        const pedidas = elegirPonderado(UNIDADES_POR_LINEA);
        const cantidad = Math.min(pedidas, elegido.stock);
        usados.add(elegido.nombre);
        elegido.stock -= cantidad;
        lineas.push({ producto: elegido, cantidad });
      }

      if (lineas.length === 0) {
        throw new Error(`No quedo stock de ningun producto el ${dia.iso}: revisar el plan`);
      }
      ventas.push({ indiceDia: indice, hora, lineas });
    }
  });

  return { lotes, ventas, consumoPorDia, demandaTotal };
}

/**
 * Arma el calendario de compras.
 *
 * Cada insumo recibe sus entregas repartidas a lo largo de la ventana. La
 * cantidad de cada entrega sale de lo que se va a consumir mas el stock con
 * el que se quiere terminar, menos lo que ya habia. Despues se verifica dia
 * por dia que el stock no se vaya abajo de cero en ningun momento, y si eso
 * pasara se agranda la entrega anterior. Es el mismo razonamiento que hace el
 * encargado cuando mira la alerta de stock critico y pide de mas.
 */
function planificarCompras(dias, insumos, consumoPorDia) {
  const consumoTotal = new Map();
  for (const mapa of consumoPorDia) {
    for (const [nombre, cantidad] of mapa) {
      consumoTotal.set(nombre, (consumoTotal.get(nombre) ?? 0) + cantidad);
    }
  }

  const compras = [];

  for (const insumo of insumos) {
    const cuantas = COMPRAS_POR_INSUMO[insumo.nombre];
    if (!cuantas) continue;

    const presentacion = PRESENTACION_INSUMO[insumo.nombre] ?? { multiplo: 1, diasVencimiento: null };
    const total = consumoTotal.get(insumo.nombre) ?? 0;

    /* Con cuanto se quiere terminar: seis dias de consumo, pero nunca por
       debajo del minimo ni cerca del maximo (eso dispararia alertas). */
    const seisDias = (total / DIAS) * 6;
    const objetivoFinal = Math.min(
      Math.max(seisDias, insumo.stockMinimo * 1.2),
      insumo.stockMaximo * 0.7
    );

    const aComprar = total + objetivoFinal - insumo.stock;
    const porEntrega = Math.max(presentacion.multiplo, aComprar / cuantas);

    /* Las entregas se reparten parejo: la primera el primer dia de la ventana
       (el insumo nuevo arranca sin stock y tiene que poder producirse) y la
       ultima cerca del final. */
    const propias = [];
    for (let k = 0; k < cuantas; k++) {
      let indice = Math.round((k * (DIAS - 1)) / cuantas);
      // Los proveedores no entregan los domingos.
      if (dias[indice].diaSemana === 0) indice = Math.max(0, indice - 1);
      const cantidad = Math.ceil(porEntrega / presentacion.multiplo) * presentacion.multiplo;
      propias.push({ insumo, indiceDia: indice, cantidad: dos(cantidad), presentacion });
    }

    // Verificacion dia por dia, con reparacion si el stock se iria a negativo.
    for (let intento = 0; intento < 60; intento++) {
      let stock = insumo.stock;
      let problema = null;
      for (let d = 0; d < DIAS && !problema; d++) {
        for (const compra of propias) if (compra.indiceDia === d) stock = dos(stock + compra.cantidad);
        const consumido = consumoPorDia[d].get(insumo.nombre) ?? 0;
        if (consumido > stock) problema = { dia: d, falta: consumido - stock };
        stock = dos(stock - consumido);
      }
      if (!problema) break;

      const anteriores = propias.filter((c) => c.indiceDia <= problema.dia);
      const destino = anteriores.length > 0 ? anteriores[anteriores.length - 1] : propias[0];
      if (anteriores.length === 0) destino.indiceDia = 0;
      const extra = Math.ceil((problema.falta * 1.3) / presentacion.multiplo) * presentacion.multiplo;
      destino.cantidad = dos(destino.cantidad + extra);
      if (intento === 59) {
        throw new Error(`No se pudo cubrir el consumo de ${insumo.nombre}`);
      }
    }

    compras.push(...propias);
  }

  return compras;
}

// ------------------------------------------------------------------
// Programa
// ------------------------------------------------------------------

async function principal() {
  console.log('\nSiembra de datos de demostracion — AmasaApp\n');

  const actuales = {};
  for (const tabla of Object.keys(OBJETIVOS)) actuales[tabla] = await contar(tabla);

  const descuadresAntes = await contarDescuadres();
  const estado = await leerEstado();

  // --- controles previos

  const porRol = new Map(estado.usuarios.map((u) => [u.rol, u]));
  for (const [email, rol] of [['kevin@correo.com', 'Panificador'],
    ['gianmarco@correo.com', 'Encargado'], ['agustin@correo.com', 'Venta']]) {
    const usuario = estado.usuarios.find((u) => u.email === email);
    if (!usuario) throw new Error(`Falta el usuario ${email}: no sigo`);
    if (usuario.rol !== rol) throw new Error(`${email} tendria que ser ${rol} y es ${usuario.rol}`);
  }

  const yaSembrado = estado.productos.some((p) => p.nombre === PRODUCTOS_NUEVOS[0].nombre);
  if (yaSembrado) {
    console.log('Los productos de la demo ya estan cargados: la base ya se sembro.');
    console.log('No se escribio nada. Para volver a sembrar hay que restaurar la base.\n');
    return;
  }

  const faltan = {
    venta: OBJETIVOS.venta - actuales.venta,
    lote_produccion: OBJETIVOS.lote_produccion - actuales.lote_produccion,
    ingreso_materia_prima: OBJETIVOS.ingreso_materia_prima - actuales.ingreso_materia_prima,
  };
  for (const [tabla, cantidad] of Object.entries(faltan)) {
    if (cantidad <= 0) throw new Error(`${tabla} ya tiene ${actuales[tabla]} filas: no hay nada que sembrar`);
  }

  const comprasPlaneadas = Object.values(COMPRAS_POR_INSUMO).reduce((a, b) => a + b, 0);
  if (comprasPlaneadas !== faltan.ingreso_materia_prima) {
    throw new Error(
      `El reparto de compras suma ${comprasPlaneadas} y hacen falta ${faltan.ingreso_materia_prima}`
    );
  }

  console.log('Faltantes a generar:');
  console.log(`  ventas   ${faltan.venta}   (hay ${actuales.venta}, objetivo ${OBJETIVOS.venta})`);
  console.log(`  lotes    ${faltan.lote_produccion}    (hay ${actuales.lote_produccion}, objetivo ${OBJETIVOS.lote_produccion})`);
  console.log(`  compras  ${faltan.ingreso_materia_prima}    (hay ${actuales.ingreso_materia_prima}, objetivo ${OBJETIVOS.ingreso_materia_prima})`);
  console.log(`  insumos  ${OBJETIVOS.materia_prima - actuales.materia_prima}      productos ${OBJETIVOS.producto - actuales.producto}\n`);

  // --- insumos y productos que hay que crear

  const proveedorPorNombre = new Map(estado.proveedores.map((p) => [p.razon_social, p.id_proveedor]));
  const idProveedorNuevo = proveedorPorNombre.get(INSUMO_NUEVO.proveedor);
  if (!idProveedorNuevo) throw new Error(`No existe el proveedor ${INSUMO_NUEVO.proveedor}`);

  const insumos = estado.insumos.map((fila) => ({
    id: fila.id_materia_prima,
    nombre: fila.nombre,
    unidad: fila.unidad_medida,
    stock: Number(fila.stock_actual),
    stockMinimo: Number(fila.stock_minimo),
    stockMaximo: Number(fila.stock_maximo),
    costo: Number(fila.costo_promedio),
    idProveedor: fila.id_proveedor_habitual ?? idProveedorNuevo,
    nuevo: false,
  }));

  insumos.push({
    id: null,
    nombre: INSUMO_NUEVO.nombre,
    unidad: INSUMO_NUEVO.unidad,
    stock: 0,
    stockMinimo: INSUMO_NUEVO.stockMinimo,
    stockMaximo: INSUMO_NUEVO.stockMaximo,
    costo: 0,
    idProveedor: idProveedorNuevo,
    nuevo: true,
  });

  const insumoPorNombre = new Map(insumos.map((i) => [i.nombre, i]));

  const productos = estado.productos.map((fila) => {
    if (!fila.id_receta) throw new Error(`El producto ${fila.nombre} no tiene receta`);
    return {
      id: fila.id_producto,
      nombre: fila.nombre,
      precio: Number(fila.precio_venta),
      stock: Number(fila.stock_actual),
      stockInicial: Number(fila.stock_actual),
      idReceta: fila.id_receta,
      rendimiento: Number(fila.rendimiento_unidades),
      peso: PESO_VENTA_PRODUCTO[fila.nombre],
      receta: [],
      nuevo: false,
    };
  });

  for (const producto of productos) {
    if (!producto.peso) throw new Error(`No se definio el peso de venta de ${producto.nombre}`);
  }

  const { rows: detallesExistentes } = await consultar(
    `SELECT d.id_receta, m.nombre, d.cantidad_requerida
       FROM receta_detalle d JOIN materia_prima m ON m.id_materia_prima = d.id_materia_prima
      WHERE d.id_receta = ANY($1::int[])`,
    [productos.map((p) => p.idReceta)]
  );
  for (const fila of detallesExistentes) {
    const producto = productos.find((p) => p.idReceta === fila.id_receta);
    producto.receta.push({ nombre: fila.nombre, cantidad: Number(fila.cantidad_requerida) });
  }

  for (const definicion of PRODUCTOS_NUEVOS) {
    productos.push({
      id: null,
      nombre: definicion.nombre,
      descripcion: definicion.descripcion,
      precio: definicion.precioVenta,
      stock: 0,
      stockInicial: 0,
      stockMinimo: definicion.stockMinimo,
      stockMaximo: definicion.stockMaximo,
      idReceta: null,
      rendimiento: definicion.receta.rendimiento,
      nombreReceta: definicion.receta.nombre,
      peso: PESO_VENTA_PRODUCTO[definicion.nombre],
      receta: definicion.receta.insumos.map(([nombre, cantidad]) => {
        if (!insumoPorNombre.has(nombre)) throw new Error(`La receta usa un insumo inexistente: ${nombre}`);
        return { nombre, cantidad };
      }),
      nuevo: true,
    });
  }

  if (productos.length !== OBJETIVOS.producto) {
    throw new Error(`Quedarian ${productos.length} productos y la presentacion dice ${OBJETIVOS.producto}`);
  }

  // --- plan

  const dias = ventana();
  const pesosVenta = dias.map((d) => PESO_VENTAS[d.diaSemana]);
  const pesosLote = dias.map((d, i) => PESO_LOTES[d.diaSemana] * (ARRANQUE[i] ?? 1));

  const ventasPorDia = repartir(faltan.venta, pesosVenta);
  const lotesPorDia = repartir(faltan.lote_produccion, pesosLote);

  const plan = planificar(dias, productos, ventasPorDia, lotesPorDia);
  const compras = planificarCompras(dias, insumos, plan.consumoPorDia);

  console.log(`Plan: ${plan.ventas.length} ventas, ${plan.lotes.length} lotes, ${compras.length} compras`);
  console.log(`Unidades estimadas de venta: ${Math.round(plan.demandaTotal)}\n`);

  // --- escritura, todo dentro de una sola transaccion

  const idPanificador = porRol.get('Panificador').id_usuario;
  const idEncargado = porRol.get('Encargado').id_usuario;
  const idVendedor = porRol.get('Venta').id_usuario;

  await conTransaccion(async (cliente) => {
    // 1. El insumo nuevo. Arranca en cero: el stock entra con sus compras.
    const insumoNuevo = insumoPorNombre.get(INSUMO_NUEVO.nombre);
    const { rows: filasInsumo } = await cliente.query(
      `INSERT INTO materia_prima
         (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo,
          costo_promedio, id_proveedor_habitual)
       VALUES ($1, $2, 0, $3, $4, 0, $5)
       RETURNING id_materia_prima`,
      [insumoNuevo.nombre, insumoNuevo.unidad, insumoNuevo.stockMinimo,
        insumoNuevo.stockMaximo, insumoNuevo.idProveedor]
    );
    insumoNuevo.id = filasInsumo[0].id_materia_prima;

    // 2. Los productos nuevos con su receta.
    for (const producto of productos.filter((p) => p.nuevo)) {
      const { rows: filasProducto } = await cliente.query(
        `INSERT INTO producto
           (nombre, descripcion, stock_actual, precio_venta, stock_minimo, stock_maximo)
         VALUES ($1, $2, 0, $3, $4, $5)
         RETURNING id_producto`,
        [producto.nombre, producto.descripcion, producto.precio,
          producto.stockMinimo, producto.stockMaximo]
      );
      producto.id = filasProducto[0].id_producto;

      const { rows: filasReceta } = await cliente.query(
        `INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
         VALUES ($1, $2, $3) RETURNING id_receta`,
        [producto.nombreReceta, producto.rendimiento, producto.id]
      );
      producto.idReceta = filasReceta[0].id_receta;

      await insertarMasivo(
        cliente, 'receta_detalle',
        ['cantidad_requerida', 'id_receta', 'id_materia_prima'],
        producto.receta.map((i) => [i.cantidad, producto.idReceta, insumoPorNombre.get(i.nombre).id])
      );
    }

    /* 3. Se recorre la ventana dia por dia en el orden en que pasan las
       cosas, llevando el stock y el costo promedio como los llevaria el
       sistema. Las filas se juntan y se insertan al final de una, porque
       14.000 INSERT de a uno tardarian de mas. */
    const stockInsumo = new Map(insumos.map((i) => [i.nombre, i.stock]));
    const costoInsumo = new Map(insumos.map((i) => [i.nombre, i.costo]));
    const stockProducto = new Map(productos.map((p) => [p.nombre, p.stockInicial]));

    const filasIngreso = [];
    const filasLote = [];
    const consumosPorLote = [];
    const filasVenta = [];
    const detallesPorVenta = [];

    const comprasDelDia = dias.map(() => []);
    for (const compra of compras) comprasDelDia[compra.indiceDia].push(compra);
    const lotesDelDia = dias.map(() => []);
    for (const lote of plan.lotes) lotesDelDia[lote.indiceDia].push(lote);
    const ventasDelDia = dias.map(() => []);
    for (const venta of plan.ventas) ventasDelDia[venta.indiceDia].push(venta);

    dias.forEach((dia, indice) => {
      // 3.a Llega la mercaderia. Sube el stock y se recalcula el promedio.
      for (const compra of comprasDelDia[indice]) {
        const nombre = compra.insumo.nombre;
        /* Los precios de la panaderia no se quedan quietos: suben a lo largo
           de la ventana, con algo de ruido entre compra y compra. */
        const base = compra.insumo.nuevo ? INSUMO_NUEVO.precioBase : compra.insumo.costo;
        const deriva = 1 + 0.0022 * indice;
        const precio = dos(Math.max(1, base * deriva * entre(0.98, 1.03)));

        const stockPrevio = stockInsumo.get(nombre);
        const costoPrevio = costoInsumo.get(nombre);
        const stockNuevo = dos(stockPrevio + compra.cantidad);
        const costoNuevo = dos((stockPrevio * costoPrevio + compra.cantidad * precio) / stockNuevo);

        stockInsumo.set(nombre, stockNuevo);
        costoInsumo.set(nombre, costoNuevo);

        const vence = compra.presentacion.diasVencimiento;
        filasIngreso.push([
          compra.cantidad, precio, dia.iso,
          vence ? sumarDias(dia.iso, vence) : null,
          compra.insumo.id, idEncargado, compra.insumo.idProveedor,
        ]);
      }

      // 3.b Se amasa. Cada lote descuenta insumos y deja su consumo asentado.
      for (const lote of lotesDelDia[indice]) {
        const producto = lote.producto;
        const consumos = [];
        let costoTotal = 0;

        for (const insumo of producto.receta) {
          const cantidad = Math.max(0.01, dos(insumo.cantidad * (lote.cantidad / producto.rendimiento)));
          const disponible = stockInsumo.get(insumo.nombre);
          if (cantidad > disponible) {
            throw new Error(
              `El ${dia.iso} faltaria ${insumo.nombre} para ${producto.nombre}: `
              + `hacen falta ${cantidad} y hay ${disponible}`
            );
          }
          const costoUnitario = costoInsumo.get(insumo.nombre);
          const subtotal = dos(cantidad * costoUnitario);
          stockInsumo.set(insumo.nombre, dos(disponible - cantidad));
          costoTotal = dos(costoTotal + subtotal);
          consumos.push([cantidad, costoUnitario, subtotal, insumoPorNombre.get(insumo.nombre).id]);
        }

        // El panificador hace casi todo; el encargado tapa los francos.
        const idUsuario = azar() < 0.8 ? idPanificador : idEncargado;
        filasLote.push([dia.iso, lote.cantidad, costoTotal, producto.idReceta, idUsuario]);
        consumosPorLote.push(consumos);
        stockProducto.set(producto.nombre, stockProducto.get(producto.nombre) + lote.cantidad);
      }

      // 3.c Se vende. El stock de productos baja.
      for (const venta of ventasDelDia[indice]) {
        const detalles = [];
        let total = 0;
        for (const linea of venta.lineas) {
          const disponible = stockProducto.get(linea.producto.nombre);
          if (linea.cantidad > disponible) {
            throw new Error(
              `El ${dia.iso} faltaria ${linea.producto.nombre}: `
              + `se venden ${linea.cantidad} y hay ${disponible}`
            );
          }
          const precio = linea.producto.precio;
          const subtotal = dos(linea.cantidad * precio);
          total = dos(total + subtotal);
          stockProducto.set(linea.producto.nombre, disponible - linea.cantidad);
          detalles.push([linea.cantidad, precio, subtotal, linea.producto.id]);
        }

        /* Atiende el mostrador casi siempre, pero el encargado y el
           panificador tambien registran ventas cuando dan una mano. */
        const tirada = azar();
        const idUsuario = tirada < 0.7 ? idVendedor : (tirada < 0.88 ? idEncargado : idPanificador);
        filasVenta.push([`${dia.iso} ${venta.hora}`, total, idUsuario]);
        detallesPorVenta.push(detalles);
      }
    });

    // 4. Se verifica que nada haya quedado en negativo antes de escribir.
    for (const [nombre, stock] of stockInsumo) {
      if (stock < 0) throw new Error(`El insumo ${nombre} quedaria en ${stock}`);
    }
    for (const [nombre, stock] of stockProducto) {
      if (stock < 0) throw new Error(`El producto ${nombre} quedaria en ${stock}`);
    }

    // 5. Las filas, en pocas consultas.
    await insertarMasivo(
      cliente, 'ingreso_materia_prima',
      ['cantidad', 'precio_unitario', 'fecha_ingreso', 'fecha_vencimiento',
        'id_materia_prima', 'id_usuario', 'id_proveedor'],
      filasIngreso
    );

    const idsLote = await insertarMasivo(
      cliente, 'lote_produccion',
      ['fecha', 'cantidad_producida', 'costo_total', 'id_receta', 'id_usuario'],
      filasLote, 'id_lote'
    );
    const filasConsumo = [];
    idsLote.forEach((idLote, i) => {
      for (const [cantidad, costoUnitario, subtotal, idInsumo] of consumosPorLote[i]) {
        filasConsumo.push([cantidad, costoUnitario, subtotal, idLote, idInsumo]);
      }
    });
    await insertarMasivo(
      cliente, 'consumo_materia_prima',
      ['cantidad', 'costo_unitario', 'subtotal', 'id_lote', 'id_materia_prima'],
      filasConsumo
    );

    const idsVenta = await insertarMasivo(
      cliente, 'venta', ['fecha', 'total', 'id_usuario'], filasVenta, 'id_venta'
    );
    const filasDetalle = [];
    idsVenta.forEach((idVenta, i) => {
      for (const [cantidad, precio, subtotal, idProducto] of detallesPorVenta[i]) {
        filasDetalle.push([cantidad, precio, subtotal, idVenta, idProducto]);
      }
    });
    await insertarMasivo(
      cliente, 'detalle_venta',
      ['cantidad', 'precio_unitario', 'subtotal', 'id_venta', 'id_producto'],
      filasDetalle
    );

    /* 6. El stock y el costo que quedan. La base guarda un solo valor por
       fila, el de hoy, asi que se escribe el resultado de los 60 dias. */
    for (const insumo of insumos) {
      await cliente.query(
        'UPDATE materia_prima SET stock_actual = $1, costo_promedio = $2 WHERE id_materia_prima = $3',
        [stockInsumo.get(insumo.nombre), costoInsumo.get(insumo.nombre), insumo.id]
      );
    }
    for (const producto of productos) {
      await cliente.query(
        'UPDATE producto SET stock_actual = $1 WHERE id_producto = $2',
        [stockProducto.get(producto.nombre), producto.id]
      );
    }

    console.log(`Escrito: ${filasIngreso.length} compras, ${filasLote.length} lotes `
      + `(${filasConsumo.length} consumos), ${filasVenta.length} ventas `
      + `(${filasDetalle.length} lineas de detalle)`);

    const unidadesVendidas = filasDetalle.reduce((s, f) => s + f[0], 0);
    const facturado = filasVenta.reduce((s, f) => s + f[1], 0);
    console.log(`Unidades vendidas: ${unidadesVendidas} — facturado: $${Math.round(facturado)}\n`);

    console.log('Como queda el stock (insumo: stock / minimo-maximo, costo):');
    for (const insumo of insumos) {
      console.log(`  ${insumo.nombre.padEnd(26)} ${String(dos(stockInsumo.get(insumo.nombre))).padStart(9)} ${insumo.unidad.padEnd(7)}`
        + ` (${insumo.stockMinimo}-${insumo.stockMaximo})  costo ${costoInsumo.get(insumo.nombre)}`);
    }
    console.log('Como queda el stock (producto: unidades):');
    for (const producto of productos) {
      console.log(`  ${producto.nombre.padEnd(26)} ${String(stockProducto.get(producto.nombre)).padStart(6)}`
        + `   (demanda ${Math.round(producto.demandaDia)}/dia, masa ${producto.masa})`);
    }
    console.log('');

    if (SIMULAR) throw new SalidaSimulada();
  }).catch((error) => {
    if (error instanceof SalidaSimulada) {
      console.log('--simular: la transaccion se revirtio, no se escribio nada.\n');
      return;
    }
    throw error;
  });

  if (SIMULAR) return;

  // --- verificacion contra la base

  console.log('Totales en la base:');
  let todoBien = true;
  for (const [tabla, objetivo] of Object.entries(OBJETIVOS)) {
    const n = await contar(tabla);
    const marca = n === objetivo ? 'ok' : 'NO COINCIDE';
    if (n !== objetivo) todoBien = false;
    console.log(`  ${tabla.padEnd(24)} ${String(n).padStart(5)}  (deck ${objetivo})  ${marca}`);
  }

  const { rows: negativos } = await consultar(
    `SELECT 'materia_prima' AS tabla, nombre, stock_actual::text AS stock
       FROM materia_prima WHERE stock_actual < 0
     UNION ALL
     SELECT 'producto', nombre, stock_actual::text FROM producto WHERE stock_actual < 0`
  );
  console.log(negativos.length === 0
    ? '\nNingun stock quedo negativo.'
    : `\nATENCION: ${negativos.length} filas con stock negativo`);
  for (const fila of negativos) console.log(`  ${fila.tabla} ${fila.nombre}: ${fila.stock}`);

  const despues = await contarDescuadres();
  console.log('\nTotales que no cierran con su detalle (antes -> despues):');
  console.log(`  ventas: ${descuadresAntes.ventas} -> ${despues.ventas}`);
  console.log(`  lotes:  ${descuadresAntes.lotes} -> ${despues.lotes}`);
  if (despues.ventas > descuadresAntes.ventas || despues.lotes > descuadresAntes.lotes) {
    todoBien = false;
    console.log('  ATENCION: la siembra dejo filas descuadradas');
  }

  console.log(todoBien ? '\nLa base coincide con la diapositiva 23.\n' : '\nRevisar: algun total no coincide.\n');
}

principal()
  .catch((error) => {
    console.error('\nNo se sembro nada (la transaccion se revirtio):', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
