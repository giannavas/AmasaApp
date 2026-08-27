# AmasaApp

Sistema de gestión administrativa para la panificadora **AmasaPan**: control de
insumos, producción, stock y ventas.

Proyecto de Prácticas Profesionalizantes I — Escuela Superior de Comercio Nº 49
"Cap. Gral. Justo José de Urquiza", Técnico Superior en Desarrollo de Software.

## Estructura

    backend/    API REST — Node.js + Express + PostgreSQL
    frontend/   Interfaz — React + Vite
    db/         Scripts de creación de la base de datos y sus pruebas
    docs/       Documentos de diseño y planes de implementación

## Instalación

Estos pasos se hacen **una sola vez por máquina**. Cada integrante tiene su
propia base de datos local: el repositorio versiona los *scripts* que la crean,
no los datos. Si alguien carga productos de prueba, los demás no los ven.

### 1. Requisitos

- [PostgreSQL 18](https://www.postgresql.org/download/windows/) o superior
- [Node.js 20.6](https://nodejs.org/) o superior (probado con 24.11)

Durante la instalación de PostgreSQL se define una contraseña para el usuario
`postgres`. Anotala: hace falta en el paso 3.

### 2. Clonar el repositorio

    git clone https://github.com/giannavas/AmasaApp.git
    cd AmasaApp

**Importante:** configurá git con tu correo institucional antes de commitear, o
tus commits no van a quedar asociados a tu perfil de GitHub:

    git config user.name "Nombre Apellido"
    git config user.email "TU_DNI@terciariourquiza.edu.ar"

Ese correo además tiene que estar cargado y verificado en tu cuenta de GitHub,
en https://github.com/settings/emails

### 3. Crear la base de datos

En Windows, si `psql` no está en el PATH, usá la ruta completa:
`"C:\Program Files\PostgreSQL\18\bin\psql.exe"`

    psql -U postgres -h localhost -d postgres -c "CREATE DATABASE amasaapp;"
    psql -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/01_schema.sql
    psql -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/02_seed.sql

Esto crea las 12 tablas con sus restricciones e índices, y carga los tres roles
del sistema.

### 4. Crear el usuario de la aplicación

La aplicación no se conecta como `postgres` —que puede borrar bases enteras—
sino con un usuario limitado a leer y escribir en las tablas.

En PowerShell, reemplazá `ELEGI_UNA_CLAVE` por una contraseña propia (solo
letras y números, los símbolos rompen el script):

```powershell
$clave = "ELEGI_UNA_CLAVE"

$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$sql = @"
CREATE USER amasaapp WITH PASSWORD '$clave';
GRANT CONNECT ON DATABASE amasaapp TO amasaapp;
GRANT USAGE ON SCHEMA public TO amasaapp;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amasaapp;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO amasaapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO amasaapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO amasaapp;
"@
& $psql -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -c $sql

@"
PGHOST=localhost
PGPORT=5432
PGDATABASE=amasaapp
PGUSER=amasaapp
PGPASSWORD=$clave
PORT=3000
"@ | Out-File "backend\.env" -Encoding ascii

$clave = $null
```

El archivo `backend/.env` guarda esa contraseña y **no se versiona**: está en
`.gitignore`. Cada integrante tiene el suyo. La plantilla vacía es
`backend/.env.example`.

### 5. Instalar dependencias

    cd backend
    npm install
    cd ../frontend
    npm install

## Uso diario

Hacen falta **dos terminales**, una para cada servidor.

Terminal 1 — backend:

    cd backend
    npm run dev        # se reinicia solo al guardar cambios

Terminal 2 — frontend:

    cd frontend
    npm run dev

Después abrí http://localhost:5173

La pantalla inicial verifica que las tres capas se comuniquen. Si dice "Sin
conexión con el backend", revisá que la terminal 1 esté corriendo.

## Pruebas

Base de datos — verifica que cada restricción rechace los datos inválidos:

    psql -U postgres -h localhost -d amasaapp -v ON_ERROR_STOP=1 -f db/tests/test_01_seguridad.sql

Hay seis archivos, `test_01` a `test_06`. Cada uno imprime una línea `OK:` por
comprobación y aborta con `FALLO:` si alguna restricción no funciona.

Backend:

    cd backend
    npm test

## Convención de commits

Cada commit incluye el enlace al ticket de Trello y el prompt usado en la
herramienta de IA:

    Descripción breve del cambio

    Ticket: https://trello.com/c/XXXXXXXX
    Prompt: "texto del prompt utilizado"

## Documentación

| Documento | Contenido |
|---|---|
| `docs/superpowers/specs/` | Decisiones de diseño y su fundamento |
| `docs/superpowers/plans/` | Planes de implementación paso a paso |
| `db/README.md` | Detalle del esquema de base de datos |
