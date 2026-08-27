-- Verifica las restricciones del bloque de insumos y proveedores.

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

-- 7. El CUIT no puede repetirse cuando tiene valor
DO $$
BEGIN
    BEGIN
        INSERT INTO proveedor (razon_social, cuit) VALUES ('Otro Molino', '20-12345678-9');
        RAISE EXCEPTION 'FALLO: se permitio un CUIT duplicado';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK: CUIT duplicado rechazado';
    END;
END $$;

-- 8. Pero varios proveedores pueden no tener CUIT
DO $$
BEGIN
    INSERT INTO proveedor (razon_social, cuit) VALUES ('Sin CUIT Uno', NULL);
    INSERT INTO proveedor (razon_social, cuit) VALUES ('Sin CUIT Dos', NULL);
    RAISE NOTICE 'OK: varios proveedores sin CUIT aceptados';
END $$;

ROLLBACK;

\echo '== Test 02 completo =='
