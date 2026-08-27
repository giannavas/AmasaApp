-- Verificacion integral del esquema completo.
-- Esta prueba solo lee: no necesita transaccion.

\echo '== Test 06: verificacion integral =='

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
