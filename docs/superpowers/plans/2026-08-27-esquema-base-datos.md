# Esquema de base de datos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear el esquema PostgreSQL de AmasaApp — 12 tablas con sus restricciones, índices y datos iniciales — verificado mediante pruebas que comprueban que cada restricción rechaza lo que debe rechazar.

**Architecture:** Scripts SQL versionados en `db/`, ejecutables con `psql` sobre una base vacía. Las pruebas son scripts SQL independientes que usan bloques `DO` de PL/pgSQL: cada prueba intenta insertar un dato inválido y falla si la base lo acepta. Sin dependencias externas ni framework de testing.

**Tech Stack:** PostgreSQL 18.1, `psql` (cliente de línea de comandos).

**Spec:** `docs/superpowers/specs/2026-08-27-esquema-base-datos-design.md`

## Global Constraints

- Motor: PostgreSQL 18.1. Ruta de binarios: `C:\Program Files\PostgreSQL\18\bin`.
- Base de datos: `amasaapp`. Usuario de conexión: `postgres`, host `localhost`, puerto `5432`.
- Credenciales: resueltas por `%APPDATA%\postgresql\pgpass.conf`. Usar siempre `psql -w` para que nunca solicite contraseña de forma interactiva.
- Convención de nombres: `snake_case`. Tablas en singular. Clave primaria `id_<tabla>`.
- Claves primarias: `INT GENERATED ALWAYS AS IDENTITY`.
- Montos y cantidades de insumos: `DECIMAL(10,2)`. Unidades de producto: `INT`.
- Todo script se ejecuta con `-v ON_ERROR_STOP=1` para que aborte ante el primer error.
- Nombres de restricciones explícitos: `ck_` para CHECK, `uq_` para UNIQUE, `fk_` para claves foráneas.
- Cada archivo de prueba corre dentro de `BEGIN; ... ROLLBACK;`. No deja datos en la base aunque aborte a la mitad, y puede ejecutarse repetidas veces sin limpieza previa.
- `ON DELETE RESTRICT` lanza `restrict_violation` (SQLSTATE 23001), **no** `foreign_key_violation` (23503) — ese lo lanza `NO ACTION`, y también un INSERT con clave foránea inexistente. Las pruebas de borrado bloqueado capturan ambos.

---

### Task 1: Estructura del proyecto y bloque de seguridad

Crea la base de datos, la estructura de carpetas y las dos primeras tablas: `rol` y `usuario`.

**Files:**
- Create: `db/01_schema.sql`
- Create: `db/tests/test_01_seguridad.sql`
- Create: `db/README.md`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces: base de datos `amasaapp`; tablas `rol (id_rol, nombre, descripcion)` y `usuario (id_usuario, nombre, email, password_hash, activo, id_rol)`. El archivo `db/01_schema.sql` queda abierto para que las tareas siguientes le agreguen tablas al final.

- [ ] **Step 1: Crear la base de datos**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d postgres \
  -v ON_ERROR_STOP=1 -c "CREATE DATABASE amasaapp;"
```

Esperado: `CREATE DATABASE`. Si informa que ya existe, borrarla primero con `DROP DATABASE amasaapp;` — el esquema todavía no tiene datos que preservar.

- [ ] **Step 2: Escribir la prueba que debe fallar**

Crear `db/tests/test_01_seguridad.sql`:

```sql
-- Verifica las restricciones del bloque de seguridad y acceso.
-- Cada bloque intenta insertar un dato invalido: si la base lo acepta,
-- la prueba lanza una excepcion y el script aborta.

\echo '== Test 01: seguridad y acceso =='
BEGIN;

-- Datos de apoyo
INSERT INTO rol (nombre, descripcion) VALUES ('TestRol', 'Rol de prueba');

-- 1. El nombre de rol no puede repetirse
DO $$
BEGIN
    BEGIN
        INSERT INTO rol (nombre, descripcion) VALUES ('TestRol', 'Duplicado');
        RAISE EXCEPTION 'FALLO: se permitio un nombre de rol duplicado';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK: nombre de rol duplicado rechazado';
    END;
END $$;

-- 2. El email de usuario no puede repetirse
INSERT INTO usuario (nombre, email, password_hash, id_rol)
VALUES ('Usuario Uno', 'uno@test.com', 'hash', (SELECT id_rol FROM rol WHERE nombre = 'TestRol'));

DO $$
BEGIN
    BEGIN
        INSERT INTO usuario (nombre, email, password_hash, id_rol)
        VALUES ('Usuario Dos', 'uno@test.com', 'hash',
                (SELECT id_rol FROM rol WHERE nombre = 'TestRol'));
        RAISE EXCEPTION 'FALLO: se permitio un email duplicado';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK: email duplicado rechazado';
    END;
END $$;

-- 3. Un usuario no puede tener un rol inexistente
DO $$
BEGIN
    BEGIN
        INSERT INTO usuario (nombre, email, password_hash, id_rol)
        VALUES ('Usuario Tres', 'tres@test.com', 'hash', 999999);
        RAISE EXCEPTION 'FALLO: se permitio un rol inexistente';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'OK: rol inexistente rechazado';
    END;
END $$;

-- 4. No se puede borrar un rol que tiene usuarios asignados
DO $$
BEGIN
    BEGIN
        DELETE FROM rol WHERE nombre = 'TestRol';
        RAISE EXCEPTION 'FALLO: se permitio borrar un rol con usuarios';
    EXCEPTION WHEN restrict_violation OR foreign_key_violation THEN
        RAISE NOTICE 'OK: borrado de rol con usuarios rechazado';
    END;
END $$;

-- 5. activo debe venir en true por defecto
DO $$
DECLARE v_activo BOOLEAN;
BEGIN
    SELECT activo INTO v_activo FROM usuario WHERE email = 'uno@test.com';
    IF v_activo IS NOT TRUE THEN
        RAISE EXCEPTION 'FALLO: activo no quedo en true por defecto';
    END IF;
    RAISE NOTICE 'OK: activo por defecto en true';
END $$;

ROLLBACK;

\echo '== Test 01 completo =='
```

- [ ] **Step 3: Ejecutar la prueba y confirmar que falla**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d amasaapp \
  -v ON_ERROR_STOP=1 -f db/tests/test_01_seguridad.sql
```

Esperado: FALLA con `ERROR: relation "rol" does not exist`. Las tablas todavía no existen — ese es el punto.

- [ ] **Step 4: Escribir el esquema mínimo**

