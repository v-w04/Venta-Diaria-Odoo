/**
 * VENTA DIARIA ODOO 2026 — Ventas de Walmart y su histórico de alertas
 *
 * NO manda correos. Ninguno. Todo queda escrito para consulta:
 *   · WALMART              cada venta con su análisis en M–U
 *   · Histórico de alertas se acumula y nunca se borra
 *
 * Regla (la misma de antes): alerta cuando J (precio unitario) queda por
 * debajo del mínimo EM de PRECIOS ERIK, salvo que J coincida con un cupón
 * de Walmart (P/Q de PRECIOS ERIK, con memoria de 15 días).
 *
 * EM y CVA se revisan igual, cada uno contra el mínimo de su master.
 * Nunca alertan: prefijos RES-/WL-/OB- · ventas internas, insumos y
 * pruebas · SKUs sin precio en PRECIOS ERIK.
 */

/** Carga lo necesario para evaluar. Si PRECIOS ERIK está vacía, la llena primero. */
function contextoPrecios_() {
  var tabla = tablaPrecios_();
  if (!tabla.nMinimos) {
    try { actualizarPreciosErik_(true); } catch (e) { logError_('PRECIOS', e); }
    tabla = tablaPrecios_();
  }
  var listaCaida = tabla.nCupones === 0;
  var cupones = listaCaida ? cuponesVigentes_({}) : cuponesVigentes_(tabla.cupones);
  return { tabla: tabla, cupones: cupones, listaCaida: listaCaida };
}

/**
 * Filas A–L de Walmart recién bajadas → WALMART (A–U) y, si quedaron bajo
 * mínimo, al histórico. Devuelve { escritas, alertas }.
 */
function procesarWalmart_(filasWm) {
  var ctx = contextoPrecios_();
  var completas = filasWm.map(function (f) {
    return f.slice(0, 12).concat(evaluarVentaWalmart_(f, ctx.tabla, ctx.cupones, ctx.listaCaida));
  });

  var escritas = agregarSinDuplicar_(CFG.H.WALMART, ENC_WALMART, completas);
  var alertas = escritas.filter(function (f) { return f[W.SEM] === 'BAJO MINIMO'; });
  var n = registrarAlertas_(alertas);

  if (ctx.listaCaida && escritas.some(function (f) { return f[W.SEM] === 'PENDIENTE'; })) {
    logWarn_('ALERTAS', 'Lista de cupones P/Q vacía: ventas bajo mínimo quedan PENDIENTES');
  }
  return { escritas: escritas.length, alertas: n };
}

/**
 * Re-evalúa en la hoja WALMART las filas marcadas PENDIENTE (y, si se pide,
 * las recientes sin analizar). Escribe M–U en una sola pasada.
 */
function revisarPendientesWalmart_(incluirSinAnalizar) {
  var out = { revisadas: 0, alertas: 0 };
  var sh = hoja_(CFG.H.WALMART, ENC_WALMART);   // asegura columnas M–U
  var n = sh.getLastRow();
  if (n < 2) return out;

  var ancho = Math.max(Math.min(sh.getMaxColumns(), N_COLS_WALMART), 12);
  var datos = sh.getRange(2, 1, n - 1, ancho).getValues();
  var limite = Date.now() - CFG.DIAS_VENTANA * 86400000;

  var aRevisar = [];
  for (var i = 0; i < datos.length; i++) {
    var sem = String(datos[i][W.SEM] || '');
    if (sem === 'PENDIENTE') { aRevisar.push(i); continue; }
    if (incluirSinAnalizar && !sem) {
      var d = datos[i][2];
      var t = (d instanceof Date) ? d.getTime() : Date.parse(d);
      if (t && t >= limite) aRevisar.push(i);
    }
  }
  if (!aRevisar.length) return out;

  var ctx = contextoPrecios_();
  var alertas = [];
  aRevisar.forEach(function (i) {
    var bloque = evaluarVentaWalmart_(datos[i], ctx.tabla, ctx.cupones, ctx.listaCaida);
    sh.getRange(i + 2, W.REF + 1, 1, bloque.length).setValues([bloque]);
    if (bloque[W.SEM - W.REF] === 'BAJO MINIMO') {
      alertas.push(datos[i].slice(0, 12).concat(bloque));
    }
  });

  out.revisadas = aRevisar.length;
  out.alertas = registrarAlertas_(alertas);
  return out;
}

