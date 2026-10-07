/**
 * VENTA DIARIA ODOO 2026 — Killers de Walmart
 *
 * Reemplaza el archivo "Walmart Killers" (Archivo descargado → mes → Activos).
 *
 *   (desde 05/10/2026) Los killers se LEEN de la hoja "Killers" de Site Sheet
 *                      (KillersSite.gs) y entran solos a KILLERS HISTORICO.
 *                      Pegar a mano ya no hace falta; lo de abajo queda de respaldo.
 *   KILLERS PEGAR      (respaldo) pegas lo que baja Table Capture del seller
 *                      center (con o sin encabezados).
 *   KILLERS KAM        killers que te dan por correo/WhatsApp y no salen en
 *                      el seller center.
 *   KILLERS HISTORICO  TODO killer que ha existido. Cada pegado es una CARGA
 *                      del mes: "SEPTIEMBRE 2026-1", "-2", "-3"…
 *   KILLERS ACTIVOS    lo que aplica HOY por SKU. De aquí bajas el archivo
 *                      para subir precios a Walmart.
 *   COMISIONES         comisión normal por categoría (para detectar promos).
 *
 * ── Cómo decide qué killer aplica ────────────────────────────────────────
 *   · Un mismo SKU puede venir varias veces con distintas fechas, en el
 *     mismo pegado o en pegados distintos. Todo se guarda, sin repetir.
 *   · Cada renglón del histórico sabe en qué carga apareció por primera vez
 *     y en cuál se vio por última vez.
 *   · La última carga es la foto oficial (la del site, o la del último pegado
 *     a mano): un SKU que ya no viene en ella, deja de estar en ACTIVOS.
 *   · Para cada SKU de la foto (y los de KAM):
 *       1) el rango que cubre HOY; si hay varios, gana la carga más nueva
 *          y, empatando, el que empezó más tarde
 *       2) si ninguno cubre hoy, el próximo que va a empezar (POR INICIAR)
 *       3) si todos vencieron, no entra a ACTIVOS
 *   · Para validar una VENTA se usa la fecha de la venta contra todos los
 *     rangos del histórico: así se sabe qué killer tenía ese día.
 */

var K_PEGAR = 'KILLERS PEGAR';
var K_KAM   = 'KILLERS KAM';
var K_ACT   = 'KILLERS ACTIVOS';
var K_HIST  = 'KILLERS HISTORICO';
var K_COM   = 'COMISIONES';
var K_EXC   = 'EXCEPCIONES CATEGORIA';   // SKU publicados en la categoría equivocada en Walmart
var ENC_K_EXC = ['SKU', 'CATEGORIA CORRECTA', 'NOTA'];
var K_PROMO = 'PROMOCIONES';   // hoja vieja: se quita una vez

var MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO',
             'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

// DESCUENTO %: si no te dieron precio sino "7% abajo del mínimo" (como la hoja
// de Fotografía), deja PRECIO NEGOCIADO vacío y pon aquí 7%. El precio sale
// del mínimo de PRECIOS ERIK, redondeado a terminar en 9.
var ENC_K_KAM = ['SKU', 'PRECIO NEGOCIADO', 'CUPON', 'INICIO', 'FIN',
                 'COMISION CUPON', 'CATEGORIA', 'NOTA', 'DESCUENTO %'];

// Histórico: índices fijos (0-based) para no depender de letras sueltas
var ENC_K_HIST = ['CARGA', 'CARGA #', 'VISTO EN CARGA #', 'SKU', 'SKU GENERAL',
                  'DETALLES', 'PRECIO ACTUAL', 'PRECIO NEGOCIADO', 'CUPON',
                  'RECIBIMOS', 'INICIO', 'FIN', 'FIN UTC', 'COMISION CUPON',
                  'OFERTA MSI', 'COMISION MSI', 'SOLO WFS', 'DESC DEVOLUCION',
                  'DISPONIBILIDAD', 'OBSERVACIONES', 'ORIGEN', 'CATEGORIA',
                  'REGISTRADO'];
var KH = { CARGA: 0, NCARGA: 1, VISTO: 2, SKU: 3, GEN: 4, DET: 5, ACTUAL: 6,
           NEGOC: 7, CUPON: 8, RECIB: 9, INI: 10, FIN: 11, FINUTC: 12,
           COMCUP: 13, MSI: 14, COMMSI: 15, WFS: 16, DEVOL: 17, DISP: 18,
           OBS: 19, ORIGEN: 20, CAT: 21, REG: 22 };

/*
 * KILLERS ACTIVOS: A–T exactamente como tu hoja "Activos" del archivo
 * Walmart Killers (misma letra, mismo nombre). Donde había fórmula, va
 * fórmula (por renglón):
 *   C PRECIO  = mínimo de PRECIOS ERIK (premium → columna D) con la llave de V
 *   F PAGAN   = D + E
 *   G %       = F / C   (la vieja F/C*0.001 estaba mal)
 *   H Carga   = D       (el precio que subes)
 *   K Fecha formato = J + 6 h
 * U en adelante: lo que agrega el script para decidir (no estorba al subir).
 */
var ENC_K_ACT = ['SKU', 'Detalles del artículo', 'PRECIO', 'Precio negociado',
                 'Cupón de oferta', 'PAGAN', '%', 'Carga', 'Inicio de la oferta',
                 'Finalización de la oferta', 'Fecha formato',
                 'Comisión sobre el cupón killer', 'Oferta con venta a MSI',
                 'Comisión MSI', 'Válida sólo WFS', 'Descuento de killer por devolución',
                 'Disponibilidad', 'Observaciones', 'VALIDACIÓN', 'KAM',
                 // ── del script ──
                 'SKU GENERAL', 'SKU PRECIO', 'COMISION NORMAL', 'PROMOCION (PUNTOS)',
                 'ORIGEN', 'ESTADO', 'CARGA KILLER', 'OTROS RANGOS'];
var KA = { SKU: 0, CAT: 19 };   // T "KAM" = categoría

var ENC_K_COM = ['CATEGORIA', 'COMISION', 'OTROS NOMBRES', 'PROMO CATEGORIA (puntos)', 'MARCAS (prefijo SKU)',
                 'YA APLICADA EN EL SITE', 'PROMO SOLO EN KILLERS'];
// PROMO SOLO EN KILLERS: SI = la promo de la categoría solo vale para los
// killers que da el KAM directo (ej. Videojuegos). No genera renglones de
// promoción en KILLERS ACTIVOS ni se descuenta extra al validar ventas.
// PROMO CATEGORIA (puntos): cuando el KAM baja la comisión a TODA una
// categoría (ej. Cámaras y Lentes 7 → 10% pasa a 3%). Con eso, todos los SKUs
// de esa categoría con stock (del dashboard WM_Inv) entran a KILLERS ACTIVOS.
// Vacío = sin promoción. MARCAS: prefijos de SKU que también cuentan como de
// esa categoría aunque Walmart los tenga en otro departamento (DJI, CAN…).
// YA APLICADA EN EL SITE — OJO, cambió el 02/10/2026:
// El site (Ofertas Especiales → Promociones) SIEMPRE rehace el precio con la
// comisión final, así que el MÍNIMO que baja a PRECIOS ERIK ya viene rebajado.
// Comprobado: CAN-EOS2000D-NEG-1842 da 8,049/8,449 en el site y 8,049/8,449 en
// PRECIOS ERIK. Por eso ahora el valor por omisión es "ya aplicada":
//   vacío o SI = el mínimo del site ya trae la rebaja → Carga = mínimo tal cual,
//                y las ventas NO se revalidan contra una rebaja extra.
//   NO (escrito a mano) = el mínimo viene SIN rebaja → se recalcula aquí:
//                INT((mín − mín×puntos%)/10)*10+9.
// Antes era al revés y provocaba doble descuento en las categorías con promo.

// Lo que MSI le suma a la comisión normal. Se deduce de los killers pegados
// (Comisión MSI − Comisión sobre el cupón); este es el respaldo.
var MSI_EXTRA_DEF = 0.045;

// Comisión fija de Walmart por categoría (la que nos pasaste).
// OTROS NOMBRES: como la escribes tú en la columna KAM de ACTIVOS / en KAM,
// separados por coma. Si una categoría tuya no casa, agrégala ahí.
var COMISIONES_INICIALES = [
  ['Accesorios', 0.15, '', ''],
  ['Alimentos', 0.15, '', ''],
  ['Audio y Amplificadores', 0.10, 'AUDIO', ''],
  ['Automotriz', 0.12, '', ''],
  ['Cables', 0.15, '', ''],
  ['Calzado', 0.15, '', ''],
  ['Camaras y Lentes', 0.10, 'FOTOGRAFIA, CAMARAS', ''],
  ['Celulares', 0.10, 'TELEFONIA', ''],
  ['Cocina y Hogar', 0.15, 'HOGAR, COCINA', ''],
  ['Computadoras', 0.10, 'COMPUTO, LAPTOPS', ''],
  ['Deportes', 0.15, '', ''],
  ['Electrodomesticos', 0.15, '', ''],
  ['Electricas', 0.15, 'FERRETERIA', ''],   // 15%: sale de los killers (cupón 15% · MSI 19.5%)
  ['Hardware', 0.15, '', ''],
  ['Herramientas', 0.12, '', ''],
  ['Iluminacion', 0.15, '', ''],
  ['Impresoras y Escaneres', 0.10, 'IMPRESORAS', ''],
  ['Joyeria', 0.20, '', ''],
  ['Juguetes', 0.15, '', ''],
  ['Lentes de Armazon', 0.15, '', ''],
  ['Mascotas', 0.15, '', ''],
  ['Perfumes', 0.15, '', ''],
  ['Proyectores', 0.10, '', ''],
  ['Relojes', 0.15, '', ''],
  ['Salud y Belleza', 0.15, '', ''],
  ['Tablets', 0.10, '', ''],
  ['TV y Video', 0.10, 'TV, PANTALLAS', ''],
  ['Videojuegos', 0.10, '', '']
];