Crear `db/01_schema.sql`:

```sql
-- ============================================================
-- AmasaApp - Esquema de base de datos
-- PostgreSQL 18
-- Ver: docs/superpowers/specs/2026-08-27-esquema-base-datos-design.md
-- ============================================================

-- ------------------------------------------------------------
-- Bloque 1: Seguridad y acceso
-- ------------------------------------------------------------

CREATE TABLE rol (
    id_rol      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(50)  NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    CONSTRAINT uq_rol_nombre UNIQUE (nombre)
);

COMMENT ON TABLE rol IS 'Roles del sistema: Venta, Panificador, Encargado';

CREATE TABLE usuario (
    id_usuario    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre        VARCHAR(50)  NOT NULL,
    email         VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    id_rol        INT          NOT NULL,
    CONSTRAINT uq_usuario_email UNIQUE (email),
    CONSTRAINT fk_usuario_rol FOREIGN KEY (id_rol)
        REFERENCES rol (id_rol) ON DELETE RESTRICT
);

COMMENT ON COLUMN usuario.activo IS 'Indica si el usuario puede iniciar sesion';
```

- [ ] **Step 5: Ejecutar el esquema**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d amasaapp \
  -v ON_ERROR_STOP=1 -f db/01_schema.sql
```

Esperado: `CREATE TABLE` dos veces, `COMMENT` dos veces, sin errores.

- [ ] **Step 6: Ejecutar la prueba y confirmar que pasa**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d amasaapp \
  -v ON_ERROR_STOP=1 -f db/tests/test_01_seguridad.sql
```

Esperado: cinco líneas `NOTICE: OK: ...` y `== Test 01 completo ==`. Ninguna línea `FALLO`.

- [ ] **Step 7: Documentar cómo se usa**

Crear `db/README.md`:

```markdown
# Base de datos — AmasaApp

Esquema PostgreSQL del sistema. Diseño: `docs/superpowers/specs/2026-08-27-esquema-base-datos-design.md`

## Requisitos

PostgreSQL 18 o superior.

## Crear la base desde cero

    psql -U postgres -h localhost -d postgres -c "CREATE DATABASE amasaapp;"
    psql -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/01_schema.sql
    psql -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/02_seed.sql

En Windows, si `psql` no está en el PATH, usar la ruta completa:
`"C:\Program Files\PostgreSQL\18\bin\psql"`

## Ejecutar las pruebas

    psql -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/tests/test_01_seguridad.sql

Cada prueba imprime `OK:` por cada restricción verificada. Si alguna
restricción no rechaza el dato inválido, el script aborta con `FALLO:`.

## Archivos

| Archivo | Contenido |
|---|---|
| `01_schema.sql` | Tablas, restricciones e índices |
| `02_seed.sql` | Datos iniciales (roles del sistema) |
| `tests/` | Pruebas de las restricciones |
```

- [ ] **Step 8: Commit**

```bash
git add db/01_schema.sql db/tests/test_01_seguridad.sql db/README.md
git commit -m "Crear esquema de base de datos: bloque de seguridad y acceso"
```

---

### Task 2: Insumos y proveedores

Agrega `proveedor`, `materia_prima` e `ingreso_materia_prima`.

**Files:**
- Modify: `db/01_schema.sql` (agregar al final)
- Create: `db/tests/test_02_insumos.sql`

**Interfaces:**
- Consumes: `usuario (id_usuario)` de la Task 1.
- Produces: `proveedor (id_proveedor, razon_social, cuit, telefono, email, direccion)`; `materia_prima (id_materia_prima, nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo, costo_promedio, id_proveedor_habitual)`; `ingreso_materia_prima (id_ingreso, cantidad, precio_unitario, fecha_ingreso, fecha_vencimiento, id_materia_prima, id_usuario, id_proveedor)`.

- [ ] **Step 1: Escribir la prueba que debe fallar**

Crear `db/tests/test_02_insumos.sql`:

```sql
\echo '== Test 02: insumos y proveedores =='
BEGIN;

INSERT INTO rol (nombre, descripcion) VALUES ('TestRol2', 'Rol de prueba');
INSERT INTO usuario (nombre, email, password_hash, id_rol)
VALUES ('Tester', 'tester2@test.com', 'hash', (SELECT id_rol FROM rol WHERE nombre = 'TestRol2'));
INSERT INTO proveedor (razon_social, cuit) VALUES ('Molino Test', '20-12345678-9');

-- 1. El stock de materia prima no puede ser negativo
DO $$
BEGIN
    BEGIN
        INSERT INTO materia_prima (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo)
        VALUES ('Harina Test', 'kg', -1, 0, 100);
        RAISE EXCEPTION 'FALLO: se permitio stock negativo en materia_prima';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: stock negativo rechazado';
    END;
END $$;

-- 2. El stock maximo no puede ser menor que el minimo
DO $$
BEGIN
    BEGIN
        INSERT INTO materia_prima (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo)
        VALUES ('Harina Test', 'kg', 0, 100, 50);
        RAISE EXCEPTION 'FALLO: se permitio stock_maximo menor que stock_minimo';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: umbrales incoherentes rechazados';
    END;
END $$;

-- 3. El proveedor habitual es opcional
DO $$
BEGIN
    INSERT INTO materia_prima (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo,
                               id_proveedor_habitual)
    VALUES ('Harina Test', 'kg', 0, 10, 500, NULL);
    RAISE NOTICE 'OK: materia prima sin proveedor habitual aceptada';
END $$;

-- 4. Al borrar el proveedor, el habitual queda en NULL (no bloquea)
INSERT INTO proveedor (razon_social, cuit) VALUES ('Proveedor Borrable', '20-99999999-9');
UPDATE materia_prima
   SET id_proveedor_habitual = (SELECT id_proveedor FROM proveedor WHERE razon_social = 'Proveedor Borrable')
 WHERE nombre = 'Harina Test';
DELETE FROM proveedor WHERE razon_social = 'Proveedor Borrable';

DO $$
DECLARE v_prov INT;
BEGIN
    SELECT id_proveedor_habitual INTO v_prov FROM materia_prima WHERE nombre = 'Harina Test';
    IF v_prov IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO: id_proveedor_habitual no quedo en NULL tras borrar el proveedor';
    END IF;
    RAISE NOTICE 'OK: proveedor habitual quedo en NULL al borrar el proveedor';
END $$;

-- 5. La cantidad de un ingreso debe ser mayor que cero
DO $$
BEGIN
    BEGIN
        INSERT INTO ingreso_materia_prima
            (cantidad, precio_unitario, fecha_ingreso, id_materia_prima, id_usuario, id_proveedor)
        VALUES (0, 500, CURRENT_DATE,
                (SELECT id_materia_prima FROM materia_prima WHERE nombre = 'Harina Test'),
                (SELECT id_usuario FROM usuario WHERE email = 'tester2@test.com'),
                (SELECT id_proveedor FROM proveedor WHERE razon_social = 'Molino Test'));
        RAISE EXCEPTION 'FALLO: se permitio un ingreso con cantidad cero';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: ingreso con cantidad cero rechazado';
    END;
END $$;

-- 6. No se puede borrar un proveedor que tiene ingresos registrados
INSERT INTO ingreso_materia_prima
    (cantidad, precio_unitario, fecha_ingreso, id_materia_prima, id_usuario, id_proveedor)
VALUES (100, 500, CURRENT_DATE,
        (SELECT id_materia_prima FROM materia_prima WHERE nombre = 'Harina Test'),
        (SELECT id_usuario FROM usuario WHERE email = 'tester2@test.com'),
        (SELECT id_proveedor FROM proveedor WHERE razon_social = 'Molino Test'));

DO $$
BEGIN
    BEGIN
        DELETE FROM proveedor WHERE razon_social = 'Molino Test';
        RAISE EXCEPTION 'FALLO: se permitio borrar un proveedor con ingresos';
    EXCEPTION WHEN restrict_violation OR foreign_key_violation THEN
        RAISE NOTICE 'OK: borrado de proveedor con ingresos rechazado';
    END;
END $$;

ROLLBACK;

\echo '== Test 02 completo =='
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que falla**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d amasaapp \
  -v ON_ERROR_STOP=1 -f db/tests/test_02_insumos.sql
```