/**
 * Escribe alertas en "Histórico de alertas".
 *
 * Esa hoja trae encabezados de dos generaciones del código anterior
 * (con y sin "Producto", "J: Precio" vs "Precio Unit."). Por eso aquí cada
 * dato se coloca en la columna cuyo ENCABEZADO le corresponde, no por letra.
 * Lo que no tenga columna se agrega a la derecha. Nada se mueve de lugar.
 *
 * No duplica: la llave es SO | SKU | precio, igual que antes.
 */
var CAMPOS_ALERTA = [
  { k: 'fecha',    nom: 'Fecha alerta',  alias: ['FECHA ALERTA'] },
  { k: 'so',       nom: 'SO',            alias: ['SO', 'NUMERO (SO)'] },
  { k: 'cliente',  nom: 'Cliente',       alias: ['CLIENTE'] },
  { k: 'vendedor', nom: 'Vendedor',      alias: ['VENDEDOR'] },
  { k: 'sku',      nom: 'SKU',           alias: ['SKU'] },
  { k: 'producto', nom: 'Producto',      alias: ['PRODUCTO'] },
  { k: 'cantidad', nom: 'Cantidad',      alias: ['CANTIDAD'] },
  { k: 'precio',   nom: 'J: Precio',     alias: ['J: PRECIO', 'PRECIO UNIT.', 'PRECIO UNIT', 'PRECIO UNITARIO', 'PRECIO VENTA'] },
  { k: 'minimo',   nom: 'N: Ref',        alias: ['N: REF', 'PRECIO MINIMO', 'PRECIO REFERENCIA'] },
  { k: 'dif',      nom: 'Diff (N-J)',    alias: ['DIFF (N-J)', 'DIFERENCIA'] },
  { k: 'importe',  nom: 'Importe',       alias: ['IMPORTE', 'IMPORTE LINEA'] },
  { k: 'total',    nom: 'Total',         alias: ['TOTAL', 'TOTAL ORDEN'] },
  { k: 'pub',      nom: 'Publicación',   alias: ['PUBLICACION'] },
  { k: 'fventa',   nom: 'Fecha venta',   alias: ['FECHA VENTA'] },
  { k: 'id',       nom: 'ID Línea',      alias: ['ID LINEA'] }
];

function registrarAlertas_(filas) {
  if (!filas || !filas.length) return 0;

  var ss = libro_();
  var sh = ss.getSheetByName(CFG.H.ALERTAS);
  if (!sh) sh = hoja_(CFG.H.ALERTAS, CAMPOS_ALERTA.map(function (c) { return c.nom; }));

  // Ubicar cada campo por su encabezado; los que falten, a la derecha.
  var ultCol = Math.max(sh.getLastColumn(), 1);
  var enc = sh.getRange(1, 1, 1, ultCol).getValues()[0];
  if (enc.length === 1 && (enc[0] === '' || enc[0] === null)) enc = [];
  var mapa = mapaColumnas_(enc);
  var pos = {}, agregar = [];
  CAMPOS_ALERTA.forEach(function (c) {
    for (var i = 0; i < c.alias.length; i++) {
      if (mapa[c.alias[i]] !== undefined) { pos[c.k] = mapa[c.alias[i]]; return; }
    }
    agregar.push(c);
  });
  if (agregar.length) {
    var desde = enc.length;
    if (sh.getMaxColumns() < desde + agregar.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), desde + agregar.length - sh.getMaxColumns());
    }
    sh.getRange(1, desde + 1, 1, agregar.length)
      .setValues([agregar.map(function (c) { return c.nom; })]);
    agregar.forEach(function (c, j) { pos[c.k] = desde + j; });
  }
  var ancho = enc.length + agregar.length;

  // Llaves existentes
  var claves = {};
  var n = sh.getLastRow();
  if (n > 1) {
    sh.getRange(2, 1, n - 1, ancho).getValues().forEach(function (r) {
      claves[String(r[pos.so]) + '|' + sku_(r[pos.sku]) + '|' + num_(r[pos.precio])] = true;
    });
  }

  var ahora = new Date();
  var nuevas = [];
  filas.forEach(function (f) {
    var k = String(f[1]) + '|' + sku_(f[6]) + '|' + num_(f[9]);
    if (claves[k]) return;
    claves[k] = true;
    var min = num_(f[W.REF]);
    var v = {
      fecha: ahora, so: f[1], cliente: f[3], vendedor: f[4], sku: f[6],
      producto: f[7], cantidad: f[8], precio: num_(f[9]), minimo: min,
      dif: min - num_(f[9]), importe: num_(f[10]), total: num_(f[11]),
      pub: f[W.PUB], fventa: f[2], id: f[0]
    };
    var fila = new Array(ancho).fill('');
    Object.keys(pos).forEach(function (key) { fila[pos[key]] = v[key]; });
    nuevas.push(fila);
  });

  if (nuevas.length) {
    agregarFilas_(sh, nuevas);
    logWarn_('ALERTAS', nuevas.length + ' venta(s) de Walmart por debajo del mínimo',
             { skus: nuevas.slice(0, 10).map(function (a) { return a[pos.sku]; }) });
  }
  return nuevas.length;
}

