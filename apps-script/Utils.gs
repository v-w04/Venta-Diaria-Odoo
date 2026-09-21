/**
 * VENTA DIARIA ODOO 2026 — Utilidades
 * Normalización de SKU, texto, fechas y acceso a hojas.
 */

/** Abre el libro por ID. Nunca getActiveSpreadsheet: los triggers no lo tienen. */
function libro_() {
  return SpreadsheetApp.openById(CFG.LIBRO_ID);
}

/**
 * Devuelve la hoja; la crea si no existe.
 * - Hoja nueva: cuadrícula chica y encabezado completo.
 * - Hoja existente: solo llena las celdas de encabezado que estén VACÍAS.
 *   Nunca pisa un encabezado que ya tengas.
 * NO impone formato (colores, congelados, anchos): eso es tuyo.
 */
function hoja_(nombre, encabezados) {
  var ss = libro_();
  var sh = ss.getSheetByName(nombre);
  var n = (encabezados && encabezados.length) || 0;

  if (!sh) {
    sh = ss.insertSheet(nombre);
    var cols = Math.max(n, 1);
    if (sh.getMaxColumns() > cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
    if (sh.getMaxRows() > 1000) sh.deleteRows(1001, sh.getMaxRows() - 1000);
  }

  if (n) {
    if (sh.getMaxColumns() < n) {
      sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
    }
    var actual = sh.getRange(1, 1, 1, n).getValues()[0];
    var cambio = false;
    for (var i = 0; i < n; i++) {
      if (actual[i] === '' || actual[i] === null) { actual[i] = encabezados[i]; cambio = true; }
    }
    if (cambio) sh.getRange(1, 1, 1, n).setValues([actual]);
  }
  return sh;
}

/** Texto sin acentos, sin dobles espacios, en mayúsculas. */
function norm_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function sku_(s) {
  return String(s == null ? '' : s).trim().toUpperCase();
}

/**
 * SKU base: quita sufijos de variante para heredar del padre.
 * Quita -OB, -CVA y -MSI / -MSI-2..9 / -2..9 (el regex de Concentrado).
 */
function skuBase_(s) {
  var v = sku_(s);
  v = v.replace(/-OB$/, '');
  v = v.replace(/-(MSI(-[2-9])?|[2-9])$/, '');
  v = v.replace(/-CVA$/, '');
  v = v.replace(/-(MSI(-[2-9])?|[2-9])$/, '');
  return v;
}

/**
 * SKU "sin -2": quita solo -2..9 y -MSI-2..9 → -MSI.
 * Es la forma en que viene la lista de cupones (columna P de PRECIOS ERIK).
 */
function skuSinVariante_(s) {
  return sku_(s).replace(/-MSI-[2-9]$/, '-MSI').replace(/-[2-9]$/, '');
}

/** PREMIUM si termina en -MSI o -MSI-2..9. OPEN BOX si termina en -OB. */
function tipoPublicacion_(s) {
  var v = sku_(s);
  if (/-OB$/.test(v)) return 'OPEN BOX';
  if (/-MSI(-[2-9])?$/.test(v)) return 'PREMIUM';
  return 'CLASICA';
}

function esCVA_(s) {
  return sku_(s).indexOf(CFG.SUFIJO_CVA) >= 0;
}

/** Walmart se detecta con "contiene", igual que el código anterior. */
function esWalmart_(cliente) {
  return norm_(cliente).indexOf(norm_(CFG.CANAL_WALMART)) >= 0;
}

function skuIgnorado_(s) {
  var v = sku_(s);
  for (var i = 0; i < CFG.PREFIJOS_IGNORADOS.length; i++) {
    if (v.indexOf(CFG.PREFIJOS_IGNORADOS[i]) === 0) return true;
  }
  return false;
}

function esVentaComercial_(cliente, precio) {
  var c = norm_(cliente);
  for (var i = 0; i < CFG.CLIENTES_NO_COMERCIALES.length; i++) {
    if (c === norm_(CFG.CLIENTES_NO_COMERCIALES[i])) return false;
  }
  return Number(precio) >= CFG.PRECIO_MINIMO_COMERCIAL;
}

function num_(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Odoo manda las fechas en UTC como "2026-09-14 06:29:00".
 * Se le pega la Z para que se interprete como UTC. El código anterior hacía
 * new Date("2026-09-14 06:29:00") y eso puede leerse como hora local.
 */
function fecha_(d) {
  if (!d) return '';
  if (d instanceof Date) return d;
  var dt = new Date(String(d).replace(' ', 'T') + 'Z');
  return isNaN(dt.getTime()) ? String(d) : dt;
}

function ahora_() {
  return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm:ss');
}

function hoy_() {
  return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
}

/** Busca columnas por el TEXTO del encabezado. {NOMBRE_NORMALIZADO: índice0} */
function mapaColumnas_(filaEncabezado) {
  var m = {};
  for (var i = 0; i < filaEncabezado.length; i++) {
    var k = norm_(filaEncabezado[i]);
    if (k && m[k] === undefined) m[k] = i;
  }
  return m;
}

/** Set de IDs de línea (columna A) de una hoja. */
function idsDeHoja_(sh) {
  var set = {};
  var n = sh.getLastRow();
  if (n < 2) return set;
  var vals = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (v !== '' && v !== null) set[String(Number(v) || v)] = true;
  }
  return set;
}

/**
 * Agrega al final SOLO las filas cuyo ID Línea (columna A) no esté ya en la
 * hoja. Cada hoja se deduplica contra sí misma: así no se duplica nada que
 * el código anterior ya hubiera repartido.
 * Devuelve las filas que sí se escribieron.
 */
function agregarSinDuplicar_(nombreHoja, encabezados, filas) {
  if (!filas || !filas.length) return [];
  var sh = hoja_(nombreHoja, encabezados);
  var ya = idsDeHoja_(sh);
  var nuevas = filas.filter(function (f) { return !ya[String(Number(f[0]) || f[0])]; });
  if (!nuevas.length) return [];
  agregarFilas_(sh, nuevas);
  return nuevas;
}

/** Agrega filas al final en una sola escritura. */
function agregarFilas_(sh, filas) {
  if (!filas || !filas.length) return;
  var inicio = Math.max(sh.getLastRow() + 1, 2);
  var necesarias = inicio + filas.length - 1;
  if (sh.getMaxRows() < necesarias) {
    sh.insertRowsAfter(sh.getMaxRows(), necesarias - sh.getMaxRows() + 100);
  }
  var cols = filas[0].length;
  if (sh.getMaxColumns() < cols) {
    sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  }
  sh.getRange(inicio, 1, filas.length, cols).setValues(filas);
}

/** Cuenta las celdas de todo el libro (filas × columnas de cada hoja). */
function celdasDelLibro_() {
  var hojas = libro_().getSheets();
  var total = 0, detalle = [];
  for (var i = 0; i < hojas.length; i++) {
    var sh = hojas[i];
    var c = sh.getMaxRows() * sh.getMaxColumns();
    total += c;
    detalle.push({
      nombre: sh.getName(), celdas: c,
      filas: sh.getMaxRows(), cols: sh.getMaxColumns(),
      conDatos: sh.getLastRow(), oculta: sh.isSheetHidden()
    });
  }
  return { total: total, hojas: detalle };
}

/** Candado. Devuelve null si ya hay otra corrida. */
function candado_(ms) {
  var lock = LockService.getScriptLock();
  try {
    return lock.tryLock(ms || 30000) ? lock : null;
  } catch (e) {
    return null;
  }
}

function esErrorDeCuota_(msg) {
  var m = String(msg || '').toLowerCase();
  return m.indexOf('too many times') >= 0
      || m.indexOf('demasiadas veces') >= 0
      || (m.indexOf('quota') >= 0 && m.indexOf('exceed') >= 0);
}

function esErrorDeCeldas_(msg) {
  var m = String(msg || '').toLowerCase();
  return m.indexOf('10000000') >= 0
      || m.indexOf('10,000,000') >= 0
      || (m.indexOf('celdas') >= 0 && m.indexOf('limite') >= 0)
      || (m.indexOf('cells') >= 0 && m.indexOf('limit') >= 0);
}

/** Toast o alerta sin tronar cuando corre desde un trigger (sin UI). */
function avisar_(texto) {
  try { SpreadsheetApp.getUi().alert(texto); }
  catch (e) { console.log(texto); }
}
