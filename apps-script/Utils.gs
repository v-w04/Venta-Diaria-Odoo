/**
 * VENTA DIARIA ODOO 2026 — Utilidades
 * Normalización de SKU, texto, fechas y acceso a hojas.
 */

/**
 * Abre el libro por ID. Nunca getActiveSpreadsheet: los triggers no lo tienen.
 *
 * Google tira de vez en cuando "Se agotó el tiempo de espera del servicio Hojas
 * de cálculo al acceder al documento": es un timeout transitorio de Sheets, no
 * del código. Se reintenta con pausas crecientes para que una corrida (o un
 * trigger) no muera al primer tropiezo.
 */
function libro_() {
  var ultimo;
  for (var i = 0; i < 4; i++) {
    try {
      return SpreadsheetApp.openById(CFG.LIBRO_ID);
    } catch (e) {
      ultimo = e;
      Utilities.sleep(1500 * (i + 1));   // 1.5s, 3s, 4.5s entre intentos
    }
  }
  throw ultimo;
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

/**
 * SKU de CVA publicado en Walmart (-CVA-MSI, -CVA-MSI-3, -CVA-2…) → el SKU general
 * de PRECIOS ERIK, que termina en -CVA (ahí van clásica y premium). Si no es CVA
 * con variante, regresa el mismo SKU.
 */
function skuCvaGeneral_(s) {
  var v = sku_(s);
  return /-CVA-(MSI(-[2-9])?|[2-9])$/.test(v) ? v.replace(/-(MSI(-[2-9])?|[2-9])$/, '') : v;
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

/** Solo el cliente que se llama exactamente WALMART. */
function esWalmart_(cliente) {
  return norm_(cliente) === norm_(CFG.CANAL_WALMART);
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

/** Índice 0-based → letra de columna (0 = A, 25 = Z, 26 = AA). */
function letraCol_(i) {
  var s = '';
  i = Number(i) + 1;
  while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - r - 1) / 26; }
  return s;
}

// ── Columnas por NOMBRE, no por posición ──────────────────────────────────
//
// El problema: si alguien inserta una columna en medio de una hoja, todo el
// código que lee "la columna 7" empieza a leer otra cosa y NO avisa: calcula
// mal en silencio. La solución es no depender nunca de la letra.
//
//   mapaFisico_    →  dónde está HOY cada columna que el código necesita
//   filasOrdenadas_→  lee la hoja y entrega cada fila YA reacomodada al orden
//                     canónico, así el resto del código sigue usando r[0],
//                     r[6]… sin enterarse de que la hoja cambió
//   enOrdenFisico_ →  lo mismo al revés, para ESCRIBIR en su lugar correcto
//
// Si un encabezado no aparece (lo renombraron, o la hoja viene del formato
// viejo sin títulos), se usa la posición canónica como red de seguridad: el
// comportamiento es el de siempre, nunca se rompe. Lo que sí hace es dejar un
// aviso en el LOG (una vez al día por hoja) para que te enteres.

/**
 * Dónde vive hoy cada columna de `encabezados` dentro de `sh`.
 * Devuelve un arreglo: fisico[iCanonico] = columna real (0-based).
 */
function mapaFisico_(sh, encabezados, filaEnc) {
  filaEnc = filaEnc || 1;
  var nc = Math.max(sh.getLastColumn(), encabezados.length, 1);
  var fila;
  try {
    fila = sh.getRange(filaEnc, 1, 1, nc).getValues()[0];
  } catch (e) {
    fila = [];
  }
  var mapa = mapaColumnas_(fila);

  var fisico = [], movidas = [], usadas = {};
  for (var i = 0; i < encabezados.length; i++) {
    var j = mapa[norm_(encabezados[i])];
    // Si el encabezado no está, o su columna ya la ocupó otro, se cae a la
    // posición de siempre: nunca se devuelven dos veces la misma columna.
    if (j === undefined || usadas[j]) {
      fisico.push(i);
      usadas[i] = true;
    } else {
      fisico.push(j);
      usadas[j] = true;
      if (j !== i) movidas.push(encabezados[i] + ': ' + letraCol_(i) + '→' + letraCol_(j));
    }
  }

  // Solo se avisa cuando algo SE MOVIÓ. Un encabezado que falta cae en su
  // posición de siempre — se comporta igual que antes, no hay nada que
  // reportar (p. ej. A1 de PEDIDOS CVA trae tu nota, no el título).
  if (movidas.length) avisarColumnas_(sh.getName(), 'movidas', movidas);
  return fisico;
}

/** Deja UN renglón al día por hoja: avisa sin llenar el LOG de basura. */
function avisarColumnas_(hoja, que, lista) {
  try {
    var llave = 'COLS_AVISO_' + norm_(hoja).replace(/[^A-Z0-9]/g, '_');
    var huella = hoy_() + '|' + que + '|' + lista.join(',');
    if (prop_(llave) === huella) return;
    setProp_(llave, huella);
    logWarn_('COLUMNAS', 'La hoja "' + hoja + '" tiene columnas ' + que +
             ' (el código se adaptó solo)', { columnas: lista });
  } catch (e) { /* avisar nunca debe tirar la corrida */ }
}

/**
 * Lee los datos de una hoja y devuelve cada fila REACOMODADA al orden de
 * `encabezados`, sin importar en qué columna estén hoy.
 * Así `f[6]` sigue siendo el SKU aunque el SKU se haya movido a la K.
 */
function filasOrdenadas_(sh, encabezados, desdeFila, filaEnc) {
  desdeFila = desdeFila || 2;
  if (!sh) return [];
  var ultima = ultimaFilaColA_(sh);
  if (ultima < desdeFila) return [];

  var fisico = mapaFisico_(sh, encabezados, filaEnc);
  var ancho = Math.max(sh.getLastColumn(), 1);
  var crudas = sh.getRange(desdeFila, 1, ultima - desdeFila + 1, ancho).getValues();
  return crudas.map(function (f) {
    return fisico.map(function (c) { return (c < f.length) ? f[c] : ''; });
  });
}

/**
 * Lo contrario: toma filas en orden canónico y las devuelve acomodadas a las
 * columnas reales de la hoja, para escribirlas donde van.
 */
function enOrdenFisico_(sh, encabezados, filas) {
  if (!filas || !filas.length) return filas || [];
  var fisico = mapaFisico_(sh, encabezados);
  var ancho = 0;
  fisico.forEach(function (c) { if (c + 1 > ancho) ancho = c + 1; });
  if (sh.getLastColumn() > ancho) ancho = sh.getLastColumn();

  return filas.map(function (f) {
    var out = new Array(ancho);
    for (var k = 0; k < ancho; k++) out[k] = '';
    for (var i = 0; i < fisico.length && i < f.length; i++) out[fisico[i]] = f[i];
    return out;
  });
}

/**
 * Set de IDs de línea de una hoja. La columna del ID se ubica por su
 * encabezado ("ID Línea"); si no aparece, se usa la A como siempre.
 */
function idsDeHoja_(sh, encabezados) {
  var set = {};
  var n = sh.getLastRow();
  if (n < 2) return set;
  var col = 1;
  if (encabezados && encabezados.length) {
    col = mapaFisico_(sh, encabezados)[0] + 1;
  }
  var vals = sh.getRange(2, col, n - 1, 1).getValues();
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
  var colId = mapaFisico_(sh, encabezados)[0] + 1;
  var ya = idsDeHoja_(sh, encabezados);
  var nuevas = filas.filter(function (f) { return !ya[String(Number(f[0]) || f[0])]; });
  if (!nuevas.length) return [];
  // Se escriben en la columna que les toque HOY, no en A–L a ciegas.
  agregarFilas_(sh, enOrdenFisico_(sh, encabezados, nuevas), colId);
  return nuevas;
}

/**
 * Última fila con dato en la columna A. getLastRow() cuenta también lo que
 * derrama una fórmula en otra columna (el ARRAYFORMULA de N en Órdenes de
 * venta), y con eso las filas nuevas caían miles de renglones abajo.
 */
function ultimaFilaColA_(sh, col) {
  var n = sh.getLastRow();
  if (n < 1) return 0;
  var vals = sh.getRange(1, col || 1, n, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (vals[i][0] !== '' && vals[i][0] !== null) return i + 1;
  }
  return 0;
}

/**
 * Agrega filas al final (después del último dato de la columna ancla, que es
 * la A salvo que se indique otra). `filas` ya debe venir en orden físico.
 */
function agregarFilas_(sh, filas, colAncla) {
  if (!filas || !filas.length) return;
  var inicio = Math.max(ultimaFilaColA_(sh, colAncla) + 1, 2);
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
