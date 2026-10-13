/**
 * VENTA DIARIA ODOO 2026 — EXPORTAR / MINIMO / MAXIMO
 *
 * La conclusión de lo que hacían las hojas EXPORTAR, MINIMO y MAXIMO del libro "CAMBIO DE PRECIOS
 * WALMART 2026" (13 columnas de FILTER / XLOOKUP / QUERY), hecha por el script y con los MISMOS
 * resultados, pero escribiendo SOLO lo que se usa:
 *
 *   EXPORTAR   SKU WALMART · PRECIO FINAL · PRECIO -2% · PRECIO CARGA
 *   MINIMO     SKU WALMART · PRECIO MINIMO
 *   MAXIMO     SKU WALMART · PRECIO MAXIMO
 *
 * Cómo se llega al precio de cada SKU del inventario de Walmart (todo en memoria, sin columnas de apoyo):
 *   1. SKU general con su precio en Site Sheet (EM y debajo CVA): clásica y premium.
 *   2. Un SKU publicado que es el general (o general-2…-9) toma el precio CLÁSICA.
 *      Uno que es general-MSI (o general-MSI-2…-9) toma el precio PREMIUM.
 *   3. PRECIOS VARIACIONES (precios manuales por SKU publicado) se agregan al final y ganan.
 *      Una variación sin precio o con #N/A se convierte en 0.
 *   4. EXPORTAR: sin repetidos (si una llave sale dos veces gana la última).
 *      PRECIO -2% = precio × 0.98 · PRECIO CARGA = INT(-2% / 10) × 10 + 9 (si el precio es 0, la carga es 0).
 *
 * De dónde sale cada cosa (ya no existen PRECIOS FINAL FINAL / MINIMO / MAXIMO ni INVENTARIO SCROLL):
 *   · Precios:  Site Sheet → Precios EM|CVA Normal|Minimo|Maximo (columnas por encabezado).
 *   · Inventario: dashboard de Walmart (WM_Inv) → Inventario → columna sku.
 *   · Variaciones: hoja PRECIOS VARIACIONES de este libro (IMPORTRANGE; la crea el script y hay que
 *     darle "Permitir acceso" una vez).
 *
 * Se corre solo dentro de revisarPreciosAuto (cada 15 min) y solo escribe si algo cambió.
 * Menú: 📤 Actualizar EXPORTAR, MINIMO y MAXIMO.
 */

var EX = {
  HOJA: { EXPORTAR: 'EXPORTAR', MINIMO: 'MINIMO', MAXIMO: 'MAXIMO', VARIACIONES: 'PRECIOS VARIACIONES' },
  // Columnas que escribe el script en cada hoja (por encabezado: se pueden mover de lugar).
  COLS: {
    EXPORTAR: ['SKU WALMART', 'PRECIO FINAL', 'PRECIO -2%', 'PRECIO CARGA'],
    MINIMO:   ['SKU WALMART', 'PRECIO MINIMO'],
    MAXIMO:   ['SKU WALMART', 'PRECIO MAXIMO']
  },
  // Hojas de Site Sheet, EM primero y CVA debajo (si un SKU sale en las dos, gana EM).
  SITE: {
    EXPORTAR: ['Precios EM Normal', 'Precios CVA Normal'],
    MINIMO:   ['Precios EM Minimo', 'Precios CVA Minimo'],
    MAXIMO:   ['Precios EM Maximo', 'Precios CVA Maximo']
  },
  // Libro de variaciones (precios manuales por SKU publicado). Es solo el ID de la hoja, no una credencial.
  VARIACIONES: { ID: '1Uy-SIuVb77xFFGTuAmN6CvbpbWbTU4JXEH7OFNzXrbI', HOJA: 'PRINCIPAL -2', RANGO_SKU: 'C112:C', RANGO_PRECIO: 'J112:J' },
  FACTOR: 0.98,               // PRECIO -2%
  MIN_FILAS_SITE: 100,        // por hoja: menos que esto es una lectura rota y no se escribe nada
  MIN_INVENTARIO: 100,
  REFRESCO_MS: 3600000,       // aunque nada parezca haber cambiado, se vuelve a leer todo una vez por hora
  PROP: { CLAVE: 'EX_CLAVE', PESADA: 'EX_PESADA', HASH: 'EX_HASH', N: 'EX_N', VARIACIONES: 'EX_VARIACIONES', ULTIMO_ERROR: 'EX_ULTIMO_ERROR' }
};

// ── Lógica pura (sin llamadas a Google: se prueba en Node contra el libro viejo) ──────────────

