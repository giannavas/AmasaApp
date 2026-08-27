-- Verifica las restricciones del bloque de produccion y consumo de insumos.

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

-- 5. El costo total del lote es la suma de sus consumos
DO $$
DECLARE v_lote INT; v_suma DECIMAL(10,2);
BEGIN
    SELECT id_lote INTO v_lote FROM lote_produccion ORDER BY id_lote DESC LIMIT 1;
    SELECT SUM(subtotal) INTO v_suma FROM consumo_materia_prima WHERE id_lote = v_lote;
    UPDATE lote_produccion SET costo_total = v_suma WHERE id_lote = v_lote;
    IF (SELECT costo_total FROM lote_produccion WHERE id_lote = v_lote) <> 16200 THEN
        RAISE EXCEPTION 'FALLO: el costo total del lote no coincide con sus consumos';
    END IF;
    RAISE NOTICE 'OK: el costo del lote es la suma verificable de sus consumos';
END $$;

-- 6. Al borrar el lote se borran sus consumos (cascada)
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