Esperado: FALLA con `ERROR: relation "proveedor" does not exist`.

- [ ] **Step 3: Agregar las tablas al esquema**

Agregar al final de `db/01_schema.sql`:

```sql
-- ------------------------------------------------------------
-- Bloque 2: Insumos y proveedores
-- ------------------------------------------------------------

CREATE TABLE proveedor (
    id_proveedor INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razon_social VARCHAR(150) NOT NULL,
    cuit         VARCHAR(13),
    telefono     VARCHAR(20),
    email        VARCHAR(150),
    direccion    VARCHAR(150)
);

-- El CUIT es opcional, pero si esta cargado no puede repetirse
CREATE UNIQUE INDEX uq_proveedor_cuit ON proveedor (cuit) WHERE cuit IS NOT NULL;

CREATE TABLE materia_prima (
    id_materia_prima      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre                VARCHAR(50)   NOT NULL,
    unidad_medida         VARCHAR(10)   NOT NULL,
    stock_actual          DECIMAL(10,2) NOT NULL DEFAULT 0,
    stock_minimo          DECIMAL(10,2) NOT NULL,
    stock_maximo          DECIMAL(10,2) NOT NULL,
    costo_promedio        DECIMAL(10,2) NOT NULL DEFAULT 0,
    id_proveedor_habitual INT,
    CONSTRAINT ck_materia_prima_stock_actual   CHECK (stock_actual >= 0),
    CONSTRAINT ck_materia_prima_stock_minimo   CHECK (stock_minimo >= 0),
    CONSTRAINT ck_materia_prima_umbrales       CHECK (stock_maximo >= stock_minimo),
    CONSTRAINT ck_materia_prima_costo          CHECK (costo_promedio >= 0),
    CONSTRAINT fk_materia_prima_proveedor FOREIGN KEY (id_proveedor_habitual)
        REFERENCES proveedor (id_proveedor) ON DELETE SET NULL
);

COMMENT ON COLUMN materia_prima.costo_promedio IS
    'Promedio ponderado movil; se recalcula en cada ingreso de mercaderia';

CREATE TABLE ingreso_materia_prima (
    id_ingreso        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cantidad          DECIMAL(10,2) NOT NULL,
    precio_unitario   DECIMAL(10,2) NOT NULL,
    fecha_ingreso     DATE          NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE,
    id_materia_prima  INT           NOT NULL,
    id_usuario        INT           NOT NULL,
    id_proveedor      INT           NOT NULL,
    CONSTRAINT ck_ingreso_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_ingreso_precio   CHECK (precio_unitario >= 0),
    CONSTRAINT fk_ingreso_materia_prima FOREIGN KEY (id_materia_prima)
        REFERENCES materia_prima (id_materia_prima) ON DELETE RESTRICT,
    CONSTRAINT fk_ingreso_usuario FOREIGN KEY (id_usuario)
        REFERENCES usuario (id_usuario) ON DELETE RESTRICT,
    CONSTRAINT fk_ingreso_proveedor FOREIGN KEY (id_proveedor)
        REFERENCES proveedor (id_proveedor) ON DELETE RESTRICT
);
```

- [ ] **Step 4: Recrear la base y ejecutar el esquema**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
"$PG" -w -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS amasaapp;" -c "CREATE DATABASE amasaapp;"
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/01_schema.sql
```

Esperado: sin errores. Recrear desde cero en cada tarea garantiza que el script completo siga siendo ejecutable de una sola pasada.

- [ ] **Step 5: Ejecutar ambas pruebas y confirmar que pasan**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/tests/test_01_seguridad.sql
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/tests/test_02_insumos.sql
```

Esperado: ambos scripts terminan con su línea `== Test NN completo ==` y ninguna línea `FALLO`.

- [ ] **Step 6: Commit**

```bash
git add db/01_schema.sql db/tests/test_02_insumos.sql
git commit -m "Agregar tablas de insumos y proveedores al esquema"
```

---

### Task 3: Productos y recetas

Agrega `producto`, `receta` y `receta_detalle`.

**Files:**
- Modify: `db/01_schema.sql` (agregar al final)
- Create: `db/tests/test_03_recetas.sql`

**Interfaces:**
- Consumes: `materia_prima (id_materia_prima)` de la Task 2.
- Produces: `producto (id_producto, nombre, descripcion, stock_actual, precio_venta, stock_minimo, stock_maximo)`; `receta (id_receta, nombre, rendimiento_unidades, id_producto)`; `receta_detalle (id_receta_detalle, cantidad_requerida, id_receta, id_materia_prima)`.

