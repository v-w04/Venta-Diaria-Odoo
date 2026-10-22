/**
 * VENTA DIARIA ODOO 2026 — Killers que no cubren el mínimo (leídos de Site Sheet)
 *
 * El otro proyecto (Site Sheet) ya hace el cálculo y lo deja en su hoja "Killers bajo minimo"
 * (el mismo "Killers que no cubren tu mínimo" del dashboard del site): SKU WALMART, SKU BASE,
 * PRODUCTO, PRECIO KILLER, CUPON, NOS PAGAN, MINIMO, FALTA, INICIA, TERMINA, DIAS, CATEGORIA,
 * CATEGORIA…, % PERDIDA. Aquí NO se recalcula nada: solo se lee.
 *
 * ESPEJO LOCAL: cada lectura se guarda tal cual en la hoja "KILLERS BAJO MINIMO" de ESTE libro
 * : si Site Sheet no responde se trabaja con la última copia,
 * y ahí mismo tienes la lista con su CATEGORIA para mandarla a cada KAM.
 *
 * REGLA (Luis, 08/10/2026): si el % PERDIDA del killer es MAYOR a 3%, NO entra a KILLERS ACTIVOS.
 * Hasta 3% se queda. El tope se puede cambiar con la propiedad de script BAJO_MIN_PERDIDA (en %).
 * Se compara por SKU WALMART exacto.
 *
 * Se refresca junto con los killers (cada ~4 min, en sincronizarKillersSite_) y, si cambia la
 * lista de killers descartados, avisa a KILLERS ACTIVOS para que se rehaga sola. Nunca truena.
 */
var BM_HOJA = 'Killers bajo minimo';          // hoja en Site Sheet
var BM_ENC  = 'BAJO_MIN_ENC';                  // firma de encabezados de la última copia
var BM_HUELLA = 'BAJO_MIN_HUELLA';             // huella de los SKUs descartados
var BM_COL_ACCION = 'ACCIÓN SUGERIDA';          // columna que agrega el script en KILLERS BAJO MINIMO
var BM_TOPE_DEF = 3;                           // % de pérdida a partir del cual no entra

function bmTope_() {
  var t = Number(prop_('BAJO_MIN_PERDIDA', String(BM_TOPE_DEF)));
  return t >= 0 ? t : BM_TOPE_DEF;
}

/** "9.9%" → 9.9 · 0.099 → 9.9 · 9.9 → 9.9 (porcentaje en puntos). */
function bmPorcentaje_(v) {
  if (typeof v === 'number') return Math.abs(v) <= 1 ? v * 100 : v;
  var t = String(v === null || v === undefined ? '' : v).trim().replace(/\s/g, '');
  if (!t) return NaN;
  var pct = t.indexOf('%') >= 0;
  var n = Number(t.replace('%', '').replace(/,/g, '.').replace(/[^0-9.\-]/g, ''));
  if (isNaN(n)) return NaN;
  return pct ? n : (Math.abs(n) <= 1 ? n * 100 : n);
}

