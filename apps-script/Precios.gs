/**
 * VENTA DIARIA ODOO 2026 — PRECIOS ERIK
 *
 * La hoja PRECIOS ERIK conserva sus columnas:
 *
 *   Filas 1-2 encabezado · datos desde la fila 3
 *   A NOMBRE · B SKU GENERAL · C WALMART CLASICA · D WALMART PREMIUM
 *        → las escribe ESTE script con valores, desde Site Sheet
 *          (Precios EM Minimo). Ya no dependen de una fórmula.
 *   E–M vacías
 *   N–O KILLERS · P–Q SIN -2 (cupones)
 *        → NO se tocan. Siguen como las tengas.
 *
 * Solo master EM. Los SKUs -CVA no se comparan contra mínimo.
 *
 * ⚠️ Nada de esto gasta UrlFetch: leer otro Google Sheet va por la API de
 * Sheets, que es otra bolsa. Por eso revisarPreciosAuto puede correr cada
 * 15 minutos sin cargarle nada a la cuenta.
 */

// ── Site Sheet ────────────────────────────────────────────────────────────

/** Hora de la última etapa de precios sin error en el Log de Site Sheet. */
function huellaSiteSheet_() {
  try {
    var sh = SpreadsheetApp.openById(CFG.SITE_SHEET_ID).getSheetByName(CFG.SITE_HOJA_LOG);
    if (!sh) return '';
    var n = sh.getLastRow();
    if (n < 2) return '';
    var desde = Math.max(2, n - 200);
    var filas = sh.getRange(desde, 1, n - desde + 1, 4).getValues();
    for (var i = filas.length - 1; i >= 0; i--) {
      var nivel = norm_(filas[i][1]);
      var etapa = norm_(filas[i][2]);
      if (etapa.indexOf('PRECIO') >= 0 && nivel.indexOf('ERROR') < 0) {
        return String(filas[i][0]);
      }
    }
    return '';
  } catch (e) {
    logWarn_('PRECIOS', 'No se pudo leer el Log de Site Sheet', { error: String(e) });
    return '';
  }
}

/**
 * Lee Precios EM Minimo de Site Sheet → [[nombre, sku, clasica, premium], …]
 * Ubica las columnas por TEXTO de encabezado. Si falta alguna, aborta en vez
 * de adivinar la letra.
 */
function leerMinimosSite_() {
  var sh = SpreadsheetApp.openById(CFG.SITE_SHEET_ID).getSheetByName(CFG.SITE_HOJA_MINIMO);
  if (!sh) throw new Error('Site Sheet no tiene la hoja "' + CFG.SITE_HOJA_MINIMO + '"');

  var ultFila = sh.getLastRow(), ultCol = sh.getLastColumn();
  if (ultFila < 2) throw new Error('"' + CFG.SITE_HOJA_MINIMO + '" está vacía');

  var m = mapaColumnas_(sh.getRange(1, 1, 1, ultCol).getValues()[0]);
  var iNom = m['PRODUCTO'], iSku = m['SKU'],
      iCla = m['WALMART CLASICA'], iPre = m['WALMART PREMIUM'];

  var faltan = [];
  if (iSku === undefined) faltan.push('SKU');
  if (iCla === undefined) faltan.push('"Walmart Clásica"');
  if (iPre === undefined) faltan.push('"Walmart Premium"');
  if (faltan.length) {
    throw new Error('En "' + CFG.SITE_HOJA_MINIMO + '" faltan encabezados: ' + faltan.join(', '));
  }

  var datos = sh.getRange(2, 1, ultFila - 1, ultCol).getValues();
  var out = [];
  for (var r = 0; r < datos.length; r++) {
    var s = sku_(datos[r][iSku]);
    if (!s) continue;
    var c = num_(datos[r][iCla]), p = num_(datos[r][iPre]);
    out.push([
      iNom === undefined ? '' : String(datos[r][iNom] || ''),
      s,
      c > 0 ? c : '',
      p > 0 ? p : ''
    ]);
  }

  // Guardarraíl: una lectura truncada no sustituye a la buena.
  var ultimoN = Number(prop_('N_PRECIOS_SITE', '0'));
  if (ultimoN && out.length < ultimoN * 0.5) {
    throw new Error('Lectura sospechosa de Site Sheet: ' + out.length +
                    ' SKUs contra ' + ultimoN + ' la última vez. No se usa.');
  }
  setProp_('N_PRECIOS_SITE', String(out.length));
  return out;
}

/**
 * Escribe A–D de PRECIOS ERIK con los mínimos de Site Sheet.
 * Solo reescribe si algo cambió (huella del contenido).
 * Borra primero A:D completo: eso quita la fórmula vieja que traía los #N/A.
 * N–Q no se tocan.
 */
