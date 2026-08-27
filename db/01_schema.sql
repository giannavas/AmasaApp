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
    'Registro historico de insumos consumidos por lote; conserva el costo aunque la receta cambie despues';

COMMENT ON COLUMN consumo_materia_prima.costo_unitario IS
    'Promedio ponderado de la materia prima al momento de producir el lote';
