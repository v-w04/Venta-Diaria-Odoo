/**
 * VENTA DIARIA ODOO 2026 — Walmart cobró distinto (leído de Site Sheet)
 *
 * Es la tarjeta "Walmart cobró distinto" del dashboard Ofertas Especiales del site: SKUs a los que Walmart
 * les cobró más comisión de la debida en los últimos cortes, y por qué. Site Sheet la baja del site y la deja
 * en sus hojas "Cobro distinto" (un renglón por SKU) y "Cobro distinto detalle" (un renglón por pedido).
 * Aquí NO se calcula nada: se copian tal cual (por ENCABEZADO) a COBRO DISTINTO y COBRO DISTINTO DETALLE,
 * igual que KILLERS BAJO MINIMO. Si Site Sheet no responde, queda la última copia.
 *
 * REGLA (Luis, 20/10/2026): un SKU que aparece en COBRO DISTINTO (por SKU EXACTO, no por SKU base) NO entra a
 * KILLERS ACTIVOS. Cuando cambia esa lista, KILLERS ACTIVOS se rehace sola.
 *
 * Se refresca junto con los killers (cada ~4 min, en sincronizarKillersSite_). Nunca truena.
 */
var CD_HOJA_SITE = 'Cobro distinto';                   // hojas en Site Sheet (resumen por SKU y detalle por pedido)
var CD_DET_SITE  = 'Cobro distinto detalle';
var CD_ESPEJO    = 'COBRO DISTINTO';                   // copias locales, en ESTE libro
var CD_DET_ESPEJO = 'COBRO DISTINTO DETALLE';
var CD_HUELLA    = 'COBRO_DISTINTO_HUELLA';
var CD_SKUS_HUELLA = 'COBRO_DISTINTO_SKUS_HUELLA';

function cdSincronizar_() {
  try {
    var r = cdCopiar_(CD_HOJA_SITE, CD_ESPEJO, CD_HUELLA, 'ENC_ESCRITOS_COBRO_DISTINTO', true);
    cdCopiar_(CD_DET_SITE, CD_DET_ESPEJO, CD_HUELLA + '_DET', 'ENC_ESCRITOS_COBRO_DISTINTO_DET', false);
    if (r) {
      // Si cambió la lista de SKUs, KILLERS ACTIVOS se rehace en la siguiente pasada.
      var skus = Object.keys(cdSkusExcluidos_()).sort().join('|');
      var h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, skus));
      if (h !== prop_(CD_SKUS_HUELLA)) {
        setProp_(CD_SKUS_HUELLA, h);
        setProp_(KS_PENDIENTE, '1');
      }
    }
  } catch (e) {
    logWarn_('COBRO DISTINTO', 'No se pudo copiar', { error: String(e && e.message || e) });
  }
}

/** Copia una hoja de Site Sheet a una de este libro. Devuelve true si la lectura salió bien (aunque no haya cambiado). */
function cdCopiar_(hojaSite, hojaLocal, claveHuella, claveEnc, resumen) {
  var sh = SpreadsheetApp.openById(CFG.SITE_SHEET_ID).getSheetByName(hojaSite);
  if (!sh) {
    ksAvisarUnaVez_('cd_falta_' + hojaSite, function () {
      logInfo_('COBRO DISTINTO', 'Site Sheet no tiene la hoja "' + hojaSite + '"; se usa la última copia si existe.');
    });
    return false;
  }
  var nf = sh.getLastRow(), nc = sh.getLastColumn();
  if (nf < 1 || nc < 1) return false;
  var todo = sh.getRange(1, 1, nf, nc).getValues();
  var enc = todo[0].map(function (x) { return String(x || ''); });
  // Se descartan las columnas sin título (vacías a la derecha)
  var cols = [];
  enc.forEach(function (h, i) { if (h !== '') cols.push(i); });
  var encC = cols.map(function (i) { return enc[i]; });
  var datos = todo.slice(1).filter(function (r) {
    return r.some(function (x) { return x !== '' && x !== null; }) && !/^COPIA DE SITE SHEET/i.test(String(r[0] || ''));
  }).map(function (r) { return cols.map(function (i) { return r[i]; }); });
  var huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
    JSON.stringify(encC) + '|' + JSON.stringify(datos)));
  if (libro_().getSheetByName(hojaLocal) && prop_(claveHuella) === huella) return true;

  var dest = hoja_(hojaLocal, null);
  var map = escribirPorEncabezado_(dest, encC, datos, { clave: claveEnc });
  if (dest.getFrozenRows() < 1) dest.setFrozenRows(1);
  dest.getRange(datos.length + 3, map.pos[0]).setValue('Copia de Site Sheet · ' + ahora_());
  encC.forEach(function (h, i) {
    var n = norm_(h);
    if (!datos.length) return;
    try {
      if (n === 'PESOS') formatoColumna_(dest, map, h, datos.length, '$#,##0.00');
    } catch (e1) { /* el formato nunca debe tirar la copia */ }
  });
  setProp_(claveHuella, huella);
  if (resumen) {
    var iP = encC.indexOf('PESOS'), pesos = 0;
    if (iP >= 0) datos.forEach(function (r) { pesos += Number(r[iP]) || 0; });
    logOK_('COBRO DISTINTO', 'Cambió la lista de "Walmart cobró distinto"', { skus: datos.length, pesos: Math.round(pesos * 100) / 100 });
  }
  return true;
}

/** SKUs EXACTOS de COBRO DISTINTO (copia local): { SKU: true }. Vacío si la hoja no existe todavía. */
function cdSkusExcluidos_() {
  var out = {};
  var sh = libro_().getSheetByName(CD_ESPEJO);
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 1) return out;
  var d = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var m = mapaColumnas_(d[0]), iS = m[norm_('SKU')];
  if (iS === undefined) return out;
  for (var i = 1; i < d.length; i++) {
    var s = sku_(d[i][iS]);
    if (s && !/^COPIA DE SITE SHEET/.test(String(d[i][iS]).toUpperCase())) out[s] = true;
  }
  return out;
}
