/**
 * Crea un usuario del sistema desde la linea de comandos.
 *
 * Existe porque hay un problema de arranque: CU-02 exige estar autenticado
 * como Encargado para dar de alta usuarios, pero al instalar el sistema no
 * hay ninguno. Este script rompe ese circulo.
 *
 * La contraseña se pide por teclado y nunca queda escrita en el repositorio.
 * Por eso NO se carga un usuario inicial en 02_seed.sql: ese archivo es
 * publico, y ademas todos los que instalaran el sistema tendrian la misma
 * clave.
 *
 * Uso:  npm run crear-usuario
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pool, consultar } from '../src/config/db.js';
import { hashearPassword } from '../src/auth/password.js';

const LARGO_MINIMO = 8;

/** Pide un dato por teclado ocultando lo que se escribe. */
async function preguntarOculto(pregunta) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const original = stdout.write.bind(stdout);
  let silenciando = false;
  stdout.write = (fragmento, ...resto) => (silenciando ? true : original(fragmento, ...resto));
  original(pregunta);
  silenciando = true;
  const respuesta = await rl.question('');
  silenciando = false;
  stdout.write = original;
  original('\n');
  rl.close();
  return respuesta;
}

async function principal() {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log('\nAlta de usuario — AmasaApp\n');

  const { rows: roles } = await consultar('SELECT nombre FROM rol ORDER BY id_rol');
  if (roles.length === 0) {
    console.error('No hay roles cargados. Ejecuta primero db/02_seed.sql');
    process.exitCode = 1;
    return;
  }

  const nombre = (await rl.question('Nombre y apellido: ')).trim();
  const email = (await rl.question('Correo electronico: ')).trim().toLowerCase();

  console.log('\nRoles disponibles:');
  roles.forEach((r, i) => console.log(`  ${i + 1}. ${r.nombre}`));
  const eleccion = await rl.question('Numero de rol: ');
  rl.close();

  const rol = roles[Number(eleccion) - 1]?.nombre;

  if (!nombre || !email || !rol) {
    console.error('\nFaltan datos o el rol elegido no existe. No se creo nada.');
    process.exitCode = 1;
    return;
  }
  if (!email.includes('@')) {
    console.error('\nEse correo no parece valido. No se creo nada.');
    process.exitCode = 1;
    return;
  }

  const { rows: existe } = await consultar(
    'SELECT 1 FROM usuario WHERE email = $1', [email]
  );
  if (existe.length > 0) {
    console.error(`\nYa hay un usuario con el correo ${email}. No se creo nada.`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  const password = await preguntarOculto('Contraseña: ');
  const repetida = await preguntarOculto('Repetir contraseña: ');

  if (password.length < LARGO_MINIMO) {
    console.error(`\nLa contraseña necesita al menos ${LARGO_MINIMO} caracteres. No se creo nada.`);
    process.exitCode = 1;
    return;
  }
  if (password !== repetida) {
    console.error('\nLas contraseñas no coinciden. No se creo nada.');
    process.exitCode = 1;
    return;
  }

  const hash = await hashearPassword(password);
  const { rows } = await consultar(
    `INSERT INTO usuario (nombre, email, password_hash, id_rol)
     VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4))
     RETURNING id_usuario`,
    [nombre, email, hash, rol]
  );

  console.log(`\nUsuario creado: ${nombre} <${email}> — rol ${rol} (id ${rows[0].id_usuario})`);
  console.log('Ya podes iniciar sesion en la aplicacion.\n');
}

principal()
  .catch((error) => {
    console.error('\nNo se pudo crear el usuario:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
