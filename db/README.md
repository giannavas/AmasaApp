# Base de datos — AmasaApp

Esquema PostgreSQL del sistema.
Diseño: `docs/superpowers/specs/2026-08-27-esquema-base-datos-design.md`

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

Cada prueba imprime una línea `OK:` por cada restricción verificada. Si
alguna restricción no rechaza el dato inválido, el script aborta con
`FALLO:` y devuelve un código de salida distinto de cero.

Las pruebas corren dentro de una transacción que se revierte al terminar,
así que no dejan datos en la base y pueden ejecutarse repetidas veces.

## Archivos

| Archivo | Contenido |
|---|---|
| `01_schema.sql` | Tablas, restricciones e índices |
| `02_seed.sql` | Datos iniciales (roles del sistema) |
| `tests/` | Pruebas de las restricciones |