/**
 * Devuelve { R: [SKU final], S: [precio] } para una hoja.
 *   inv      SKUs del inventario (texto; los que sean número no entran, como en el libro viejo)
 *   precios  [[sku, clasica, premium], …]  EM y debajo CVA, tal cual vienen (puede haber repetidos)
 *   vars     [[llave, precio], …]  precio = número | '' | '#N/A'  (sin precio → 0)
 *   esExportar  true = sin repetidos (gana el último); false = MINIMO / MAXIMO, todas las filas
 */
function exArmar_(inv, precios, vars, esExportar) {
  var E = Object.create(null), F = Object.create(null);
  for (var i = 0; i < precios.length; i++) {
    var k = String(precios[i][0]).toLowerCase();
    if (!(k in E)) { E[k] = precios[i][1]; F[k] = precios[i][2]; }   // gana la primera aparición (EM antes que CVA)
  }
  var J = [], N = [];   // clásicas y premium por separado: primero todas las clásicas, luego todas las premium (como el libro viejo)
  for (var j = 0; j < inv.length; j++) {
    var b = inv[j];
    if (typeof b !== 'string' || b === '') continue;
    var bl = b.toLowerCase(), m;
    // Clásica: igual al general o a general-2…9 → se quita el -2…9 y se busca el precio clásica
    if ((bl in E) || ((m = /^(.*)-[2-9]$/.exec(bl)) && (m[1] in E))) {
      var kc = b.replace(/-[2-9]$/, '').toLowerCase();
      J.push([b, (kc in E) ? E[kc] : '#N/A']);
    }
    // Premium: general-MSI o general-MSI-2…9 → se quita el -MSI… y se busca el precio premium
    if ((m = /^(.*)-msi(?:-[2-9])?$/.exec(bl)) && (m[1] in E)) {
      var kp = b.replace(/-MSI(?:-[2-9])?$/i, '').toLowerCase();
      N.push([b, (kp in F) ? F[kp] : '#N/A']);
    }
  }
  var pares = J.concat(N);
  for (var v = 0; v < vars.length; v++) {
    var llave = vars[v][0];
    if (llave === '' || llave === null || llave === undefined) continue;
    var p = vars[v][1];
    pares.push([String(llave), p]);
  }
  var R = [], S = [];
  if (esExportar) {
    var ultimo = Object.create(null), orden = [];
    pares.forEach(function (q) {
      var kl = q[0].toLowerCase();
      if (!(kl in ultimo)) orden.push(q[0]);
      ultimo[kl] = q[1];
    });
    orden.forEach(function (k0) { R.push(k0); S.push(ultimo[k0.toLowerCase()]); });
  } else {
    pares.forEach(function (q) { R.push(q[0]); S.push(q[1]); });
  }
  S = S.map(function (x) { return x === '#N/A' ? 0 : x; });   // cualquier #N/A → 0
  return { R: R, S: S };
}

/** [PRECIO -2%, PRECIO CARGA] de un precio final. Vacío → vacío; 0 → 0 (nunca una carga de $9). */
function exCarga_(precio) {
  if (typeof precio !== 'number') return ['', ''];
  if (!(precio > 0)) return [0, 0];
  var t = precio * EX.FACTOR;
  return [Math.round(t * 100) / 100, Math.floor(t / 10) * 10 + 9];
}

/** Filas listas para escribir, en el orden de EX.COLS[tipo]. */
function exFilas_(tipo, t) {
  var filas = [];
  for (var i = 0; i < t.R.length; i++) {
    var s = t.S[i], fila = [t.R[i], (s === undefined || s === null) ? '' : s];
    if (tipo === 'EXPORTAR') fila = fila.concat(exCarga_(s));
    filas.push(fila);
  }
  return filas;
}

/** Filas de una hoja de precios de Site Sheet → [[sku, clasica, premium], …] (sin SKU = no entra; precio ≤ 0 = vacío). */
function exFilasSite_(datos, iSku, iCla, iPre) {
  var out = [];
  for (var r = 0; r < datos.length; r++) {
    var s = String(datos[r][iSku] == null ? '' : datos[r][iSku]).trim();
    if (!s) continue;
    var c = num_(datos[r][iCla]), p = num_(datos[r][iPre]);
    out.push([s, c > 0 ? c : '', p > 0 ? p : '']);
  }
  return out;
}

/**
 * Variaciones tal como las deja el IMPORTRANGE: [[llave, precio]] con precio número o 0 (vacío, #N/A, texto, ≤ 0).
 * Devuelve null si el IMPORTRANGE no está autorizado (#REF!).
 */