// Encabezados de Table Capture (columnas del seller center)
var TC = {
  DETALLES: ['DETALLES DEL ARTICULO'],
  ACTUAL:   ['PRECIO ACTUAL'],
  NEGOC:    ['PRECIO NEGOCIADO'],
  CUPON:    ['CUPON DE OFERTA'],
  INICIO:   ['INICIO DE LA OFERTA'],
  FIN:      ['FINALIZACION DE LA OFERTA'],
  COMCUP:   ['COMISION SOBRE EL CUPON KILLER'],
  MSI:      ['OFERTA CON VENTA A MSI'],
  COMMSI:   ['COMISION MSI'],
  WFS:      ['VALIDA SOLO WFS'],
  DEVOL:    ['DESCUENTO DE KILLER POR DEVOLUCION'],
  DISP:     ['DISPONIBILIDAD'],
  OBS:      ['OBSERVACIONES']
};
// Sin encabezados: orden en que llega de Table Capture
var TC_ORDEN = ['DETALLES', 'ACTUAL', 'NEGOC', 'CUPON', 'INICIO', 'FIN',
                'COMCUP', 'MSI', 'COMMSI', 'WFS', 'DEVOL', 'DISP', 'OBS'];

// ── Utilidades ────────────────────────────────────────────────────────────

/** SKU dentro de "Detalles del artículo": "... SKU : XXX-YYY-MSI Detalles ..." */
function extraerSkuKiller_(texto) {
  var m = String(texto || '').match(/SKU\s*:\s*([A-Za-z0-9\-\/\.]+)/i);
  return m ? sku_(m[1]) : '';
}

/** Porcentaje: 0.1, "10%", "10" → 0.10 */
function pct_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  var s = String(v).replace('%', '').trim();
  var n = Number(s);
  if (isNaN(n) || s === '') return '';
  return (String(v).indexOf('%') >= 0 || n > 1) ? n / 100 : n;
}

/** Fecha del seller center: Date, "30/09/2026 23:58" o "2026-09-30 23:58". */
function fechaK_(v) {
  if (!v) return '';
  if (v instanceof Date) return v;
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/))) {
    return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/))) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : d;
}

function ms_(d) { return d instanceof Date ? d.getTime() : NaN; }

function ddmm_(d) {
  return d instanceof Date ? Utilities.formatDate(d, CFG.TZ, 'dd/MM/yyyy HH:mm') : '';
}

/**
 * Mapa CATEGORIA (y sus otros nombres) → comisión normal (hoja COMISIONES).
 * La primera vez con esta versión, la hoja se rehace con la tabla fija de
 * Walmart; renglones que tú hayas agregado y no estén en ella se conservan.
 */
function comisionesNormales_() {
  var sh = libro_().getSheetByName(K_COM);
  if (!sh || prop_('COMISIONES_V6') !== '1') {
    var extra = [];
    if (sh && sh.getLastRow() > 1) {
      var fijas = {};
      COMISIONES_INICIALES.forEach(function (r) {
        fijas[norm_(r[0])] = true;
        String(r[2]).split(',').forEach(function (x) { if (norm_(x)) fijas[norm_(x)] = true; });
      });
      sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
        if (norm_(r[0]) && !fijas[norm_(r[0])] && pct_(r[1]) !== '') extra.push([r[0], pct_(r[1]), '', '']);
      });
    }
    sh = hoja_(K_COM, ENC_K_COM);
    var W5 = ENC_K_COM.length;
    sh.getRange(1, 1, 1, W5).setValues([ENC_K_COM]);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, W5).clearContent();
    var todas = COMISIONES_INICIALES.concat(extra).map(function (r) {
      r = r.slice(0, W5); while (r.length < W5) r.push(''); return r;
    });
    sh.getRange(2, 1, todas.length, W5).setValues(todas);
    sh.getRange(2, 2, todas.length, 1).setNumberFormat('0.00%');
    sh.getRange(2, 4, todas.length, 1).setNumberFormat('0.0');
    setProp_('COMISIONES_V6', '1');
  }
  if (prop_('COMISIONES_COLS_V8') !== '1') {
    // D pasa a "PROMO CATEGORIA", se agrega E "MARCAS". Tus datos no se tocan,
    // solo se precargan las marcas de Cámaras y Lentes si están vacías. La D se
    // deja vacía: la promoción se deduce sola de los killers.
    if (sh.getMaxColumns() < ENC_K_COM.length) sh.insertColumnsAfter(sh.getMaxColumns(), ENC_K_COM.length - sh.getMaxColumns());
    sh.getRange(1, 4, 1, 3).setValues([[ENC_K_COM[3], ENC_K_COM[4], ENC_K_COM[5]]]);
    var nn = sh.getLastRow();
    if (nn > 1) {
      var dd = sh.getRange(2, 1, nn - 1, 5).getValues();
      for (var q = 0; q < dd.length; q++) {
        if (norm_(dd[q][0]) === 'CAMARAS Y LENTES') {
          if (dd[q][4] === '' || dd[q][4] === null) sh.getRange(q + 2, 5).setValue('DJI, NIK, CAN, FUJ');
        }
      }
    }
    setProp_('COMISIONES_COLS_V8', '1');
  }
  if (prop_('COMISIONES_COLS_V9') !== '1') {
    // Nueva columna G "PROMO SOLO EN KILLERS": se precarga SI en Videojuegos.
    if (sh.getMaxColumns() < ENC_K_COM.length) sh.insertColumnsAfter(sh.getMaxColumns(), ENC_K_COM.length - sh.getMaxColumns());
    sh.getRange(1, 7).setValue(ENC_K_COM[6]);
    var n9 = sh.getLastRow();
    if (n9 > 1) {
      var d9 = sh.getRange(2, 1, n9 - 1, 7).getValues();
      for (var q9 = 0; q9 < d9.length; q9++) {
        if (norm_(d9[q9][0]) === 'VIDEOJUEGOS' && (d9[q9][6] === '' || d9[q9][6] === null)) sh.getRange(q9 + 2, 7).setValue('SI');
      }
    }
    setProp_('COMISIONES_COLS_V9', '1');
  }
  var m = {};
  var n = sh.getLastRow();
  if (n < 2) return m;
  // Un nombre (categoría u OTROS NOMBRES) que apunta a comisiones DISTINTAS
  // (ej. COMPUTO en Computadoras 10% y en Accesorios 15%) es ambiguo: no se
  // usa, y esa comisión normal se deduce de lo que trae el killer.
  var alias = {}, ambiguos = {};
  sh.getRange(2, 1, n - 1, 3).getValues().forEach(function (r) {
    var c = pct_(r[1]);
    if (!norm_(r[0]) || c === '') return;
    m[norm_(r[0])] = c;
    String(r[2] || '').split(',').forEach(function (x) {
      var k = norm_(x);
      if (!k || k === norm_(r[0])) return;
      if (alias[k] !== undefined && Math.abs(alias[k] - c) > 0.0001) ambiguos[k] = true;
      alias[k] = c;
    });
  });
  Object.keys(alias).forEach(function (k) {
    if (!ambiguos[k] && m[k] === undefined) m[k] = alias[k];
  });
  return m;
}

/**
 * Categorías de COMISIONES: { nombres: {NOMBRE o ALIAS normalizado → cat},
 * marcas: [{pref, cat}], cats: {cat: {nombre, normal, red, origen}} }.
 * red = PROMO CATEGORIA capturada (columna D) en fracción, 7 → 0.07; 0 si vacía.
 */
function promosCategoria_() {
  var com = comisionesNormales_();              // asegura hoja y columnas
  var sh = libro_().getSheetByName(K_COM);
  var out = { nombres: {}, marcas: [], cats: {} };
  if (!sh || sh.getLastRow() < 2) return out;
  var ancho = Math.min(Math.max(sh.getLastColumn(), 5), 7);
  sh.getRange(2, 1, sh.getLastRow() - 1, ancho).getValues().forEach(function (r) {
    var cat = norm_(r[0]);
    if (!cat) return;
    var red = descKam_(r[3]);
    out.cats[cat] = { nombre: String(r[0]), normal: com[cat], red: red, origen: red ? 'COMISIONES' : '',
                      // Por omisión SÍ viene aplicada en el site (ver nota de
                      // ENC_K_COM). Solo un "NO" explícito la recalcula aquí.
                      enSite: norm_(r[5]) !== 'NO',
                      soloKillers: norm_(r[6]) === 'SI' };
    out.nombres[cat] = cat;
    String(r[2] || '').split(',').forEach(function (x) {
      var k = norm_(x);
      if (!k) return;
      if (out.nombres[k] && out.nombres[k] !== cat) out.nombres[k] = null;   // alias ambiguo
      else if (out.nombres[k] !== null) out.nombres[k] = cat;
    });
    String(r[4] || '').split(',').forEach(function (x) {
      var p = norm_(x).replace(/-+$/, '');
      if (p) out.marcas.push({ pref: p + '-', cat: cat });
    });
  });
  return out;
}

