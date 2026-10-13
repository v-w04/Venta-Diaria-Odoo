/**
 * VENTA DIARIA ODOO 2026 — EXPORTAR / MINIMO / MAXIMO
 *
 * Esta es la lógica que vivía en el libro "CAMBIO DE PRECIOS WALMART 2026"
 * (hojas EXPORTAR, MINIMO y MAXIMO, con sus fórmulas FILTER / XLOOKUP / QUERY),
 * ahora hecha por el script y con LOS MISMOS RESULTADOS:
 *
 *   B  SKU WALMART            inventario publicado (hoja Inventario de WM_Inv)
 *   D  SKU ERIK               SKU general con su precio (Site Sheet, EM y debajo CVA)
 *   E  SIN MSI                precio clásica          F  CON MSI   precio premium
 *   H  SKU REALES WALMART     B que coinciden con D (o con sus variantes -2…-9, -MSI…)
 *   J  SKU SIN MSI            B que son D o D-2…-9     K  base sin -2…-9    L  precio clásica
 *   N  SKU TOTAL CON MSI      B que son D-MSI o D-MSI-2…-9
 *                             O  base sin -MSI…        P  precio premium
 *   R  SKU FINALES WALMART    J+L, N+P y PRECIOS VARIACIONES (las variaciones ganan)
 *   S  PRECIO FINAL           el precio de R
 *   T  PRECIO -2%             solo EXPORTAR: S × 0.98   (fórmula tuya, el script no la toca)
 *   U  PRECIO CARGA           solo EXPORTAR: INT(T/10)×10+9 (fórmula tuya, el script no la toca)
 *
 * Lo que de verdad importa: R y S (las tres hojas) y U (EXPORTAR).
 *
 * Diferencias entre las tres, igual que en el libro original:
 *   · EXPORTAR usa los precios NORMALES, sin repetidos (si una llave sale dos veces gana la última,
 *     y las variaciones van al final), y una variación sin precio (#N/A) queda como #N/A.
 *   · MINIMO y MAXIMO usan los precios MÍNIMO y MÁXIMO, dejan todas las filas y un #N/A queda en blanco.
 *
 * De dónde sale cada cosa (ya no hay hojas PRECIOS FINAL FINAL / PRECIOS MINIMO / PRECIOS MAXIMO
 * ni INVENTARIO SCROLL: se leen directo):
 *   · Precios:  Site Sheet → Precios EM|CVA Normal|Minimo|Maximo (columnas por encabezado).
 *   · Inventario: dashboard de Walmart (WM_Inv) → Inventario → columna sku.
 *   · Variaciones: hoja PRECIOS VARIACIONES de este libro (IMPORTRANGE de tu otro libro; la crea el
 *     script y solo hay que darle "Permitir acceso" una vez).
 *
 * Se corre solo dentro de revisarPreciosAuto (cada 15 min) y solo escribe si algo cambió.
 * Menú: 📤 Actualizar EXPORTAR, MINIMO y MAXIMO.
 */

var EX = {
  HOJA: { EXPORTAR: 'EXPORTAR', MINIMO: 'MINIMO', MAXIMO: 'MAXIMO', VARIACIONES: 'PRECIOS VARIACIONES' },
  // Hojas de Site Sheet, EM primero y CVA debajo (si un SKU sale en las dos, gana EM).
  SITE: {
    EXPORTAR: ['Precios EM Normal', 'Precios CVA Normal'],
    MINIMO:   ['Precios EM Minimo', 'Precios CVA Minimo'],
    MAXIMO:   ['Precios EM Maximo', 'Precios CVA Maximo']
  },
  // Libro de variaciones (precios manuales por SKU publicado). Es solo el ID de la hoja, no una credencial.
  VARIACIONES: { ID: '1Uy-SIuVb77xFFGTuAmN6CvbpbWbTU4JXEH7OFNzXrbI', HOJA: 'PRINCIPAL -2', RANGO_SKU: 'C112:C', RANGO_PRECIO: 'J112:J' },
  MIN_FILAS_SITE: 100,        // por hoja: menos que esto es una lectura rota y no se escribe nada
  MIN_INVENTARIO: 100,
  REFRESCO_MS: 3600000,       // aunque nada parezca haber cambiado, se vuelve a leer todo una vez por hora
  PROP: { CLAVE: 'EX_CLAVE', PESADA: 'EX_PESADA', HASH: 'EX_HASH', N: 'EX_N', VARIACIONES: 'EX_VARIACIONES', ULTIMO_ERROR: 'EX_ULTIMO_ERROR' },
  FACTOR_TEXTO: '0.98'        // solo para el texto del aviso; la cuenta vive en la fórmula de la columna T
};

