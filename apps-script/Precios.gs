/**
 * VENTA DIARIA ODOO 2026 — PRECIOS ERIK
 *
 * La hoja PRECIOS ERIK conserva sus columnas:
 *
 *   Filas 1-2 encabezado · datos desde la fila 3
 *   A NOMBRE · B SKU GENERAL · C WALMART CLASICA · D WALMART PREMIUM
 *        → las escribe ESTE script con valores, desde Site Sheet
 *          (Precios EM Minimo + Precios CVA Minimo). Ya no dependen de una fórmula.
 *   E–M vacías
 *   N–O KILLERS · P–Q SIN -2 (cupones)
 *        → NO se tocan. Siguen como las tengas.
 *
 * Dos masters: EM y CVA. Cada venta se compara contra el mínimo de su master.
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
 * Lee UNA hoja de mínimos de Site Sheet → [[nombre, sku, clasica, premium], …]
 * Ubica las columnas por TEXTO de encabezado. Si falta alguna, aborta en vez
 * de adivinar la letra.
 */
function leerHojaMinimos_(nombreHoja) {
  var sh = SpreadsheetApp.openById(CFG.SITE_SHEET_ID).getSheetByName(nombreHoja);
  if (!sh) throw new Error('Site Sheet no tiene la hoja "' + nombreHoja + '"');

  var ultFila = sh.getLastRow(), ultCol = sh.getLastColumn();
  if (ultFila < 2) throw new Error('"' + nombreHoja + '" está vacía');

  var m = mapaColumnas_(sh.getRange(1, 1, 1, ultCol).getValues()[0]);
  var iNom = m['PRODUCTO'], iSku = m['SKU'],
      iCla = m['WALMART CLASICA'], iPre = m['WALMART PREMIUM'];

  var faltan = [];
  if (iSku === undefined) faltan.push('SKU');
  if (iCla === undefined) faltan.push('"Walmart Clásica"');
  if (iPre === undefined) faltan.push('"Walmart Premium"');
  if (faltan.length) {
    throw new Error('En "' + nombreHoja + '" faltan encabezados: ' + faltan.join(', '));
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
  return out;
}

/**
 * Mínimos de EM + CVA juntos, sin SKUs repetidos (si se repite, gana EM).
 * Si la hoja de CVA falla, se sigue con EM y queda en el LOG.
 */
function leerMinimosSite_() {
  var out = [], vistos = {};
  CFG.SITE_HOJAS_MINIMO.forEach(function (nombre, i) {
    var filas;
    try {
      filas = leerHojaMinimos_(nombre);
    } catch (e) {
      if (i === 0) throw e;                         // sin EM no hay nada que hacer
      logWarn_('PRECIOS', 'No se pudo leer "' + nombre + '", se sigue sin ella',
               { error: String(e && e.message || e) });
      return;
    }
    filas.forEach(function (f) {
      if (vistos[f[1]]) return;
      vistos[f[1]] = true;
      out.push(f);
    });
  });

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
 * Lee PRECIOS ERIK en una sola pasada.
 *   minimos  {SKU: {c, p}}      de A–D
 *   killersNQ [{general, pub, precio}] de N–Q: solo respaldo mientras
 *            KILLERS HISTORICO está vacío
 *            general = P (el SKU como llega la venta de Odoo)
 *            pub     = N (el SKU de la publicación con killer, …-MSI-3)
 */
function tablaPrecios_() {
  var sh = libro_().getSheetByName(CFG.H.PRECIOS);
  var t = { minimos: {}, killersNQ: [], nMinimos: 0, nCupones: 0 };
  if (!sh) return t;
  var n = sh.getLastRow();
  if (n < CFG.PE.FILA_DATOS) return t;

  var C = columnasPreciosErik_(sh);
  var ancho = Math.max(sh.getLastColumn(), CFG.PE.COL_CUPON_PRECIO);
  if (ancho > sh.getMaxColumns()) ancho = sh.getMaxColumns();
  var datos = sh.getRange(CFG.PE.FILA_DATOS, 1, n - CFG.PE.FILA_DATOS + 1, ancho).getValues();

  var v = function (f, i) { return (i >= 0 && i < f.length) ? f[i] : ''; };

  for (var i = 0; i < datos.length; i++) {
    var f = datos[i];
    var s = sku_(v(f, C.SKU));
    if (s) {
      var c = num_(v(f, C.CLASICA)), p = num_(v(f, C.PREMIUM));
      if (c > 0 || p > 0) { t.minimos[s] = { c: c, p: p }; t.nMinimos++; }
    }
    var pub = sku_(v(f, C.KILLER_SKU));
    var gen = sku_(v(f, C.CUPON_SKU)) || (pub ? skuBase_(pub) : '');
    var precio = num_(v(f, C.CUPON_PRECIO)) || num_(v(f, C.KILLER_PRECIO));
    if (gen && precio > 0) t.killersNQ.push({ general: gen, pub: pub, precio: precio });
  }
  t.nCupones = t.killersNQ.length;
  return t;
}

/**
 * Dónde está cada columna de PRECIOS ERIK. Esta hoja es especial: trae DOS
 * filas de títulos (1 y 2) y los datos arrancan en la 3, y las columnas N–Q
 * (killers/cupones) las mantienes tú a mano. Así que primero se buscan por el
 * TEXTO del título — en la fila 1 o en la 2, la que lo traiga — y solo si no
 * aparece se usa la letra de siempre (CFG.PE). Nunca truena: a lo mucho se
 * comporta como antes y deja un aviso en el LOG.
 */
function columnasPreciosErik_(sh) {
  var def = {
    SKU:           CFG.PE.COL_SKU - 1,
    CLASICA:       CFG.PE.COL_CLASICA - 1,
    PREMIUM:       CFG.PE.COL_PREMIUM - 1,
    KILLER_SKU:    CFG.PE.COL_KILLER_SKU - 1,
    KILLER_PRECIO: CFG.PE.COL_KILLER_PRECIO - 1,
    CUPON_SKU:     CFG.PE.COL_CUPON_SKU - 1,
    CUPON_PRECIO:  CFG.PE.COL_CUPON_PRECIO - 1
  };
  // Títulos que se aceptan para cada cosa (sin acentos ni mayúsculas: norm_).
  // Los primeros de cada lista son los que TÚ pusiste en la hoja el 02/10/2026.
  // OJO: no se aceptan los títulos de la fila 2 ("KILLERS", "SIN -2") porque
  // están repetidos en dos columnas y no distinguen cuál es cuál.
  var alias = {
    SKU:           ['SKU GENERAL'],
    CLASICA:       ['CLASICA', 'WALMART CLASICA'],
    PREMIUM:       ['PREMIUM', 'WALMART PREMIUM'],
    KILLER_SKU:    ['SKU KILLER', 'KILLER SKU', 'SKU PUBLICACION', 'SKU DE LA PUBLICACION'],
    KILLER_PRECIO: ['PRECIO KILLERS', 'PRECIO KILLER', 'PRECIO NEGOCIADO'],
    CUPON_SKU:     ['SKU SIN -2', 'SKU CUPON', 'SKU GENERAL CUPON', 'SKU CON CUPON'],
    CUPON_PRECIO:  ['PRECIO SIN -2', 'PRECIO CUPON', 'PRECIO CON CUPON']
  };

  var out = {}, movidas = [];
  try {
    var nc = Math.max(sh.getLastColumn(), CFG.PE.COL_CUPON_PRECIO);
    var f1 = sh.getRange(1, 1, 1, nc).getValues()[0];
    var f2 = sh.getRange(2, 1, 1, nc).getValues()[0];
    var mapa = {};
    for (var c = 0; c < nc; c++) {
      [f1[c], f2[c]].forEach(function (x) {
        var k = norm_(x);
        if (k && mapa[k] === undefined) mapa[k] = c;
      });
    }
    Object.keys(def).forEach(function (llave) {
      var i;
      alias[llave].some(function (nombre) {
        var j = mapa[norm_(nombre)];
        if (j !== undefined) { i = j; return true; }
        return false;
      });
      out[llave] = (i === undefined) ? def[llave] : i;
      if (i !== undefined && i !== def[llave]) {
        movidas.push(llave + ': ' + letraCol_(def[llave]) + '→' + letraCol_(i));
      }
    });
    if (movidas.length) avisarColumnas_(sh.getName(), 'movidas', movidas);
    return out;
  } catch (e) {
    return def;   // ante cualquier duda, el comportamiento de siempre
  }
}




/**
 * Mínimo que aplica: SKU exacto y, si no, sin variante (-2..9). Un SKU -CVA
 * nunca cae al mínimo de EM: si no está como -CVA, no tiene referencia.
 * Premium → columna D.
 */
function minimoDe_(tabla, sku) {
  var s = sku_(sku);
  var fila = tabla.minimos[s] || tabla.minimos[skuSinVariante_(s)];
  // Open box (-OB) nunca toma el mínimo del producto nuevo: si no tiene el
  // suyo propio en PRECIOS ERIK, queda SIN REFERENCIA en vez de alertar.
  if (!fila && !esCVA_(s) && tipoPublicacion_(s) !== 'OPEN BOX') fila = tabla.minimos[skuBase_(s)];
  if (!fila) return 0;
  return tipoPublicacion_(s) === 'PREMIUM' ? (fila.p || 0) : (fila.c || 0);
}

/**
 * Evalúa una venta de Walmart (fila A–L) y devuelve el bloque M–U (9 valores).
 * listaCaida = P/Q vacía en este instante (IMPORTRANGE cargando): una venta
 * bajo mínimo se deja PENDIENTE en vez de alertar, igual que antes.
 */
function evaluarVentaWalmart_(f, tabla, killers, listaCaida, asignados) {
  var s = sku_(f[6]);
  // Si el SKU vendido está vinculado a otro (hoja SKU ASIGNADOS), el precio
  // mínimo es el del principal y valen los killers de cualquiera del grupo.
  var g = grupoDe_(asignados, s);
  var refSku = g ? g.principal : s;
  var grupo = g ? g.grupo : null;
  var notaAsig = (g && g.principal !== s) ? 'Asignado a ' + g.principal : '';
  var J = num_(f[9]);
  var fecha = (f[2] instanceof Date) ? f[2] : fecha_(f[2]);
  var base = skuBase_(s);
  var tipo = tipoPublicacion_(s);
  var origen = esCVA_(s) ? 'CVA' : 'EM';
  var nota = function (t) { return (t + (notaAsig ? ' · ' + notaAsig : '')).replace(/^ · /, ''); };

  if (!esVentaComercial_(f[3], J)) {
    return ['', base, tipo, origen, '—', '', '', 'INTERNA', 'Venta interna, insumo o prueba'];
  }
  if (skuIgnorado_(s)) {
    return ['', base, tipo, origen, '—', '', '', 'IGNORADO', 'Prefijo viejo RES- / WL- / OB-'];
  }

  // Con SKUs asignados da igual cuál pusiste en A: el mínimo es el más bajo
  // del grupo (el SKU vendido se está surtiendo como cualquiera de ellos).
  var min = 0;
  [s, refSku].concat(grupo || []).forEach(function (x) {
    var m = minimoDe_(tabla, x);
    if (m > 0 && (!min || m < min)) min = m;
  });
  if (!min) {
    return ['', base, tipo, origen, '—', '', '', 'SIN REFERENCIA',
            'No está en PRECIOS ERIK' + (tipo === 'PREMIUM' ? ' (columna PREMIUM)' : '')];
  }

  var dif = J - min;
  var pct = dif / min;

  if (J >= min - CFG.TOLERANCIA_PRECIO) {
    return [min, base, tipo, origen, 'MINIMO', dif, pct, 'OK', notaAsig];
  }

  // 1) Killer: mismo precio y la venta cayó dentro de sus fechas
  var k = killerQueAplica_(killers, s, J, fecha, grupo);
  if (k) {
    var fin = k.fin instanceof Date ? ' (hasta ' + Utilities.formatDate(k.fin, CFG.TZ, 'dd/MM') + ')' : '';
    return [min, base, tipo, origen, 'KILLER', dif, pct, 'KILLER', nota('Killer $' + k.precio + fin)];
  }

  // 2) Promoción de comisión. Se ajusta el mínimo UNA sola vez, y solo si el
  //    site no la trae ya (COMISIONES, "YA APLICADA EN EL SITE"):
  //      · la del killer de ese SKU (comisión del cupón / MSI), o si no hay,
  //      · la de su categoría (COMISIONES col. D o deducida de los killers).
  //    mínimo ajustado = mínimo × (1 − comisión normal) ÷ (1 − comisión promo)
  //    El killer (paso 1) es precio exacto y no se combina con nada.
  var premium = tipo === 'PREMIUM';
  // 2a) Promoción capturada en el site para ese SKU (APLICA = SI): el mínimo NO la trae,
  //     así que la venta se valida contra mínimo − puntos de la promo.
  var psw = null;
  try { psw = promoSiteDeSku_(promosSiteMem_(), s); } catch (e) { psw = null; }
  if (psw && psw.red > 0) {
    var minS = min * (1 - psw.red);
    if (J >= minS - CFG.TOLERANCIA_PRECIO) {
      return [min, base, tipo, origen, 'PROMOCION', dif, pct, 'PROMOCION',
              nota('Promoción del site −' + Math.round(psw.red * 1000) / 10 + '% · mínimo ajustado $' + Math.round(minS))];
    }
  }
  var p = promoQueAplica_(killers, s, fecha, grupo, premium);
  // Rebaja de comisión BASE cuya categoría ya está aplicada en el site: el
  // mínimo ya viene rebajado, no se vuelve a ajustar (sí la de SOLO MSI).
  if (p && !p.soloMsi && promoYaEnSite_(killers, s, grupo)) p = null;
  if (!p) p = promoCategoriaDe_(killers, s, grupo, premium);
  if (p) {
    var minAj = min * (1 - p.normal) / (1 - p.com);
    if (J >= minAj - CFG.TOLERANCIA_PRECIO) {
      return [min, base, tipo, origen, 'PROMOCION', dif, pct, 'PROMOCION',
              nota('Promoción ' + (p.nombre ? p.nombre + ' ' : '') + Math.round(p.com * 1000) / 10 + '% vs ' +
                   Math.round(p.normal * 1000) / 10 + '% · mínimo ajustado $' + Math.round(minAj))];
    }
  }

  return [min, base, tipo, origen, 'MINIMO', dif, pct, 'BAJO MINIMO', notaAsig];
}

/** Lista de promociones del site, leída una sola vez por corrida. */
function promosSiteMem_() {
  if (promosSiteMem_.v === undefined) {
    try { promosSiteMem_.v = promosDelSite_(); } catch (e) { promosSiteMem_.v = null; }
  }
  return promosSiteMem_.v;
}

// ── SKU ASIGNADOS ─────────────────────────────────────────────────────────

/**
 * Lee la hoja SKU ASIGNADOS → { SKU: {principal, grupo:[...]} }.
 * Cada renglón es un grupo: A = SKU principal, B.. = los vinculados.
 * Cualquier SKU del renglón apunta al mismo grupo.
 */
function leerAsignados_() {
  var mapa = {};
  var sh = libro_().getSheetByName(CFG.H.ASIGNADOS);
  if (!sh || sh.getLastRow() < 2) return mapa;
  var datos = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 1)).getValues();
  datos.forEach(function (fila) {
    var grupo = fila.map(sku_).filter(function (x) { return x; });
    if (grupo.length < 2) return;
    var info = { principal: grupo[0], grupo: grupo };
    grupo.forEach(function (x) { mapa[x] = info; mapa[skuBase_(x)] = mapa[skuBase_(x)] || info; });
  });
  return mapa;
}