/**
 * Hoja EXCEPCIONES CATEGORIA: SKUs que Walmart (o el KAM) publicó en una categoría
 * equivocada. Aquí se les corrige para comparar contra la comisión y la promoción
 * correctas. El SKU cubre sus variantes -MSI, -MSI-2..9 y -2..9. La hoja se crea
 * sola la primera vez, con los casos que ya detectaste; agrega los demás al final.
 */
var EXC_INICIALES = [
  ['DJI-MIC3-NEG-1834', 'Fotografía', 'Publicado en Instrumentos Musicales'],
  ['GOP-CHDHF132AT-NEG-4129', 'Fotografía', 'Publicado en Campañas'],
  ['CAN-CAMCANREBT7-NEG-2721', 'Fotografía', 'Publicado en Bodega Aurrera'],
  ['CAN-KP1081N--8891', 'Fotografía', 'Publicado en Oficina y Papelería'],
  ['SKU-S2TAWT007-MOR-3021', 'Audio', 'Publicado en Farmacia y Cuidado de la Salud'],
  ['JBL-VBEAM2WHTAM-BLA-5058', 'Audio', 'Publicado en Farmacia y Cuidado de la Salud'],
  ['JBL-PBWIRELESSMICAM-NEG-9975', 'Audio', 'Publicado en Instrumentos Musicales'],
  ['SKU-S2SPWU794-NEG-4509', 'Audio', 'Publicado en Farmacia y Cuidado de la Salud'],
  ['SKU-S2TAWS967-ROJ-0549', 'Audio', 'Publicado en UNNAV'],
  ['SON-CFIZCT1W-CAM-2671', 'Videojuegos', 'Publicado en UNNAV'],
  ['SON-WHCH520BZ-NEG-5205', 'Videojuegos', 'Publicado en Audio'],
  ['SON-CFIZVR1-BLA-7999', 'Videojuegos', 'Publicado en Celulares']
];

function excepcionesCategoria_() {
  if (excepcionesCategoria_.cache) return excepcionesCategoria_.cache;
  var m = {};
  try {
    var sh = hoja_(K_EXC, ENC_K_EXC);
    if (prop_('EXC_CAT_V1') !== '1') {
      if (sh.getLastRow() < 2) {
        sh.getRange(2, 1, EXC_INICIALES.length, 3).setValues(EXC_INICIALES);
      }
      setProp_('EXC_CAT_V1', '1');
    }
    var n = sh.getLastRow();
    if (n > 1) {
      sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
        var k = sku_(r[0]);
        if (k && String(r[1] || '').trim()) m[skuBase_(k)] = String(r[1]).trim();
      });
    }
  } catch (e) {
    logWarn_('KILLERS', 'No se pudo leer EXCEPCIONES CATEGORIA', { error: String(e && e.message || e) });
  }
  excepcionesCategoria_.cache = m;
  return m;
}

/** Categoría corregida de un SKU ('' si no tiene excepción). */
function catExcepcion_(sku) {
  var m = excepcionesCategoria_();
  return m[skuBase_(sku)] || m[sku_(sku)] || '';
}

/** Categoría (clave de COMISIONES) de un SKU según su departamento o su marca. */
function categoriaDeSku_(pc, sku, depto) {
  var exc = catExcepcion_(sku);
  if (exc && pc.nombres[norm_(exc)]) return pc.nombres[norm_(exc)];
  var cat = depto ? pc.nombres[norm_(depto)] : null;
  if (cat) return cat;
  for (var j = 0; j < pc.marcas.length; j++) {
    if (sku.indexOf(pc.marcas[j].pref) === 0) return pc.marcas[j].cat;
  }
  return null;
}

function leerDashboard_() {
  if (leerDashboard_.cache) return leerDashboard_.cache;
  var sh = SpreadsheetApp.openById(CFG.WM_DASH.ID).getSheetByName(CFG.WM_DASH.HOJA);
  if (!sh) throw new Error('El dashboard de Walmart no tiene la hoja "' + CFG.WM_DASH.HOJA + '"');
  var n = sh.getLastRow(), nc = sh.getLastColumn();
  var out = [];
  if (n >= 2) {
    var datos = sh.getRange(1, 1, n, nc).getValues();
    var m = mapaColumnas_(datos[0]);
    var c = function (k) { return m[norm_(k)]; };
    var iSku = c('sku'), iShelf = c('shelf'), iNom = c('productName'),
        iTot = c('stockTotal'), iWfs = c('wfsDisponible');
    if (iSku === undefined || iShelf === undefined) throw new Error('El dashboard no trae sku/shelf');
    var numero = function (v) { return v instanceof Date ? 0 : num_(v); };   // 0 con formato fecha
    for (var i = 1; i < datos.length; i++) {
      var f = datos[i], s = sku_(f[iSku]);
      if (!s) continue;
      out.push({ sku: s, shelf: String(f[iShelf] || ''), nombre: iNom === undefined ? '' : String(f[iNom] || ''),
                 tot: iTot === undefined ? 0 : numero(f[iTot]), wfs: iWfs === undefined ? 0 : numero(f[iWfs]) });
    }
  }
  leerDashboard_.cache = out;
  return out;
}

/**
 * Stock de Odoo por SKU general, de Site Sheet (columna "Stock Odoo" de las
 * hojas de mínimos EM y CVA). Es el mismo TOTAL que usaba tu fórmula de
 * Concentrado. El stockTotal del dashboard es el inventario que Walmart
 * reporta y muchas veces viene en 0 aunque haya mercancía en Odoo.
 */
function stockOdoo_() {
  if (stockOdoo_.cache) return stockOdoo_.cache;
  var out = {};
  var ss = SpreadsheetApp.openById(CFG.SITE_SHEET_ID);
  CFG.SITE_HOJAS_MINIMO.forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var nc = sh.getLastColumn();
    var m = mapaColumnas_(sh.getRange(1, 1, 1, nc).getValues()[0]);
    var iSku = m['SKU'], iSt = m['STOCK ODOO'];
    if (iSku === undefined || iSt === undefined) return;
    var a = Math.min(iSku, iSt), b = Math.max(iSku, iSt);
    sh.getRange(2, a + 1, sh.getLastRow() - 1, b - a + 1).getValues().forEach(function (r) {
      var k = sku_(r[iSku - a]);
      if (k && out[k] === undefined) out[k] = num_(r[iSt - a]);
    });
  });
  stockOdoo_.cache = out;
  return out;
}

/**
 * Qué SKUs entran a KILLERS ACTIVOS por promoción de comisión.
 *
 * Dos modos, y gana el primero que se pueda:
 *
 *   1. LISTA DEL SITE (lo preciso). Site Sheet baja cada hora la hoja
 *      "Promociones" con los SKUs que de verdad traen promoción — el site la
 *      captura uno por uno, no por categoría. Si de 200 cámaras solo 8 tienen
 *      promo, entran esas 8. Nada de adivinar.
 *   2. POR CATEGORÍA (el respaldo de siempre). Si esa hoja no existe todavía,
 *      está vacía o no se pudo leer, se usa COMISIONES → PROMO CATEGORIA y
 *      entran todos los SKUs de la categoría con stock, como antes.
 *
 * En los dos modos se respeta tu regla de stock: TOTAL (Odoo) ≥ 4, o algo en WFS.
 */
function skusPromoCategoria_(pc) {
  var promos = promosDelSite_();            // null = no se pudo, usamos el modo 2
  var conPromo = Object.keys(pc.cats).filter(function (c) { return pc.cats[c].red > 0; });
  if (!promos && !conPromo.length) return [];

  var st = {};
  try { st = stockOdoo_(); }
  catch (e) { logWarn_('KILLERS', 'No se pudo leer el stock de Odoo de Site Sheet; se usa el del dashboard', { error: String(e && e.message || e) }); }

  var out = [], conStock = 0;
  leerDashboard_().forEach(function (d) {
    var s = d.sku;
    if (skuIgnorado_(s) || /-(OB|OPENBOX)$/.test(s)) return;

    var cat = categoriaDeSku_(pc, s, d.shelf);
    var ps = promos ? promoSiteDeSku_(promos, s) : null;
    if (cat && pc.cats[cat] && pc.cats[cat].soloKillers) return;   // promo solo para killers del KAM
    if (promos && ps && !cat && ps.cat && pc.cats[norm_(ps.cat)] && pc.cats[norm_(ps.cat)].soloKillers) return;


    if (promos) {
      if (!ps) return;                      // modo 1: solo los que el site marcó
      if (!cat && ps.cat) cat = norm_(ps.cat);
      if (!cat) cat = norm_(d.shelf || '');
    } else {
      if (!cat || !(pc.cats[cat].red > 0)) return;   // modo 2: toda la categoría
    }

    // Tu regla: TOTAL (Odoo) ≥ 4, o si no, que haya algo en WFS
    var tot = st[s] !== undefined ? st[s] : (st[skuSinVariante_(s)] !== undefined ? st[skuSinVariante_(s)] :
              (st[skuBase_(s)] !== undefined ? st[skuBase_(s)] : d.tot));
    // Con la lista del site (modo 1) entran TODAS las promociones, con o sin stock
    // (06/10/2026). La regla de stock solo se queda en el modo 2 (por categoría).
    if (!promos && !(tot >= 4 || d.wfs > 0)) return;
    conStock++;

    // Precio con promoción que generó el site (clásica o premium según el SKU).
    // Vacío en el modo 2 (sin lista del site): ahí se usa el mínimo, como antes.
    var precioPromo = ps ? (tipoPublicacion_(s) === 'PREMIUM' ? ps.preP : ps.claP) : '';
    out.push({ sku: s, nombre: d.nombre, cat: cat, stock: tot, depto: d.shelf, precioPromo: precioPromo });
  });

  // reconstruirActivos_ corre cada hora desde el trigger: el LOG solo lleva
  // renglón cuando el número CAMBIA, más uno al día. Igual que la sobreventa.
  if (promos) {
    var huella = hoy_() + '|' + promos.n + '|' + promos.noAplican + '|' + conStock + '|' + promos.origen;
    if (prop_('PROMOS_SITE_HUELLA') !== huella) {
      setProp_('PROMOS_SITE_HUELLA', huella);
      logInfo_('KILLERS', 'Promociones tomadas del site (SKU por SKU)', {
        enElSite: promos.n, noAplican: promos.noAplican, conStock: conStock,
        leidasDe: promos.origen === 'espejo' ? 'copia local (Site Sheet no respondió)' : 'Site Sheet'
      });
    }
  }
  return out;
}

