import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/config/db.js';
import { planificarCompras } from '../scripts/sembrar-demo.js';

/* El script de siembra no es parte del sistema, pero su planificacion de
   compras tiene cuentas propias y ahi estuvo un problema real: el azucar
   arrancaba con 320 kg contra un maximo de 200, la cuenta de cuanto comprar
   daba negativa y caia al piso del multiplo, asi que emitio doce entregas de
   un kilo y la base nacio con una alerta de Sobrestock.

   El script apuntaba a terminar en stockMaximo * 0.7 justo para no disparar
   alertas, pero nunca verificaba si lo habia logrado. Es el mismo hueco que
   el bug del Panificador: una intencion sin comprobacion. Estas pruebas
   comprueban el resultado.

   No tocan la base: planificarCompras es una funcion pura. */

const DIAS = 60;

// Lunes a domingo girando, para que caigan domingos adentro de la ventana.
const diasDe = (n) => Array.from({ length: n }, (_, i) => ({ diaSemana: (i + 1) % 7 }));

/* Los doce insumos de la demo con sus limites reales. El consumo diario es
   plano: lo que importa aca es el reparto de entregas, no la curva. */
const INSUMOS = [
  { nombre: 'Harina 000', unidad: 'kg', stock: 120, stockMinimo: 50, stockMaximo: 400, porDia: 14.5 },
  { nombre: 'Levadura fresca', unidad: 'kg', stock: 18, stockMinimo: 10, stockMaximo: 60, porDia: 0.4 },
  { nombre: 'Sal fina', unidad: 'kg', stock: 25, stockMinimo: 15, stockMaximo: 100, porDia: 0.31 },
  { nombre: 'Azucar', unidad: 'kg', stock: 40, stockMinimo: 30, stockMaximo: 200, porDia: 1.38 },
  { nombre: 'Manteca', unidad: 'kg', stock: 30, stockMinimo: 12, stockMaximo: 80, porDia: 1.66 },
  { nombre: 'Leche entera', unidad: 'l', stock: 40, stockMinimo: 20, stockMaximo: 150, porDia: 1.02 },
  { nombre: 'Huevos', unidad: 'u', stock: 200, stockMinimo: 120, stockMaximo: 900, porDia: 2.9 },
  { nombre: 'Miel', unidad: 'kg', stock: 4, stockMinimo: 2, stockMaximo: 15, porDia: 0.04 },
  { nombre: 'Aceite de girasol', unidad: 'l', stock: 20, stockMinimo: 8, stockMaximo: 60, porDia: 0.07 },
  { nombre: 'Almidon de maiz', unidad: 'kg', stock: 10, stockMinimo: 3, stockMaximo: 25, porDia: 0.04 },
  { nombre: 'Dulce de leche repostero', unidad: 'kg', stock: 15, stockMinimo: 10, stockMaximo: 80, porDia: 0.38 },
  { nombre: 'Grasa vacuna refinada', unidad: 'kg', stock: 20, stockMinimo: 5, stockMaximo: 40, porDia: 1.44 },
];

function escenario(cambios = {}) {
  const insumos = INSUMOS.map((i) => ({ ...i, ...(cambios[i.nombre] ?? {}) }));
  const consumoPorDia = Array.from({ length: DIAS }, () =>
    new Map(insumos.map((i) => [i.nombre, i.porDia])));
  return { dias: diasDe(DIAS), insumos, consumoPorDia };
}

const entregasDe = (compras, nombre) => compras.filter((c) => c.insumo.nombre === nombre);

function stockFinal(compras, insumo) {
  const comprado = entregasDe(compras, insumo.nombre).reduce((a, c) => a + c.cantidad, 0);
  return insumo.stock + comprado - insumo.porDia * DIAS;
}

// Silencia los avisos del planificador y devuelve lo que imprimio.
function sinRuido(fn) {
  const original = console.log;
  const lineas = [];
  console.log = (...partes) => lineas.push(partes.join(' '));
  try {
    return { valor: fn(), lineas };
  } finally {
    console.log = original;
  }
}

test('al insumo que ya tiene stock de sobra no se le compra nada', () => {
  // El caso del azucar: 320 kg para consumir 83 en los sesenta dias.
  const { dias, insumos, consumoPorDia } = escenario({ Azucar: { stock: 320 } });
  const { valor: compras } = sinRuido(() => planificarCompras(dias, insumos, consumoPorDia));

  assert.equal(entregasDe(compras, 'Azucar').length, 0,
    'el azucar no necesita comprar y no deberia recibir entregas');
});

