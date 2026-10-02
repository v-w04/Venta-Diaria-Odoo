/**
 * VENTA DIARIA ODOO 2026 — Promociones de comisión (leídas del site)
 *
 * El site (Ofertas Especiales → Promociones) captura la promoción SKU por SKU,
 * no por categoría: de 200 cámaras puede haber promoción en 8. Site Sheet ya
 * baja esa lista cada hora a su hoja "Promociones" (su Promos.gs, misma cookie
 * que los killers). Aquí solo se LEE esa hoja — Site Sheet es fuente permitida
 * y leerla no gasta cuota de UrlFetch.
 *
 * Para qué sirve: para que KILLERS ACTIVOS proponga EXACTAMENTE los SKUs que
 * de verdad traen promoción, en vez de proponer toda la categoría.
 *
 * El PRECIO no se toca aquí: el mínimo que baja de Site Sheet a PRECIOS ERIK ya
 * viene rehecho con la comisión final. Esto es solo "a quién proponerle killer".
 *
 * Si la hoja no existe, está vacía o no se puede leer, devuelve null y el
 * llamador se queda con la regla vieja (toda la categoría). Nunca truena.
 */

var PS_HOJA  = 'Promociones';
var PS_CACHE = 'PROMOS_SITE';      // caché de 10 min (la hoja cambia cada hora)

/**
 * Encabezados de la hoja "Promociones" de Site Sheet, verificados contra la
 * hoja real el 02/10/2026. Site Sheet la arma con las LLAVES que manda el site,
 * así que si el site cambia un nombre, se agrega aquí y listo. Si no se
 * encuentra el SKU, el módulo deja en el LOG los encabezados REALES que vio.
 *
 * La hoja trae 22 columnas; aquí solo se usan las que hacen falta:
 *   SKU · CATEGORIA · NOMBRE · COM NORMAL · REDUCCION · COM FINAL
 *   APLICA · ENCONTRADO · MIN CLASICA · MIN PREMIUM
 * (ANTES/PRECIO CLASICA·PREMIUM, CATALOGO, MOTIVO, POR, TS… no se usan.)
 */
var PS_ALIAS = {
  SKU:        ['SKU', 'SKU CAPTURADO', 'SKU BASE', 'SKU GENERAL'],
  CAT:        ['CATEGORIA', 'CATEGORIA WALMART'],
  NOMBRE:     ['NOMBRE', 'PRODUCTO', 'TITULO'],
  NORMAL:     ['COM NORMAL', 'COMISION NORMAL', 'COMISION'],
  RED:        ['REDUCCION', 'PUNTOS'],
  FINAL:      ['COM FINAL', 'COMISION FINAL'],
  APLICA:     ['APLICA', 'ACTIVA', 'VIGENTE'],
  // ENCONTRADO = NO → el SKU capturado no existe en /precios-em (son las
  // variantes -2/-3 que el site no reconoce). Son los que tu pantalla cuenta
  // como "NO APLICAN". No traen precio ni mínimo: no sirve proponerlos.
  ENCONTRADO: ['ENCONTRADO'],
  MINCLA:     ['MIN CLASICA', 'MINIMO CLASICA'],
  MINPRE:     ['MIN PREMIUM', 'MINIMO PREMIUM']
};

/**
 * Lee la hoja "Promociones" de Site Sheet.
 * Devuelve null si no se pudo (y entonces se usa la regla por categoría), o
 * { skus: {SKU: {cat, nombre, normal, red, final}}, n: <cuántas> }.
 * Las llaves incluyen el SKU tal cual, su base y su versión sin -2..9, para que
 * las variantes (-MSI, -MSI-3, -2) hereden la promoción del SKU base.
 */
function promosDelSite_() {
  var cache = CacheService.getScriptCache();
  try {
    var guardado = cache.get(PS_CACHE);
    if (guardado) return JSON.parse(guardado);
  } catch (e) { /* el caché es opcional */ }

  var r = null;
  try {
    r = psLeerHoja_();
  } catch (e) {
    psAvisarUnaVez_('error', function () {
      logWarn_('PROMOS SITE', 'No se pudo leer la hoja "' + PS_HOJA + '" de Site Sheet; ' +
               'se usa la promoción por categoría de COMISIONES', { error: String(e && e.message || e) });
    });
    return null;
  }

  try { cache.put(PS_CACHE, JSON.stringify(r), 600); } catch (e) { /* opcional */ }
  return r;
}

