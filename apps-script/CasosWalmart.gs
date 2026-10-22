/**
 * VENTA DIARIA ODOO 2026 — CASOS WALMART (registro y seguimiento de casos con Walmart)
 *
 * Una sola hoja en el libro: "CASOS WALMART". Es el REGISTRO e HISTORIAL: cada caso es una fila y
 * nunca se borra; cuando se resuelve solo cambias ESTADO a CERRADO (y llenas RESOLUCION y FECHA CIERRE).
 * Para ver solo lo vigente, filtra ESTADO distinto de CERRADO.
 *
 * Columnas (las llenas tú, salvo las que pone el script al detectar):
 *   FOLIO WALMART · FECHA ABIERTO · SKU · PRODUCTO · TIPO · MOTIVO · ESTADO · CORREO ENVIADO ·
 *   SEGUIMIENTO (lo que te dijeron, comentarios, fechas) · RESOLUCION (cómo se resolvió) · FECHA CIERRE ·
 *   DETECTADO (MANUAL o AUTO + fecha)
 * Estados sugeridos: POR ABRIR · ABIERTO · EN ESPERA WALMART · CERRADO (todo lo que no sea CERRADO es vigente).
 *
 * Qué hace el script:
 *   · Crea la hoja si falta (una vez) y siembra los casos que ya conoces.
 *   · DETECTA problemas y los agrega como fila nueva (POR ABRIR, DETECTADO = AUTO):
 *       - De COMPARAR WALMART (cwDiagnostico_): precio en $0, SYSTEM_PROBLEM, no está en el dashboard, precio
 *         distinto a la carga. Solo si el error dura 24 h o más. Lo que ya está en tu lista de BLOQUEADOS o
 *         es despublicado (fecha de exposición vencida, sin stock) NO es caso: sale como ACCIÓN SUGERIDA en COMPARAR.
 *       - COBRO DISTINTO: cada SKU de la hoja COBRO DISTINTO (Walmart cobró más comisión) se registra una sola vez.
 *     Solo agrega si el SKU no tiene ya un caso vigente. Nunca modifica ni borra tus filas.
 *   · COMPARAR WALMART muestra el caso vigente de cada SKU en la columna CASO WALMART y en AVISO.
 * Los SKUs se leen por encabezado: puedes mover columnas o agregar las tuyas.
 */

var CS_HOJA = 'CASOS WALMART';
var CS_ENC = ['FOLIO WALMART', 'FECHA ABIERTO', 'SKU', 'PRODUCTO', 'TIPO', 'MOTIVO', 'ESTADO', 'CORREO ENVIADO',
              'SEGUIMIENTO', 'RESOLUCION', 'FECHA CIERRE', 'DETECTADO'];
var CS_TIPO_CERO = 'PRECIO EN $0 EN WALMART';
var CS_HORAS_ERROR = 24;         // horas con el mismo error antes de proponerlo como caso
var CS_PROP_VISTO = 'CS_ERRORES_VISTOS';

/** SKUs con caso conocido desde el inicio (Walmart los deja en $0 por un bug). */
var CS_SEMILLA = [
  'LOG-910007565-NEG-7548-MSI',
  'LOG-920012593-BLA-4060-MSI'
];

