-- Verifica las restricciones del bloque de ventas.

\echo '== Test 05: ventas =='
BEGIN;

INSERT INTO rol (nombre, descripcion) VALUES ('TestRol5', 'Rol de prueba');
INSERT INTO usuario (nombre, email, password_hash, id_rol)
VALUES ('Vendedor', 'venta5@test.com', 'hash', (SELECT id_rol FROM rol WHERE nombre = 'TestRol5'));
INSERT INTO producto (nombre, stock_actual, precio_venta, stock_minimo, stock_maximo)
VALUES ('Producto V', 100, 350, 10, 200);

INSERT INTO venta (fecha, total, id_usuario)
VALUES (CURRENT_TIMESTAMP, 0, (SELECT id_usuario FROM usuario WHERE email = 'venta5@test.com'));

-- 1. La cantidad vendida debe ser mayor que cero
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

-- 5. El precio del detalle no cambia si luego se actualiza el producto
UPDATE producto SET precio_venta = 500 WHERE nombre = 'Producto V';

DO $$
DECLARE v_precio DECIMAL(10,2);
BEGIN
    SELECT precio_unitario INTO v_precio FROM detalle_venta LIMIT 1;
    IF v_precio <> 350 THEN
        RAISE EXCEPTION 'FALLO: el precio historico de la venta cambio a %', v_precio;
    END IF;
    RAISE NOTICE 'OK: el precio historico de la venta se conserva';
END $$;

-- 6. Al borrar la venta se borran sus detalles (cascada)
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
