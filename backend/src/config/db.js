import pg from 'pg';

const { Pool } = pg;

/**
 * Pool de conexiones a PostgreSQL.
 *
 * Un pool mantiene un conjunto de conexiones abiertas y las reutiliza, en vez
 * de abrir y cerrar una por cada consulta. Abrir una conexion es costoso, y
 * con varios usuarios simultaneos el ahorro es significativo.
 *
 * La configuracion se toma de las variables de entorno definidas en .env,
 * que Node carga con la opcion --env-file. Ese archivo no se versiona.
 */
export const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Una conexion que falla de fondo no debe tumbar el proceso entero.
pool.on('error', (error) => {
  console.error('[db] error en una conexion inactiva del pool:', error.message);
});

/**
 * Ejecuta una consulta usando una conexion del pool.
 *
 * Los valores SIEMPRE van como parametros ($1, $2, ...), nunca concatenados
 * al texto de la consulta: es lo que evita la inyeccion de SQL.
 */
export function consultar(texto, valores) {
  return pool.query(texto, valores);
}

/**
 * Ejecuta varias operaciones dentro de una unica transaccion.
 *
 * Si la funcion recibida termina bien, se confirma todo (COMMIT). Si lanza un
 * error, no queda nada a medias (ROLLBACK).
 *
 * Este es el mecanismo que sostiene la decision 2.2 de la especificacion: la
 * consistencia del stock vive en el backend, y toda operacion que lo modifique
 * (registrar una venta, producir un lote) tiene que pasar por aca.
 *
 * Uso:
 *   await conTransaccion(async (cliente) => {
 *     await cliente.query('INSERT INTO venta ...');
 *     await cliente.query('UPDATE producto SET stock_actual = ...');
 *   });
 */
export async function conTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    // Devuelve la conexion al pool. Sin esto el pool se agota y la
    // aplicacion se cuelga esperando una conexion libre.
    cliente.release();
  }
}