test('no se emiten entregas de relleno del tamano minimo', () => {
  const { dias, insumos, consumoPorDia } = escenario({ Azucar: { stock: 320 } });
  const { valor: compras } = sinRuido(() => planificarCompras(dias, insumos, consumoPorDia));

  /* El sintoma concreto que tenia la base: doce entregas de 1,00 kg de
     azucar. Ninguna entrega deberia ser tan chica como para cubrir menos de
     un dia de consumo de su insumo. */
  for (const compra of compras) {
    const porDia = insumos.find((i) => i.nombre === compra.insumo.nombre).porDia;
    assert.ok(compra.cantidad >= porDia,
      `${compra.insumo.nombre}: entrega de ${compra.cantidad} y consume ${porDia} por dia`);
  }
});

test('las entregas que sobran se reparten: el total no cambia', () => {
  const normal = escenario();
  const conSobrante = escenario({ Azucar: { stock: 320 } });

  const { valor: comprasNormal } = sinRuido(() =>
    planificarCompras(normal.dias, normal.insumos, normal.consumoPorDia));
  const { valor: comprasSobrante } = sinRuido(() =>
    planificarCompras(conSobrante.dias, conSobrante.insumos, conSobrante.consumoPorDia));

  assert.equal(comprasSobrante.length, comprasNormal.length,
    'la cantidad total de compras es la que pide la presentacion y no puede cambiar');
  assert.ok(entregasDe(comprasNormal, 'Azucar').length > 0,
    'con stock normal el azucar si recibe sus entregas');
});

test('ningun insumo termina abajo de su minimo', () => {
  const { dias, insumos, consumoPorDia } = escenario();
  const { valor: compras } = sinRuido(() => planificarCompras(dias, insumos, consumoPorDia));

  for (const insumo of insumos) {
    const final = stockFinal(compras, insumo);
    assert.ok(final >= insumo.stockMinimo,
      `${insumo.nombre} termina en ${final.toFixed(2)} y su minimo es ${insumo.stockMinimo}`);
  }
});

test('el stock nunca se va a negativo en ningun dia de la ventana', () => {
  const { dias, insumos, consumoPorDia } = escenario();
  const { valor: compras } = sinRuido(() => planificarCompras(dias, insumos, consumoPorDia));

  for (const insumo of insumos) {
    let stock = insumo.stock;
    for (let d = 0; d < DIAS; d++) {
      for (const compra of entregasDe(compras, insumo.nombre)) {
        if (compra.indiceDia === d) stock += compra.cantidad;
      }
      stock -= consumoPorDia[d].get(insumo.nombre);
      assert.ok(stock >= 0, `${insumo.nombre} queda en ${stock.toFixed(2)} el dia ${d}`);
    }
  }
});

test('si un limite esta mal puesto corta en vez de sembrar una alerta', () => {
  /* Con maximo 60 y minimo 50 el objetivo del script (maximo * 0.7 = 42)
     queda abajo del minimo, asi que la demo naceria con un StockCritico.
     Antes pasaba inadvertido: nadie miraba el resultado. */
  const { dias, insumos, consumoPorDia } = escenario({
    Miel: { stockMinimo: 50, stockMaximo: 60 },
  });

  assert.throws(
    () => sinRuido(() => planificarCompras(dias, insumos, consumoPorDia)),
    /Miel[\s\S]*minimo/,
    'tendria que avisar que la miel termina abajo del minimo'
  );
});

test('el excedente heredado se avisa, con el remedio a mano', () => {
  const { dias, insumos, consumoPorDia } = escenario({ Azucar: { stock: 320 } });
  const { lineas } = sinRuido(() => planificarCompras(dias, insumos, consumoPorDia));

  const aviso = lineas.find((l) => l.includes('Azucar') && l.includes('maximo'));
  assert.ok(aviso, `tendria que avisar del sobrestock del azucar. Imprimio: ${lineas.join(' | ')}`);
  assert.match(aviso, /CU-04/, 'el aviso tiene que decir como corregirlo');
});

test('con los limites corregidos el azucar ya no genera aviso', () => {
  // Es el arreglo que se aplico en la base: el maximo paso de 200 a 300.
  const { dias, insumos, consumoPorDia } = escenario({
    Azucar: { stock: 249.29, stockMaximo: 300 },
  });
  const { lineas } = sinRuido(() => planificarCompras(dias, insumos, consumoPorDia));

  assert.equal(lineas.filter((l) => l.includes('maximo')).length, 0,
    `no tendria que quedar ningun insumo fuera de rango. Imprimio: ${lineas.join(' | ')}`);
});

after(() => pool.end());
