/**
 * CompararWalmart.gs
 * Compara KILLERS ACTIVOS (los killers que baja el site) contra los
 * precios reales de Walmart (hoja Inventario del WALMART DASHBOARD) y contra
 * el MÍNIMO de Erik. Solo LEE: no toca KILLERS ACTIVOS.
 * Resultado en la hoja COMPARAR WALMART, ordenado del que más baja del mínimo
 * al que menos.
 *
 *  · MÍNIMO APLICABLE: el mínimo de Erik; si el SKU está en KILLERS BAJO MINIMO, el mínimo que
 *    reporta el site (ya con sus promociones). Los cupones del KAM cubren la diferencia.
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
 * Videojuegos: el killer se compara contra la publicación PREMIUM real de Walmart (nunca la clásica).
 *  · El SKU del killer manda (tal cual, con su -MSI / -MSI-2…). Si existe en Walmart, se usa ese.
 *  · Si el killer vino sin -MSI y Walmart tiene UNA sola premium de ese SKU base, se usa esa.
 *  · Si no coincide (p. ej. el killer dice -MSI-3 y Walmart publica -MSI-2) NO se cambia el SKU:
 *    solo se avisa cuáles premium tiene Walmart. Nunca se inventa el sufijo.
 */
function cwPremiumVj_(sku, wm) {
  var premium = tipoPublicacion_(sku) === 'PREMIUM';
  if (premium && wm[sku] && wm[sku].precio > 0) return { sku: sku, aviso: '' };
  var base = skuBase_(sku), cands = Object.keys(wm).filter(function (k) {
    return k !== sku && tipoPublicacion_(k) === 'PREMIUM' && wm[k].precio > 0 && skuBase_(k) === base;
  });
  if (!premium && cands.length === 1) return { sku: cands[0], aviso: 'Videojuegos: el killer venía sin MSI, se tomó ' + cands[0] };
  if (cands.length) return { sku: sku, aviso: 'Videojuegos: el killer dice ' + sku + ' y Walmart tiene ' + cands.join(', ') };
  return { sku: sku, aviso: '' };
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
  var iS = c('sku'), iP = c('price'), iSt = c('publishedStatus'), iT = c('stockTotal'), iSh = c('shelf'), iPt = c('productType');
  if (iS === undefined || iP === undefined) { return { error: 'El dashboard no trae sku/price.' }; }
  var wm = {};
  for (var i = 1; i < d.length; i++) {
    var s = sku_(d[i][iS]);
    if (s) wm[s] = { precio: num_(d[i][iP]), estado: iSt === undefined ? '' : String(d[i][iSt] || ''),
                     stock: iT === undefined ? '' : num_(d[i][iT]),
                     shelf: iSh === undefined ? '' : String(d[i][iSh] || ''),
                     tipoProd: iPt === undefined ? '' : String(d[i][iPt] || '') };
  }

  // KILLERS ACTIVOS por encabezado
  var a = act.getRange(1, 1, act.getLastRow(), act.getLastColumn()).getValues();
  var ma = mapaColumnas_(a[0]), g = function (k) { return ma[norm_(k)]; };
  var xS = g('SKU'), xC = g('PRECIO'), xH = g('Carga'), xN = g('Detalles del artículo'),
      xE = g('Cupón de oferta'), xK = g('KAM');
  if (xS === undefined || xH === undefined || xC === undefined) { return { error: 'KILLERS ACTIVOS no trae SKU/PRECIO/Carga.' }; }

  // Mínimo aplicable que reporta el site (hoja Killers bajo minimo, ya con sus promociones); si el SKU no está ahí, el de Erik.
  var bm = null;
  try { bm = bajoMinimoDelSite_(); } catch (e) { bm = null; }
  var actCat = [];     // para la hoja CATEGORIA REVISAR
  var cont = { OK: 0, DEJAR: 0, REVISAR: 0, CAMBIO: 0, SINMIN: 0, NOPUB: 0 }, out = [];
  for (var r = 1; r < a.length; r++) {
    var f = a[r], sku = sku_(f[xS]);
    if (!sku) continue;
    var carga = num_(f[xH]), min = typeof f[xC] === 'number' ? f[xC] : 0;
    var kamCat = xK === undefined ? '' : f[xK];
    actCat.push({ sku: sku, kam: kamCat, prod: xN === undefined ? '' : f[xN] });
    var eBm = bm && bm.skus[sku];
    if (eBm && eBm.minimo > 0) min = eBm.minimo;
    var cupon = xE === undefined ? 0 : num_(f[xE]);
    var avisoVj = '', skuWm = sku;
    if (/VIDEOJUEGO/.test(norm_(kamCat))) { var rv = cwPremiumVj_(sku, wm); skuWm = rv.sku; avisoVj = rv.aviso; }
    var w = wm[skuWm], dec, pct = '', entra = '', dif = '', aviso = '', wp = '';
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
        else if (precioLibre_(sku)) { dec = 'OK (PRECIO LIBRE)'; cont.OK++; }
        else if (baja <= bd.b1) { dec = 'DEJAR'; cont.DEJAR++; }
        else if (baja <= bd.b2) { dec = 'REVISAR KAM'; cont.REVISAR++; }
        else { dec = 'CAMBIO / QUITAR'; cont.CAMBIO++; }
      }
      if (Math.abs(dif) >= 1) aviso = wp > carga ? 'Walmart más alto que tu Carga' : 'Walmart más bajo que tu Carga';
    }
    if (avisoVj) aviso = avisoVj + (aviso ? ' · ' + aviso : '');
    out.push([sku, 'KILLER', kamCat, dec, pct, entra, min || '',
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

  try { categoriasRevisar_(actCat, wm, bm); } catch (eCat) { logWarn_('CATEGORIA REVISAR', 'No se pudo armar', { error: String(eCat && eCat.message || eCat) }); }

  // Solo se reescribe la hoja si el resultado cambió (la revisión corre cada pocos minutos)
  var huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
    JSON.stringify(out) + '|' + bd.b1 + '|' + bd.b2));
  var h0 = libro_().getSheetByName(CFG.H.COMPARAR);
  if (h0 && prop_('HUELLA_COMPARAR') === huella) return { total: out.length, cont: cont };
  var h = hoja_(CFG.H.COMPARAR, CW_ENC);
  var n0c = h.getLastRow();
  // Solo las columnas del script, ubicadas por encabezado: tus columnas, formatos y validaciones no se tocan.
  var map = escribirPorEncabezado_(h, CW_ENC, out, { clave: 'ENC_ESCRITOS_COMPARAR' });
  var cDec = map.pos[3];
  h.getRange(1, cDec).setNote('OK: entra ≥ mínimo\nDEJAR: hasta ' + bd.b1 + '% abajo\nREVISAR KAM: ' + bd.b1 + '% a ' + bd.b2 +
    '%\nCAMBIO / QUITAR: más de ' + bd.b2 + '%\n(Se cambian en el menú: Configurar bandas de alerta)');
  var nBg = Math.max(n0c - 1, out.length);
  if (nBg > 0) h.getRange(2, cDec, nBg, 1).setBackground(null);   // solo el color de DECISIÓN
  if (out.length) {
    formatoColumna_(h, map, '% VS MÍNIMO', out.length, '0.0%');
    ['ENTRA (PRECIO + CUPÓN)', 'MÍNIMO APLICABLE', 'PRECIO EN WALMART', 'CARGA (LO QUE PUBLICAS)', 'DIFERENCIA vs CARGA']
      .forEach(function (x) { formatoColumna_(h, map, x, out.length, '#,##0.00'); });
    var col = out.map(function (x) {
      var k = x[3];
      return [k === 'CAMBIO / QUITAR' ? '#e06666' : k === 'REVISAR KAM' ? '#f9cb9c' : k === 'DEJAR' ? '#fff2cc' :
              (k === 'OK' || k === 'OK (PRECIO LIBRE)') ? '#d9ead3' : '#d9d9d9'];
    });
    h.getRange(2, cDec, out.length, 1).setBackgrounds(col);
  }
  if (h.getFrozenRows() < 1) h.setFrozenRows(1);
  setProp_('HUELLA_COMPARAR', huella);
  logInfo_('COMPARAR WALMART', 'Comparación terminada', cont);
  return { total: out.length, cont: cont };
}