/** Nombre oficial de la categoría de Walmart (como la pide el site). */
function categoriaOficial_(cat) {
  var n = norm_(cat);
  if (!n) return '';
  for (var i = 0; i < COMISIONES_INICIALES.length; i++) {
    var r = COMISIONES_INICIALES[i];
    if (norm_(r[0]) === n) return r[0];
    var alias = String(r[2]).split(',').map(norm_);
    if (alias.indexOf(n) >= 0) return r[0];
  }
  return String(cat);
}

/**
 * Cuánto suma MSI a la comisión: 4.5 puntos, confirmado por el KAM (10/09/2026).
 * No se deduce del pegado porque Table Capture trae los % redondeados
 * (14.5% llega como "15%").
 */
function msiExtra_(hist) {
  return MSI_EXTRA_DEF;
}

/**
 * Deduce la promoción de comisión de un killer.
 *   normal clásica: la de su categoría (COMISIONES). Sin categoría se infiere:
 *     si la comisión del cupón es una comisión estándar, esa es la normal;
 *     si no, la estándar inmediata de arriba (3% → 10%).
 *   normal MSI = normal + extra MSI
 *   reducción = la mayor de (normal − cupón) y (normal MSI − comisión MSI),
 *   en puntos: Cámaras 10%→3% = 7 · Videojuegos MSI 14.5%→10% = 4.5
 */
function deducirPromo_(k, cat, com, extra) {
  var out = { normal: '', normalMsi: '', red: 0, redCla: 0, redMsi: 0, inferida: false };
  var normal = cat ? com[norm_(cat)] : undefined;
  if (normal === undefined) {
    if (k.comCup === '' || k.comCup === undefined) return out;
    var est = {};
    Object.keys(com).forEach(function (x) { est[Math.round(com[x] * 1000)] = com[x]; });
    var vals = Object.keys(est).map(function (x) { return est[x]; }).sort(function (a, b) { return a - b; });
    var c0 = Math.round(k.comCup * 1000);
    if (est[c0] !== undefined) normal = est[c0];
    else normal = vals.filter(function (v) { return v >= k.comCup; })[0];
    if (normal === undefined) return out;
    out.inferida = true;
  }
  out.normal = normal;
  out.normalMsi = Math.round((normal + extra) * 1000) / 1000;
  if (k.comCup !== '' && k.comCup !== undefined) out.redCla = Math.max(0, normal - k.comCup);
  if (k.comMsi !== '' && k.comMsi !== undefined) out.redMsi = Math.max(0, out.normalMsi - k.comMsi);
  out.redCla = Math.round(out.redCla * 1000) / 1000;
  out.redMsi = Math.round(out.redMsi * 1000) / 1000;
  out.red = Math.max(out.redCla, out.redMsi);
  return out;
}

/** SKU → CATEGORIA que ya capturaste (ACTIVOS gana sobre el histórico). */
function categoriasConocidas_() {
  var m = {};
  var leer = function (nombre, iSku, iCat) {
    var sh = libro_().getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(iSku, iCat) + 1).getValues()
      .forEach(function (r) {
        if (r[iSku] && r[iCat]) {
          m[sku_(r[iSku])] = String(r[iCat]);
          m[skuBase_(r[iSku])] = m[skuBase_(r[iSku])] || String(r[iCat]);
        }
      });
  };
  // En el histórico, SKU y CATEGORIA se ubican por su título.
  var shH = libro_().getSheetByName(K_HIST);
  if (shH) {
    var fisH = mapaFisico_(shH, ENC_K_HIST);
    leer(K_HIST, fisH[KH.SKU], fisH[KH.CAT]);
  }
  // En ACTIVOS la categoría se busca por encabezado ("KAM" o "CATEGORIA"),
  // por si la hoja aún trae el formato anterior; el SKU, igual, por título.
  var shA = libro_().getSheetByName(K_ACT);
  if (shA && shA.getLastColumn() > 0) {
    var mapa = mapaColumnas_(shA.getRange(1, 1, 1, shA.getLastColumn()).getValues()[0]);
    var iCat = mapa['KAM'] !== undefined ? mapa['KAM'] : mapa['CATEGORIA'];
    var iSkuA = mapa['SKU'] !== undefined ? mapa['SKU'] : KA.SKU;
    if (iCat !== undefined) leer(K_ACT, iSkuA, iCat);
  }
  return m;
}

function asegurarHojasKillers_() {
  var ss = libro_();
  quitarHojasSobrantesUnaVez_();
  if (!ss.getSheetByName(K_PEGAR)) hoja_(K_PEGAR, null);
  hoja_(K_HIST, ENC_K_HIST);
  hoja_(K_ACT, ENC_K_ACT);
  comisionesNormales_();
}

/**
 * UNA vez: quita KILLERS KAM (los killers del KAM ya llegan en el pegado del
 * seller center) y PROMOCIONES (las promociones viven en el site). Solo se
 * borran si no tienen datos capturados por ti.
 */
function quitarHojasSobrantesUnaVez_() {
  if (prop_('HOJAS_SOBRANTES_QUITADAS') === '1') return;
  var ss = libro_();
  [K_KAM, K_PROMO].forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre);
    if (!sh) return;
    if (nombre === K_KAM && ultimaFilaColA_(sh) > 1) return;   // trae datos: se respeta
    ss.deleteSheet(sh);
    logOK_('KILLERS', 'Hoja quitada: ' + nombre);
  });
  setProp_('HOJAS_SOBRANTES_QUITADAS', '1');
}

/** Siguiente carga: número global y nombre del mes ("SEPTIEMBRE 2026-2"). */
function nuevaCarga_() {
  var ahora = new Date();
  var mes = Utilities.formatDate(ahora, CFG.TZ, 'yyyy-MM');
  // Si borraste KILLERS HISTORICO, la numeración del mes vuelve a empezar en -1
  var shH = libro_().getSheetByName(K_HIST);
  if (!shH || ultimaFilaColA_(shH) < 2) setProp_('KILLERS_CARGA_' + mes, '0');
  var nMes = Number(prop_('KILLERS_CARGA_' + mes, '0')) + 1;
  var nGlobal = Number(prop_('KILLERS_CARGA_N', '0')) + 1;
  setProp_('KILLERS_CARGA_' + mes, String(nMes));
  setProp_('KILLERS_CARGA_N', String(nGlobal));
  var etiqueta = MESES[Number(mes.slice(5)) - 1] + ' ' + mes.slice(0, 4) + '-' + nMes;
  return { n: nGlobal, etiqueta: etiqueta };
}

// ── Botón: procesar lo pegado ─────────────────────────────────────────────

/**
 * Menú: trae los killers de Site Sheet y rehace KILLERS ACTIVOS. No hay que
 * pegar nada.
 *
 * Es lo que hay que darle cuando quieres ver ya un killer o una promoción
 * nueva y no esperar al trigger (corre solo cada 15 min / 1 hora).
 * Primero lee la hoja "Killers" de Site Sheet y, si la lista cambió, la pasa a
 * KILLERS HISTORICO. Luego vuelve a armar la hoja de ACTIVOS con los killers
 * vigentes y las promociones que trae el site. No toca lo pegado a mano.
 */
