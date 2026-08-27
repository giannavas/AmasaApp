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