/** Encabezados de las tres hojas, en SUS columnas de siempre (A y los huecos quedan en blanco a propósito). */
var EX_CAB = ['', 'SKU WALMART', '', 'SKU ERIK', 'SIN MSI', 'CON MSI', '', 'SKU REALES WALMART', '',
              'SKU SIN MSI', 'BASE CLASICA', 'PRECIO CLASICA', '', 'SKU TOTAL CON MSI', 'BASE PREMIUM',
              'PRECIO PREMIUM', '', 'SKU FINALES WALMART', 'PRECIO FINAL', 'PRECIO -2%', 'PRECIO CARGA'];

/** Columnas que escribe el script, en el orden de las filas que arma exFilas_. */
var EX_ESCRIBE = ['SKU WALMART', 'SKU ERIK', 'SIN MSI', 'CON MSI', 'SKU REALES WALMART', 'SKU SIN MSI',
                  'BASE CLASICA', 'PRECIO CLASICA', 'SKU TOTAL CON MSI', 'BASE PREMIUM', 'PRECIO PREMIUM',
                  'SKU FINALES WALMART', 'PRECIO FINAL'];

// ── Lógica pura (sin llamadas a Google: se prueba en Node contra el libro viejo) ──────────────

/** ¿La llave (en minúsculas) está en el mapa? */
function exTiene_(mapa, k) { return k in mapa; }

/** XLOOKUP exacto: el valor de la primera aparición, o #N/A si la llave no existe. */
function exBuscar_(mapa, k) { return (k in mapa) ? mapa[k] : '#N/A'; }

/**
 * Arma todas las columnas.
 *   inv      SKUs del inventario (texto; los que sean número no entran a J, N ni H, como en el libro)
 *   precios  [[sku, clasica, premium], …]  EM y debajo CVA, tal cual vienen (puede haber repetidos)
 *   vars     [[llave, precio], …]  precio = número | '' | '#N/A'
 *   esExportar  true = reglas de EXPORTAR (sin repetidos, #N/A se queda); false = MINIMO / MAXIMO
 */
