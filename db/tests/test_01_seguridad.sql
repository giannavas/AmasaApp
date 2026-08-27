-- Verifica las restricciones del bloque de seguridad y acceso.
-- Cada bloque intenta insertar un dato invalido: si la base lo acepta,
-- la prueba lanza una excepcion y el script aborta.

\echo '== Test 01: seguridad y acceso =='

-- Toda la prueba corre dentro de una transaccion que se revierte al final.
-- Asi no deja datos en la base ni siquiera si aborta a la mitad, y puede
-- ejecutarse tantas veces como haga falta.
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
    -- ON DELETE RESTRICT lanza restrict_violation (23001), no
    -- foreign_key_violation (23503), que es el que lanza NO ACTION.
    -- Se capturan ambos para que la prueba siga siendo valida si
    -- alguna vez se cambia la accion de la clave foranea.
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
