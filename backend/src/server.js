import { app } from './app.js';
import { pool } from './config/db.js';

const puerto = Number(process.env.PORT) || 3000;

const servidor = app.listen(puerto, () => {
  console.log(`AmasaApp API escuchando en http://localhost:${puerto}`);
});

/**
 * Cierre ordenado: deja de aceptar pedidos nuevos, termina los que estan en
 * curso y recien despues cierra las conexiones a la base. Sin esto, Ctrl+C
 * puede cortar una transaccion por la mitad.
 */
async function cerrar(senal) {
  console.log(`\n${senal} recibido, cerrando...`);
  servidor.close(async () => {
    await pool.end();
    console.log('Conexiones cerradas.');
    process.exit(0);
  });
}

process.on('SIGINT', () => cerrar('SIGINT'));
process.on('SIGTERM', () => cerrar('SIGTERM'));
