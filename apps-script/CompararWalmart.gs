/**
 * CompararWalmart.gs
 * Compara KILLERS ACTIVOS contra los precios reales de Walmart (hoja
 * Inventario del WALMART DASHBOARD). Solo LEE: no toca KILLERS ACTIVOS.
 * Resultado en la hoja COMPARAR WALMART.
 *
 *  · PROMO CATEGORIA: la Carga ES el precio que publicas → debe ser igual al de Walmart.
 *  · KILLER: la Carga es el precio negociado de la oferta (no el precio de lista),
 *    así que lo que se valida es que el precio de LISTA en Walmart no esté
 *    por debajo del mínimo de Erick.
 *  · En ambos casos: Walmart por debajo del mínimo = ALERTA.
 */
var CW_ENC = ['SKU', 'TIPO', 'RESULTADO', 'PRECIO EN WALMART', 'CARGA (LO QUE PUBLICAS)',
              'DIFERENCIA', 'MÍNIMO ERIK', 'ESTADO EN WALMART', 'STOCK WALMART', 'PRODUCTO'];

/** Menú: igual que la automática, pero con aviso en pantalla. */
function compararConWalmart() {
  var r = compararWalmart_();
  if (r.error) { SpreadsheetApp.getUi().alert(r.error); return; }
  var cont = r.cont;
  SpreadsheetApp.getUi().alert('Comparado contra Walmart: ' + r.total + ' SKUs\n\n' +
    'OK: ' + cont.OK + '\nALERTA (debajo del mínimo): ' + cont.ALERTA +
    '\nPrecio distinto a tu Carga: ' + cont.DIF + '\nNo están en el dashboard: ' + cont.NO +
    '\n\nDetalle en la hoja COMPARAR WALMART.');
}

/** Automática: la llama revisarPreciosAuto en cada revisión. Nunca avisa en pantalla ni rompe la revisión. */
function compararWalmartAuto_() {
  try {
    var r = compararWalmart_();
    if (r.error) logWarn_('COMPARAR WALMART', r.error);
  } catch (e) { logWarn_('COMPARAR WALMART', 'No se pudo comparar', { error: String(e && e.message || e) }); }
}

function compararWalmart_() {
  var act = libro_().getSheetByName(K_ACT);
  if (!act || act.getLastRow() < 2) { return { error: 'KILLERS ACTIVOS está vacía. Corre primero "Traer killers de Site Sheet".' }; }

  // Precios de Walmart por SKU
  var sh = SpreadsheetApp.openById(CFG.WM_DASH.ID).getSheetByName(CFG.WM_DASH.HOJA);
  if (!sh) { return { error: 'El dashboard no tiene la hoja Inventario.' }; }
  var d = sh.getDataRange().getValues();
  var m = mapaColumnas_(d[0]), c = function (k) { return m[norm_(k)]; };
  var iS = c('sku'), iP = c('price'), iSt = c('publishedStatus'), iT = c('stockTotal');
  if (iS === undefined || iP === undefined) { return { error: 'El dashboard no trae sku/price.' }; }
  var wm = {};
  for (var i = 1; i < d.length; i++) {
    var s = sku_(d[i][iS]);
    if (s) wm[s] = { precio: num_(d[i][iP]), estado: iSt === undefined ? '' : String(d[i][iSt] || ''),
                     stock: iT === undefined ? '' : num_(d[i][iT]) };
  }

  // KILLERS ACTIVOS por encabezado
  var nc = act.getLastColumn();
  var a = act.getRange(1, 1, act.getLastRow(), nc).getValues();
  var ma = mapaColumnas_(a[0]), g = function (k) { return ma[norm_(k)]; };
  var xS = g('SKU'), xC = g('PRECIO'), xH = g('Carga'), xO = g('ORIGEN'), xN = g('Detalles del artículo');
  if (xS === undefined || xH === undefined || xC === undefined) { return { error: 'KILLERS ACTIVOS no trae SKU/PRECIO/Carga.' }; }

  var cont = { OK: 0, DIF: 0, ALERTA: 0, NO: 0 }, out = [];
  for (var r = 1; r < a.length; r++) {
    var f = a[r], sku = sku_(f[xS]);
    if (!sku) continue;
    var promo = xO !== undefined && String(f[xO]) === 'PROMO CATEGORIA';
    var carga = num_(f[xH]), min = typeof f[xC] === 'number' ? f[xC] : 0;
    var w = wm[sku], res, wp = '', dif = '';
    if (!w) { res = 'NO ESTÁ EN EL DASHBOARD'; cont.NO++; }
    else {
      wp = w.precio;
      if (min > 0 && wp < min - 0.5) { res = 'ALERTA: Walmart debajo del mínimo'; cont.ALERTA++; }
      else if (promo) {
        dif = wp - carga;
        if (Math.abs(dif) < 1) { res = 'OK'; cont.OK++; }
        else { res = wp > carga ? 'SUBIR CAMBIO: Walmart más alto que tu Carga' : 'Walmart más bajo que tu Carga'; cont.DIF++; }
      } else { res = 'OK (killer: lista ≥ mínimo)'; cont.OK++; dif = wp - carga; }
    }
    out.push([sku, promo ? 'PROMO' : 'KILLER', res, wp, carga || '', dif, min || '',
              w ? w.estado : '', w ? w.stock : '', xN === undefined ? '' : f[xN]]);
  }
  // Primero lo que requiere acción
  var peso = function (x) { return x[2].indexOf('ALERTA') === 0 ? 0 : x[2].indexOf('OK') === 0 ? 3 : x[2].indexOf('NO ESTÁ') === 0 ? 2 : 1; };
  out.sort(function (p, q) { return peso(p) - peso(q); });

  // Solo se reescribe la hoja si el resultado cambió (la revisión corre cada pocos minutos)
  var huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(out)));
  var h0 = libro_().getSheetByName(CFG.H.COMPARAR);
  if (h0 && prop_('HUELLA_COMPARAR') === huella) return { total: out.length, cont: cont };
  var h = hoja_(CFG.H.COMPARAR, CW_ENC);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, Math.max(h.getLastColumn(), CW_ENC.length)).clearContent().clearFormat();
  h.getRange(1, 1, 1, CW_ENC.length).setValues([CW_ENC]).setFontWeight('bold');
  if (out.length) {
    h.getRange(2, 1, out.length, CW_ENC.length).setValues(out);
    h.getRange(2, 4, out.length, 4).setNumberFormat('#,##0.00');
    var col = out.map(function (x) {
      var rj = x[2].indexOf('ALERTA') === 0, am = x[2].indexOf('OK') !== 0;
      return [rj ? '#f4cccc' : am ? '#fff2cc' : '#d9ead3'];
    });
    h.getRange(2, 3, out.length, 1).setBackgrounds(col);
  }
  h.setFrozenRows(1);
  setProp_('HUELLA_COMPARAR', huella);
  logInfo_('COMPARAR WALMART', 'Comparación terminada', cont);
  return { total: out.length, cont: cont };
}