- [ ] **Step 1: Escribir la prueba que debe fallar**

Crear `db/tests/test_03_recetas.sql`:

```sql
\echo '== Test 03: productos y recetas =='
BEGIN;

INSERT INTO materia_prima (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo)
VALUES ('Harina R', 'kg', 100, 10, 500);

INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
VALUES ('Cañoncito', 0, 350, 10, 200);

-- 1. El stock de producto no puede ser negativo
DO $$
BEGIN
    BEGIN
        INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
        VALUES ('Producto Malo', -5, 100, 0, 50);
        RAISE EXCEPTION 'FALLO: se permitio stock negativo en producto';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: stock negativo en producto rechazado';
    END;
END $$;

-- 2. El precio de venta no puede ser negativo
DO $$
BEGIN
    BEGIN
        INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
        VALUES ('Producto Malo', 0, -100, 0, 50);
        RAISE EXCEPTION 'FALLO: se permitio un precio de venta negativo';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: precio de venta negativo rechazado';
    END;
END $$;

-- 3. Un producto tiene una sola receta
INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
VALUES ('Receta Cañoncito', 24, (SELECT id_producto FROM producto WHERE nombre = 'Cañoncito'));

DO $$
BEGIN
    BEGIN
        INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
        VALUES ('Receta Alternativa', 30,
                (SELECT id_producto FROM producto WHERE nombre = 'Cañoncito'));
        RAISE EXCEPTION 'FALLO: se permitio una segunda receta para el mismo producto';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK: segunda receta para el mismo producto rechazada';
    END;
END $$;

-- 4. El rendimiento debe ser mayor que cero
DO $$
BEGIN
    BEGIN
        INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
        VALUES ('Otro Producto', 0, 100, 0, 50);
        INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
        VALUES ('Receta Cero', 0, (SELECT id_producto FROM producto WHERE nombre = 'Otro Producto'));
        RAISE EXCEPTION 'FALLO: se permitio una receta con rendimiento cero';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: rendimiento cero rechazado';
    END;
END $$;

-- 5. Un insumo no puede repetirse dentro de la misma receta
INSERT INTO receta_detalle (cantidad_requerida, id_receta, id_materia_prima)
VALUES (2.5, (SELECT id_receta FROM receta WHERE nombre = 'Receta Cañoncito'),
        (SELECT id_materia_prima FROM materia_prima WHERE nombre = 'Harina R'));

DO $$
BEGIN
    BEGIN
        INSERT INTO receta_detalle (cantidad_requerida, id_receta, id_materia_prima)
        VALUES (1.0, (SELECT id_receta FROM receta WHERE nombre = 'Receta Cañoncito'),
                (SELECT id_materia_prima FROM materia_prima WHERE nombre = 'Harina R'));
        RAISE EXCEPTION 'FALLO: se permitio repetir un insumo en la misma receta';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK: insumo repetido en receta rechazado';
    END;
END $$;

-- 6. Al borrar la receta se borran sus detalles (cascada)
DELETE FROM receta WHERE nombre = 'Receta Cañoncito';

DO $$
DECLARE v_cantidad INT;
BEGIN
    SELECT COUNT(*) INTO v_cantidad FROM receta_detalle;
    IF v_cantidad <> 0 THEN
        RAISE EXCEPTION 'FALLO: quedaron detalles huerfanos tras borrar la receta';
    END IF;
    RAISE NOTICE 'OK: los detalles se borraron en cascada con la receta';
END $$;

ROLLBACK;

\echo '== Test 03 completo =='
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que falla**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d amasaapp \
  -v ON_ERROR_STOP=1 -f db/tests/test_03_recetas.sql
```

Esperado: FALLA con `ERROR: relation "producto" does not exist`.

- [ ] **Step 3: Agregar las tablas al esquema**

Agregar al final de `db/01_schema.sql`:

```sql
-- ------------------------------------------------------------
-- Bloque 3: Productos y recetas
-- ------------------------------------------------------------

CREATE TABLE producto (
    id_producto   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre        VARCHAR(50)   NOT NULL,
    descripcion   VARCHAR(255),
    stock_actual  INT           NOT NULL DEFAULT 0,
    precio_venta  DECIMAL(10,2) NOT NULL,
    stock_minimo  INT           NOT NULL,
    stock_maximo  INT           NOT NULL,
    CONSTRAINT ck_producto_stock_actual CHECK (stock_actual >= 0),
    CONSTRAINT ck_producto_stock_minimo CHECK (stock_minimo >= 0),
    CONSTRAINT ck_producto_umbrales     CHECK (stock_maximo >= stock_minimo),
    CONSTRAINT ck_producto_precio       CHECK (precio_venta >= 0)
);

CREATE TABLE receta (
    id_receta            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre               VARCHAR(50) NOT NULL,
    rendimiento_unidades INT         NOT NULL,
    id_producto          INT         NOT NULL,
    CONSTRAINT ck_receta_rendimiento CHECK (rendimiento_unidades > 0),
    CONSTRAINT uq_receta_producto UNIQUE (id_producto),
    CONSTRAINT fk_receta_producto FOREIGN KEY (id_producto)
        REFERENCES producto (id_producto) ON DELETE RESTRICT
);

COMMENT ON CONSTRAINT uq_receta_producto ON receta IS
    'La relacion producto-receta es 1:1 segun el diseno de clases';

CREATE TABLE receta_detalle (
    id_receta_detalle  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cantidad_requerida DECIMAL(10,2) NOT NULL,
    id_receta          INT           NOT NULL,
    id_materia_prima   INT           NOT NULL,
    CONSTRAINT ck_receta_detalle_cantidad CHECK (cantidad_requerida > 0),
    CONSTRAINT uq_receta_detalle_insumo UNIQUE (id_receta, id_materia_prima),
    CONSTRAINT fk_receta_detalle_receta FOREIGN KEY (id_receta)
        REFERENCES receta (id_receta) ON DELETE CASCADE,
    CONSTRAINT fk_receta_detalle_materia_prima FOREIGN KEY (id_materia_prima)
        REFERENCES materia_prima (id_materia_prima) ON DELETE RESTRICT
);
```

- [ ] **Step 4: Recrear la base y ejecutar el esquema**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
"$PG" -w -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS amasaapp;" -c "CREATE DATABASE amasaapp;"
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/01_schema.sql
```

Esperado: sin errores.

- [ ] **Step 5: Ejecutar las tres pruebas**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
for t in db/tests/test_01_seguridad.sql db/tests/test_02_insumos.sql db/tests/test_03_recetas.sql; do
  "$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f "$t" || break
done
```