function grupoDe_(asignados, sku) {
  if (!asignados) return null;
  var s = sku_(sku);
  return asignados[s] || asignados[skuSinVariante_(s)] || null;
}

// ── Menú y trigger ────────────────────────────────────────────────────────

/** Menú: fuerza la bajada de mínimos desde Site Sheet. */
function actualizarPreciosMinimos() {
  // Botón: espera hasta 3 min a que termine el trigger que esté corriendo.
  var lock = candado_(180000);
  if (!lock) { avisar_('La importación automática está corriendo en este momento y no terminó en 3 minutos.\n\nNo pasa nada: espera a que termine (revisa LOG Ventas) y vuelve a darle.'); return; }
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
 * Trigger cada 15 min. Cero UrlFetch.
 *  1) Anota en HISTORICO KILLERS lo que hoy trae N–Q de PRECIOS ERIK.
 *  2) Si Site Sheet reportó cambio de precios, reescribe A–D.
 */
function revisarPreciosAuto() {
  var lock = candado_(10000);
  if (!lock) return;
  try {
    var huella = huellaSiteSheet_();
    if (!huella || huella !== prop_('HUELLA_PRECIOS')) {
      actualizarPreciosErik_(false);
      setProp_('HUELLA_PRECIOS', huella);
    }
    // Killers: se leen de Site Sheet (cada ~4 min como mucho; si la lista no
    // cambió no se escribe nada). Ver KillersSite.gs.
    sincronizarKillersSite_(false);
    // KILLERS ACTIVOS se rehace cuando llegaron killers nuevos del site, y de
    // todos modos una vez por hora (estados, KAM nuevos, mínimos).
    if (prop_('KILLERS_ACTIVOS_PENDIENTE') === '1' ||
        Date.now() - Number(prop_('KILLERS_REFRESCO', '0')) > 3600000) {
      asegurarHojasKillers_();
      migrarCuponesViejos_();
      reconstruirActivos_();
      setProp_('KILLERS_REFRESCO', String(Date.now()));
      setProp_('KILLERS_ACTIVOS_PENDIENTE', '');
    }
    // Cotejo automático de KILLERS ACTIVOS contra los precios reales de Walmart
    // (dashboard). Solo reescribe COMPARAR WALMART si cambió algo.
    compararWalmartAuto_();
  } catch (e) {
    logError_('PRECIOS', e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * UNA vez: pasa la memoria vieja de killers (CUPONES WALMART HIST: SKU,
 * Precio, Primera vez, Última vez) a KILLERS HISTORICO y la borra.
 */
function migrarCuponesViejos_() {
  if (prop_('CUPONES_MIGRADOS') === '1') return;
  var ss = libro_();
  var vieja = ss.getSheetByName(CFG.HOJA_CUPONES_VIEJA);
  if (vieja) {
    var n = vieja.getLastRow();
    var lista = [];
    if (n > 1) {
      vieja.getRange(2, 1, n - 1, 4).getValues().forEach(function (r) {
        if (!sku_(r[0]) || !(num_(r[1]) > 0)) return;
        var ini = fechaK_(r[2]), fin = fechaK_(r[3]);
        lista.push({ sku: sku_(r[0]), general: skuBase_(r[0]), detalles: 'Memoria del código anterior',
                     actual: '', negoc: num_(r[1]), cupon: '', recibimos: '', ini: ini, fin: fin,
                     comCup: '', msi: '', comMsi: '', wfs: '', devol: '', disp: '', obs: '',
                     origen: 'MEMORIA ANTERIOR', registrado: new Date() });
      });
    }
    guardarEnHistorico_(lista, { n: 0, etiqueta: 'MEMORIA ANTERIOR' });
    ss.deleteSheet(vieja);
    logOK_('KILLERS', 'Memoria vieja pasada a KILLERS HISTORICO', { filas: lista.length });
  }
  setProp_('CUPONES_MIGRADOS', '1');
}