function exArmar_(inv, precios, vars, esExportar) {
  var NA = '#N/A';
  var E = Object.create(null), F = Object.create(null);
  var D = [], Ec = [], Fc = [];
  for (var i = 0; i < precios.length; i++) {
    var s = precios[i][0];
    D.push(s); Ec.push(precios[i][1]); Fc.push(precios[i][2]);
    var k = String(s).toLowerCase();
    if (!(k in E)) { E[k] = precios[i][1]; F[k] = precios[i][2]; }   // XLOOKUP: gana la primera
  }

  var B = [], H = [], J = [], K = [], L = [], N = [], O = [], P = [];
  for (var j = 0; j < inv.length; j++) {
    var b = inv[j];
    if (b === '' || b === null || b === undefined) continue;
    B.push(b);
    if (typeof b === 'number') continue;           // el libro pide NOT(ISNUMBER(B))
    var bl = b.toLowerCase(), m;

    // H · SKU REALES: igual a D, D-msi, D-2…9, D-msi-2…9
    var real = exTiene_(E, bl);
    if (!real && (m = /^(.*)-msi-[2-9]$/.exec(bl)) && exTiene_(E, m[1])) real = true;
    if (!real && (m = /^(.*)-msi$/.exec(bl)) && exTiene_(E, m[1])) real = true;
    if (!real && (m = /^(.*)-[2-9]$/.exec(bl)) && exTiene_(E, m[1])) real = true;
    if (real) H.push(b);

    // J · igual a D o a D-2…9  →  K quita el -2…9  →  L precio clásica
    if (exTiene_(E, bl) || ((m = /^(.*)-[2-9]$/.exec(bl)) && exTiene_(E, m[1]))) {
      var kk = b.replace(/-[2-9]$/, '');
      J.push(b); K.push(kk); L.push(exBuscar_(E, kk.toLowerCase()));
    }
    // N · igual a D-MSI o D-MSI-2…9  →  O quita el -MSI…  →  P precio premium
    if ((m = /^(.*)-msi(?:-[2-9])?$/.exec(bl)) && exTiene_(E, m[1])) {
      var oo = b.replace(/-MSI(?:-[2-9])?$/i, '');
      N.push(b); O.push(oo); P.push(exBuscar_(F, oo.toLowerCase()));
    }
  }

  // R · S: J+L, N+P y las variaciones al final
  var pares = [];
  for (var a = 0; a < J.length; a++) pares.push([J[a], L[a]]);
  for (var c = 0; c < N.length; c++) pares.push([N[c], P[c]]);
  for (var v = 0; v < vars.length; v++) {
    var llave = vars[v][0];
    if (llave === '' || llave === null || llave === undefined) continue;
    pares.push([String(llave), vars[v][1]]);
  }
  var R = [], S = [];
  if (esExportar) {
    var ultimo = Object.create(null), orden = [];
    pares.forEach(function (p) {
      var kl = p[0].toLowerCase();
      if (!(kl in ultimo)) orden.push(p[0]);
      ultimo[kl] = p[1];
    });
    orden.forEach(function (k0) { R.push(k0); S.push(ultimo[k0.toLowerCase()]); });
  } else {
    pares.forEach(function (p) { R.push(p[0]); S.push(p[1] === NA ? '' : p[1]); });
  }
  return { B: B, D: D, E: Ec, F: Fc, H: H, J: J, K: K, L: L, N: N, O: O, P: P, R: R, S: S };
}

/** Celda lista para escribir: un #N/A se escribe como =NA() para que siga siendo error de verdad. */
function exCelda_(v) {
  if (v === '#N/A') return '=NA()';
  return (v === undefined || v === null) ? '' : v;
}

