/**
 * Llamadas a la API de ventas (CU-07 y CU-08).
 */

const cabeceras = { 'Content-Type': 'application/json' };

async function procesar(respuesta) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'No se pudo completar la operacion');
  }
  return datos;
}

/**
 * CU-08. Devuelve el historial de ventas, de la mas reciente a la mas vieja.
 *
 * Los filtros son opcionales y los vacios no se mandan: una fecha vacia en la
 * consulta haria que el servidor la rechace por formato.
 */
export async function listarVentas({ desde, hasta, idProducto } = {}) {
  const parametros = new URLSearchParams();
  if (desde) parametros.set('desde', desde);
  if (hasta) parametros.set('hasta', hasta);
  if (idProducto) parametros.set('idProducto', String(idProducto));

  const consulta = parametros.toString();
  const respuesta = await fetch(`/api/ventas${consulta ? `?${consulta}` : ''}`, {
    credentials: 'same-origin',
  });
  return (await procesar(respuesta)).ventas;
}

/**
 * CU-07. Registra una venta y descuenta el stock de cada producto vendido.
 *
 * Si falta stock de alguno, el servidor responde con el nombre del producto
 * que falta y no modifica nada: ni la venta queda registrada, ni se descuenta
 * la linea que si tenia stock.
 */
export async function registrarVenta({ detalles, fecha }) {
  const respuesta = await fetch('/api/ventas', {
    method: 'POST',
    headers: cabeceras,
    credentials: 'same-origin',
    body: JSON.stringify({ detalles, fecha }),
  });
  return (await procesar(respuesta)).venta;
}
