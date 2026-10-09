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
    // Solo se llena un encabezado VACÍO si ese nombre no existe ya en otra columna
    // (si moviste o insertaste columnas, no se duplica ni se pisa lo tuyo).
    var yaEstan = {};
    sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), n)).getValues()[0].forEach(function (x) { var k = norm_(x); if (k) yaEstan[k] = true; });
    for (var i = 0; i < n; i++) {
      if ((actual[i] === '' || actual[i] === null) && !yaEstan[norm_(encabezados[i])]) { actual[i] = encabezados[i]; cambio = true; }
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
  var fisico = mapaFisico_(sh, encabezados, filaEnc);
  var ultima = ultimaFilaColA_(sh, fisico[0] + 1);   // la primera columna del script, donde esté hoy
  if (ultima < desdeFila) return [];

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
    for (var k = 0; k < ancho; k++) out[k] = null;   // null = columna que no es del script: no se escribe
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
  // Solo se escriben las columnas del script (las null son tuyas: fórmulas, validaciones, lo que agregues).
  var propias = [];
  for (var c = 0; c < cols; c++) {
    for (var q = 0; q < filas.length; q++) { if (filas[q][c] !== null && filas[q][c] !== undefined) { propias.push(c); break; } }
  }
  var i0 = 0;
  while (i0 < propias.length) {
    var i1 = i0;
    while (i1 + 1 < propias.length && propias[i1 + 1] === propias[i1] + 1) i1++;
    var c0 = propias[i0], c1 = propias[i1];
    sh.getRange(inicio, c0 + 1, filas.length, c1 - c0 + 1).setValues(filas.map(function (f) {
      return f.slice(c0, c1 + 1).map(function (v) { return v === null || v === undefined ? '' : v; });
    }));
    i0 = i1 + 1;
  }
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

// ── Escritura por ENCABEZADO (hojas que el script llena) ───────────────────
/*
 * Regla de Luis: puede agregar, mover o borrar columnas, y poner formatos, validaciones y
 * formatos condicionales propios SIN que el script lo rompa ni lo borre en la siguiente corrida.
 * Por eso las hojas de salida se escriben con escribirPorEncabezado_:
 *   · cada columna del script se ubica por el NOMBRE de su encabezado (donde esté);
 *   · si falta, se crea AL FINAL de los encabezados existentes (nunca en medio);
 *   · solo se limpia y se escribe el VALOR de las columnas del script: nunca clear(), clearFormat(),
 *     deleteColumns() ni se tocan columnas, formatos, validaciones o reglas condicionales ajenas;
 *   · las fórmulas que apuntan a otra columna usan refCol_('ENCABEZADO', fila) y se resuelven a la letra real.
 */

/** Marca para una fórmula: referencia a la columna con ese encabezado, en esa fila. */
function refCol_(encabezado, fila) { return '\u0001' + encabezado + '\u0002' + fila; }

/** Número de columna (1-based) de un encabezado en la fila indicada; 0 si no está. */
function colDe_(sh, encabezado, filaEnc) {
  var nc = sh.getLastColumn();
  if (nc < 1) return 0;
  var h = sh.getRange(filaEnc || 1, 1, 1, nc).getValues()[0], k = norm_(encabezado);
  for (var i = 0; i < h.length; i++) { if (norm_(h[i]) === k) return i + 1; }
  return 0;
}

/**
 * Escribe `filas` (cada una en el orden de `enc`) en `sh` ubicando las columnas por encabezado.
 * opts: { filaEnc: 1, clave: 'texto' }  clave = Script Property donde se recuerdan los encabezados que
 * escribió el script, para limpiar una columna que ya no se genera (no deja datos viejos regados).
 * Devuelve { col: {ENCABEZADO NORMALIZADO: nº de columna}, pos: [nº por cada enc], filaDatos: n }.
 */
function escribirPorEncabezado_(sh, enc, filas, opts) {
  opts = opts || {};
  // Encabezados vacíos o repetidos (copias del site) reciben un nombre único para no encimarse.
  var vistos = {};
  enc = enc.map(function (h, i) {
    var t = String(h == null ? '' : h).trim() || ('COLUMNA ' + (i + 1)), k = norm_(t);
    if (vistos[k]) { vistos[k]++; t = t + ' (' + vistos[k] + ')'; } else vistos[k] = 1;
    return t;
  });
  var fe = opts.filaEnc || 1, ini = fe + 1;
  var nc = Math.max(sh.getLastColumn(), 1);
  var hdr = sh.getRange(fe, 1, 1, nc).getValues()[0];
  var mapa = {}, fin = 0;
  for (var i = 0; i < hdr.length; i++) {
    var k = norm_(hdr[i]);
    if (k) { if (mapa[k] === undefined) mapa[k] = i + 1; fin = i + 1; }
  }
  var pos = [], nuevas = [];
  enc.forEach(function (h) {
    var k = norm_(h);
    if (mapa[k] === undefined) { fin++; mapa[k] = fin; nuevas.push([fin, h]); }
    pos.push(mapa[k]);
  });
  if (sh.getMaxColumns() < fin) sh.insertColumnsAfter(sh.getMaxColumns(), fin - sh.getMaxColumns());
  nuevas.forEach(function (x) { sh.getRange(fe, x[0]).setValue(x[1]).setFontWeight('bold'); });

  // Columnas que el script escribía antes y ya no genera: se vacían (no se borran).
  var sobrantes = [];
  if (opts.clave) {
    var antes = [];
    try { antes = JSON.parse(prop_(opts.clave) || '[]'); } catch (e) { antes = []; }
    var ahoraK = enc.map(norm_);
    antes.forEach(function (k) { if (ahoraK.indexOf(k) < 0 && mapa[k] !== undefined) sobrantes.push(mapa[k]); });
    setProp_(opts.clave, JSON.stringify(ahoraK));
  }

  var n0 = Math.max(sh.getLastRow(), fe), nf = filas.length;
  var tope = Math.max(n0, fe + nf);
  if (sh.getMaxRows() < tope) sh.insertRowsAfter(sh.getMaxRows(), tope - sh.getMaxRows());

  // Tramos de columnas contiguas del script (normalmente uno solo).
  var orden = pos.map(function (c, j) { return { c: c, j: j }; }).sort(function (a, b) { return a.c - b.c; });
  var tramos = [], t = null;
  orden.forEach(function (o) {
    if (t && o.c === t.fin + 1) { t.fin = o.c; t.js.push(o.j); }
    else { t = { ini: o.c, fin: o.c, js: [o.j] }; tramos.push(t); }
  });
  var letra = function (h) {
    var c = mapa[norm_(h)];
    if (!c) throw new Error('escribirPorEncabezado_: no hay columna "' + h + '" para armar una fórmula');
    return letraCol_(c - 1);
  };
  var resolver = function (v) {
    if (typeof v === 'string' && v.charAt(0) === '=' && v.indexOf('\u0001') >= 0) {
      return v.replace(/\u0001([^\u0002]*)\u0002/g, function (m, h) { return letra(h); });
    }
    return v;
  };
  if (n0 >= ini) {
    sobrantes.forEach(function (c) { sh.getRange(ini, c, n0 - ini + 1, 1).clearContent(); });
    tramos.forEach(function (tr) { sh.getRange(ini, tr.ini, n0 - ini + 1, tr.fin - tr.ini + 1).clearContent(); });
  }
  if (nf) {
    tramos.forEach(function (tr) {
      var datos = filas.map(function (f) { return tr.js.map(function (j) { return resolver(f[j]); }); });
      sh.getRange(ini, tr.ini, nf, tr.fin - tr.ini + 1).setValues(datos);
    });
  }
  return { col: mapa, pos: pos, filaDatos: ini };
}

/**
 * Formato de número "suave": solo se pone el formato por defecto en las celdas que están en General (o
 * en `comoGeneral`, formatos viejos del script). Lo que ya tenga otro formato —el tuyo— no se toca; si la
 * primera celda tiene un formato tuyo, ese mismo se extiende a las celdas en General (renglones nuevos).
 * Devuelve cuántos tramos escribió.
 */
function formatoSuave_(sh, col, ini, n, porDefecto, comoGeneral) {
  if (!col || !(n > 0)) return 0;
  var fs = sh.getRange(ini, col, n, 1).getNumberFormats();
  var libre = function (f) { return f === 'General' || f === '' || (comoGeneral && comoGeneral.indexOf(f) >= 0); };
  var plantilla = libre(fs[0][0]) ? porDefecto : fs[0][0];
  if (!plantilla || plantilla === 'General') return 0;
  var tramos = 0, i = 0;
  while (i < n) {
    if (libre(fs[i][0]) && fs[i][0] !== plantilla) {
      var j = i;
      while (j + 1 < n && libre(fs[j + 1][0]) && fs[j + 1][0] !== plantilla) j++;
      sh.getRange(ini + i, col, j - i + 1, 1).setNumberFormat(plantilla);
      tramos++;
      i = j + 1;
    } else { i++; }
  }
  return tramos;
}

/** Formato de una columna del script (por encabezado) sin pisar el tuyo: ver formatoSuave_. */
function formatoColumna_(sh, map, encabezado, n, porDefecto, filaDatos) {
  var c = map.col[norm_(encabezado)];
  if (!c || !(n > 0)) return;
  formatoSuave_(sh, c, filaDatos || map.filaDatos || 2, n, porDefecto);
}

/**
 * Lee las filas de datos de una hoja que tú llenas y devuelve cada fila con SOLO las columnas pedidas, en
 * el orden de `enc`, ubicadas por encabezado (donde estén; puedes moverlas, insertar otras o cambiar el orden).
 * Si un encabezado no aparece pero la columna de su posición original no es de otro encabezado pedido, se usa
 * esa (compatibilidad con hojas viejas o con un título que cambiaste). Si no, queda ''.
 */
function leerPorEncabezado_(sh, enc, filaEnc) {
  var fe = filaEnc || 1, n = sh.getLastRow(), nc = sh.getLastColumn();
  if (n <= fe || nc < 1) return [];
  var datos = sh.getRange(fe, 1, n - fe + 1, nc).getValues();
  var m = mapaColumnas_(datos[0]);
  var idx = enc.map(function (h) { var j = m[norm_(h)]; return j === undefined ? -1 : j; });
  var tomadas = {};
  idx.forEach(function (j) { if (j >= 0) tomadas[j] = true; });
  var todos = idx.every(function (j) { return j < 0; });
  idx = idx.map(function (j, i) {
    if (j >= 0) return j;
    return (todos || (i < nc && !tomadas[i] && !String(datos[0][i] || '').trim())) ? i : -1;
  });
  return datos.slice(1).map(function (r) { return idx.map(function (j) { return j < 0 ? '' : r[j]; }); });
}