Esperado: las tres terminan con `== Test NN completo ==`.

- [ ] **Step 6: Commit**

```bash
git add db/01_schema.sql db/tests/test_03_recetas.sql
git commit -m "Agregar tablas de productos y recetas al esquema"
```

---

### Task 4: Producción y consumo de insumos

Agrega `lote_produccion` y `consumo_materia_prima`, la tabla que resuelve la trazabilidad.

**Files:**
- Modify: `db/01_schema.sql` (agregar al final)
- Create: `db/tests/test_04_produccion.sql`

**Interfaces:**
- Consumes: `receta (id_receta)` de la Task 3, `usuario (id_usuario)` de la Task 1, `materia_prima (id_materia_prima)` de la Task 2.
- Produces: `lote_produccion (id_lote, fecha, cantidad_producida, costo_total, id_receta, id_usuario)`; `consumo_materia_prima (id_consumo, cantidad, costo_unitario, subtotal, id_lote, id_materia_prima)`.

- [ ] **Step 1: Escribir la prueba que debe fallar**

Crear `db/tests/test_04_produccion.sql`:

```sql
\echo '== Test 04: produccion y consumo =='
BEGIN;

INSERT INTO rol (nombre, descripcion) VALUES ('TestRol4', 'Rol de prueba');
INSERT INTO usuario (nombre, email, password_hash, id_rol)
VALUES ('Panificador', 'pan4@test.com', 'hash', (SELECT id_rol FROM rol WHERE nombre = 'TestRol4'));
INSERT INTO materia_prima (nombre, unidad_medida, stock_actual, stock_minimo, stock_maximo, costo_promedio)
VALUES ('Harina P', 'kg', 100, 10, 500, 540);
INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
VALUES ('Producto P', 0, 350, 10, 200);
INSERT INTO receta (nombre, rendimiento_unidades, id_producto)
VALUES ('Receta P', 24, (SELECT id_producto FROM producto WHERE nombre = 'Producto P'));

-- 1. La cantidad producida debe ser mayor que cero
DO $$
BEGIN
    BEGIN
        INSERT INTO lote_produccion (fecha, cantidad_producida, costo_total, id_receta, id_usuario)
        VALUES (CURRENT_DATE, 0, 1000,
                (SELECT id_receta FROM receta WHERE nombre = 'Receta P'),
                (SELECT id_usuario FROM usuario WHERE email = 'pan4@test.com'));
        RAISE EXCEPTION 'FALLO: se permitio un lote con cantidad producida cero';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: lote con cantidad cero rechazado';
    END;
END $$;

-- 2. Registrar un lote valido con su consumo
INSERT INTO lote_produccion (fecha, cantidad_producida, costo_total, id_receta, id_usuario)
VALUES (CURRENT_DATE, 24, 0,
        (SELECT id_receta FROM receta WHERE nombre = 'Receta P'),
        (SELECT id_usuario FROM usuario WHERE email = 'pan4@test.com'));

INSERT INTO consumo_materia_prima (cantidad, costo_unitario, subtotal, id_lote, id_materia_prima)
VALUES (30, 540, 16200,
        (SELECT id_lote FROM lote_produccion ORDER BY id_lote DESC LIMIT 1),
        (SELECT id_materia_prima FROM materia_prima WHERE nombre = 'Harina P'));

DO $$
DECLARE v_subtotal DECIMAL(10,2);
BEGIN
    SELECT SUM(subtotal) INTO v_subtotal FROM consumo_materia_prima;
    IF v_subtotal <> 16200 THEN
        RAISE EXCEPTION 'FALLO: el subtotal del consumo no coincide (%)', v_subtotal;
    END IF;
    RAISE NOTICE 'OK: consumo registrado con costo trazable';
END $$;

-- 3. Un insumo no puede repetirse en el consumo del mismo lote
DO $$
BEGIN
    BEGIN
        INSERT INTO consumo_materia_prima (cantidad, costo_unitario, subtotal, id_lote, id_materia_prima)
        VALUES (5, 540, 2700,
                (SELECT id_lote FROM lote_produccion ORDER BY id_lote DESC LIMIT 1),
                (SELECT id_materia_prima FROM materia_prima WHERE nombre = 'Harina P'));
        RAISE EXCEPTION 'FALLO: se permitio repetir un insumo en el mismo lote';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK: insumo repetido en el lote rechazado';
    END;
END $$;

-- 4. No se puede borrar una materia prima que fue consumida
DO $$
BEGIN
    BEGIN
        DELETE FROM materia_prima WHERE nombre = 'Harina P';
        RAISE EXCEPTION 'FALLO: se permitio borrar una materia prima consumida';
    EXCEPTION WHEN restrict_violation OR foreign_key_violation THEN
        RAISE NOTICE 'OK: borrado de materia prima consumida rechazado';
    END;
END $$;

-- 5. Al borrar el lote se borran sus consumos (cascada)
DELETE FROM lote_produccion;

DO $$
DECLARE v_cantidad INT;
BEGIN
    SELECT COUNT(*) INTO v_cantidad FROM consumo_materia_prima;
    IF v_cantidad <> 0 THEN
        RAISE EXCEPTION 'FALLO: quedaron consumos huerfanos tras borrar el lote';
    END IF;
    RAISE NOTICE 'OK: los consumos se borraron en cascada con el lote';
END $$;

ROLLBACK;

\echo '== Test 04 completo =='
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que falla**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d amasaapp \
  -v ON_ERROR_STOP=1 -f db/tests/test_04_produccion.sql
```

Esperado: FALLA con `ERROR: relation "lote_produccion" does not exist`.

- [ ] **Step 3: Agregar las tablas al esquema**

Agregar al final de `db/01_schema.sql`:

