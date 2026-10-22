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
var K_ACT   = 'KILLERS ACTIVOS';
var K_HIST  = 'KILLERS HISTORICO';
var K_BAJO  = 'KILLERS BAJO MINIMO';     // killers cuyo "nos pagan" no cubre el mínimo (se descartan de ACTIVOS)
var MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO',
             'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

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
                 'SKU GENERAL', 'SKU PRECIO',
                 'ORIGEN', 'ESTADO', 'CARGA KILLER', 'OTROS RANGOS', '% PERDIDA (site)'];
var KA = { SKU: 0, CAT: 19 };   // T "KAM" = categoría

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

function asegurarHojasKillers_() {
  var ss = libro_();
  if (!ss.getSheetByName(K_PEGAR)) hoja_(K_PEGAR, null);
  hoja_(K_HIST, ENC_K_HIST);
  hoja_(K_ACT, ENC_K_ACT);
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
    var txtKs = {
      cambio: 'Killers de Site Sheet: ' + ks.leidos + ' leídos · ' + ks.vigentes + ' vigentes hoy · ' +
              ks.nuevosEnHistorico + ' nuevos en el histórico (' + ks.carga + ')',
      igual: 'Killers de Site Sheet: ' + (ks.n || 0) + ' · sin cambios desde la última lectura',
      sospechosa: '⚠️ Site Sheet trajo muy pocos killers (' + (ks.n || 0) + ') comparado con la lectura anterior; no se aplicó. Si la siguiente lectura trae lo mismo, se acepta.',
      sin_lectura: '⚠️ No se pudo leer la hoja "Killers" de Site Sheet (revisa LOG Ventas). Se usó el histórico que ya había.',
      vacia: '⚠️ La hoja "Killers" de Site Sheet no trae killers con precio y fecha. Se usó el histórico que ya había.',
      error: '⚠️ Falló la lectura de killers de Site Sheet (revisa LOG Ventas). Se usó el histórico que ya había.'
    }[ks.estado] || 'Killers de Site Sheet: ' + ks.estado;
    avisar_('KILLERS ACTIVOS actualizada\n\n' + txtKs + '\n\n' +
      'Renglones: ' + a.total + '\n' +
      '  · killers vigentes: ' + (a.total - (a.porIniciar || 0)) + '\n' +
      '  · por iniciar: ' + (a.porIniciar || 0) + '\n' +
      'Fuera por bajo mínimo (lo dice el site): ' + (a.bajoMinimo || 0) + '\n' +
      'Fuera por cobro distinto de Walmart: ' + (a.cobroDistinto || 0) + '\n' +
      'Salieron (vencidos o ya no vienen): ' + (a.salieron || 0));
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
      'KILLERS ACTIVOS: ' + r.activos + '  ·  por iniciar: ' + r.porIniciar + '\n' +
      'Salieron de ACTIVOS (ya no vienen en el seller center o vencieron): ' + r.salieron);
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
              repetidos: 0, activos: 0, porIniciar: 0, salieron: 0,
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
  res.activos = a.total; res.porIniciar = a.porIniciar;
  res.sinCategoria = a.sinCategoria;
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
      k.categoria || '', ahora]);
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

  var previos = {};
  var cSkuA = colDe_(sh, 'SKU') || 1;             // la columna SKU donde esté (puedes mover o insertar columnas)
  var n0 = ultimaFilaColA_(sh, cSkuA);
  if (n0 > 1) sh.getRange(2, cSkuA, n0 - 1, 1).getValues().forEach(function (r) { previos[sku_(r[0])] = true; });

  var hojaPrecios = "'" + CFG.H.PRECIOS + "'!";
  // Columnas de PRECIOS ERIK por su título (no por letra fija): SKU GENERAL, CLASICA, PREMIUM.
  var cpe = { SKU: CFG.PE.COL_SKU - 1, CLASICA: CFG.PE.COL_CLASICA - 1, PREMIUM: CFG.PE.COL_PREMIUM - 1 };
  try { var shPe = libro_().getSheetByName(CFG.H.PRECIOS); if (shPe) cpe = columnasPreciosErik_(shPe); } catch (e) { /* se queda con las de siempre */ }
  var lPeSku = letraCol_(cpe.SKU), lPeCla = letraCol_(cpe.CLASICA), lPePre = letraCol_(cpe.PREMIUM);
  // Fórmulas de ACTIVOS: cada referencia es refCol_('ENCABEZADO', fila); se resuelve a la letra real al escribir.
  var X = function (h, r) { return refCol_(h, r); };
  var fxPrecio = function (r, premium) {
    var v = X('SKU PRECIO', r), cm = premium ? lPePre : lPeCla;
    return '=IF(' + v + '="","NO ESTA",IFERROR(XLOOKUP(' + v + ',' + hojaPrecios + '$' + lPeSku + ':$' + lPeSku + ',' +
      hojaPrecios + '$' + cm + ':$' + cm + '),"NO ESTA"))';
  };
  var fxPagan = function (r) { return '=IF(' + X('Precio negociado', r) + '="","",' + X('Precio negociado', r) + '+N(' + X('Cupón de oferta', r) + '))'; };
  var fxPct = function (r) { return '=IF(AND(ISNUMBER(' + X('PRECIO', r) + '),ISNUMBER(' + X('PAGAN', r) + ')),' + X('PAGAN', r) + '/' + X('PRECIO', r) + ',"")'; };
  var fxCarga = function (r) { return '=' + X('Precio negociado', r); };
  var fxFechaFmt = function (r) { return '=IF(' + X('Finalización de la oferta', r) + '="","",' + X('Finalización de la oferta', r) + '+TIME(6,0,0))'; };
  var res = { total: 0, porIniciar: 0, sinCategoria: 0, entraron: 0, bajoMinimo: 0, cobroDistinto: 0 };
  var filas = [];
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

  // ÚNICO CÁLCULO: KILLERS BAJO MINIMO. El site (hoja "Killers bajo minimo" de Site Sheet) ya calcula,
  // con sus promociones aplicadas, qué killers no cubren el mínimo. Si el % PERDIDA es mayor al tope (3%),
  // el killer NO entra a ACTIVOS. Comparación por SKU exacto. Aquí no se recalcula nada más.
  var bm = null;
  try { bm = bajoMinimoDelSite_(); } catch (e) { logWarn_('KILLERS', 'No se pudo leer Killers bajo minimo', { error: String(e && e.message || e) }); }
  var nBajo = 0;
  var sinBajo = function (sku) {
    var e = bm && bm.skus[sku];
    if (e && e.perdida > bm.tope + 0.0001) { nBajo++; return false; }
    return true;
  };
  vigentes = vigentes.filter(sinBajo);
  porIniciar = porIniciar.filter(sinBajo);
  res.bajoMinimo = nBajo;

  // COBRO DISTINTO (copia de Site Sheet): un SKU exacto que Walmart cobró con otra comisión NO entra a ACTIVOS.
  var cdSkus = {}, nCd = 0;
  try { cdSkus = cdSkusExcluidos_(); } catch (e) { logWarn_('KILLERS', 'No se pudo leer COBRO DISTINTO', { error: String(e && e.message || e) }); }
  var sinCobro = function (sku) { if (cdSkus[sku]) { nCd++; return false; } return true; };
  vigentes = vigentes.filter(sinCobro);
  porIniciar = porIniciar.filter(sinCobro);
  res.cobroDistinto = nCd;

  // % PERDIDA (site): solo informativo; vacío = el site no lo reporta bajo el mínimo.
  var perdidaSite_ = function (sku) {
    var e = bm && bm.skus[sku];
    return e ? e.perdida / 100 : '';
  };

  var filaKiller = function (sku) {
    var rangos = porSku[sku];
    var sel = rangoQueAplica_(rangos, ahora);
    if (!sel) return;
    var k = sel.k;
    var r = filas.length + 2;                       // renglón en la hoja
    var cat = k.categoria || '';
    var otros = rangos.filter(function (x) { return x !== k && x.fin instanceof Date && ms_(x.fin) >= ahora; })
      .map(function (x) { return '$' + x.negoc + ' ' + ddmm_(x.ini).slice(0, 5) + '–' + ddmm_(x.fin).slice(0, 5); })
      .join(' · ');
    var llave = llavePrecio_(tabla, k.sku);
    var premiumK = tipoPublicacion_(k.sku) === 'PREMIUM';
    // D: KAM con DESCUENTO % → fórmula sobre PRECIO, igual que tu hoja de Fotografía
    var negoc = k.desc
      ? '=IF(ISNUMBER(' + X('PRECIO', r) + '),INT((' + X('PRECIO', r) + '-' + X('PRECIO', r) + '*' + k.desc + ')/10)*10+9,"")'
      : k.negoc;
    if (!cat) res.sinCategoria++;
    if (sel.estado === 'POR INICIAR') res.porIniciar++;
    if (!previos[sku]) res.entraron++;
    filas.push([
      k.sku,                                                            // A SKU
      k.detalles,                                                       // B
      fxPrecio(r, premiumK),                                            // C PRECIO
      negoc,                                                            // D
      k.cupon === 0 ? '' : k.cupon,                                     // E
      fxPagan(r),                                                       // F PAGAN
      fxPct(r),                                                         // G %
      fxCarga(r),                                                       // H Carga
      k.ini, k.fin,                                                     // I J
      fxFechaFmt(r),                                                    // K Fecha formato
      k.comCup, k.msi, k.comMsi, k.wfs, k.devol, k.disp, k.obs,         // L–R
      'SI',                                                             // S VALIDACIÓN
      cat,                                                              // T KAM
      k.general, llave,                                                 // U V
      k.origen, sel.estado, k.carga, otros,                             // W–Z
      perdidaSite_(k.sku)                                               // AA % PERDIDA (site)
    ]);
  };

  vigentes.forEach(filaKiller);
  porIniciar.forEach(filaKiller);

  // Solo se escriben las columnas del script, ubicadas por encabezado; tus columnas, formatos,
  // validaciones y reglas condicionales se quedan como están.
  var map = escribirPorEncabezado_(sh, ENC_K_ACT, filas, { clave: 'ENC_ESCRITOS_K_ACT' });
  if (filas.length) formatoActivos_(sh, filas.length, map);
  res.total = filas.length;
  var ahoraSkus = {};
  filas.forEach(function (f) { ahoraSkus[sku_(f[0])] = true; });   // f[0] = SKU en el arreglo interno (orden ENC_K_ACT)
  res.salieron = Object.keys(previos).filter(function (k) { return k && !ahoraSkus[k]; }).length;
  setProp_('KILLERS_ACTIVOS_N', String(filas.length));
  return res;
}