function bmNumero_(v) {
  if (typeof v === 'number') return v;
  var n = Number(String(v || '').replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Tabla cruda: Site Sheet y, si no, el espejo local. { enc, datos, origen } o null. */
function bmTabla_() {
  try {
    var sh = SpreadsheetApp.openById(CFG.SITE_SHEET_ID).getSheetByName(BM_HOJA);
    if (sh) {
      var nf = sh.getLastRow(), nc = sh.getLastColumn();
      if (nf >= 1 && nc >= 1) {
        var todo = sh.getRange(1, 1, nf, nc).getValues();
        bmGuardarEspejo_(todo);
        return { enc: todo[0], datos: todo.slice(1), origen: 'site' };
      }
    } else {
      ksAvisarUnaVez_('bm_falta', function () {
        logWarn_('BAJO MINIMO', 'Site Sheet no tiene la hoja "' + BM_HOJA + '"; se usa la copia local si existe.');
      });
    }
  } catch (e) {
    ksAvisarUnaVez_('bm_error', function () {
      logWarn_('BAJO MINIMO', 'No se pudo leer "' + BM_HOJA + '" de Site Sheet; se usa la copia local "' + K_BAJO + '"',
               { error: String(e && e.message || e) });
    });
  }
  var esp = libro_().getSheetByName(K_BAJO);
  if (!esp) return null;
  var ef = esp.getLastRow(), ec = esp.getLastColumn();
  if (ef < 1 || ec < 1) return null;
  var crudo = esp.getRange(1, 1, ef, ec).getValues();
  return { enc: crudo[0], datos: crudo.slice(1), origen: 'espejo' };
}

/** Copia tal cual (encabezados y renglones) en KILLERS BAJO MINIMO. */
function bmGuardarEspejo_(todo) {
  try {
    var enc = todo[0].map(function (x) { return String(x || ''); });
    var firma = enc.join('|');
    var antes = prop_(BM_ENC);
    if (antes && antes !== firma) {
      var a = antes.split('|');
      logWarn_('BAJO MINIMO', 'Site Sheet CAMBIÓ las columnas de "' + BM_HOJA + '"',
               { yaNoEstan: a.filter(function (x) { return x && enc.indexOf(x) < 0; }),
                 ahoraHay: enc.filter(function (x) { return x && a.indexOf(x) < 0; }) });
    }
    setProp_(BM_ENC, firma);
    var sh = hoja_(K_BAJO, null);
    // Columna del script: qué hacer con cada killer (correo al KAM si la pérdida pasa del tope). Se calcula aquí, no viene del site.
    var iPerA = -1, iKamA = -1, iSkuA = -1;
    enc.forEach(function (x, i) {
      var k = norm_(x);
      if (iPerA < 0 && k.indexOf('PERDIDA') >= 0) iPerA = i;
      if (k === 'CATEGORIA KAM') iKamA = i;
      if (iSkuA < 0 && (k === 'SKU WALMART' || k === 'SKU')) iSkuA = i;
    });
    var tope = bmTope_();
    var encC = enc.filter(function (x) { return norm_(x) !== norm_(BM_COL_ACCION); }).concat([BM_COL_ACCION]);
    var filasC = todo.slice(1).map(function (f) {
      var base = f.slice(0, enc.length), per = iPerA < 0 ? NaN : bmPorcentaje_(f[iPerA]);
      var accion = '';
      if (iSkuA >= 0 && String(f[iSkuA] || '') !== '' && !isNaN(per)) {
        accion = per > tope + 0.0001
          ? 'No entra a ACTIVOS: pérdida mayor a ' + tope + '%' + (iKamA >= 0 && f[iKamA] ? ' (KAM ' + f[iKamA] + ')' : '') + '. El aviso al KAM lo hace Site Sheet'
          : 'Nada: pérdida de ' + tope + '% o menos, entra a ACTIVOS';
      }
      return base.concat([accion]);
    });
    // Solo se escriben las columnas del site y la ACCIÓN (por encabezado); las que agregues tú, y sus formatos, se quedan.
    var map = escribirPorEncabezado_(sh, encC, filasC, { clave: 'ENC_ESCRITOS_K_BAJO' });
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
    sh.getRange(todo.length + 2, map.pos[0]).setValue('Copia de Site Sheet · ' + ahora_());   // (todo.length = encabezado + datos)
    var cPer = -1;
    enc.forEach(function (x, i) { if (cPer < 0 && norm_(x).indexOf('PERDIDA') >= 0) cPer = map.pos[i]; });
    if (cPer > 0) { try { bmColorPerdida_(sh, cPer); } catch (e2) { logWarn_('BAJO MINIMO', 'No se pudo poner el color de % PERDIDA', { error: String(e2 && e2.message || e2) }); } }
  } catch (e) {
    ksAvisarUnaVez_('bm_espejo', function () {
      logWarn_('BAJO MINIMO', 'No se pudo guardar la copia local', { error: String(e && e.message || e) });
    });
  }
}

/**
 * { skus: {SKU WALMART: {perdida (%), falta, minimo, cat}}, n, tope, origen } o null.
 * Si el % PERDIDA no viene, se saca de FALTA / MINIMO.
 */
function bajoMinimoDelSite_() {
  var t = bmTabla_();
  if (!t) return null;
  var m = mapaColumnas_(t.enc), iSku = m[norm_('SKU WALMART')], iPer, iFal = m[norm_('FALTA')], iMin = m[norm_('MINIMO')];
  if (iSku === undefined) iSku = m[norm_('SKU')];
  for (var i = 0; i < t.enc.length; i++) { if (norm_(t.enc[i]).indexOf('PERDIDA') >= 0) { iPer = i; break; } }
  if (iSku === undefined) {
    logWarn_('BAJO MINIMO', 'La hoja no trae una columna SKU WALMART que reconozca', { encabezados: t.enc });
    return null;
  }
  var iCat = m[norm_('CATEGORIA')], iKam = m[norm_('CATEGORIA KAM')];
  var out = { skus: {}, n: 0, tope: bmTope_(), origen: t.origen };
  t.datos.forEach(function (f) {
    var s = sku_(f[iSku]);
    if (!s || /^COPIA DE SITE SHEET/.test(String(f[iSku] || '').toUpperCase())) return;
    var per = iPer === undefined ? NaN : bmPorcentaje_(f[iPer]);
    var fal = iFal === undefined ? 0 : bmNumero_(f[iFal]), mn = iMin === undefined ? 0 : bmNumero_(f[iMin]);
    if (isNaN(per)) per = mn > 0 ? fal / mn * 100 : NaN;
    if (isNaN(per)) return;
    out.skus[s] = { perdida: per, falta: fal, minimo: mn, cat: iCat === undefined ? '' : String(f[iCat] || '') };
    out.n++;
  });
  return out;
}

/** Lista de SKUs que NO entran (pérdida mayor al tope). */
function bmDescartados_(bm) {
  if (!bm) return [];
  return Object.keys(bm.skus).filter(function (s) { return bm.skus[s].perdida > bm.tope + 0.0001; }).sort();
}

/**
 * Refresca la copia y, si cambió la lista de descartados, marca KILLERS ACTIVOS como pendiente.
 * Se llama desde sincronizarKillersSite_ (cada ~4 min).
 */
function sincronizarBajoMinimo_() {
  try {
    var bm = bajoMinimoDelSite_();
    if (!bm) return;
    var lista = bmDescartados_(bm);
    var huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, lista.join('|') + '#' + bm.tope));
    if (huella !== prop_(BM_HUELLA)) {
      setProp_(BM_HUELLA, huella);
      setProp_(KS_PENDIENTE, '1');
      logOK_('BAJO MINIMO', 'Cambió la lista de killers que no entran (pérdida > ' + bm.tope + '%)',
             { enLista: bm.n, descartados: lista.length, fuente: bm.origen });
    }
  } catch (e) {
    logWarn_('BAJO MINIMO', 'No se pudo refrescar', { error: String(e && e.message || e) });
  }
}

