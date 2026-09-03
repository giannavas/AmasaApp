import express from 'express';
import { consultar } from './config/db.js';
import { rutasSesion } from './rutas/sesion.js';

/**
 * La aplicacion Express, separada del arranque del servidor.
 *
 * Tenerla aparte permite que las pruebas la importen y le hagan pedidos sin
 * ocupar un puerto real.
 */
export const app = express();

app.use(express.json());

// CU-01 y CU-02: sesion de usuario
app.use('/api/sesion', rutasSesion);

/**
 * Verificacion de estado. Confirma que la API responde y que la base de datos
 * esta accesible. Util para diagnosticar si un problema es del servidor o de
 * la conexion.
 */
app.get('/api/salud', async (_req, res, next) => {
  try {
    const { rows } = await consultar('SELECT NOW() AS hora');
    res.json({ estado: 'ok', baseDeDatos: 'conectada', hora: rows[0].hora });
  } catch (error) {
    next(error);
  }
});

// Ruta inexistente
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador de errores. Registra el detalle en el servidor pero no lo expone
// al cliente: un mensaje de error de PostgreSQL puede revelar la estructura
// interna de la base.
app.use((error, _req, res, _next) => {
  console.error('[api]', error);
  res.status(500).json({ error: 'Error interno del servidor' });
});
