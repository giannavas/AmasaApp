-- Verifica las restricciones del bloque de productos y recetas.

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

-- 7. Los acentos y la enie se guardan y recuperan correctamente
DO $$
DECLARE v_nombre VARCHAR(50);
BEGIN
    SELECT nombre INTO v_nombre FROM producto WHERE nombre = 'Cañoncito';
    IF v_nombre IS DISTINCT FROM 'Cañoncito' THEN
        RAISE EXCEPTION 'FALLO: problema de codificacion, se leyo %', v_nombre;
    END IF;
    RAISE NOTICE 'OK: los caracteres acentuados se conservan';
END $$;

ROLLBACK;

\echo '== Test 03 completo =='
