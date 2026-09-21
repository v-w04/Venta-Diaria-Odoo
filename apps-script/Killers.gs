/**
 * VENTA DIARIA ODOO 2026 — Killers de Walmart
 *
 * Reemplaza el archivo "Walmart Killers" (Archivo descargado → mes → Activos).
 *
 *   KILLERS PEGAR      pegas tal cual lo que baja Table Capture del seller
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
 *   · El último pegado es la foto oficial del seller center: un SKU que ya
 *     no viene en él, deja de estar en ACTIVOS.
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

var ENC_K_COM = ['CATEGORIA', 'COMISION', 'OTROS NOMBRES', 'REDUCCION KAM'];
// REDUCCION KAM (puntos de comisión): SOLO para killers de KILLERS KAM que no
// traen "COMISION CUPON". Los del seller center NO la usan: su promoción se
// deduce sola de "Comisión sobre el cupón killer" y "Comisión MSI".

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
    sh.getRange(1, 1, 1, 4).setValues([ENC_K_COM]);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
    var todas = COMISIONES_INICIALES.concat(extra);
    sh.getRange(2, 1, todas.length, 4).setValues(todas);
    sh.getRange(2, 2, todas.length, 1).setNumberFormat('0.00%');
    sh.getRange(2, 4, todas.length, 1).setNumberFormat('0.0');
    setProp_('COMISIONES_V6', '1');
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

/** CATEGORIA (y otros nombres) → reducción KAM en fracción (7 puntos → 0.07). */
function reduccionesKam_() {
  comisionesNormales_();                     // asegura la hoja
  var sh = libro_().getSheetByName(K_COM), m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    var d = descKam_(r[3]);
    if (!norm_(r[0]) || !d) return;
    m[norm_(r[0])] = d;
    String(r[2] || '').split(',').forEach(function (x) { if (norm_(x)) m[norm_(x)] = d; });
  });
  return m;
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