/** Filas en el orden de EX_ESCRIBE. */
function exFilas_(t) {
  var cols = [t.B, t.D, t.E, t.F, t.H, t.J, t.K, t.L, t.N, t.O, t.P, t.R, t.S];
  var n = 0;
  cols.forEach(function (c) { if (c.length > n) n = c.length; });
  var filas = [];
  for (var i = 0; i < n; i++) {
    filas.push(cols.map(function (c) { return i < c.length ? exCelda_(c[i]) : ''; }));
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

/** Variaciones tal como las deja el IMPORTRANGE: [[llave, precio]] con precio número, '' o '#N/A'. Devuelve null si el IMPORTRANGE no está autorizado. */
function exVariacionesDe_(valores) {
  var out = [];
  for (var i = 0; i < valores.length; i++) {
    var llave = String(valores[i][0] == null ? '' : valores[i][0]).trim();
    if (!llave) continue;
    if (llave.charAt(0) === '#') return null;               // #REF! = falta permitir el acceso
    var p = valores[i][1], precio;
    if (typeof p === 'number') precio = p;
    else if (p === '' || p === null || p === undefined) precio = '';
    else if (String(p).charAt(0) === '#') precio = '#N/A';
    else { var n = num_(p); precio = n > 0 ? n : ''; }
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

function exHojasExisten_() {
  var ss = libro_();
  return ['EXPORTAR', 'MINIMO', 'MAXIMO'].every(function (k) { return !!ss.getSheetByName(EX.HOJA[k]); });
}

/**
 * Pone las fórmulas de T y U de EXPORTAR solo si están vacías (son tuyas: si cambias el 0.98 o el
 * redondeo, el script no las pisa). T = S × 0.98 · U = INT(T/10)×10+9.
 */
function exFormulasTU_(sh) {
  var cT = colDe_(sh, 'PRECIO -2%', 1), cU = colDe_(sh, 'PRECIO CARGA', 1), cS = colDe_(sh, 'PRECIO FINAL', 1);
  if (!cT || !cU || !cS) return;
  var lS = letraCol_(cS - 1), lT = letraCol_(cT - 1);
  var t2 = sh.getRange(2, cT), u2 = sh.getRange(2, cU);
  if (t2.getFormula() === '' && t2.getValue() === '') {
    t2.setFormula('=ARRAYFORMULA(IF(' + lS + '2:' + lS + '="","",' + lS + '2:' + lS + '*' + EX.FACTOR_TEXTO + '))');
  }
  if (u2.getFormula() === '' && u2.getValue() === '') {
    u2.setFormula('=ARRAYFORMULA(IF(' + lT + '2:' + lT + '="","",INT(' + lT + '2:' + lT + '/10)*10+9))');
  }
}

/** Escribe una de las tres hojas. Devuelve cuántas filas finales (R·S) y cuántas variaciones sin precio. */
function exEscribirHoja_(tipo, t) {
  var cab = (tipo === 'EXPORTAR') ? EX_CAB : EX_CAB.slice(0, 19);
  var sh = hoja_(EX.HOJA[tipo], cab);
  var filas = exFilas_(t);
  escribirPorEncabezado_(sh, EX_ESCRIBE, filas, { clave: 'EX_COLS_' + tipo });
  if (tipo === 'EXPORTAR') exFormulasTU_(sh);
  return filas.length;
}

/**
 * Recalcula y escribe EXPORTAR, MINIMO y MAXIMO.
 * forzar = true (menú): lee todo y reescribe aunque nada haya cambiado.
 * Solo escribe si cambió algo; cualquier lectura rota o sospechosa detiene todo sin tocar las hojas.
 */
function exportarPrecios_(forzar) {
  var t0 = Date.now();
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

  var res = { cambio: true, finales: {}, sinPrecio: {}, nA: 0 };
  ['EXPORTAR', 'MINIMO', 'MAXIMO'].forEach(function (tipo) {
    exEscribirHoja_(tipo, tablas[tipo]);
    var S = tablas[tipo].S;
    res.finales[tipo] = tablas[tipo].R.length;
    res.sinPrecio[tipo] = S.filter(function (x) { return x === '' || x === null; }).length;
  });
  res.nA = tablas.EXPORTAR.S.filter(function (x) { return x === '#N/A'; }).length;
  SpreadsheetApp.flush();

  setProp_(EX.PROP.HASH, hash);
  setProp_(EX.PROP.N, String(finales));
  res.segundos = Math.round((Date.now() - t0) / 100) / 10;
  logOK_('EXPORTAR', 'EXPORTAR ' + res.finales.EXPORTAR + ' · MINIMO ' + res.finales.MINIMO + ' · MAXIMO ' + res.finales.MAXIMO +
         ' SKUs · ' + res.segundos + ' s', { sinPrecio: res.sinPrecio, variacionesSinPrecio: res.nA, inventario: inv.length, variaciones: vars.length });
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
    avisar_('EXPORTAR, MINIMO y MAXIMO actualizadas\n\n' +
            'SKUs con precio final (R·S):\n  EXPORTAR ' + r.finales.EXPORTAR + '\n  MINIMO ' + r.finales.MINIMO + '\n  MAXIMO ' + r.finales.MAXIMO +
            '\n\nVariaciones sin precio (#N/A en EXPORTAR): ' + r.nA +
            '\nSin precio: EXPORTAR ' + r.sinPrecio.EXPORTAR + ' · MINIMO ' + r.sinPrecio.MINIMO + ' · MAXIMO ' + r.sinPrecio.MAXIMO +
            '\n\nLas columnas T y U de EXPORTAR son tus fórmulas (S × ' + EX.FACTOR_TEXTO + ' y redondeo a 9): el script no las toca.');
  } catch (e) {
    logError_('EXPORTAR', e);
    avisar_('No se pudo actualizar EXPORTAR, MINIMO y MAXIMO:\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}