/** Llave con la que C busca el mínimo en PRECIOS ERIK (misma regla que minimoDe_). */
function llavePrecio_(tabla, sku) {
  var s = sku_(sku);
  if (tabla.minimos[s]) return s;
  if (tabla.minimos[skuSinVariante_(s)]) return skuSinVariante_(s);
  if (tabla.minimos[skuCvaGeneral_(s)]) return skuCvaGeneral_(s);   // CVA premium (-CVA-MSI) → general -CVA
  if (!esCVA_(s) && tabla.minimos[skuBase_(s)]) return skuBase_(s);
  return '';
}

function formatoActivos_(sh, n, map) {
  var f = function (h, fmt) { formatoColumna_(sh, map, h, n, fmt); };
  ['PRECIO', 'Precio negociado', 'Cupón de oferta', 'PAGAN', 'Carga'].forEach(function (h) { f(h, '$#,##0'); });
  f('%', '0.0%');
  ['Inicio de la oferta', 'Finalización de la oferta', 'Fecha formato'].forEach(function (h) { f(h, 'dd/MM/yyyy HH:mm'); });
  ['Comisión sobre el cupón killer', 'Comisión MSI'].forEach(function (h) { f(h, '0.0%'); });
  f('% PERDIDA (site)', '0.00%');   // igual que la copia de KILLERS BAJO MINIMO
  var cPer = map.col[norm_('% PERDIDA (site)')];
  if (cPer) {
    try { bmColorPerdida_(sh, cPer); } catch (e) { logWarn_('KILLERS', 'No se pudo poner el color de % PERDIDA', { error: String(e && e.message || e) }); }   // rojo tenue si pasa de 3%, verde tenue si es aceptable
  }
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

  var rangos = leerHistorico_().filter(function (k) {
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
  leerHistorico_().forEach(function (k) {
    if (!k.negoc) return;
    var e = { precio: k.negoc, ini: k.ini, fin: k.fin, nCarga: k.nCarga };
    add(k.sku, e); add(k.general, e);
    total++;
  });

  if (!total && tabla && tabla.killersNQ) {
    tabla.killersNQ.forEach(function (k) {
      var e = { precio: k.precio, ini: '', fin: '', nCarga: 0 };
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