function exVariacionesDe_(valores) {
  var out = [];
  for (var i = 0; i < valores.length; i++) {
    var llave = String(valores[i][0] == null ? '' : valores[i][0]).trim();
    if (!llave) continue;
    if (llave.charAt(0) === '#') return null;               // #REF! = falta permitir el acceso
    var p = valores[i][1], precio = 0;
    if (typeof p === 'number') precio = p > 0 ? p : 0;
    else if (p !== '' && p !== null && p !== undefined && String(p).charAt(0) !== '#') { var n = num_(p); precio = n > 0 ? n : 0; }
    out.push([llave, precio]);
  }
  return out;
}

// ── Lecturas ──────────────────────────────────────────────────────────────

/** Una hoja de precios de Site Sheet. Columnas por texto de encabezado; si falta alguna, aborta. */
function exLeerSite_(nombreHoja) {
  var sh = SpreadsheetApp.openById(CFG.SITE_SHEET_ID).getSheetByName(nombreHoja);
  if (!sh) throw new Error('Site Sheet no tiene la hoja "' + nombreHoja + '"');
  var ultFila = sh.getLastRow(), ultCol = sh.getLastColumn();
  if (ultFila < 2) throw new Error('"' + nombreHoja + '" está vacía');
  var m = mapaColumnas_(sh.getRange(1, 1, 1, ultCol).getValues()[0]);
  var iSku = m['SKU'], iCla = m['WALMART CLASICA'], iPre = m['WALMART PREMIUM'];
  var faltan = [];
  if (iSku === undefined) faltan.push('SKU');
  if (iCla === undefined) faltan.push('"Walmart Clásica"');
  if (iPre === undefined) faltan.push('"Walmart Premium"');
  if (faltan.length) throw new Error('En "' + nombreHoja + '" faltan encabezados: ' + faltan.join(', '));
  var datos = sh.getRange(2, 1, ultFila - 1, ultCol).getValues();
  return exFilasSite_(datos, iSku, iCla, iPre);
}

/** EM y debajo CVA para un tipo (EXPORTAR / MINIMO / MAXIMO). Cada hoja debe traer su mínimo de filas o no se escribe nada. */
function exLeerFuente_(tipo) {
  var todo = [];
  EX.SITE[tipo].forEach(function (nombre) {
    var filas = exLeerSite_(nombre);
    if (filas.length < EX.MIN_FILAS_SITE) {
      throw new Error('"' + nombre + '" trae solo ' + filas.length + ' SKUs (mínimo ' + EX.MIN_FILAS_SITE +
                      '). No se escribió nada para no perder precios buenos.');
    }
    todo = todo.concat(filas);
  });
  return todo;
}

/** SKUs del inventario publicado (columna sku del dashboard de Walmart). */
function exLeerInventario_() {
  var sh = SpreadsheetApp.openById(CFG.WM_DASH.ID).getSheetByName(CFG.WM_DASH.HOJA);
  if (!sh) throw new Error('El dashboard de Walmart no tiene la hoja "' + CFG.WM_DASH.HOJA + '"');
  var ultFila = sh.getLastRow(), ultCol = sh.getLastColumn();
  if (ultFila < 2) throw new Error('La hoja "' + CFG.WM_DASH.HOJA + '" del dashboard está vacía');
  var m = mapaColumnas_(sh.getRange(1, 1, 1, ultCol).getValues()[0]);
  var iS = m[norm_('sku')];
  if (iS === undefined) throw new Error('El dashboard no trae la columna sku');
  var col = sh.getRange(2, iS + 1, ultFila - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < col.length; i++) {
    var v = col[i][0];
    if (typeof v === 'number') { out.push(v); continue; }
    v = String(v == null ? '' : v).trim();
    if (v) out.push(v);
  }
  if (out.length < EX.MIN_INVENTARIO) {
    throw new Error('El inventario trae solo ' + out.length + ' SKUs (mínimo ' + EX.MIN_INVENTARIO + '). No se escribió nada.');
  }
  return out;
}

/**
 * Variaciones: se leen de la hoja PRECIOS VARIACIONES de este libro (IMPORTRANGE). Si la hoja no existe
 * se crea con las dos fórmulas; si el acceso todavía no está permitido se usa la última copia buena
 * (Script Properties) y, si tampoco hay, se detiene: sin variaciones se perderían precios manuales.
 */