/**
 * CATEGORIA REVISAR: killers cuya categoría del KAM no coincide con el departamento en que Walmart tiene
 * publicado el producto (hoja Inventario del dashboard). Solo informativa, se reescribe sola cuando cambia.
 * Incluye los killers activos y los que el site manda a bajo mínimo (que ya no están en ACTIVOS).
 * Una categoría del KAM que no está en la tabla de abajo no se evalúa (no se marca nada).
 */
var CR_HOJA = 'CATEGORIA REVISAR';
var CR_ENC = ['SKU', 'KAM', 'DEPARTAMENTO EN WALMART', 'TIPO DE PRODUCTO EN WALMART', 'ESTADO', '% PERDIDA (site)', 'PRODUCTO'];
var CR_ESPERADA = {
  'FOTOGRAFIA': ['FOTOGRAFIA'], 'CAMARAS Y LENTES': ['FOTOGRAFIA'], 'CAMARAS': ['FOTOGRAFIA'],
  'AUDIO': ['AUDIO'],
  'COMPUTACION': ['COMPUTADORAS'], 'TABLETS': ['COMPUTADORAS'], 'HARDWARE': ['COMPUTADORAS'],
  'VIDEOJUEGOS': ['VIDEOJUEGOS']
};
function categoriasRevisar_(actCat, wm, bm) {
  var filas = [], visto = {};
  var evalua = function (sku, kam, prod, estado, per) {
    if (visto[sku]) return;
    visto[sku] = true;
    var ok = CR_ESPERADA[norm_(kam)];
    var w = wm[sku];
    if (!ok || !w || !w.shelf) return;
    if (ok.indexOf(norm_(w.shelf)) >= 0) return;
    filas.push([sku, kam, w.shelf, w.tipoProd, estado, per === '' ? '' : per, prod]);
  };
  actCat.forEach(function (x) {
    var e = bm && bm.skus[x.sku];
    evalua(x.sku, x.kam, x.prod, e && e.perdida > bm.tope + 0.0001 ? 'FUERA (bajo mínimo)' : 'ACTIVO', e ? e.perdida / 100 : '');
  });
  if (bm) Object.keys(bm.skus).forEach(function (s) {
    var e = bm.skus[s];
    evalua(s, e.cat || '', '', e.perdida > bm.tope + 0.0001 ? 'FUERA (bajo mínimo)' : 'ACTIVO', e.perdida / 100);
  });
  filas.sort(function (a, b) { return (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0) || (a[0] < b[0] ? -1 : 1); });
  var huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(filas)));
  if (libro_().getSheetByName(CR_HOJA) && prop_('HUELLA_CATEGORIA_REVISAR') === huella) return;
  var sh = hoja_(CR_HOJA, CR_ENC);
  var n0 = sh.getLastRow();
  var map = escribirPorEncabezado_(sh, CR_ENC, filas, { clave: 'ENC_ESCRITOS_CAT_REVISAR' });
  if (filas.length) formatoColumna_(sh, map, '% PERDIDA (site)', filas.length, '0.0%');
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  setProp_('HUELLA_CATEGORIA_REVISAR', huella);
  logInfo_('CATEGORIA REVISAR', 'Actualizada', { skus: filas.length });
}