/**
 * Formato condicional de una columna de % PERDIDA: rojo tenue si pasa del tope (3%), verde tenue si es
 * aceptable (tope o menos). Acepta fracción (0.0295) o porcentaje (2.95). Reemplaza solo sus propias reglas.
 */
function bmColorPerdida_(sh, col) {
  var ROJO = '#f4cccc', VERDE = '#d9ead3';
  var n = Math.max(sh.getMaxRows() - 1, 1);
  var rango = sh.getRange(2, col, n, 1);
  var letra = rango.getA1Notation().replace(/\d+/g, '').split(':')[0];
  var celda = letra + '2';
  var val = 'IF(ABS(' + celda + ')<=1,' + celda + '*100,' + celda + ')';
  var tope = bmTope_();
  var propias = function (r) {
    var cond = r.getBooleanCondition();
    var bg = cond && cond.getBackgroundObject && cond.getBackgroundObject();
    var c = bg ? String(bg.asRgbColor().asHexString()).toLowerCase() : '';
    if (c !== ROJO && c !== VERDE) return false;
    // Regla nuestra = misma fórmula de % (aunque haya quedado sobre una columna vieja o sobre dos rangos):
    // se reemplaza, así no se acumulan reglas repetidas ni se pinta una columna que ya no es % PERDIDA.
    var f = String((cond.getCriteriaValues && cond.getCriteriaValues()[0]) || '');
    if (/ISNUMBER\(.*IF\(ABS\(.*\*100/i.test(f)) return true;
    var rs = r.getRanges();
    return rs.length === 1 && rs[0].getColumn() === col;
  };
  var reglas = sh.getConditionalFormatRules().filter(function (r) { return !propias(r); });
  reglas.push(SpreadsheetApp.newConditionalFormatRule().setRanges([rango])
    .whenFormulaSatisfied('=AND(ISNUMBER(' + celda + '),' + val + '>' + tope + ')').setBackground(ROJO).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule().setRanges([rango])
    .whenFormulaSatisfied('=AND(ISNUMBER(' + celda + '),' + val + '<=' + tope + ')').setBackground(VERDE).build());
  sh.setConditionalFormatRules(reglas);
}