/** Cuánto suma MSI a la comisión: lo más repetido en el histórico. */
function msiExtra_(hist) {
  var c = {};
  hist.forEach(function (k) {
    if (k.comCup === '' || k.comMsi === '' || k.comCup === undefined || k.comMsi === undefined) return;
    var d = Math.round((k.comMsi - k.comCup) * 1000) / 1000;
    if (d > 0) c[d] = (c[d] || 0) + 1;
  });
  var mejor = MSI_EXTRA_DEF, n = 0;
  Object.keys(c).forEach(function (d) { if (c[d] > n) { n = c[d]; mejor = Number(d); } });
  return mejor;
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
  leer(K_HIST, KH.SKU, KH.CAT);
  // En ACTIVOS la categoría se busca por encabezado ("KAM" o "CATEGORIA"),
  // por si la hoja aún trae el formato anterior.
  var shA = libro_().getSheetByName(K_ACT);
  if (shA && shA.getLastColumn() > 0) {
    var mapa = mapaColumnas_(shA.getRange(1, 1, 1, shA.getLastColumn()).getValues()[0]);
    var iCat = mapa['KAM'] !== undefined ? mapa['KAM'] : mapa['CATEGORIA'];
    if (iCat !== undefined) leer(K_ACT, KA.SKU, iCat);
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

function procesarKillers() {
  // Botón: espera hasta 3 min a que termine el trigger que esté corriendo.
  var lock = candado_(180000);
  if (!lock) { avisar_('La importación automática está corriendo en este momento y no terminó en 3 minutos.\n\nNo pasa nada: espera a que termine (revisa LOG Ventas) y vuelve a darle.'); return; }
  try {
    var r = procesarKillers_();
    if (!r.leidos) {
      avisar_('KILLERS PEGAR está vacía.\n\nPega ahí lo que bajaste con Table Capture y vuelve a darle.');
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
      '\nCon promoción de comisión (columna X): ' + (r.promociones || 0));
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
  res.salieron = Math.max(0, antes - a.total + a.entraron);

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
  var n = ultimaFilaColA_(sh);
  var datos = n > 1 ? sh.getRange(2, 1, n - 1, ENC_K_HIST.length).getValues() : [];
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

  if (repetidos) {
    sh.getRange(2, KH.VISTO + 1, datos.length, 1)
      .setValues(datos.map(function (r) { return [r[KH.VISTO]]; }));
  }
  if (nuevas.length) agregarFilas_(sh, nuevas);
  return { nuevos: nuevas.length, repetidos: repetidos };
}

/** KAM → objetos killer. */
function leerKam_(tabla) {
  var sh = libro_().getSheetByName(K_KAM);
  if (!sh || sh.getLastRow() < 2) return [];
  var ancho = Math.max(Math.min(sh.getLastColumn(), ENC_K_KAM.length), 9);
  var rCat = reduccionesKam_(), com = comisionesNormales_();
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
  var n = sh ? ultimaFilaColA_(sh) : 0;
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, ENC_K_HIST.length).getValues()
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
  var porSku = {};
  hist.forEach(function (k) {
    if (k.origen === 'SELLER CENTER' && k.visto !== ultima) return;
    if (k.origen === 'MEMORIA ANTERIOR') return;
    (porSku[k.sku] = porSku[k.sku] || []).push(k);
  });
  kam.forEach(function (k) { (porSku[k.sku] = porSku[k.sku] || []).push(k); });

  var previos = {};
  var n0 = ultimaFilaColA_(sh);
  if (n0 > 1) sh.getRange(2, 1, n0 - 1, 1).getValues().forEach(function (r) { previos[sku_(r[0])] = true; });

  var hojaPrecios = "'" + CFG.H.PRECIOS + "'!";
  var res = { total: 0, promos: 0, porIniciar: 0, sinCategoria: 0, entraron: 0 };
  var filas = [], promos = [];
  // Orden: primero los VIGENTES (lo que subes hoy), al final los POR INICIAR.
  var orden = Object.keys(porSku).map(function (sku) {
    var x = rangoQueAplica_(porSku[sku], ahora);
    return { sku: sku, v: x && x.estado === 'VIGENTE' ? 0 : 1 };
  }).sort(function (a, b) { return (a.v - b.v) || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0); })
    .map(function (x) { return x.sku; });
  orden.forEach(function (sku) {
    var rangos = porSku[sku];
    var sel = rangoQueAplica_(rangos, ahora);
    if (!sel) return;
    var k = sel.k;
    var r = filas.length + 2;                       // renglón en la hoja
    var cat = k.categoria || cats[k.sku] || cats[k.general] || '';
    var pr = deducirPromo_(k, cat, com, extra);
    var promo = pr.red > 0.0001;
    if (promo) promos.push({ k: k, cat: cat, pr: pr });
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
  });

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
  var nW = shW ? ultimaFilaColA_(shW) : 0;
  if (nW > 1) {
    shW.getRange(2, 1, nW - 1, 11).getValues().forEach(function (f) {
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
    var cat = k.categoria || cats[k.sku] || cats[k.general] || '';
    var pr = deducirPromo_(k, cat, com, extra);
    var e = { precio: k.negoc, ini: k.ini, fin: k.fin, nCarga: k.nCarga,
              normal: pr.normal, com: pr.normal === '' ? '' : pr.normal - pr.redCla,
              normalMsi: pr.normalMsi, comMsi: pr.normalMsi === '' ? '' : pr.normalMsi - pr.redMsi };
    add(k.sku, e); add(k.general, e);
    total++;
  });

  if (!total && tabla && tabla.killersNQ) {
    tabla.killersNQ.forEach(function (k) {
      var e = { precio: k.precio, ini: '', fin: '', com: '', normal: '', comMsi: '', normalMsi: '', nCarga: 0 };
      add(k.general, e); add(k.pub, e); if (k.pub) add(skuBase_(k.pub), e);
      total++;
    });
  }
  return { mapa: mapa, total: total };
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