function csHoy_() { return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'); }

/** Crea la hoja si falta (y la siembra). No toca una hoja que ya exista. */
function csAsegurarHoja_() {
  var ss = libro_();
  if (ss.getSheetByName(CS_HOJA)) return;
  var sh = hoja_(CS_HOJA, CS_ENC);
  var filas = CS_SEMILLA.map(function (s) {
    return ['', csHoy_(), s, '', CS_TIPO_CERO, 'El precio queda en $0 en Walmart (bug de Walmart): enviar correo y abrir caso',
            'POR ABRIR', 'NO', '', '', '', 'MANUAL'];
  });
  escribirPorEncabezado_(sh, CS_ENC, filas, { clave: 'ENC_ESCRITOS_CASOS' });
  try { csFormato_(sh); } catch (e) { logWarn_('CASOS WALMART', 'No se pudo poner listas y colores', { error: String(e && e.message || e) }); }
  logInfo_('CASOS WALMART', 'Hoja creada con ' + filas.length + ' caso(s) por abrir');
}

/** { SKU: { folio, estado } } de los casos vigentes (ESTADO distinto de CERRADO). */
function csCasosVigentes_() {
  var out = {};
  var sh = libro_().getSheetByName(CS_HOJA);
  if (!sh || sh.getLastRow() < 2) return out;
  var d = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var m = mapaColumnas_(d[0]);
  var iS = m[norm_('SKU')], iF = m[norm_('FOLIO WALMART')], iE = m[norm_('ESTADO')];
  if (iS === undefined) return out;
  for (var i = 1; i < d.length; i++) {
    var s = sku_(d[i][iS]);
    if (!s) continue;
    var est = iE === undefined ? '' : String(d[i][iE] || '').trim();
    if (norm_(est) === 'CERRADO') continue;
    out[s] = { folio: iF === undefined ? '' : String(d[i][iF] || '').trim(), estado: est || 'POR ABRIR' };
  }
  return out;
}

/** Texto para la columna CASO WALMART de COMPARAR ('' si el SKU no tiene caso vigente). */
function csTexto_(casos, sku) {
  var c = casos[sku];
  if (!c) return '';
  return (c.folio ? 'Caso ' + c.folio : 'Caso sin folio') + ' · ' + c.estado;
}

/**
 * Recibe los errores que HOY tienen los killers activos [{sku, producto, tipo, detalle}] y agrega como caso por
 * abrir a los SKUs cuyo error lleva CS_HORAS_ERROR horas o más y no tienen caso vigente. Devuelve cuántos agregó.
 */
function csDetectar_(errores, casos) {
  var visto = {};
  try { visto = JSON.parse(prop_(CS_PROP_VISTO) || '{}'); } catch (e) { visto = {}; }
  var ahora = Date.now(), nuevo = {}, porSku = {};
  errores.forEach(function (x) {
    var k = x.sku + '|' + x.tipo;
    var desde = visto[k] || ahora;
    nuevo[k] = desde;                                       // los errores que ya no están se olvidan solos
    if (ahora - desde < CS_HORAS_ERROR * 3600000 || casos[x.sku]) return;
    var e = porSku[x.sku] || (porSku[x.sku] = { producto: x.producto, tipos: [], detalles: [] });
    e.tipos.push(x.tipo);
    if (x.detalle) e.detalles.push(x.detalle);
  });
  setProp_(CS_PROP_VISTO, JSON.stringify(nuevo));
  var skus = Object.keys(porSku);
  if (!skus.length) return 0;
  var sh = libro_().getSheetByName(CS_HOJA);
  if (!sh) return 0;
  var filas = skus.map(function (s) {
    var e = porSku[s];
    return ['', csHoy_(), s, e.producto || '', e.tipos.join(' + '),
            'Detectado por el script (' + CS_HORAS_ERROR + ' h o más)' + (e.detalles.length ? ': ' + e.detalles.join('; ') : ''),
            'POR ABRIR', 'NO', '', '', '', 'AUTO ' + csHoy_()];
  });
  var colSku = mapaFisico_(sh, CS_ENC)[2] + 1;
  agregarFilas_(sh, enOrdenFisico_(sh, CS_ENC, filas), colSku);
  logWarn_('CASOS WALMART', 'Casos nuevos por abrir', { skus: skus });
  return skus.length;
}

/** SKUs que ya tienen alguna fila (de cualquier estado) cuyo TIPO contiene `tipo`. */
function csSkusConTipo_(tipo) {
  var out = {};
  var sh = libro_().getSheetByName(CS_HOJA);
  if (!sh || sh.getLastRow() < 2) return out;
  var d = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var m = mapaColumnas_(d[0]), iS = m[norm_('SKU')], iT = m[norm_('TIPO')];
  if (iS === undefined || iT === undefined) return out;
  for (var i = 1; i < d.length; i++) {
    if (norm_(d[i][iT]).indexOf(norm_(tipo)) >= 0) out[sku_(d[i][iS])] = true;
  }
  return out;
}

/** COBRO DISTINTO: cada SKU de la hoja se registra UNA vez como caso por abrir (Walmart cobró más comisión de la debida). */
function csDetectarCobro_() {
  var cd = libro_().getSheetByName(CD_ESPEJO);
  var sh = libro_().getSheetByName(CS_HOJA);
  if (!cd || !sh || cd.getLastRow() < 2) return 0;
  var d = cd.getRange(1, 1, cd.getLastRow(), cd.getLastColumn()).getValues();
  var m = mapaColumnas_(d[0]), iS = m[norm_('SKU')], iC = m[norm_('CAUSA')], iP = m[norm_('PESOS')], iPed = m[norm_('PEDIDOS')];
  if (iS === undefined) return 0;
  var ya = csSkusConTipo_('COBRO DISTINTO'), filas = [], vistos = {};
  for (var i = 1; i < d.length; i++) {
    var s = sku_(d[i][iS]);
    if (!s || ya[s] || vistos[s] || /^COPIA DE SITE SHEET/.test(String(d[i][iS]).toUpperCase())) continue;
    vistos[s] = true;
    var det = [];
    if (iPed !== undefined && d[i][iPed] !== '') det.push(d[i][iPed] + ' pedido(s)');
    if (iP !== undefined && d[i][iP] !== '') det.push('$' + d[i][iP] + ' cobrados de más');
    if (iC !== undefined && d[i][iC] !== '') det.push(String(d[i][iC]));
    filas.push(['', csHoy_(), s, '', 'COBRO DISTINTO', 'Walmart cobró distinto a lo debido' + (det.length ? ': ' + det.join(' · ') : ''),
                'POR ABRIR', 'NO', '', '', '', 'AUTO ' + csHoy_()]);
  }
  if (!filas.length) return 0;
  var colSku = mapaFisico_(sh, CS_ENC)[2] + 1;
  agregarFilas_(sh, enOrdenFisico_(sh, CS_ENC, filas), colSku);
  logWarn_('CASOS WALMART', 'Casos nuevos por abrir (cobro distinto)', { skus: filas.map(function (x) { return x[2]; }) });
  return filas.length;
}

var CS_ESTADOS = ['POR ABRIR', 'ABIERTO', 'EN ESPERA WALMART', 'CERRADO'];
var CS_COLOR_ESTADO = { 'POR ABRIR': '#fff2cc', 'ABIERTO': '#fce5cd', 'EN ESPERA WALMART': '#cfe2f3', 'CERRADO': '#d9d9d9' };

/**
 * Listas desplegables (ESTADO, CORREO ENVIADO) y color de ESTADO, ubicados por encabezado, para filas 2 a 2000.
 * Es idempotente: se puede correr las veces que sea (Ordenar la llama). Solo reemplaza sus propias reglas de color.
 */
function csFormato_(sh) {
  var ss = sh || libro_().getSheetByName(CS_HOJA);
  if (!ss) return;
  var m = mapaColumnas_(ss.getRange(1, 1, 1, Math.max(ss.getLastColumn(), 1)).getValues()[0]);
  var iE = m[norm_('ESTADO')], iC = m[norm_('CORREO ENVIADO')];
  var filas = 1999;
  if (ss.getMaxRows() < filas + 1) ss.insertRowsAfter(ss.getMaxRows(), filas + 1 - ss.getMaxRows());
  if (iE !== undefined) {
    ss.getRange(2, iE + 1, filas, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(CS_ESTADOS, true).setAllowInvalid(true).build());
    var rango = ss.getRange(2, iE + 1, filas, 1);
    var propias = function (r) {
      var cond = r.getBooleanCondition(), bg = cond && cond.getBackgroundObject && cond.getBackgroundObject();
      var col = bg ? String(bg.asRgbColor().asHexString()).toLowerCase() : '';
      var rs = r.getRanges();
      return rs.length === 1 && rs[0].getColumn() === iE + 1 && Object.keys(CS_COLOR_ESTADO).some(function (k) { return CS_COLOR_ESTADO[k] === col; });
    };
    var reglas = ss.getConditionalFormatRules().filter(function (r) { return !propias(r); });
    CS_ESTADOS.forEach(function (e) {
      reglas.push(SpreadsheetApp.newConditionalFormatRule().setRanges([rango])
        .whenTextEqualTo(e).setBackground(CS_COLOR_ESTADO[e]).build());
    });
    ss.setConditionalFormatRules(reglas);
  }
  if (iC !== undefined) {
    ss.getRange(2, iC + 1, filas, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['SI', 'NO'], true).setAllowInvalid(true).build());
  }
}