function exLeerVariaciones_() {
  var ss = libro_();
  var sh = ss.getSheetByName(EX.HOJA.VARIACIONES);
  if (!sh) {
    sh = ss.insertSheet(EX.HOJA.VARIACIONES);
    var url = 'https://docs.google.com/spreadsheets/d/' + EX.VARIACIONES.ID + '/edit';
    sh.getRange('A1').setFormula('=IMPORTRANGE("' + url + '","\'' + EX.VARIACIONES.HOJA + '\'!' + EX.VARIACIONES.RANGO_SKU + '")');
    sh.getRange('B1').setFormula('=IMPORTRANGE("' + url + '","\'' + EX.VARIACIONES.HOJA + '\'!' + EX.VARIACIONES.RANGO_PRECIO + '")');
    SpreadsheetApp.flush();
    logInfo_('EXPORTAR', 'Se creó la hoja "' + EX.HOJA.VARIACIONES + '". Ábrela y da "Permitir acceso" en A1 para que traiga las variaciones.');
  }
  var n = sh.getLastRow();
  var vars = n >= 1 ? exVariacionesDe_(sh.getRange(1, 1, n, 2).getValues()) : [];
  if (vars === null || vars.length === 0) {
    var copia = [];
    try { copia = JSON.parse(prop_(EX.PROP.VARIACIONES) || '[]'); } catch (e) { copia = []; }
    if (!copia.length) {
      throw new Error('"' + EX.HOJA.VARIACIONES + '" no trae datos (¿falta "Permitir acceso" en A1?) y no hay copia anterior. ' +
                      'No se escribió nada para no perder los precios de las variaciones.');
    }
    logWarn_('EXPORTAR', '"' + EX.HOJA.VARIACIONES + '" no respondió; se usa la última copia buena (' + copia.length + ' variaciones)');
    return copia;
  }
  var texto = JSON.stringify(vars);
  if (texto.length < 8500 && texto !== prop_(EX.PROP.VARIACIONES)) setProp_(EX.PROP.VARIACIONES, texto);
  return vars;
}

function exMd5_(texto) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, texto);
  return d.map(function (b) { return ((b + 256) % 256).toString(16); }).join('');
}

// ── Escritura ─────────────────────────────────────────────────────────────

/** ¿Están las tres hojas? */
function exHojasExisten_() {
  var ss = libro_();
  return ['EXPORTAR', 'MINIMO', 'MAXIMO'].every(function (k) { return !!ss.getSheetByName(EX.HOJA[k]); });
}

/** Si la hoja es la copia vieja del libro CAMBIO DE PRECIOS (21 columnas con SKU REALES WALMART), no se escribe encima. */
function exRevisarCopiaVieja_(tipo) {
  var sh = libro_().getSheetByName(EX.HOJA[tipo]);
  if (!sh || sh.getLastColumn() < 2) return;
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (var i = 0; i < h.length; i++) {
    if (norm_(h[i]) === norm_('SKU REALES WALMART')) {
      throw new Error('La hoja "' + EX.HOJA[tipo] + '" es la copia vieja de CAMBIO DE PRECIOS (con todas sus columnas de apoyo). ' +
                      'Bórrala (clic derecho en la pestaña → Eliminar) y vuelve a correr: el script la crea limpia.');
    }
  }
}

/** Escribe una de las tres hojas. Devuelve cuántas filas. */
function exEscribirHoja_(tipo, t) {
  var cols = EX.COLS[tipo];
  var sh = hoja_(EX.HOJA[tipo], cols);
  var filas = exFilas_(tipo, t);
  escribirPorEncabezado_(sh, cols, filas, { clave: 'EX_COLS_' + tipo });
  return filas.length;
}

/**
 * Recalcula y escribe EXPORTAR, MINIMO y MAXIMO.
 * forzar = true (menú): lee todo y reescribe aunque nada haya cambiado.
 * Solo escribe si cambió algo; cualquier lectura rota o sospechosa detiene todo sin tocar las hojas.
 */