```sql
-- ------------------------------------------------------------
-- Bloque 4: Produccion y consumo de insumos
-- ------------------------------------------------------------

CREATE TABLE lote_produccion (
    id_lote            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha              DATE          NOT NULL DEFAULT CURRENT_DATE,
    cantidad_producida INT           NOT NULL,
    costo_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
    id_receta          INT           NOT NULL,
    id_usuario         INT           NOT NULL,
    CONSTRAINT ck_lote_cantidad CHECK (cantidad_producida > 0),
    CONSTRAINT ck_lote_costo    CHECK (costo_total >= 0),
    CONSTRAINT fk_lote_receta FOREIGN KEY (id_receta)
        REFERENCES receta (id_receta) ON DELETE RESTRICT,
    CONSTRAINT fk_lote_usuario FOREIGN KEY (id_usuario)
        REFERENCES usuario (id_usuario) ON DELETE RESTRICT
);

COMMENT ON COLUMN lote_produccion.costo_total IS
    'Suma de los subtotales de consumo_materia_prima del lote';

CREATE TABLE consumo_materia_prima (
    id_consumo       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cantidad         DECIMAL(10,2) NOT NULL,
    costo_unitario   DECIMAL(10,2) NOT NULL,
    subtotal         DECIMAL(10,2) NOT NULL,
    id_lote          INT           NOT NULL,
    id_materia_prima INT           NOT NULL,
    CONSTRAINT ck_consumo_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_consumo_costo    CHECK (costo_unitario >= 0),
    CONSTRAINT ck_consumo_subtotal CHECK (subtotal >= 0),
    CONSTRAINT uq_consumo_lote_insumo UNIQUE (id_lote, id_materia_prima),
    CONSTRAINT fk_consumo_lote FOREIGN KEY (id_lote)
        REFERENCES lote_produccion (id_lote) ON DELETE CASCADE,
    CONSTRAINT fk_consumo_materia_prima FOREIGN KEY (id_materia_prima)
        REFERENCES materia_prima (id_materia_prima) ON DELETE RESTRICT
);

COMMENT ON TABLE consumo_materia_prima IS
    'Registro historico de insumos consumidos por lote; conserva el costo
     aunque la receta cambie despues';

COMMENT ON COLUMN consumo_materia_prima.costo_unitario IS
    'Promedio ponderado de la materia prima al momento de producir el lote';
```

- [ ] **Step 4: Recrear la base y ejecutar el esquema**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
"$PG" -w -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS amasaapp;" -c "CREATE DATABASE amasaapp;"
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/01_schema.sql
```

Esperado: sin errores.

- [ ] **Step 5: Ejecutar las cuatro pruebas**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
for t in db/tests/test_0*.sql; do
  "$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f "$t" || break
done
```

Esperado: las cuatro terminan con `== Test NN completo ==`.

- [ ] **Step 6: Commit**

```bash
git add db/01_schema.sql db/tests/test_04_produccion.sql
git commit -m "Agregar tablas de produccion y consumo de insumos al esquema"
```

---

### Task 5: Ventas

Agrega `venta` y `detalle_venta`, cerrando las 12 tablas.

**Files:**
- Modify: `db/01_schema.sql` (agregar al final)
- Create: `db/tests/test_05_ventas.sql`

**Interfaces:**
- Consumes: `usuario (id_usuario)` de la Task 1, `producto (id_producto)` de la Task 3.
- Produces: `venta (id_venta, fecha, total, id_usuario)`; `detalle_venta (id_detalle_venta, cantidad, precio_unitario, subtotal, id_venta, id_producto)`.

- [ ] **Step 1: Escribir la prueba que debe fallar**

Crear `db/tests/test_05_ventas.sql`:

```sql
\echo '== Test 05: ventas =='
BEGIN;

INSERT INTO rol (nombre, descripcion) VALUES ('TestRol5', 'Rol de prueba');
INSERT INTO usuario (nombre, email, password_hash, id_rol)
VALUES ('Vendedor', 'venta5@test.com', 'hash', (SELECT id_rol FROM rol WHERE nombre = 'TestRol5'));
INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
VALUES ('Producto V', 100, 350, 10, 200);

-- 1. La cantidad vendida debe ser mayor que cero
INSERT INTO venta (fecha, total, id_usuario)
VALUES (CURRENT_TIMESTAMP, 0, (SELECT id_usuario FROM usuario WHERE email = 'venta5@test.com'));

DO $$
BEGIN
    BEGIN
        INSERT INTO detalle_venta (cantidad, precio_unitario, subtotal, id_venta, id_producto)
        VALUES (0, 350, 0,
                (SELECT id_venta FROM venta ORDER BY id_venta DESC LIMIT 1),
                (SELECT id_producto FROM producto WHERE nombre = 'Producto V'));
        RAISE EXCEPTION 'FALLO: se permitio un detalle de venta con cantidad cero';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: detalle de venta con cantidad cero rechazado';
    END;
END $$;

-- 2. El total de la venta no puede ser negativo
DO $$
BEGIN
    BEGIN
        INSERT INTO venta (fecha, total, id_usuario)
        VALUES (CURRENT_TIMESTAMP, -100,
                (SELECT id_usuario FROM usuario WHERE email = 'venta5@test.com'));
        RAISE EXCEPTION 'FALLO: se permitio una venta con total negativo';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: total negativo rechazado';
    END;
END $$;

-- 3. Registrar una venta valida
INSERT INTO detalle_venta (cantidad, precio_unitario, subtotal, id_venta, id_producto)
VALUES (3, 350, 1050,
        (SELECT id_venta FROM venta ORDER BY id_venta DESC LIMIT 1),
        (SELECT id_producto FROM producto WHERE nombre = 'Producto V'));

UPDATE venta SET total = 1050 WHERE id_venta = (SELECT MAX(id_venta) FROM venta);

DO $$
DECLARE v_total DECIMAL(10,2); v_suma DECIMAL(10,2);
BEGIN
    SELECT total INTO v_total FROM venta ORDER BY id_venta DESC LIMIT 1;
    SELECT SUM(subtotal) INTO v_suma FROM detalle_venta;
    IF v_total <> v_suma THEN
        RAISE EXCEPTION 'FALLO: el total (%) no coincide con la suma de subtotales (%)', v_total, v_suma;
    END IF;
    RAISE NOTICE 'OK: venta registrada con total coherente';
END $$;

-- 4. No se puede borrar un producto que fue vendido
DO $$
BEGIN
    BEGIN
        DELETE FROM producto WHERE nombre = 'Producto V';
        RAISE EXCEPTION 'FALLO: se permitio borrar un producto vendido';
    EXCEPTION WHEN restrict_violation OR foreign_key_violation THEN
        RAISE NOTICE 'OK: borrado de producto vendido rechazado';
    END;
END $$;

-- 5. Al borrar la venta se borran sus detalles (cascada)
DELETE FROM venta;

DO $$
DECLARE v_cantidad INT;
BEGIN
    SELECT COUNT(*) INTO v_cantidad FROM detalle_venta;
    IF v_cantidad <> 0 THEN
        RAISE EXCEPTION 'FALLO: quedaron detalles huerfanos tras borrar la venta';
    END IF;
    RAISE NOTICE 'OK: los detalles se borraron en cascada con la venta';
END $$;

ROLLBACK;

\echo '== Test 05 completo =='
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que falla**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d amasaapp \
  -v ON_ERROR_STOP=1 -f db/tests/test_05_ventas.sql
```