function actualizarPreciosErik_(forzar) {
  var filas = leerMinimosSite_();

  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
                                       JSON.stringify(filas));
  var huella = digest.map(function (b) { return ((b + 256) % 256).toString(16); }).join('');
  if (!forzar && huella === prop_('HASH_PRECIOS_ERIK')) return { cambio: false, skus: filas.length };

  var sh = hoja_(CFG.H.PRECIOS, null);
  var necesarias = CFG.PE.FILA_DATOS - 1 + filas.length;
  if (sh.getMaxRows() < necesarias) {
    sh.insertRowsAfter(sh.getMaxRows(), necesarias - sh.getMaxRows() + 50);
  }
  if (sh.getMaxColumns() < 4) sh.insertColumnsAfter(sh.getMaxColumns(), 4 - sh.getMaxColumns());

  sh.getRange(1, 1, sh.getMaxRows(), 4).clearContent();
  sh.getRange(1, 1, 2, 4).setValues([
    ['NOMBRE', 'SKU GENERAL', 'WALMART', ''],
    ['',       '',            'CLASICA', 'PREMIUM']
  ]);
  if (filas.length) sh.getRange(CFG.PE.FILA_DATOS, 1, filas.length, 4).setValues(filas);
  SpreadsheetApp.flush();

  setProp_('HASH_PRECIOS_ERIK', huella);
  setProp_('PRECIOS_ERIK_ACTUALIZADO', ahora_());
  logOK_('PRECIOS', 'PRECIOS ERIK actualizada desde Site Sheet', { skus: filas.length });
  return { cambio: true, skus: filas.length };
}

// ── Lectura para evaluar ventas ───────────────────────────────────────────

/**
 * Lee PRECIOS ERIK (A–D y P–Q) en una sola pasada.
 * Devuelve { minimos: {SKU: {c, p}}, cupones: {SKU: [precios]}, nCupones }
 */
function tablaPrecios_() {
  var sh = libro_().getSheetByName(CFG.H.PRECIOS);
  var t = { minimos: {}, cupones: {}, nCupones: 0, nMinimos: 0 };
  if (!sh) return t;
  var n = sh.getLastRow();
  if (n < CFG.PE.FILA_DATOS) return t;

  var ancho = Math.min(sh.getMaxColumns(), CFG.PE.COL_CUPON_PRECIO);
  var datos = sh.getRange(CFG.PE.FILA_DATOS, 1, n - CFG.PE.FILA_DATOS + 1, ancho).getValues();

  for (var i = 0; i < datos.length; i++) {
    var f = datos[i];
    var s = sku_(f[CFG.PE.COL_SKU - 1]);
    if (s) {
      var c = num_(f[CFG.PE.COL_CLASICA - 1]), p = num_(f[CFG.PE.COL_PREMIUM - 1]);
      if (c > 0 || p > 0) { t.minimos[s] = { c: c, p: p }; t.nMinimos++; }
    }
    if (ancho >= CFG.PE.COL_CUPON_PRECIO) {
      var cs = sku_(f[CFG.PE.COL_CUPON_SKU - 1]);
      var cp = f[CFG.PE.COL_CUPON_PRECIO - 1];
      // Ignorar errores (#N/A, #VALUE!): solo números > 0
      if (cs && typeof cp === 'number' && cp > 0) {
        if (!t.cupones[cs]) t.cupones[cs] = [];
        t.cupones[cs].push(cp);
        t.nCupones++;
      }
    }
  }
  return t;
}

/**
 * Memoria de cupones (hoja oculta CUPONES WALMART HIST), igual que antes:
 * cada SKU+precio visto en P/Q se sigue aceptando CUPON_DIAS_VIGENCIA días.
 * Protege contra cupones que rotan y contra IMPORTRANGE con caché viejo.
 * Devuelve el mapa de cupones vigentes.
 */
function cuponesVigentes_(cuponesActuales) {
  var sh = libro_().getSheetByName(CFG.H.CUPONES);
  if (!sh) {
    sh = hoja_(CFG.H.CUPONES, ENC_CUPONES);
    try { sh.hideSheet(); } catch (e) { /* no importa */ }
  }
  var ahora = new Date();
  var n = sh.getLastRow();
  var data = n > 1 ? sh.getRange(2, 1, n - 1, 4).getValues() : [];
  var idx = {};
  data.forEach(function (r, i) { idx[sku_(r[0]) + '|' + num_(r[1])] = i; });

  var nuevos = [];
  Object.keys(cuponesActuales).forEach(function (s) {
    cuponesActuales[s].forEach(function (p) {
      var k = s + '|' + num_(p);
      if (idx[k] !== undefined) data[idx[k]][3] = ahora;
      else { idx[k] = -1; nuevos.push([s, p, ahora, ahora]); }
    });
  });

  if (data.length) sh.getRange(2, 4, data.length, 1).setValues(data.map(function (r) { return [r[3]]; }));
  if (nuevos.length) agregarFilas_(sh, nuevos);

  var limite = ahora.getTime() - CFG.CUPON_DIAS_VIGENCIA * 86400000;
  var vig = {};
  var add = function (s, p) {
    if (!vig[s]) vig[s] = [];
    if (vig[s].indexOf(p) < 0) vig[s].push(p);
  };
  data.forEach(function (r) {
    var u = (r[3] instanceof Date) ? r[3].getTime() : new Date(r[3]).getTime();
    if (!isNaN(u) && u >= limite) add(sku_(r[0]), num_(r[1]));
  });
  nuevos.forEach(function (r) { add(r[0], num_(r[1])); });
  return vig;
}

