# Informe de pruebas — Tercera entrega

**Fecha:** 19/10/2026
**Versión probada:** `3e70edf` (Commit 12) más las correcciones de este informe
**Entorno:** Windows 11, Node.js 24.19, PostgreSQL 18.6, base local `amasaapp`
con datos cargados desde la aplicación (más de 2600 ventas y 400 lotes)

## Resumen

| Capa | Archivos | Comprobaciones | Resultado |
|---|---|---|---|
| Base de datos (`db/tests/`) | 6 | 36 | 36 OK, después de corregir 3 archivos |
| Backend (`backend/tests/`) | 13 | 231 | 231 OK |

Las pruebas de la base se corrieron cinco veces seguidas después de la
corrección, todas en verde, para descartar fallos intermitentes. Ninguna dejó
datos: cada archivo trabaja dentro de una transacción que termina en
`ROLLBACK`.

## Defectos encontrados

### 1. Las pruebas de la base contaban la tabla entera

Las pruebas `test_03`, `test_04` y `test_05` se escribieron el 27/08 sobre una
base vacía, y varias comprobaciones sumaban o contaban **toda** la tabla en
lugar de las filas que crea la propia prueba. Con la base vacía daba lo mismo;
en cuanto se cargaron datos desde la aplicación, fallaron:

| Prueba | Comprobación | Error |
|---|---|---|
| `test_03_recetas` | Borrar la receta borra sus detalles | `COUNT(*) FROM receta_detalle` encontró los 46 detalles de las recetas reales |
| `test_04_produccion` | El subtotal del consumo es trazable | `SUM(subtotal)` de los 2580 consumos daba 10.687.287,29 en vez de 16.200 |
| `test_05_ventas` | El total de la venta coincide con sus subtotales | `SUM(subtotal)` de los 3858 detalles daba 20.405.750 en vez de 1.050 |

Es el mismo defecto latente que el Commit 12 corrigió en las pruebas de ventas
del backend. Las restricciones de la base funcionaban bien: lo que estaba mal
era cómo lo verificaba la prueba.

### 2. Una comprobación leía una fila al azar

En `test_05_ventas`, la comprobación del precio histórico hacía
`SELECT precio_unitario FROM detalle_venta LIMIT 1`, sin filtro ni orden.
PostgreSQL devuelve cualquier fila, así que el resultado dependía de la suerte:
en una de las corridas leyó una venta real de 7500 y falló.

### 3. Las pruebas de cascada borraban todo

`test_04` hacía `DELETE FROM lote_produccion` y `test_05` hacía
`DELETE FROM venta`, sin `WHERE`. El `ROLLBACK` final lo deshacía, pero la
prueba no verificaba lo que decía: al borrar todos los lotes, los consumos
quedaban en cero aunque la cascada no funcionara para el lote de la prueba.

### Corrección

Cada consulta se acota ahora a lo que crea la propia prueba, buscándolo por
los nombres de prueba (`Harina R`, `Harina P`, `Receta P`, `Producto V`, el
usuario `venta5@test.com`). Así la prueba da el mismo resultado con la base
vacía o con datos reales.

## Detalle — Base de datos

Se corren con `psql` (ver `db/README.md`). Para este informe se usó el usuario
de la aplicación `amasaapp`: alcanza, porque las pruebas solo leen y escriben
datos.

| Archivo | OK | Qué verifica |
|---|---|---|
| `test_01_seguridad` | 5 | Rol y email únicos, rol obligatorio, no se borra un rol con usuarios, usuario activo por defecto |
| `test_02_insumos` | 8 | Stock no negativo, umbrales coherentes, proveedor habitual opcional y en NULL al borrarlo, ingreso mayor que cero, no se borra un proveedor con ingresos, CUIT único pero opcional |
| `test_03_recetas` | 7 | Stock y precio no negativos, una receta por producto, rendimiento mayor que cero, insumo no repetido, cascada receta → detalles, acentos y eñe |
| `test_04_produccion` | 6 | Cantidad mayor que cero, consumo con costo trazable, insumo no repetido en el lote, no se borra un insumo consumido, costo del lote = suma de consumos, cascada lote → consumos |
| `test_05_ventas` | 6 | Cantidad mayor que cero, total no negativo, total = suma de subtotales, no se borra un producto vendido, precio histórico conservado, cascada venta → detalles |
| `test_06_integral` | 4 | Existen las 12 tablas y los 18 índices, están los 3 roles, la fórmula del promedio ponderado da 540 |

## Detalle — Backend

Se corren con `npm test` dentro de `backend/`.

| Archivo | Pruebas | Caso de uso |
|---|---|---|
| `auth.test.js` | 11 | Permisos por rol |
| `sesion.test.js` | 10 | CU-01 Iniciar sesión |
| `usuarios.test.js` | 20 | CU-02 Gestionar usuarios |
| `materias-primas.test.js` | 29 | CU-03 / 04 / 05 Insumos y stock, ingreso de mercadería |
| `proveedores.test.js` | 11 | CU-11 Proveedores |
| `productos.test.js` | 14 | Productos |
| `recetas.test.js` | 14 | Recetas |
| `produccion.test.js` | 13 | CU-06 Registrar lote de producción |
| `ventas.test.js` | 29 | CU-07 / 08 Ventas e historial |
| `alertas.test.js` | 40 | CU-09 / 10 Umbrales y alertas |
| `panel.test.js` | 25 | CU-12 Panel de control |
| `db.test.js` | 5 | Conexión a la base |
| `integracion.test.js` | 10 | Un día completo de la panadería, incluye los casos de prueba 14 y 15 |

La prueba de integración recorre el circuito completo: el Encargado carga
proveedor, insumo, producto y receta; configura el umbral de la harina; el
Panificador produce y la harina queda en alerta con su proveedor; el mostrador
vende, la venta aparece en el historial y el panel muestra la rentabilidad.
Cierra comprobando que sin harina no se puede producir y que cada rol ve solo
sus pantallas.

## Pendientes

- **Caso de uso del ingreso de mercadería:** el Commit 10 agregó el registro de
  ingresos de materias primas, pero todavía no tiene un caso de uso escrito en
  el documento del proyecto.
- **Pruebas de pantalla:** el frontend no tiene pruebas automáticas; las
  pantallas se prueban a mano.
