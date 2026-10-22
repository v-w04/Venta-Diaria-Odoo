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
 *   · DETECTA problemas que son para caso y los agrega como fila nueva (POR ABRIR, DETECTADO = AUTO):
 *       - Killer activo cuyo precio en Walmart está en $0 durante 24 h o más (en el dashboard).
 *     Solo agrega si ese SKU no tiene ya un caso vigente. Nunca modifica ni borra tus filas.
 *   · COMPARAR WALMART muestra el caso vigente de cada SKU en la columna CASO WALMART y en AVISO.
 * Los SKUs se leen por encabezado: puedes mover columnas o agregar las tuyas.
 */

var CS_HOJA = 'CASOS WALMART';
var CS_ENC = ['FOLIO WALMART', 'FECHA ABIERTO', 'SKU', 'PRODUCTO', 'TIPO', 'MOTIVO', 'ESTADO', 'CORREO ENVIADO',
              'SEGUIMIENTO', 'RESOLUCION', 'FECHA CIERRE', 'DETECTADO'];
var CS_TIPO_CERO = 'PRECIO EN $0 EN WALMART';
var CS_HORAS_CERO = 24;          // horas con el precio en $0 antes de proponerlo como caso
var CS_PROP_VISTO = 'CS_PRECIO_CERO_VISTO';

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
 * Recibe los killers que HOY tienen el precio en $0 en Walmart [{sku, producto}] y agrega como caso
 * por abrir a los que llevan CS_HORAS_CERO horas o más así y no tienen caso vigente. Devuelve cuántos agregó.
 */
function csDetectarCero_(ceros, casos) {
  var visto = {};
  try { visto = JSON.parse(prop_(CS_PROP_VISTO) || '{}'); } catch (e) { visto = {}; }
  var ahora = Date.now(), nuevo = {}, aAgregar = [];
  ceros.forEach(function (c) {
    var desde = visto[c.sku] || ahora;
    nuevo[c.sku] = desde;                                   // los que ya no están en $0 se olvidan solos
    if (ahora - desde >= CS_HORAS_CERO * 3600000 && !casos[c.sku]) {
      aAgregar.push(['', csHoy_(), c.sku, c.producto || '', CS_TIPO_CERO,
                     'El precio de Walmart lleva ' + CS_HORAS_CERO + ' h o más en $0 (detectado por el script)',
                     'POR ABRIR', 'NO', '', '', '', 'AUTO ' + csHoy_()]);
    }
  });
  setProp_(CS_PROP_VISTO, JSON.stringify(nuevo));
  if (!aAgregar.length) return 0;
  var sh = libro_().getSheetByName(CS_HOJA);
  if (!sh) return 0;
  var colSku = mapaFisico_(sh, CS_ENC)[2] + 1;
  agregarFilas_(sh, enOrdenFisico_(sh, CS_ENC, aAgregar), colSku);
  logWarn_('CASOS WALMART', 'Casos nuevos por abrir (precio en $0 en Walmart)', { skus: ceros.filter(function (c) { return !casos[c.sku]; }).map(function (c) { return c.sku; }) });
  return aAgregar.length;
}
