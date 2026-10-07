/**
 * CompararWalmart.gs
 * Compara KILLERS ACTIVOS (killers + promociones que baja el site) contra los
 * precios reales de Walmart (hoja Inventario del WALMART DASHBOARD) y contra
 * el MÍNIMO de Erik. Solo LEE: no toca KILLERS ACTIVOS.
 * Resultado en la hoja COMPARAR WALMART, ordenado del que más baja del mínimo
 * al que menos.
 *
 *  · MÍNIMO APLICABLE: killers = mínimo de Erik; promociones = mínimo de Erik menos el
 *    descuento de comisión de la promo (que es la Carga, ver Killers.gs).
 *  · ENTRA = precio en Walmart + cupón (el cupón lo paga Walmart).
 *  · % VS MÍNIMO = (ENTRA − mínimo) / mínimo.
 *  · DECISIÓN, con dos cortes que tú ajustas (menú → Configurar bandas):
 *      OK ............ ENTRA ≥ mínimo
 *      DEJAR ......... baja del mínimo hasta el 1er corte (por defecto 3%)
 *      REVISAR KAM ... baja entre el 1er y el 2º corte (por defecto 10%)
 *      CAMBIO / QUITAR  baja más que el 2º corte
 *  · Aparte avisa si Walmart no tiene publicado el SKU (precio 0), si no hay
 *    mínimo de Erik, o si el precio de Walmart no es igual a tu Carga.
 */
var CW_ENC = ['SKU', 'TIPO', 'KAM', 'DECISIÓN', '% VS MÍNIMO', 'ENTRA (PRECIO + CUPÓN)', 'MÍNIMO APLICABLE',
              'PRECIO EN WALMART', 'CARGA (LO QUE PUBLICAS)', 'DIFERENCIA vs CARGA', 'AVISO',
              'ESTADO EN WALMART', 'STOCK WALMART', 'PRODUCTO'];
var CW_BANDA1_DEF = 3, CW_BANDA2_DEF = 10;

/** Cortes de las bandas, en % positivos (3 = "hasta 3% abajo del mínimo"). */
function cwBandas_() {
  var b1 = Number(prop_('CW_BANDA1', String(CW_BANDA1_DEF))), b2 = Number(prop_('CW_BANDA2', String(CW_BANDA2_DEF)));
  if (!(b1 > 0) || !(b2 > b1)) { b1 = CW_BANDA1_DEF; b2 = CW_BANDA2_DEF; }
  return { b1: b1, b2: b2 };
}