/**
 * Menú: revisa las ventas de Walmart PENDIENTES y las de los últimos 7 días
 * que no tengan análisis. No re-evalúa ventas viejas: se compararían contra
 * el precio de hoy y llenarían el histórico de alertas falsas.
 */
function revisarPreciosWalmart() {
  var lock = candado_(30000);
  if (!lock) { avisar_('Hay otra corrida en curso. Intenta en un minuto.'); return; }
  try {
    var r = revisarPendientesWalmart_(true);
    logOK_('ALERTAS', 'Revisión manual de precios de Walmart', r);
    avisar_('Revisión terminada\n\n' +
            'Ventas revisadas: ' + r.revisadas + '\n' +
            'Alertas nuevas: ' + r.alertas + '\n\n' +
            'Quedó en WALMART y en Histórico de alertas. No se mandó ningún correo.');
  } catch (e) {
    logError_('ALERTAS', e);
    avisar_('Falló la revisión:\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}

/** Resumen rápido para consultar sin abrir las hojas. */
function resumenWalmart() {
  var sh = libro_().getSheetByName(CFG.H.WALMART);
  if (!sh || sh.getLastRow() < 2) { avisar_('Todavía no hay ventas de Walmart.'); return; }

  var n = sh.getLastRow();
  var ancho = Math.max(Math.min(sh.getMaxColumns(), N_COLS_WALMART), 12);
  var datos = sh.getRange(2, 1, n - 1, ancho).getValues();
  var c = { OK: 0, 'BAJO MINIMO': 0, CUPON: 0, PENDIENTE: 0, 'SIN REFERENCIA': 0, otros: 0, sin: 0 };
  var importe = 0, perdida = 0;
  datos.forEach(function (f) {
    importe += num_(f[10]);
    var s = String(f[W.SEM] || '');
    if (!s) c.sin++;
    else if (c[s] !== undefined) c[s]++;
    else c.otros++;
    if (s === 'BAJO MINIMO') perdida += Math.abs(num_(f[W.DIF])) * num_(f[8]);
  });

  var al = libro_().getSheetByName(CFG.H.ALERTAS);
  var cel = celdasDelLibro_();
  avisar_(
    'WALMART — resumen\n\n' +
    'Ventas: ' + datos.length + '\n' +
    '  En precio: ' + c.OK + '\n' +
    '  Con cupón: ' + c.CUPON + '\n' +
    '  Bajo mínimo: ' + c['BAJO MINIMO'] + '\n' +
    '  Pendientes: ' + c.PENDIENTE + '\n' +
    '  Sin precio en PRECIOS ERIK: ' + c['SIN REFERENCIA'] + '\n' +
    '  Anteriores al cambio (sin análisis): ' + c.sin + '\n\n' +
    'Importe total: $' + Math.round(importe).toLocaleString('es-MX') + '\n' +
    'Diferencia acumulada bajo mínimo: $' + Math.round(perdida).toLocaleString('es-MX') + '\n\n' +
    'Histórico de alertas: ' + (al ? Math.max(0, al.getLastRow() - 1) : 0) + ' registros\n' +
    'Celdas del libro: ' + cel.total.toLocaleString('es-MX') + ' / 10,000,000\n' +
    'Llamadas a Odoo hoy: ' + llamadasDeHoy_()
  );
}
