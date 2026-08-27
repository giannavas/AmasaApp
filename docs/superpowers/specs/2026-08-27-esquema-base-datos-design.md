# Diseño del esquema de base de datos — AmasaApp

**Fecha:** 27 de agosto de 2026
**Sprint:** 0 — Preparación
**Motor:** PostgreSQL 18.1

## 1. Contexto y alcance

Este documento define el esquema de base de datos de AmasaApp, sistema de gestión
administrativa para la panificadora AmasaPan.

El esquema se deriva del modelo de datos de la documentación del proyecto: el diagrama de
entidad-relación (sección 7.1), el diccionario de datos (7.2), el modelo físico (7.3) y el
diseño de clases (7.4).

Queda fuera de alcance la lógica de negocio, que reside en el backend. Este documento define
únicamente la estructura de datos y las restricciones que la protegen.

## 2. Decisiones de diseño

### 2.1 Convención de nombres: snake_case

La documentación usa camelCase (`idMateriaPrima`, `stockActual`). PostgreSQL convierte a
minúsculas todo identificador no entrecomillado, de modo que conservar camelCase obligaría a
escribir comillas dobles en cada consulta, de forma permanente.

Se adopta `snake_case` en la base de datos, con la conversión a camelCase en la capa de acceso
a datos del backend. Es la convención estándar de PostgreSQL.

**Consecuencia:** el modelo físico de la sección 7.3 debe actualizarse para reflejar esta
convención. Actualmente mezcla ambas (`id_rol` junto a `idMateriaPrima`).

### 2.2 Ubicación de la lógica de consistencia: backend

`materia_prima.stock_actual` y `producto.stock_actual` son datos derivados que se almacenan
como columna. Alguna capa debe mantenerlos consistentes.

Se opta por transacciones en el backend, con la lógica en Node.js. Toda escritura que afecte el
stock ocurre dentro de una transacción que se revierte por completo ante cualquier error.

Fundamentos:

- Concentra la lógica de negocio en un solo lugar, coincidiendo con el diseño de clases, que ya
  la ubica en los métodos `descontarStock()` y `consumirInsumos()`.
- Permite aplicar desarrollo guiado por pruebas, práctica adoptada por el equipo.
- La depuración se realiza sobre código JavaScript, más accesible para el equipo que la
  depuración de triggers.

Alternativas descartadas: triggers en la base de datos (parte la lógica en dos lugares y
duplica lo definido en el diseño de clases) y stock calculado mediante vistas (contradice el
diccionario de datos entregado, donde `stockActual` es una columna).

**Riesgo asumido:** una modificación directa sobre la base, por fuera de la aplicación, puede
desincronizar el stock. Se mitiga con las restricciones descritas en la sección 5.

### 2.3 Costeo de insumos: promedio ponderado móvil

El diseño de clases expone `MateriaPrima.precioUnitarioActual()` sin definir su cálculo. Se
adopta promedio ponderado móvil, que requiere almacenar el promedio vigente en
`materia_prima.costo_promedio`.

El promedio se recalcula en cada ingreso de mercadería:

```
nuevo_promedio = (stock_actual × costo_promedio + cantidad_ingresada × precio_pagado)
                 ─────────────────────────────────────────────────────────────────────
                              stock_actual + cantidad_ingresada
```

Los consumos no alteran el promedio: solo las compras lo modifican.

### 2.4 Proveedor habitual: opcional

`materia_prima.id_proveedor_habitual` admite valores nulos, siguiendo el diseño de clases, que
define la relación como `0..1`. Esto corrige la discrepancia con el diccionario de datos, que
la marcaba como obligatoria.

## 3. Estructura del esquema

Doce tablas, agrupadas según la división del diagrama de clases.

| Bloque | Tablas |
|---|---|
| Seguridad y acceso | `rol`, `usuario` |
| Insumos y proveedores | `proveedor`, `materia_prima`, `ingreso_materia_prima` |
| Recetas y producción | `receta`, `receta_detalle`, `lote_produccion`, `consumo_materia_prima` |
| Productos y ventas | `producto`, `venta`, `detalle_venta` |

Once provienen del DER sin cambios estructurales. `consumo_materia_prima` es nueva.

Las clases `Alerta`, `GestorAlertas` y `PanelControl` no generan tablas: son servicios que
calculan sobre las tablas existentes. Las enumeraciones `EstadoStock` y `TipoAlerta` se derivan
comparando el stock contra los umbrales configurados.

Las claves primarias usan `INT GENERATED ALWAYS AS IDENTITY`, forma estándar en PostgreSQL
desde la versión 10.

## 4. Adiciones al modelo documentado

### 4.1 Tabla `consumo_materia_prima`

Registra, para cada lote de producción, qué insumos se consumieron, en qué cantidad y a qué
costo unitario.

