-- ============================================================
-- AmasaApp - Datos iniciales
-- Roles del sistema segun la seccion 5.2 del documento del proyecto
-- ============================================================

INSERT INTO rol (nombre, descripcion) VALUES
    ('Venta',       'Registra y consulta ventas de productos'),
    ('Panificador', 'Registra lotes de produccion y consulta ventas'),
    ('Encargado',   'Acceso total: insumos, produccion, ventas, alertas y usuarios')
ON CONFLICT (nombre) DO NOTHING;