/** Botón del menú: cambiar los cortes de las bandas cuando quieras. */
function configurarBandasAlerta() {
  var ui = SpreadsheetApp.getUi(), b = cwBandas_();
  var r1 = ui.prompt('Bandas de alerta (1 de 2)',
    'Hasta qué % por debajo del mínimo de Erik el killer se DEJA.\n' +
    'Ahora: ' + b.b1 + '%\n\nEscribe el número (solo el número, ej. 3):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var n1 = Number(String(r1.getResponseText()).replace(',', '.').replace('%', '').trim());
  if (!(n1 > 0)) { ui.alert('Número no válido. No se cambió nada.'); return; }
  var r2 = ui.prompt('Bandas de alerta (2 de 2)',
    'Desde qué % por debajo del mínimo se pide CAMBIO o se QUITA el killer.\n' +
    'Entre ' + n1 + '% y ese número = REVISAR con el KAM.\nAhora: ' + b.b2 + '%\n\nEscribe el número (ej. 10):',
    ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var n2 = Number(String(r2.getResponseText()).replace(',', '.').replace('%', '').trim());
  if (!(n2 > n1)) { ui.alert('El segundo corte debe ser mayor que ' + n1 + '. No se cambió nada.'); return; }
  setProp_('CW_BANDA1', String(n1));
  setProp_('CW_BANDA2', String(n2));
  setProp_('HUELLA_COMPARAR', '');            // fuerza reescribir la hoja con los cortes nuevos
  var r = compararWalmart_();
  if (r.error) { ui.alert('Bandas guardadas (' + n1 + '% y ' + n2 + '%), pero: ' + r.error); return; }
  ui.alert('Bandas guardadas:\n  DEJAR: hasta ' + n1 + '% abajo\n  REVISAR KAM: ' + n1 + '% a ' + n2 +
    '%\n  CAMBIO / QUITAR: más de ' + n2 + '%\n\nSe actualizó la hoja COMPARAR WALMART.');
}

/** Menú: igual que la automática, pero con aviso en pantalla. */
function compararConWalmart() {
  var r = compararWalmart_();
  if (r.error) { SpreadsheetApp.getUi().alert(r.error); return; }
  var c = r.cont;
  SpreadsheetApp.getUi().alert('Comparado contra Walmart: ' + r.total + ' SKUs\n\n' +
    'OK: ' + c.OK + '\nDEJAR: ' + c.DEJAR + '\nREVISAR KAM: ' + c.REVISAR + '\nCAMBIO / QUITAR: ' + c.CAMBIO +
    '\nSin mínimo en Erik: ' + c.SINMIN + '\nNo publicados en Walmart: ' + c.NOPUB +
    '\n\nDetalle en la hoja COMPARAR WALMART.');
}

/** Automática: la llama revisarPreciosAuto en cada revisión. Nunca avisa en pantalla ni rompe la revisión. */
function compararWalmartAuto_() {
  try {
    var r = compararWalmart_();
    if (r.error) logWarn_('COMPARAR WALMART', r.error);
  } catch (e) { logWarn_('COMPARAR WALMART', 'No se pudo comparar', { error: String(e && e.message || e) }); }
}

/**
 * Puntos de promoción (fracción, 0.07) que aplican a un SKU para el análisis:
 *   1) si el SKU está en la lista de promociones del site (APLICA = SI), los del site;
 *   2) si no, y su categoría es "PROMO SOLO EN KILLERS" (Videojuegos), la de COMISIONES
 *      cuando es premium (los killers del KAM son premium).
 * 0 si no le toca promoción.
 */
function cwPuntosPromo_(sku, kam, promos, pc) {
  var ps = promos ? promoSiteDeSku_(promos, sku) : null;
  if (ps && ps.red > 0) return ps.red;
  if (pc && tipoPublicacion_(sku) === 'PREMIUM') {
    var ck = categoriaDeSku_(pc, sku, kam);
    var i = ck && pc.cats[ck];
    if (i && i.soloKillers && i.red > 0) return i.red;
  }
  return 0;
}

function compararWalmart_() {
  var act = libro_().getSheetByName(K_ACT);
  if (!act || act.getLastRow() < 2) { return { error: 'KILLERS ACTIVOS está vacía. Corre primero "Traer killers de Site Sheet".' }; }
  var bd = cwBandas_();

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
  var a = act.getRange(1, 1, act.getLastRow(), act.getLastColumn()).getValues();
  var ma = mapaColumnas_(a[0]), g = function (k) { return ma[norm_(k)]; };
  var xS = g('SKU'), xC = g('PRECIO'), xH = g('Carga'), xO = g('ORIGEN'), xN = g('Detalles del artículo'),
      xE = g('Cupón de oferta'), xK = g('KAM');
  if (xS === undefined || xH === undefined || xC === undefined) { return { error: 'KILLERS ACTIVOS no trae SKU/PRECIO/Carga.' }; }

  var promos = null, pc = null;
  try { promos = promosDelSite_(); } catch (e) { promos = null; }
  try { pc = promosCategoria_(); } catch (e) { pc = null; }

  var cont = { OK: 0, DEJAR: 0, REVISAR: 0, CAMBIO: 0, SINMIN: 0, NOPUB: 0 }, out = [];
  for (var r = 1; r < a.length; r++) {
    var f = a[r], sku = sku_(f[xS]);
    if (!sku) continue;
    var promo = xO !== undefined && String(f[xO]) === 'PROMO CATEGORIA';
    var carga = num_(f[xH]), min = typeof f[xC] === 'number' ? f[xC] : 0;
    // Killer: se compara contra el mínimo de Erik (los cupones del KAM cubren la diferencia).
    // Promoción: el mínimo aplicable ya trae el descuento de comisión = la Carga (mín − puntos%).
    if (promo && min > 0 && carga > 0) min = carga;
    // Killer que además trae promoción (site o Videojuegos): se compara contra mínimo − puntos.
    var kamCat = catExcepcion_(sku) || (xK === undefined ? '' : f[xK]);
    var red = (!promo && min > 0) ? cwPuntosPromo_(sku, kamCat, promos, pc) : 0;
    if (red > 0) min = min * (1 - red);
    var cupon = xE === undefined ? 0 : num_(f[xE]);
    var w = wm[sku], dec, pct = '', entra = '', dif = '', aviso = '', wp = '';
    if (!w || !(w.precio > 0)) {
      dec = 'NO PUBLICADO EN WALMART'; cont.NOPUB++;
      aviso = w ? 'Walmart tiene el precio en 0' : 'No está en el dashboard';
      wp = w ? w.precio : '';
    } else {
      wp = w.precio;
      entra = wp + cupon;
      dif = wp - carga;
      if (!(min > 0)) { dec = 'SIN MÍNIMO EN ERIK'; cont.SINMIN++; }
      else {
        pct = (entra - min) / min;                       // fracción: -0.043 = 4.3% abajo
        var baja = -pct * 100;
        if (baja <= 0.05) { dec = 'OK'; cont.OK++; }
        else if (baja <= bd.b1) { dec = 'DEJAR'; cont.DEJAR++; }
        else if (baja <= bd.b2) { dec = 'REVISAR KAM'; cont.REVISAR++; }
        else { dec = 'CAMBIO / QUITAR'; cont.CAMBIO++; }
      }
      if (Math.abs(dif) >= 1) aviso = wp > carga ? 'Walmart más alto que tu Carga' : 'Walmart más bajo que tu Carga';
    }
    out.push([sku, promo ? 'PROMO' : red > 0 ? 'KILLER + PROMO' : 'KILLER', kamCat, dec, pct, entra, min || '',
              wp, carga || '', dif, aviso, w ? w.estado : '', w ? w.stock : '',
              xN === undefined ? '' : f[xN]]);
  }
  // Orden: lo que más baja del mínimo primero; luego avisos; al final los OK
  var peso = function (x) {
    return x[3] === 'CAMBIO / QUITAR' ? 0 : x[3] === 'REVISAR KAM' ? 1 : x[3] === 'DEJAR' ? 2 :
           x[3] === 'NO PUBLICADO EN WALMART' ? 3 : x[3] === 'SIN MÍNIMO EN ERIK' ? 4 : 5;
  };
  out.sort(function (p, q) {
    return (peso(p) - peso(q)) || ((typeof p[4] === 'number' ? p[4] : 9) - (typeof q[4] === 'number' ? q[4] : 9));
  });

  // Solo se reescribe la hoja si el resultado cambió (la revisión corre cada pocos minutos)
  var huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
    JSON.stringify(out) + '|' + bd.b1 + '|' + bd.b2));
  var h0 = libro_().getSheetByName(CFG.H.COMPARAR);
  if (h0 && prop_('HUELLA_COMPARAR') === huella) return { total: out.length, cont: cont };
  var h = hoja_(CFG.H.COMPARAR, CW_ENC);
  var ancho = Math.max(h.getLastColumn(), CW_ENC.length);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, ancho).clearContent().clearFormat().clearNote();
  h.getRange(1, 1, 1, ancho).clearContent();
  h.getRange(1, 1, 1, CW_ENC.length).setValues([CW_ENC]).setFontWeight('bold');
  h.getRange(1, 4).setNote('OK: entra ≥ mínimo\nDEJAR: hasta ' + bd.b1 + '% abajo\nREVISAR KAM: ' + bd.b1 + '% a ' + bd.b2 +
    '%\nCAMBIO / QUITAR: más de ' + bd.b2 + '%\n(Se cambian en el menú: Configurar bandas de alerta)');
  if (out.length) {
    h.getRange(2, 1, out.length, CW_ENC.length).setValues(out);
    h.getRange(2, 5, out.length, 1).setNumberFormat('0.0%');
    h.getRange(2, 6, out.length, 5).setNumberFormat('#,##0.00');
    var col = out.map(function (x) {
      var k = x[3];
      return [k === 'CAMBIO / QUITAR' ? '#e06666' : k === 'REVISAR KAM' ? '#f9cb9c' : k === 'DEJAR' ? '#fff2cc' :
              k === 'OK' ? '#d9ead3' : '#d9d9d9'];
    });
    h.getRange(2, 4, out.length, 1).setBackgrounds(col);
  }
  h.setFrozenRows(1);
  setProp_('HUELLA_COMPARAR', huella);
  logInfo_('COMPARAR WALMART', 'Comparación terminada', cont);
  return { total: out.length, cont: cont };
}