| Columna | Tipo | Descripción |
|---|---|---|
| `id_consumo` | PK | Identificador único |
| `id_lote` | FK | Lote de producción |
| `id_materia_prima` | FK | Insumo consumido |
| `cantidad` | DECIMAL(10,2) | Cantidad consumida |
| `costo_unitario` | DECIMAL(10,2) | Promedio ponderado al momento de producir |
| `subtotal` | DECIMAL(10,2) | cantidad × costo_unitario |

**Justificación.** El modelo documentado registra el costo total de cada lote sin detallar su
composición. Ante una modificación posterior de la receta, los lotes ya producidos perderían el
registro de lo que efectivamente consumieron. Esta tabla resuelve la falta de trazabilidad
identificada en la sección 2.2 del documento del proyecto, y respalda el requerimiento RF-06.

Con ella, `lote_produccion.costo_total` pasa a ser la suma verificable de sus consumos.

### 4.2 Columna `materia_prima.costo_promedio`

Almacena el promedio ponderado vigente del insumo, necesario para la decisión 2.3.

## 5. Integridad

Las restricciones actúan como red de seguridad de la decisión 2.2: si la lógica del backend
falla, la base rechaza el dato inválido en lugar de almacenarlo.

**Restricciones de valor**

- Stock no negativo en `materia_prima` y `producto`.
- `stock_maximo >= stock_minimo`.
- Cantidades estrictamente positivas en ingresos, consumos, detalles de venta, detalles de
  receta y lotes producidos.
- Precios y costos no negativos.

**Unicidad**

- `usuario.email` y `receta.id_producto`, según el diccionario de datos.
- `proveedor.cuit`, únicamente cuando tiene valor, dado que es opcional.
- `rol.nombre`.
- Un mismo insumo no puede repetirse dentro de una receta ni dentro del consumo de un lote.

**Comportamiento ante borrado**

| Comportamiento | Casos | Motivo |
|---|---|---|
| Bloquear | Proveedor con ingresos, materia prima consumida, producto vendido | Preserva el historial contable |
| Cascada | Detalles de venta, detalles de receta, consumos de lote | El detalle no tiene sentido sin su cabecera |
| Poner en nulo | `materia_prima.id_proveedor_habitual` | Habilitado por la decisión 2.4 |

## 6. Índices

PostgreSQL indexa automáticamente las claves primarias, pero no las foráneas. Se indexan todas
las claves foráneas, ya que las consultas del sistema navegan esas relaciones de forma
constante.

Se agregan índices por fecha en `venta`, `lote_produccion` e `ingreso_materia_prima`, usados por
el panel de control para filtrar por período.

Al volumen de datos previsto, estos índices no resultan determinantes para cumplir el RNF-02.
Se incorporan como buena práctica, con costo de mantenimiento despreciable.

## 7. Datos iniciales

Se cargan los tres roles del sistema: **Venta**, **Panificador** y **Encargado**.

Estos son los roles utilizados por la tabla de módulos de la sección 5.2, el caso de uso CU-02 y
el diseño de clases.

**Consecuencia:** el párrafo introductorio de la sección 5.2 debe corregirse. Enuncia cuatro
actores, enumera tres, y los nombra de forma distinta al resto del documento (Empleado,
Encargado, Administrador).

## 8. Ubicación y verificación

El script se versiona en el repositorio bajo `db/`, separado en estructura y datos iniciales.
Esto implementa la acción preventiva definida para el riesgo 1 de la sección 8.3, referido a la
concentración del conocimiento de la base de datos en un solo integrante.

**Criterios de verificación**

1. El script se ejecuta completo sobre una base vacía, sin errores, en una sola pasada.
2. Cada restricción rechaza efectivamente lo que debe rechazar: stock negativo, cantidades en
   cero, correo duplicado, insumo repetido dentro de una receta.
3. Los datos iniciales quedan cargados y consultables.

Una restricción que no se dispare ante el dato inválido correspondiente está mal escrita.

## 9. Deuda técnica registrada

**Control de vencimientos.** `ingreso_materia_prima.fecha_vencimiento` se registra conforme al
RF-01, pero no existe seguimiento de la cantidad restante por lote, por lo que no puede
determinarse si un lote vencido conserva mercadería.

Se omite deliberadamente: ningún requerimiento solicita alertas por vencimiento. RF-04 define
alertas por umbrales de stock, no por caducidad. Implementarlo exigiría distribuir cada consumo
entre lotes según orden de vencimiento.

De incorporarse más adelante, la información histórica ya estará disponible.

## 10. Correcciones pendientes en la documentación

Derivadas de este diseño:

1. Sección 5.2 — unificar los roles del sistema (ver sección 7).
2. Sección 7.2 / 7.3 — `rol.descripcion` figura como `VARCHAR(255)` en el diccionario y como
   `descipcion VARCHAR(50)`, con errata, en el modelo físico.
3. Sección 7.3 — unificar la convención de nombres a snake_case.
4. Sección 7.2 — `id_proveedor_habitual` pasa a admitir nulos.
5. Secciones 7.1 a 7.3 — incorporar `consumo_materia_prima` y `materia_prima.costo_promedio`.