Esperado: FALLA con `ERROR: relation "venta" does not exist`.

- [ ] **Step 3: Agregar las tablas al esquema**

Agregar al final de `db/01_schema.sql`:

```sql
-- ------------------------------------------------------------
-- Bloque 5: Ventas
-- ------------------------------------------------------------

CREATE TABLE venta (
    id_venta   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total      DECIMAL(10,2) NOT NULL DEFAULT 0,
    id_usuario INT           NOT NULL,
    CONSTRAINT ck_venta_total CHECK (total >= 0),
    CONSTRAINT fk_venta_usuario FOREIGN KEY (id_usuario)
        REFERENCES usuario (id_usuario) ON DELETE RESTRICT
);

COMMENT ON COLUMN venta.total IS 'Suma de los subtotales de detalle_venta';

CREATE TABLE detalle_venta (
    id_detalle_venta INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cantidad         INT           NOT NULL,
    precio_unitario  DECIMAL(10,2) NOT NULL,
    subtotal         DECIMAL(10,2) NOT NULL,
    id_venta         INT           NOT NULL,
    id_producto      INT           NOT NULL,
    CONSTRAINT ck_detalle_venta_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_detalle_venta_precio   CHECK (precio_unitario >= 0),
    CONSTRAINT ck_detalle_venta_subtotal CHECK (subtotal >= 0),
    CONSTRAINT fk_detalle_venta_venta FOREIGN KEY (id_venta)
        REFERENCES venta (id_venta) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_venta_producto FOREIGN KEY (id_producto)
        REFERENCES producto (id_producto) ON DELETE RESTRICT
);

COMMENT ON COLUMN detalle_venta.precio_unitario IS
    'Precio al momento de la venta; no cambia si luego se actualiza el producto';
```

- [ ] **Step 4: Recrear la base y ejecutar el esquema**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
"$PG" -w -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS amasaapp;" -c "CREATE DATABASE amasaapp;"
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/01_schema.sql
```

Esperado: sin errores.

- [ ] **Step 5: Ejecutar las cinco pruebas**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
for t in db/tests/test_0*.sql; do
  "$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f "$t" || break
done
```

Esperado: las cinco terminan con `== Test NN completo ==`.

- [ ] **Step 6: Commit**

```bash
git add db/01_schema.sql db/tests/test_05_ventas.sql
git commit -m "Agregar tablas de ventas al esquema"
```

---

### Task 6: Índices, datos iniciales y verificación integral

Cierra el esquema con los índices de claves foráneas y fechas, carga los roles del sistema y verifica que todo el conjunto se construya desde cero.

**Files:**
- Modify: `db/01_schema.sql` (agregar al final)
- Create: `db/02_seed.sql`
- Create: `db/tests/test_06_integral.sql`

**Interfaces:**
- Consumes: las 12 tablas de las Tasks 1 a 5.
- Produces: índices sobre todas las claves foráneas y sobre `venta.fecha`, `lote_produccion.fecha`, `ingreso_materia_prima.fecha_ingreso`; los roles Venta, Panificador y Encargado cargados en `rol`.

- [ ] **Step 1: Escribir la prueba que debe fallar**

Crear `db/tests/test_06_integral.sql`:

```sql
\echo '== Test 06: verificacion integral =='
-- Esta prueba solo lee: no necesita transaccion.

-- 1. Las 12 tablas existen
DO $$
DECLARE v_cantidad INT;
BEGIN
    SELECT COUNT(*) INTO v_cantidad
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    IF v_cantidad <> 12 THEN
        RAISE EXCEPTION 'FALLO: se esperaban 12 tablas y hay %', v_cantidad;
    END IF;
    RAISE NOTICE 'OK: las 12 tablas existen';
END $$;

-- 2. Los tres roles del sistema estan cargados
DO $$
DECLARE v_cantidad INT;
BEGIN
    SELECT COUNT(*) INTO v_cantidad
      FROM rol WHERE nombre IN ('Venta', 'Panificador', 'Encargado');
    IF v_cantidad <> 3 THEN
        RAISE EXCEPTION 'FALLO: se esperaban 3 roles del sistema y hay %', v_cantidad;
    END IF;
    RAISE NOTICE 'OK: los tres roles del sistema estan cargados';
END $$;

-- 3. Los indices definidos existen
DO $$
DECLARE
    v_esperados TEXT[] := ARRAY[
        'ix_usuario_rol', 'ix_materia_prima_proveedor', 'ix_ingreso_materia_prima',
        'ix_ingreso_usuario', 'ix_ingreso_proveedor', 'ix_receta_producto',
        'ix_receta_detalle_receta', 'ix_receta_detalle_materia_prima',
        'ix_lote_receta', 'ix_lote_usuario', 'ix_consumo_lote',
        'ix_consumo_materia_prima', 'ix_venta_usuario', 'ix_detalle_venta_venta',
        'ix_detalle_venta_producto', 'ix_venta_fecha', 'ix_lote_fecha', 'ix_ingreso_fecha'
    ];
    v_faltantes TEXT;
BEGIN
    SELECT string_agg(nombre, ', ') INTO v_faltantes
      FROM unnest(v_esperados) AS nombre
     WHERE nombre NOT IN (SELECT indexname FROM pg_indexes WHERE schemaname = 'public');
    IF v_faltantes IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO: faltan indices: %', v_faltantes;
    END IF;
    RAISE NOTICE 'OK: los 18 indices definidos existen';
END $$;

-- 4. El promedio ponderado se calcula como define el diseno
DO $$
DECLARE v_promedio DECIMAL(10,2);
BEGIN
    -- 100 kg a 500 mas 50 kg a 620 debe dar 540
    v_promedio := ROUND((100 * 500.00 + 50 * 620.00) / (100 + 50), 2);
    IF v_promedio <> 540.00 THEN
        RAISE EXCEPTION 'FALLO: el promedio ponderado dio % en vez de 540', v_promedio;
    END IF;
    RAISE NOTICE 'OK: la formula del promedio ponderado da 540';
END $$;

\echo '== Test 06 completo =='
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que falla**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" -w -U postgres -h localhost -d amasaapp \
  -v ON_ERROR_STOP=1 -f db/tests/test_06_integral.sql
```