function exportarPrecios_(forzar) {
  var t0 = Date.now();
  ['EXPORTAR', 'MINIMO', 'MAXIMO'].forEach(exRevisarCopiaVieja_);
  var inv = exLeerInventario_();
  var vars = exLeerVariaciones_();
  var huella = huellaSiteSheet_();
  var existen = exHojasExisten_();

  // Revisión barata: si ni el inventario, ni las variaciones, ni el aviso de precios de Site Sheet cambiaron
  // (y hace menos de una hora de la última lectura completa), no se vuelven a leer las seis hojas de precios.
  var clave = exMd5_(JSON.stringify([inv, vars])) + '|' + huella;
  var pesada = Number(prop_(EX.PROP.PESADA, '0'));
  if (!forzar && existen && clave === prop_(EX.PROP.CLAVE) && (Date.now() - pesada) < EX.REFRESCO_MS) {
    return { cambio: false, razon: 'sin cambios' };
  }

  var fuentes = {};
  ['EXPORTAR', 'MINIMO', 'MAXIMO'].forEach(function (tipo) { fuentes[tipo] = exLeerFuente_(tipo); });
  var hash = exMd5_(JSON.stringify([inv, vars, fuentes]));
  setProp_(EX.PROP.CLAVE, clave);
  setProp_(EX.PROP.PESADA, String(Date.now()));
  if (!forzar && existen && hash === prop_(EX.PROP.HASH)) return { cambio: false, razon: 'mismos datos' };

  var tablas = {
    EXPORTAR: exArmar_(inv, fuentes.EXPORTAR, vars, true),
    MINIMO:   exArmar_(inv, fuentes.MINIMO,   vars, false),
    MAXIMO:   exArmar_(inv, fuentes.MAXIMO,   vars, false)
  };

  // Guardarraíl: si EXPORTAR se encoge a menos de la mitad de la última vez, algo salió mal.
  var finales = tablas.EXPORTAR.R.length;
  var antes = Number(prop_(EX.PROP.N, '0'));
  if (antes && finales < antes * 0.5) {
    throw new Error('EXPORTAR saldría con ' + finales + ' SKUs contra ' + antes + ' la última vez. No se escribió nada.');
  }

  var res = { cambio: true, finales: {}, sinPrecio: {}, ceros: {} };
  ['EXPORTAR', 'MINIMO', 'MAXIMO'].forEach(function (tipo) {
    exEscribirHoja_(tipo, tablas[tipo]);
    var S = tablas[tipo].S;
    res.finales[tipo] = tablas[tipo].R.length;
    res.sinPrecio[tipo] = S.filter(function (x) { return x === '' || x === null || x === undefined; }).length;
    res.ceros[tipo] = S.filter(function (x) { return x === 0; }).length;
  });
  SpreadsheetApp.flush();

  setProp_(EX.PROP.HASH, hash);
  setProp_(EX.PROP.N, String(finales));
  res.segundos = Math.round((Date.now() - t0) / 100) / 10;
  logOK_('EXPORTAR', 'EXPORTAR ' + res.finales.EXPORTAR + ' · MINIMO ' + res.finales.MINIMO + ' · MAXIMO ' + res.finales.MAXIMO +
         ' SKUs · ' + res.segundos + ' s', { sinPrecio: res.sinPrecio, enCero: res.ceros, inventario: inv.length, variaciones: vars.length });
  return res;
}

/** La llama revisarPreciosAuto en cada revisión. Nunca avisa en pantalla ni tumba la revisión. */
function exportarPreciosAuto_() {
  try {
    exportarPrecios_(false);
    setProp_(EX.PROP.ULTIMO_ERROR, '');
  } catch (e) {
    // El mismo error no se repite en el LOG cada 15 min: una vez por día y por mensaje.
    var marca = hoy_() + '|' + String(e && e.message || e).slice(0, 200);
    if (prop_(EX.PROP.ULTIMO_ERROR) !== marca) {
      setProp_(EX.PROP.ULTIMO_ERROR, marca);
      logError_('EXPORTAR', e);
    }
  }
}

/** Menú: fuerza el recálculo y avisa. */
function exportarPreciosWalmart() {
  var lock = candado_(180000);
  if (!lock) { avisar_('La importación automática está corriendo en este momento y no terminó en 3 minutos.\n\nNo pasa nada: espera a que termine (revisa LOG Ventas) y vuelve a darle.'); return; }
  try {
    var r = exportarPrecios_(true);
    avisar_('EXPORTAR, MINIMO y MAXIMO actualizadas (' + r.segundos + ' s)\n\n' +
            'SKUs:\n  EXPORTAR ' + r.finales.EXPORTAR + '\n  MINIMO ' + r.finales.MINIMO + '\n  MAXIMO ' + r.finales.MAXIMO +
            '\n\nEn 0 (variación sin precio): EXPORTAR ' + r.ceros.EXPORTAR + ' · MINIMO ' + r.ceros.MINIMO + ' · MAXIMO ' + r.ceros.MAXIMO +
            '\nSin precio: EXPORTAR ' + r.sinPrecio.EXPORTAR + ' · MINIMO ' + r.sinPrecio.MINIMO + ' · MAXIMO ' + r.sinPrecio.MAXIMO);
  } catch (e) {
    logError_('EXPORTAR', e);
    avisar_('No se pudo actualizar EXPORTAR, MINIMO y MAXIMO:\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}