function psLeerHoja_() {
  var ss = SpreadsheetApp.openById(CFG.SITE_SHEET_ID);
  var sh = ss.getSheetByName(PS_HOJA);
  if (!sh) {
    psAvisarUnaVez_('falta', function () {
      logWarn_('PROMOS SITE', 'Site Sheet todavía no tiene la hoja "' + PS_HOJA + '". ' +
               'Córrele una vez el menú "🏷️ Bajar promociones del site".');
    });
    return null;
  }

  var nf = sh.getLastRow(), nc = sh.getLastColumn();
  if (nf < 2 || nc < 1) return null;

  var enc = sh.getRange(1, 1, 1, nc).getValues()[0];
  var mapa = mapaColumnas_(enc);
  var col = function (llave) {
    var lista = PS_ALIAS[llave];
    for (var i = 0; i < lista.length; i++) {
      var j = mapa[norm_(lista[i])];
      if (j !== undefined) return j;
    }
    return -1;
  };

  var iSku = col('SKU');
  if (iSku < 0) {
    // Lo único que de verdad hace falta. Si no está, se deja en el LOG qué
    // encabezados trae la hoja para agregar el alias correcto.
    psAvisarUnaVez_('sinsku', function () {
      logWarn_('PROMOS SITE', 'La hoja "' + PS_HOJA + '" no trae una columna de SKU que yo reconozca',
               { encabezadosReales: enc.map(String).filter(function (x) { return x !== ''; }) });
    });
    return null;
  }

  var iCat = col('CAT'), iNom = col('NOMBRE'),
      iNor = col('NORMAL'), iRed = col('RED'), iFin = col('FINAL'),
      iApl = col('APLICA'), iEnc = col('ENCONTRADO'),
      iMinC = col('MINCLA'), iMinP = col('MINPRE');

  var datos = sh.getRange(2, 1, nf - 1, nc).getValues();
  var skus = {}, n = 0, noAplican = 0;
  var esNo = function (v) {
    var a = norm_(v);
    return a === 'NO' || a === 'FALSE' || a === '0';
  };

  datos.forEach(function (f) {
    var s = sku_(f[iSku]);
    if (!s) return;

    // Los que no se proponen (en tu pantalla, 5 de 26):
    //   APLICA = NO      → la promoción está apagada
    //   ENCONTRADO = NO  → el SKU no existe en /precios-em (variantes -2/-3),
    //                      no trae precio ni mínimo
    if (iApl >= 0 && esNo(f[iApl]))  { noAplican++; return; }
    if (iEnc >= 0 && esNo(f[iEnc]))  { noAplican++; return; }

    var info = {
      cat:    iCat >= 0 ? String(f[iCat] || '') : '',
      nombre: iNom >= 0 ? String(f[iNom] || '') : '',
      normal: iNor >= 0 ? psPct_(f[iNor]) : '',
      red:    iRed >= 0 ? psPuntos_(f[iRed]) : '',
      final:  iFin >= 0 ? psPct_(f[iFin]) : '',
      minC:   iMinC >= 0 ? num_(f[iMinC]) : '',
      minP:   iMinP >= 0 ? num_(f[iMinP]) : ''
    };
    n++;

    // El SKU tal cual y sus formas base: así una promo capturada en el SKU
    // base cubre su -MSI, -MSI-3 y -2, que es como lo captura el site.
    [s, skuBase_(s), skuSinVariante_(s)].forEach(function (k) {
      if (k && !skus[k]) skus[k] = info;
    });
  });

  if (!n) return null;
  return { skus: skus, n: n, noAplican: noAplican };
}

/** "10%" / 0.1 / 10 → 0.1. Vacío si no se puede. */
function psPct_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return '';
  var s = String(v).trim();
  var tienePct = s.indexOf('%') >= 0;
  var n = num_(s);
  if (!n && n !== 0) return '';
  if (tienePct) return n / 100;
  return n > 1 ? n / 100 : n;        // 10 → 0.10 · 0.1 → 0.1
}

/** Los puntos de reducción vienen como número entero ("7"). → 0.07 */
function psPuntos_(v) {
  var p = psPct_(v);
  return p === '' ? '' : p;
}

function psAvisarUnaVez_(clave, fn) {
  try {
    var k = 'PROMOS_SITE_AVISO';
    var marca = hoy_() + '|' + clave;
    if (prop_(k) === marca) return;
    setProp_(k, marca);
    fn();
  } catch (e) { /* avisar nunca debe tirar la corrida */ }
}

/**
 * ¿Este SKU trae promoción capturada en el site?
 * Devuelve la info o null. Prueba el SKU, su base y su versión sin -2..9.
 */
function promoSiteDeSku_(promos, sku) {
  if (!promos || !promos.skus) return null;
  var s = sku_(sku);
  return promos.skus[s] || promos.skus[skuSinVariante_(s)] || promos.skus[skuBase_(s)] || null;
}