/** ¿El precio coincide con un cupón vigente del SKU? Prueba SKU, sin -2 y base. */
function esPrecioCupon_(cupones, sku, precio) {
  var llaves = [sku_(sku), skuSinVariante_(sku), skuBase_(sku)];
  for (var i = 0; i < llaves.length; i++) {
    var lista = cupones[llaves[i]];
    if (!lista) continue;
    for (var j = 0; j < lista.length; j++) {
      if (Math.abs(lista[j] - precio) <= CFG.TOLERANCIA_PRECIO) return true;
    }
  }
  return false;
}

/** Mínimo que aplica: SKU exacto y, si no, SKU base. Premium → columna D. */
function minimoDe_(tabla, sku) {
  var s = sku_(sku);
  var fila = tabla.minimos[s] || tabla.minimos[skuBase_(s)];
  if (!fila) return 0;
  return tipoPublicacion_(s) === 'PREMIUM' ? (fila.p || 0) : (fila.c || 0);
}

/**
 * Evalúa una venta de Walmart (fila A–L) y devuelve el bloque M–U (9 valores).
 * listaCaida = P/Q vacía en este instante (IMPORTRANGE cargando): una venta
 * bajo mínimo se deja PENDIENTE en vez de alertar, igual que antes.
 */
function evaluarVentaWalmart_(f, tabla, cupones, listaCaida) {
  var s = sku_(f[6]);
  var J = num_(f[9]);
  var base = skuBase_(s);
  var tipo = tipoPublicacion_(s);
  var origen = esCVA_(s) ? 'CVA' : 'EM';

  if (!esVentaComercial_(f[3], J)) {
    return ['', base, tipo, origen, '—', '', '', 'INTERNA', 'Venta interna, insumo o prueba'];
  }
  if (origen === 'CVA') {
    return ['', base, tipo, 'CVA', '—', '', '', 'CVA', 'Producto CVA: no se compara contra mínimo EM'];
  }
  if (skuIgnorado_(s)) {
    return ['', base, tipo, 'EM', '—', '', '', 'IGNORADO', 'Prefijo viejo RES- / WL- / OB-'];
  }

  var min = minimoDe_(tabla, s);
  if (!min) {
    return ['', base, tipo, 'EM', '—', '', '', 'SIN REFERENCIA',
            'No está en PRECIOS ERIK' + (tipo === 'PREMIUM' ? ' (columna PREMIUM)' : '')];
  }

  var dif = J - min;
  var pct = dif / min;

  if (J >= min - CFG.TOLERANCIA_PRECIO) {
    return [min, base, tipo, 'EM', 'MINIMO', dif, pct, 'OK', ''];
  }
  if (esPrecioCupon_(cupones, s, J)) {
    return [min, base, tipo, 'EM', 'CUPON', dif, pct, 'CUPON', 'Precio de cupón / killer Walmart'];
  }
  if (listaCaida) {
    return [min, base, tipo, 'EM', 'MINIMO', dif, pct, 'PENDIENTE',
            'Lista de cupones P/Q vacía: se revisa en la siguiente corrida'];
  }
  return [min, base, tipo, 'EM', 'MINIMO', dif, pct, 'BAJO MINIMO', ''];
}

// ── Menú y trigger ────────────────────────────────────────────────────────

/** Menú: fuerza la bajada de mínimos desde Site Sheet. */
function actualizarPreciosMinimos() {
  var lock = candado_(30000);
  if (!lock) { avisar_('Hay otra corrida en curso. Intenta en un minuto.'); return; }
  try {
    var r = actualizarPreciosErik_(true);
    setProp_('HUELLA_PRECIOS', huellaSiteSheet_());
    avisar_('PRECIOS ERIK actualizada\n\nSKUs con precio mínimo: ' + r.skus +
            '\n\nColumnas A–D escritas desde Site Sheet. N–Q no se tocaron.');
  } catch (e) {
    logError_('PRECIOS', e);
    avisar_('No se pudo actualizar PRECIOS ERIK:\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Trigger cada 15 min. Solo trabaja si el Log de Site Sheet reportó un
 * cambio de precios desde la última vez. Cero UrlFetch.
 */
function revisarPreciosAuto() {
  try {
    var huella = huellaSiteSheet_();
    if (huella && huella === prop_('HUELLA_PRECIOS')) return;
    var lock = candado_(10000);
    if (!lock) return;
    try {
      actualizarPreciosErik_(false);
      setProp_('HUELLA_PRECIOS', huella);
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    logError_('PRECIOS', e);
  }
}