function actualizarActivos() {
  var lock = candado_(180000);
  if (!lock) { avisar_('La importación automática está corriendo en este momento y no terminó en 3 minutos.\n\nEspera a que termine (revisa LOG Ventas) y vuelve a darle.'); return; }
  try {
    asegurarHojasKillers_();
    var ks = sincronizarKillersSite_(true);
    var a = reconstruirActivos_();
    setProp_('KILLERS_REFRESCO', String(Date.now()));
    setProp_('KILLERS_ACTIVOS_PENDIENTE', '');
    var p = promosDelSite_();
    var txtKs = {
      cambio: 'Killers de Site Sheet: ' + ks.leidos + ' leídos · ' + ks.vigentes + ' vigentes hoy · ' +
              ks.nuevosEnHistorico + ' nuevos en el histórico (' + ks.carga + ')',
      igual: 'Killers de Site Sheet: ' + (ks.n || 0) + ' · sin cambios desde la última lectura',
      sin_lectura: '⚠️ No se pudo leer la hoja "Killers" de Site Sheet (revisa LOG Ventas). Se usó el histórico que ya había.',
      vacia: '⚠️ La hoja "Killers" de Site Sheet no trae killers con precio y fecha. Se usó el histórico que ya había.',
      error: '⚠️ Falló la lectura de killers de Site Sheet (revisa LOG Ventas). Se usó el histórico que ya había.'
    }[ks.estado] || 'Killers de Site Sheet: ' + ks.estado;
    avisar_('KILLERS ACTIVOS actualizada\n\n' + txtKs + '\n\n' +
      'Renglones: ' + a.total + '\n' +
      '  · killers vigentes: ' + (a.total - (a.promoCategoria || 0) - (a.porIniciar || 0)) + '\n' +
      '  · por promoción de categoría: ' + (a.promoCategoria || 0) + '\n' +
      '  · por iniciar: ' + (a.porIniciar || 0) + '\n' +
      'Salieron (vencidos o ya no vienen): ' + (a.salieron || 0) + '\n\n' +
      (p ? 'Promociones leídas del site: ' + p.n + '  (descartadas: ' + p.noAplican + ')\n' +
           'Fuente: ' + (p.origen === 'espejo' ? 'copia local, Site Sheet no respondió' : 'Site Sheet')
         : 'Sin lista de promociones del site: se usó la promoción por categoría de COMISIONES.'));
  } catch (e) {
    logError_('KILLERS', e);
    avisar_('No se pudo actualizar KILLERS ACTIVOS:\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}

function procesarKillers() {
  // Botón: espera hasta 3 min a que termine el trigger que esté corriendo.
  var lock = candado_(180000);
  if (!lock) { avisar_('La importación automática está corriendo en este momento y no terminó en 3 minutos.\n\nNo pasa nada: espera a que termine (revisa LOG Ventas) y vuelve a darle.'); return; }
  try {
    var r = procesarKillers_();
    if (!r.leidos) {
      avisar_('KILLERS PEGAR está vacía.\n\nYa no hace falta pegar nada: los killers se leen solos de Site Sheet.\n' +
              'Para traerlos ya, usa "🔄 Actualizar KILLERS ACTIVOS".\n\n' +
              '(Este botón solo sirve si algún día pegas a mano lo de Table Capture.)');
      return;
    }
    avisar_('Killers procesados · ' + r.carga + '\n\n' +
      'Renglones leídos: ' + r.leidos + (r.sinSku ? '  (sin SKU: ' + r.sinSku + ')' : '') + '\n' +
      'SKUs distintos: ' + r.skus + '\n' +
      'Rangos nuevos o con cambio → histórico: ' + r.nuevos + '\n' +
      'Rangos que ya estaban (se marcan como vistos): ' + r.repetidos + '\n\n' +
      'KILLERS ACTIVOS: ' + r.activos + '  ·  con promoción: ' + r.promos +
      '  ·  por iniciar: ' + r.porIniciar + '\n' +
      'Salieron de ACTIVOS (ya no vienen en el seller center o vencieron): ' + r.salieron +
      '\nKillers con promoción de comisión (columna X): ' + (r.promociones || 0) +
      '\nSKUs por promoción de CATEGORÍA (sin killer, del dashboard): ' + (r.promoCategoria || 0));
  } catch (e) {
    logError_('KILLERS', e);
    avisar_('No se pudieron procesar los killers:\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}

function procesarKillers_() {
  asegurarHojasKillers_();
  var sh = libro_().getSheetByName(K_PEGAR);
  var lista = leerPegado_(sh);
  var res = { leidos: lista.leidos, sinSku: lista.sinSku, skus: 0, nuevos: 0,
              repetidos: 0, activos: 0, promos: 0, porIniciar: 0, salieron: 0,
              sinCategoria: 0, carga: '' };
  if (!lista.killers.length) return res;

  var carga = nuevaCarga_();
  res.carga = carga.etiqueta;
  var skus = {};
  lista.killers.forEach(function (k) { skus[k.sku] = true; });
  res.skus = Object.keys(skus).length;

  var h = guardarEnHistorico_(lista.killers, carga);
  res.nuevos = h.nuevos; res.repetidos = h.repetidos;

  var antes = Number(prop_('KILLERS_ACTIVOS_N', '0'));
  setProp_('KILLERS_ULTIMA_CARGA', String(carga.n));
  var a = reconstruirActivos_();
  res.activos = a.total; res.promos = a.promos; res.porIniciar = a.porIniciar;
  res.sinCategoria = a.sinCategoria;
  res.promociones = a.promociones;
  res.promoCategoria = a.promoCategoria || 0;
  res.salieron = a.salieron || 0;

  sh.clearContents();
  logOK_('KILLERS', 'Carga ' + carga.etiqueta + ' procesada', res);
  return res;
}

/** Lee KILLERS PEGAR. Encabezados por texto; sin encabezados, por orden. */
function leerPegado_(sh) {
  var out = { killers: [], leidos: 0, sinSku: 0 };
  var n = sh.getLastRow(), nc = sh.getLastColumn();
  if (n < 1 || nc < 1) return out;
  var datos = sh.getRange(1, 1, n, nc).getValues();

  var pos = {}, filaIni = 0;
  for (var r0 = 0; r0 < Math.min(5, datos.length); r0++) {
    var mapa = mapaColumnas_(datos[r0]), p = {};
    Object.keys(TC).forEach(function (k) {
      TC[k].forEach(function (a) { if (mapa[a] !== undefined && p[k] === undefined) p[k] = mapa[a]; });
    });
    if (p.DETALLES !== undefined && p.NEGOC !== undefined) { pos = p; filaIni = r0 + 1; break; }
  }
  if (pos.DETALLES === undefined) {
    var c0 = 0;
    for (var c = 0; c < datos[0].length; c++) {
      if (/SKU\s*:/i.test(String(datos[0][c]))) { c0 = c; break; }
    }
    TC_ORDEN.forEach(function (k, i) { pos[k] = c0 + i; });
  }

  for (var i = filaIni; i < datos.length; i++) {
    var f = datos[i];
    var det = f[pos.DETALLES];
    if (!det) continue;
    out.leidos++;
    var sku = extraerSkuKiller_(det);
    if (!sku) { out.sinSku++; continue; }
    var g = function (k) { return pos[k] === undefined ? '' : f[pos[k]]; };
    var negoc = num_(g('NEGOC')), cupon = num_(g('CUPON'));
    out.killers.push({
      sku: sku, general: skuBase_(sku), detalles: String(det).slice(0, 200),
      actual: num_(g('ACTUAL')), negoc: negoc, cupon: cupon, recibimos: negoc + cupon,
      ini: fechaK_(g('INICIO')), fin: fechaK_(g('FIN')), comCup: pct_(g('COMCUP')),
      msi: g('MSI'), comMsi: pct_(g('COMMSI')), wfs: g('WFS'), devol: g('DEVOL'),
      disp: g('DISP'), obs: String(g('OBS') || '').slice(0, 300), origen: 'SELLER CENTER'
    });
  }
  return out;
}

function llaveKiller_(sku, negoc, cupon, ini, fin) {
  var t = function (d) { d = fechaK_(d); return d instanceof Date ? d.getTime() : ''; };
  return [sku_(sku), num_(negoc), num_(cupon), t(ini), t(fin)].join('|');
}

/**
 * Guarda en el histórico. Un rango que ya existe no se repite: solo se le
 * actualiza "VISTO EN CARGA #". Lo nuevo entra con la carga actual.
 */
function guardarEnHistorico_(lista, carga) {
  var sh = hoja_(K_HIST, ENC_K_HIST);
  // Las 23 columnas se ubican por su título, no por su letra.
  var datos = filasOrdenadas_(sh, ENC_K_HIST);
  var idx = {};
  datos.forEach(function (r, i) {
    idx[llaveKiller_(r[KH.SKU], r[KH.NEGOC], r[KH.CUPON], r[KH.INI], r[KH.FIN])] = i;
  });

  var cats = categoriasConocidas_();
  var ahora = new Date();
  var nuevas = [], repetidos = 0, vistos = {};
  lista.forEach(function (k) {
    var ll = llaveKiller_(k.sku, k.negoc, k.cupon, k.ini, k.fin);
    if (vistos[ll]) return;                  // mismo renglón pegado dos veces
    vistos[ll] = true;
    if (idx[ll] !== undefined) {
      datos[idx[ll]][KH.VISTO] = carga.n;
      repetidos++;
      return;
    }
    var finUtc = k.fin instanceof Date ? new Date(k.fin.getTime() + 6 * 3600000) : '';
    nuevas.push([carga.etiqueta, carga.n, carga.n, k.sku, k.general, k.detalles,
      k.actual, k.negoc, k.cupon, k.recibimos, k.ini, k.fin, finUtc, k.comCup,
      k.msi, k.comMsi, k.wfs, k.devol, k.disp, k.obs, k.origen,
      k.categoria || cats[k.sku] || cats[k.general] || '', ahora]);
  });

  var fis = mapaFisico_(sh, ENC_K_HIST);
  if (repetidos) {
    sh.getRange(2, fis[KH.VISTO] + 1, datos.length, 1)
      .setValues(datos.map(function (r) { return [r[KH.VISTO]]; }));
  }
  if (nuevas.length) {
    agregarFilas_(sh, enOrdenFisico_(sh, ENC_K_HIST, nuevas), fis[KH.CARGA] + 1);
  }
  return { nuevos: nuevas.length, repetidos: repetidos };
}

/** KAM → objetos killer. */
function leerKam_(tabla) {
  var sh = libro_().getSheetByName(K_KAM);
  if (!sh || sh.getLastRow() < 2) return [];
  var ancho = Math.max(Math.min(sh.getLastColumn(), ENC_K_KAM.length), 9);
  var rCat = {}, com = comisionesNormales_();
  var descDe = function (r) { return descKam_(r[8]); };
  return sh.getRange(2, 1, sh.getLastRow() - 1, ancho).getValues()
    .filter(function (r) { return sku_(r[0]) && (num_(r[1]) > 0 || descDe(r) > 0); })
    .map(function (r) {
      var desc = num_(r[1]) > 0 ? '' : descDe(r);
      var negoc = num_(r[1]);
      if (desc) {
        tabla = tabla || tablaPrecios_();
        negoc = precioConDescuento_(minimoDe_(tabla, r[0]), desc);
      }
      var cupon = num_(r[2]);
      // Sin COMISION CUPON: normal de su categoría − REDUCCION KAM
      var comCup = pct_(r[5]), comMsi = '';
      var nCat = com[norm_(r[6])], red = rCat[norm_(r[6])];
      if (comCup === '' && nCat !== undefined && red) comCup = Math.round((nCat - red) * 1000) / 1000;
      if (nCat !== undefined && red) comMsi = Math.round((nCat + MSI_EXTRA_DEF - red) * 1000) / 1000;
      return {
        sku: sku_(r[0]), general: skuBase_(r[0]), detalles: String(r[7] || 'Autorizado por KAM'),
        negoc: negoc, cupon: cupon, recibimos: negoc + cupon, desc: desc,
        ini: fechaK_(r[3]), fin: fechaK_(r[4]), comCup: comCup, comMsi: comMsi, wfs: '',
        msi: '', devol: '', disp: '', obs: '',
        origen: 'KAM', categoria: String(r[6] || ''), carga: 'KAM', nCarga: Infinity
      };
    })
    .filter(function (k) { return k.negoc > 0; });
}

/** "-7%", "7%", -0.07, 0.07, -4.5, "4.5" → 0.07 / 0.045 */
function descKam_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var txt = String(v), n = Math.abs(typeof v === 'number' ? v : Number(txt.replace('%', '').trim()));
  if (isNaN(n) || !n) return 0;
  return (txt.indexOf('%') >= 0 || n >= 1) ? n / 100 : n;
}

/** Igual que tu hoja de Fotografía: INT((mín − mín×desc)/10)*10+9 */
function precioConDescuento_(minimo, desc) {
  if (!(minimo > 0)) return 0;
  return Math.floor((minimo - minimo * desc) / 10) * 10 + 9;
}

/** Renglones del histórico como objetos. */
function leerHistorico_() {
  var sh = libro_().getSheetByName(K_HIST);
  if (!sh) return [];
  return filasOrdenadas_(sh, ENC_K_HIST)
    .filter(function (r) { return sku_(r[KH.SKU]); })
    .map(function (r) {
      return {
        sku: sku_(r[KH.SKU]), general: sku_(r[KH.GEN]) || skuBase_(r[KH.SKU]),
        detalles: r[KH.DET], negoc: num_(r[KH.NEGOC]), cupon: num_(r[KH.CUPON]),
        recibimos: num_(r[KH.RECIB]), ini: fechaK_(r[KH.INI]), fin: fechaK_(r[KH.FIN]),
        comCup: pct_(r[KH.COMCUP]), comMsi: pct_(r[KH.COMMSI]), wfs: r[KH.WFS],
        msi: r[KH.MSI], devol: r[KH.DEVOL], disp: r[KH.DISP], obs: r[KH.OBS],
        origen: r[KH.ORIGEN], categoria: String(r[KH.CAT] || ''),
        carga: r[KH.CARGA], nCarga: num_(r[KH.NCARGA]), visto: num_(r[KH.VISTO])
      };
    });
}

/**
 * De varios rangos de un SKU, el que aplica en `t` (ms):
 *   cubre t → gana carga más nueva, luego el que empezó más tarde
 *   si no, el próximo por iniciar · si no, null
 */
function rangoQueAplica_(rangos, t) {
  var cubre = rangos.filter(function (k) {
    return (!(k.ini instanceof Date) || ms_(k.ini) <= t) && (!(k.fin instanceof Date) || ms_(k.fin) >= t);
  });
  if (cubre.length) {
    cubre.sort(function (a, b) { return (b.nCarga - a.nCarga) || (ms_(b.ini) - ms_(a.ini)); });
    return { k: cubre[0], estado: 'VIGENTE' };
  }
  var futuros = rangos.filter(function (k) { return k.ini instanceof Date && ms_(k.ini) > t; });
  if (futuros.length) {
    futuros.sort(function (a, b) { return (ms_(a.ini) - ms_(b.ini)) || (b.nCarga - a.nCarga); });
    return { k: futuros[0], estado: 'POR INICIAR' };
  }
  return null;
}

/**
 * Reescribe KILLERS ACTIVOS a partir del histórico + KAM, con el mismo
 * formato A–T de tu hoja "Activos" (ver ENC_K_ACT).
 * Seller center: solo los rangos que venían en la última carga.
 */
function reconstruirActivos_() {
  var sh = hoja_(K_ACT, ENC_K_ACT);
  var ultima = Number(prop_('KILLERS_ULTIMA_CARGA', '0'));
  var tabla = tablaPrecios_();
  var hist = leerHistorico_();
  var kam = leerKam_(tabla);
  var cats = categoriasConocidas_();
  var com = comisionesNormales_();
  var extra = msiExtra_(hist);
  var ahora = Date.now();

  // Un rango que Walmart ya quitó no regresa a Activos (sí queda en el
  // histórico para validar ventas de esas fechas).
  // Cada origen tiene su propia "última carga": lo pegado a mano (ultima) y lo
  // leído de Site Sheet (siteUltima). Un rango vale si lo trajo cualquiera de
  // las dos; los números de carga son globales, no se pisan.
  var siteUltima = Number(prop_('KILLERS_SITE_ULTIMA', '0'));
  var porSku = {};
  hist.forEach(function (k) {
    if ((k.origen === 'SELLER CENTER' || k.origen === 'SITE') &&
        k.visto !== ultima && k.visto !== siteUltima) return;
    if (k.origen === 'MEMORIA ANTERIOR') return;
    (porSku[k.sku] = porSku[k.sku] || []).push(k);
  });
  kam.forEach(function (k) { (porSku[k.sku] = porSku[k.sku] || []).push(k); });

  var previos = {};
  var n0 = ultimaFilaColA_(sh);
  if (n0 > 1) sh.getRange(2, 1, n0 - 1, 1).getValues().forEach(function (r) { previos[sku_(r[0])] = true; });

  // Departamento de Walmart (dashboard) como categoría cuando no la capturaste
  var depto = {};
  try { leerDashboard_().forEach(function (d) { if (d.shelf) depto[d.sku] = d.shelf; }); }
  catch (e) { logWarn_('KILLERS', 'No se pudo leer el dashboard de Walmart', { error: String(e && e.message || e) }); }

  var pc = promosCategoria_(), votos = {};
  var hojaPrecios = "'" + CFG.H.PRECIOS + "'!";
  var res = { total: 0, promos: 0, porIniciar: 0, sinCategoria: 0, entraron: 0 };
  var filas = [], promos = [];
  // Orden: primero los VIGENTES (lo que subes hoy), al final los POR INICIAR.
  var orden = Object.keys(porSku).map(function (sku) {
    var x = rangoQueAplica_(porSku[sku], ahora);
    return { sku: sku, v: x && x.estado === 'VIGENTE' ? 0 : 1 };
  }).sort(function (a, b) { return (a.v - b.v) || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0); })
    .map(function (x) { return x.sku; });
  var vigentes = [], porIniciar = [];
  orden.forEach(function (sku) {
    var x = rangoQueAplica_(porSku[sku], ahora);
    if (x) (x.estado === 'VIGENTE' ? vigentes : porIniciar).push(sku);
  });
  var conKiller = {};                    // solo killers VIGENTES tapan la promo
  vigentes.forEach(function (sku) { conKiller[sku] = true; });

  var filaKiller = function (sku) {
    var rangos = porSku[sku];
    var sel = rangoQueAplica_(rangos, ahora);
    if (!sel) return;
    var k = sel.k;
    var r = filas.length + 2;                       // renglón en la hoja
    var cat = catExcepcion_(k.sku) || k.categoria || cats[k.sku] || cats[k.general] || depto[k.sku] || '';
    var pr = deducirPromo_(k, cat, com, extra);
    var promo = pr.red > 0.0001;
    if (promo) promos.push({ k: k, cat: cat, pr: pr });
    // Voto: ¿los killers de esta categoría traen la comisión base rebajada?
    var ck = categoriaDeSku_(pc, k.sku, depto[k.sku] || cat);
    if (ck && sel.estado === 'VIGENTE') {
      var v = votos[ck] = votos[ck] || { total: 0, red: {} };
      v.total++;
      var rc = Math.round(pr.redCla * 1000) / 1000;
      if (rc > 0) v.red[rc] = (v.red[rc] || 0) + 1;
    }
    var otros = rangos.filter(function (x) { return x !== k && x.fin instanceof Date && ms_(x.fin) >= ahora; })
      .map(function (x) { return '$' + x.negoc + ' ' + ddmm_(x.ini).slice(0, 5) + '–' + ddmm_(x.fin).slice(0, 5); })
      .join(' · ');
    var llave = llavePrecio_(tabla, k.sku);
    var colMin = tipoPublicacion_(k.sku) === 'PREMIUM' ? 'D' : 'C';
    // D: KAM con DESCUENTO % → fórmula sobre C, igual que tu hoja de Fotografía
    var negoc = k.desc
      ? '=IF(ISNUMBER(C' + r + '),INT((C' + r + '-C' + r + '*' + k.desc + ')/10)*10+9,"")'
      : k.negoc;
    if (promo) res.promos++;
    if (!cat) res.sinCategoria++;
    if (sel.estado === 'POR INICIAR') res.porIniciar++;
    if (!previos[sku]) res.entraron++;
    filas.push([
      k.sku,                                                            // A SKU
      k.detalles,                                                       // B
      '=IF(V' + r + '="","NO ESTA",IFERROR(XLOOKUP(V' + r + ',' + hojaPrecios + '$B:$B,' +
        hojaPrecios + '$' + colMin + ':$' + colMin + '),"NO ESTA"))',   // C PRECIO
      negoc,                                                            // D
      k.cupon === 0 ? '' : k.cupon,                                     // E
      '=IF(D' + r + '="","",D' + r + '+N(E' + r + '))',                 // F PAGAN
      '=IF(AND(ISNUMBER(C' + r + '),ISNUMBER(F' + r + ')),F' + r + '/C' + r + ',"")', // G %
      '=D' + r,                                                         // H Carga
      k.ini, k.fin,                                                     // I J
      '=IF(J' + r + '="","",J' + r + '+TIME(6,0,0))',                   // K Fecha formato
      k.comCup, k.msi, k.comMsi, k.wfs, k.devol, k.disp, k.obs,         // L–R
      'SI',                                                             // S VALIDACIÓN
      cat,                                                              // T KAM
      k.general, llave,                                                 // U V
      pr.normal, promo ? Math.round(pr.red * 1000) / 10 : '',          // W X (puntos)
      k.origen, sel.estado, k.carga, otros                              // Y–AB
    ]);
  };

  // Promoción de CATEGORÍA: los SKUs de la categoría (clásica y MSI) con stock
  // y SIN killer vigente. Los que tienen killer ya traen su precio del KAM.
  //   · vacío o SI (lo normal) → el site ya rehizo el precio con la comisión
  //     final, así que Carga = el mínimo del site tal cual.
  //   · NO escrito a mano → Carga = INT((mín − mín × puntos%)/10)*10+9, la
  //     fórmula de tu hoja Activos (8,049 con 7 → 7,489).
  // Clásica y MSI sin killer vigente.
  var filaPromoCat = function (p) {
    var r = filas.length + 2;
    // Con la lista del site pueden llegar categorías que COMISIONES todavía no
    // tiene (p. ej. Videojuegos antes de capturarle los puntos). Sin esta red,
    // info sería undefined y la corrida entera se caía.
    var info = pc.cats[p.cat] || { normal: undefined, red: 0, nombre: p.cat || '' };
    var llave = llavePrecio_(tabla, p.sku);
    var colMin = tipoPublicacion_(p.sku) === 'PREMIUM' ? 'D' : 'C';
    var normal = info.normal === undefined ? '' : info.normal;
    var fin = normal === '' ? '' : Math.round((normal - info.red) * 1000) / 1000;
    if (!previos[p.sku]) res.entraron++;
    res.promoCategoria++;
    filas.push([
      p.sku, p.nombre,
      '=IF(V' + r + '="","NO ESTA",IFERROR(XLOOKUP(V' + r + ',' + hojaPrecios + '$B:$B,' +
        hojaPrecios + '$' + colMin + ':$' + colMin + '),"NO ESTA"))',   // C PRECIO
      // Regla de Luis (07/10/2026): killers y promociones se calculan SIEMPRE sobre el
      // PRECIO MÍNIMO de Erik (el site calcula sobre el precio normal, no sirve).
      //   · mínimo − puntos% de la promo, terminado en 9 (8,049 con 7% → 7,489), tanto en la
      //     clásica como en la premium (-MSI) que no tenga killer vigente (los que sí tienen
      //     killer ya traen el descuento y entran como killer, no como promoción).
      (info.red > 0)
        ? '=IF(ISNUMBER(C' + r + '),INT((C' + r + '-C' + r + '*' + info.red.toFixed(4) + ')/10)*10+9,"")'
        : '=IF(ISNUMBER(C' + r + '),C' + r + ',"")',                    // D
      '',                                                               // E
      '=IF(D' + r + '="","",D' + r + '+N(E' + r + '))',                 // F PAGAN
      '=IF(AND(ISNUMBER(C' + r + '),ISNUMBER(F' + r + ')),F' + r + '/C' + r + ',"")', // G %
      '=D' + r,                                                         // H Carga
      '', '', '',                                                       // I J K
      fin, '', fin === '' ? '' : Math.round((fin + extra) * 1000) / 1000, // L M N
      '', '', '', 'Promoción de categoría (stock ' + p.stock + ')',     // O P Q R
      'SI', catExcepcion_(p.sku) ? info.nombre : (p.depto || info.nombre), // S T (categoría; con excepción, la corregida)
      skuBase_(p.sku), llave, normal, Math.round(info.red * 1000) / 10,  // U V W X
      'PROMO CATEGORIA', 'VIGENTE', info.origen,
      (info.red > 0) ? 'Mínimo − promo' : 'Mínimo' // Y–AB
    ]);
  };

  vigentes.forEach(filaKiller);

  // Promoción de categoría: la de COMISIONES (col. D) manda; si está vacía,
  // se deduce de los killers vigentes: si 2 o más killers de la categoría
  // traen la misma rebaja de comisión base, esa es la promoción de la categoría.
  Object.keys(votos).forEach(function (ck) {
    var info = pc.cats[ck];
    if (!info || info.red > 0) return;
    var mejor = 0, n = 0;
    Object.keys(votos[ck].red).forEach(function (rc) {
      if (votos[ck].red[rc] > n) { n = votos[ck].red[rc]; mejor = Number(rc); }
    });
    if (n >= 2) { info.red = mejor; info.origen = 'DEDUCIDA DE KILLERS'; }
  });
  var guardar = {};
  Object.keys(pc.cats).forEach(function (ck) {
    var i = pc.cats[ck];
    if (i.red > 0 && i.normal !== undefined) guardar[ck] = { red: i.red, normal: i.normal, nombre: i.nombre, origen: i.origen, enSite: i.enSite, soloKillers: !!i.soloKillers };
  });
  setProp_('KILLERS_PROMO_CAT', JSON.stringify(guardar));
  res.promoCat = guardar;

  var extraCat = [];
  res.promoCategoria = 0;
  try {
    extraCat = skusPromoCategoria_(pc).filter(function (p) { return !conKiller[p.sku]; });
  } catch (e) {
    logWarn_('KILLERS', 'No se pudo leer el dashboard de Walmart (promoción de categoría)', { error: String(e && e.message || e) });
  }

  extraCat.sort(function (a, b) { return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0; }).forEach(filaPromoCat);
  porIniciar.forEach(filaKiller);

  var ancho = Math.max(sh.getLastColumn(), ENC_K_ACT.length);
  if (sh.getMaxColumns() < ancho) sh.insertColumnsAfter(sh.getMaxColumns(), ancho - sh.getMaxColumns());
  if (n0 > 1) sh.getRange(2, 1, n0 - 1, ancho).clearContent();
  sh.getRange(1, 1, 1, ENC_K_ACT.length).setValues([ENC_K_ACT]);   // encabezado siempre al día
  if (filas.length) {
    if (sh.getMaxRows() < filas.length + 1) sh.insertRowsAfter(sh.getMaxRows(), filas.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, filas.length, ENC_K_ACT.length).setValues(filas);
    formatoActivos_(sh, filas.length);
  }
  res.total = filas.length;
  res.promociones = promos.length;
  var ahoraSkus = {};
  filas.forEach(function (f) { ahoraSkus[sku_(f[0])] = true; });
  res.salieron = Object.keys(previos).filter(function (k) { return k && !ahoraSkus[k]; }).length;
  setProp_('KILLERS_ACTIVOS_N', String(filas.length));
  return res;
}

/** Llave con la que C busca el mínimo en PRECIOS ERIK (misma regla que minimoDe_). */
function llavePrecio_(tabla, sku) {
  var s = sku_(sku);
  if (tabla.minimos[s]) return s;
  if (tabla.minimos[skuSinVariante_(s)]) return skuSinVariante_(s);
  if (!esCVA_(s) && tabla.minimos[skuBase_(s)]) return skuBase_(s);
  return '';
}

function formatoActivos_(sh, n) {
  var f = function (col, fmt) { sh.getRange(2, col, n, 1).setNumberFormat(fmt); };
  [3, 4, 5, 6, 8].forEach(function (c) { f(c, '$#,##0'); });
  f(7, '0.0%');
  [9, 10, 11].forEach(function (c) { f(c, 'dd/MM/yyyy HH:mm'); });
  [12, 14, 23].forEach(function (c) { f(c, '0.0%'); });
}

// ── Reporte por mes ───────────────────────────────────────────────────────

/** Menú: hoja "KILLERS <MES>" con cada SKU, sus rangos y lo vendido en cada uno. */
function reporteKillersMes() {
  var ui = SpreadsheetApp.getUi();
  var def = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM');
  var r = ui.prompt('Reporte de killers', '¿Qué mes? (formato ' + def + ')', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var mes = (r.getResponseText().trim() || def);
  var m = mes.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) { avisar_('Escribe el mes como ' + def); return; }
  try {
    var out = reporteKillersMes_(+m[1], +m[2]);
    avisar_('Listo: hoja "' + out.hoja + '"\n\nSKUs: ' + out.skus + '\nRangos: ' + out.rangos +
            '\nPiezas vendidas dentro de algún killer: ' + out.piezas);
  } catch (e) {
    logError_('KILLERS', e);
    avisar_('No se pudo armar el reporte:\n\n' + e);
  }
}

function reporteKillersMes_(anio, mes) {
  var ini = new Date(anio, mes - 1, 1).getTime();
  var fin = new Date(anio, mes, 1).getTime() - 1;
  var nombre = 'KILLERS ' + MESES[mes - 1] + ' ' + anio;

  var rangos = leerHistorico_().concat(leerKam_()).filter(function (k) {
    var a = k.ini instanceof Date ? ms_(k.ini) : -Infinity;
    var b = k.fin instanceof Date ? ms_(k.fin) : Infinity;
    return a <= fin && b >= ini;
  });

  // Ventas de Walmart del mes, por SKU general
  var ventas = {};
  var shW = libro_().getSheetByName(CFG.H.WALMART);
  if (shW) {
    // Por nombre de encabezado: aguanta que muevan columnas en WALMART.
    filasOrdenadas_(shW, ENC_WALMART).forEach(function (f) {
      var d = f[2] instanceof Date ? f[2] : fecha_(f[2]);
      if (!(d instanceof Date) || d.getTime() < ini || d.getTime() > fin) return;
      (ventas[skuBase_(f[6])] = ventas[skuBase_(f[6])] || []).push({ t: d.getTime(), p: num_(f[9]), q: num_(f[8]), imp: num_(f[10]) });
    });
  }

  var totalPiezas = 0, skus = {};
  var filas = rangos.sort(function (a, b) {
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : (ms_(a.ini) - ms_(b.ini));
  }).map(function (k) {
    skus[k.sku] = true;
    var a = k.ini instanceof Date ? ms_(k.ini) : ini, b = k.fin instanceof Date ? ms_(k.fin) : fin;
    var vs = (ventas[k.general] || []).filter(function (v) {
      return v.t >= a && v.t <= b && Math.abs(v.p - k.negoc) <= 1;
    });
    var q = vs.reduce(function (s, v) { return s + v.q; }, 0);
    var imp = vs.reduce(function (s, v) { return s + v.imp; }, 0);
    totalPiezas += q;
    return [k.sku, k.general, k.ini, k.fin, k.negoc, k.cupon, k.recibimos, k.comCup,
            k.origen, k.carga, q, imp];
  });

  var ss = libro_();
  var sh = ss.getSheetByName(nombre);
  if (sh) ss.deleteSheet(sh);
  sh = hoja_(nombre, ['SKU', 'SKU GENERAL', 'DESDE', 'HASTA', 'PRECIO NEGOCIADO', 'CUPON',
                      'RECIBIMOS', 'COMISION CUPON', 'ORIGEN', 'CARGA',
                      'PIEZAS VENDIDAS A ESE PRECIO', 'IMPORTE']);
  if (filas.length) agregarFilas_(sh, filas);
  return { hoja: nombre, skus: Object.keys(skus).length, rangos: filas.length, piezas: totalPiezas };
}

// ── Lectura para validar ventas ───────────────────────────────────────────

/**
 * Todos los rangos conocidos (histórico + KAM) indexados por SKU de la
 * publicación y por SKU general: {SKU: [{precio, ini, fin, com, normal, nCarga}]}.
 * Mientras el histórico esté vacío, usa N–Q de PRECIOS ERIK como respaldo.
 */
function killersParaValidar_(tabla) {
  var mapa = {}, total = 0;
  var add = function (llave, e) {
    if (!llave) return;
    (mapa[llave] = mapa[llave] || []).push(e);
  };
  var com = comisionesNormales_();
  var cats = categoriasConocidas_();
  var hist = leerHistorico_();
  var extra = msiExtra_(hist);

  hist.concat(leerKam_(tabla)).forEach(function (k) {
    if (!k.negoc) return;
    var cat = catExcepcion_(k.sku) || k.categoria || cats[k.sku] || cats[k.general] || '';
    var pr = deducirPromo_(k, cat, com, extra);
    var e = { precio: k.negoc, ini: k.ini, fin: k.fin, nCarga: k.nCarga,
              normal: pr.normal, com: pr.normal === '' ? '' : pr.normal - pr.redCla,
              normalMsi: pr.normalMsi, comMsi: pr.normalMsi === '' ? '' : pr.normalMsi - pr.redMsi };
    add(k.sku, e); add(k.general, e);
    total++;
  });

  // Promoción de categoría vigente (la guarda reconstruirActivos_): para las
  // ventas de SKUs de esa categoría sin killer. Solo si hay alguna.
  var promoCat = {};
  try { promoCat = JSON.parse(prop_('KILLERS_PROMO_CAT', '{}')); } catch (e) { promoCat = {}; }
  var catSku = {};
  if (Object.keys(promoCat).length) {
    try {
      var pc = promosCategoria_();
      leerDashboard_().forEach(function (d) {
        var ck = categoriaDeSku_(pc, d.sku, d.shelf);
        if (ck && promoCat[ck]) { catSku[d.sku] = ck; catSku[skuBase_(d.sku)] = catSku[skuBase_(d.sku)] || ck; }
      });
    } catch (e) {
      logWarn_('PRECIOS', 'No se pudo leer el dashboard para la promoción de categoría', { error: String(e && e.message || e) });
    }
  }

  if (!total && tabla && tabla.killersNQ) {
    tabla.killersNQ.forEach(function (k) {
      var e = { precio: k.precio, ini: '', fin: '', com: '', normal: '', comMsi: '', normalMsi: '', nCarga: 0 };
      add(k.general, e); add(k.pub, e); if (k.pub) add(skuBase_(k.pub), e);
      total++;
    });
  }
  return { mapa: mapa, total: total, promoCat: promoCat, catSku: catSku, extra: extra };
}

/** Categoría con promoción de un SKU (clave) o null. */
function catPromoDeSku_(killers, sku, grupo) {
  if (!killers.catSku) return null;
  var ll = llavesSku_(sku, grupo);
  for (var i = 0; i < ll.length; i++) if (killers.catSku[ll[i]]) return killers.catSku[ll[i]];
  return null;
}

/** ¿La promoción de la categoría de este SKU ya viene aplicada en el site? */
function promoYaEnSite_(killers, sku, grupo) {
  var ck = catPromoDeSku_(killers, sku, grupo);
  return !!(ck && killers.promoCat[ck] && killers.promoCat[ck].enSite === true);
}

/**
 * Promoción de categoría para una venta: {com, normal} o null. Premium usa el
 * par MSI. Si ya está aplicada en el site, null: el mínimo ya viene rebajado.
 */
function promoCategoriaDe_(killers, sku, grupo, premium) {
  if (!killers.promoCat) return null;
  var ll = llavesSku_(sku, grupo);
  for (var i = 0; i < ll.length; i++) {
    var ck = killers.catSku[ll[i]];
    var p = ck && killers.promoCat[ck];
    if (!p) continue;
    if (p.soloKillers === true) {
      // Videojuegos: la promo solo vale para los killers premium del KAM. Su venta
      // se valida contra mínimo − puntos; la clásica no tiene promoción.
      return premium && p.red > 0 ? { normal: p.red, com: 0, nombre: p.nombre } : null;
    }
    if (p.enSite === true) return null;
    var extra = killers.extra || MSI_EXTRA_DEF;
    return premium ? { normal: p.normal + extra, com: p.normal + extra - p.red, nombre: p.nombre }
                   : { normal: p.normal, com: p.normal - p.red, nombre: p.nombre };
  }
  return null;
}

/** ¿La fecha de la venta cae dentro del rango? Un día de colchón a cada lado. */
function enVentana_(e, fecha) {
  if (!(fecha instanceof Date)) return true;
  var t = fecha.getTime(), dia = 86400000;
  if (e.ini instanceof Date && t < e.ini.getTime() - dia) return false;
  if (e.fin instanceof Date && t > e.fin.getTime() + dia) return false;
  return true;
}

function llavesSku_(sku, grupo) {
  var ll = [sku_(sku), skuSinVariante_(sku), skuBase_(sku)];
  (grupo || []).forEach(function (x) { ll.push(sku_(x), skuBase_(x)); });
  return ll;
}

/** Killer con ese precio vigente en la fecha de la venta, o null. */
function killerQueAplica_(killers, sku, precio, fecha, grupo) {
  var ll = llavesSku_(sku, grupo);
  for (var i = 0; i < ll.length; i++) {
    var lista = killers.mapa[ll[i]];
    if (!lista) continue;
    for (var j = 0; j < lista.length; j++) {
      var e = lista[j];
      if (Math.abs(e.precio - precio) <= CFG.TOLERANCIA_PRECIO && enVentana_(e, fecha)) return e;
    }
  }
  return null;
}

/**
 * Promoción de comisión vigente en esa fecha (la de carga más nueva).
 * Premium usa el par MSI (normal + extra vs comisión MSI). Devuelve {com, normal}.
 */
function promoQueAplica_(killers, sku, fecha, grupo, premium) {
  var ll = llavesSku_(sku, grupo), mejor = null;
  for (var i = 0; i < ll.length; i++) {
    (killers.mapa[ll[i]] || []).forEach(function (e) {
      var c = premium ? e.comMsi : e.com, n = premium ? e.normalMsi : e.normal;
      if (c === '' || c === undefined || n === '' || n === undefined || !(c < n - 0.0001)) return;
      if (!enVentana_(e, fecha)) return;
      var soloMsi = !(e.com !== '' && e.normal !== '' && e.com < e.normal - 0.0001);
      if (!mejor || e.nCarga > mejor.nCarga) mejor = { com: c, normal: n, nCarga: e.nCarga, soloMsi: soloMsi };
    });
  }
  return mejor;
}