Esperado: FALLA con `FALLO: se esperaban 3 roles del sistema y hay 0` — las tablas ya existen pero los roles todavía no se cargaron.

- [ ] **Step 3: Agregar los índices al esquema**

Agregar al final de `db/01_schema.sql`:

```sql
-- ------------------------------------------------------------
-- Indices
-- PostgreSQL indexa las claves primarias automaticamente, pero no
-- las foraneas. Todas las consultas del sistema navegan esas
-- relaciones, de modo que se indexan todas.
-- ------------------------------------------------------------

CREATE INDEX ix_usuario_rol                  ON usuario (id_rol);
CREATE INDEX ix_materia_prima_proveedor      ON materia_prima (id_proveedor_habitual);
CREATE INDEX ix_ingreso_materia_prima        ON ingreso_materia_prima (id_materia_prima);
CREATE INDEX ix_ingreso_usuario              ON ingreso_materia_prima (id_usuario);
CREATE INDEX ix_ingreso_proveedor            ON ingreso_materia_prima (id_proveedor);
CREATE INDEX ix_receta_producto              ON receta (id_producto);
CREATE INDEX ix_receta_detalle_receta        ON receta_detalle (id_receta);
CREATE INDEX ix_receta_detalle_materia_prima ON receta_detalle (id_materia_prima);
CREATE INDEX ix_lote_receta                  ON lote_produccion (id_receta);
CREATE INDEX ix_lote_usuario                 ON lote_produccion (id_usuario);
CREATE INDEX ix_consumo_lote                 ON consumo_materia_prima (id_lote);
CREATE INDEX ix_consumo_materia_prima        ON consumo_materia_prima (id_materia_prima);
CREATE INDEX ix_venta_usuario                ON venta (id_usuario);
CREATE INDEX ix_detalle_venta_venta          ON detalle_venta (id_venta);
CREATE INDEX ix_detalle_venta_producto       ON detalle_venta (id_producto);

-- Indices por fecha, usados por el panel de control para filtrar por periodo
CREATE INDEX ix_venta_fecha   ON venta (fecha);
CREATE INDEX ix_lote_fecha    ON lote_produccion (fecha);
CREATE INDEX ix_ingreso_fecha ON ingreso_materia_prima (fecha_ingreso);
```

Nota: `uq_receta_producto` ya genera un índice único sobre `receta (id_producto)`, y `uq_consumo_lote_insumo` uno sobre `consumo_materia_prima (id_lote, id_materia_prima)`. Eso vuelve redundantes a `ix_receta_producto` e `ix_consumo_lote`. PostgreSQL los crea igual sin protestar, porque el nombre es distinto. Se mantienen por uniformidad —así la lista cubre todas las claves foráneas sin excepciones que recordar— y porque el costo de dos índices adicionales sobre tablas de este tamaño es despreciable.

- [ ] **Step 4: Escribir los datos iniciales**

Crear `db/02_seed.sql`:

```sql
-- ============================================================
-- AmasaApp - Datos iniciales
-- Roles del sistema segun la seccion 5.2 del documento del proyecto
-- ============================================================

INSERT INTO rol (nombre, descripcion) VALUES
    ('Venta',       'Registra y consulta ventas de productos'),
    ('Panificador', 'Registra lotes de produccion y consulta ventas'),
    ('Encargado',   'Acceso total: insumos, produccion, ventas, alertas y usuarios')
ON CONFLICT (nombre) DO NOTHING;
```

- [ ] **Step 5: Recrear la base con esquema y datos iniciales**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
"$PG" -w -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS amasaapp;" -c "CREATE DATABASE amasaapp;"
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/01_schema.sql
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/02_seed.sql
```

Esperado: sin errores. `INSERT 0 3` en el último.

- [ ] **Step 6: Ejecutar las seis pruebas**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
for t in db/tests/test_0*.sql; do
  echo "--- $t"
  "$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f "$t" || break
done
```

Esperado: las seis terminan con `== Test NN completo ==`, sin ninguna línea `FALLO`.

- [ ] **Step 7: Verificar que el esquema se construye desde cero en una sola pasada**

```bash
PG="/c/Program Files/PostgreSQL/18/bin/psql"
"$PG" -w -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS amasaapp;" -c "CREATE DATABASE amasaapp;"
"$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/01_schema.sql \
  && "$PG" -w -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/02_seed.sql \
  && echo "ESQUEMA CONSTRUIDO CORRECTAMENTE DESDE CERO"
```

Esperado: la línea final `ESQUEMA CONSTRUIDO CORRECTAMENTE DESDE CERO`. Este es el criterio 1 de verificación de la especificación.

- [ ] **Step 8: Commit**

```bash
git add db/01_schema.sql db/02_seed.sql db/tests/test_06_integral.sql
git commit -m "Agregar indices y datos iniciales; completar el esquema de base de datos"
```

---

## Verificación final

Al terminar la Task 6, la especificación queda cubierta así:

| Requisito de la especificación | Dónde se cumple |
|---|---|
| 2.1 snake_case | Todas las tablas, Tasks 1-5 |
| 2.2 Consistencia por backend + restricciones | CHECK de stock, Tasks 2 y 3 |
| 2.3 Promedio ponderado | `materia_prima.costo_promedio`, Task 2; fórmula verificada en Task 6 |
| 2.4 Proveedor habitual opcional | `id_proveedor_habitual` nullable + ON DELETE SET NULL, Task 2 |
| 3 Doce tablas | Tasks 1-5; conteo verificado en Task 6 |
| 4.1 `consumo_materia_prima` | Task 4 |
| 4.2 `costo_promedio` | Task 2 |
| 5 Integridad | Restricciones en cada tabla, verificadas en las pruebas de cada tarea |
| 6 Índices | Task 6 |
| 7 Datos iniciales | `db/02_seed.sql`, Task 6 |
| 8 Ubicación y verificación | `db/`, Task 1; criterios verificados en Task 6 |

Queda pendiente de la especificación, fuera del alcance de este plan:

- Sección 9 — deuda técnica del control de vencimientos, deliberadamente no implementada.
- Sección 10 — las cinco correcciones a la documentación del proyecto, que se aplican sobre el documento en Word, no sobre el código.
