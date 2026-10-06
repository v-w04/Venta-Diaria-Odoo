/**
 * VENTA DIARIA ODOO 2026 — Killers leídos de Site Sheet
 *
 * Los killers ya NO se pegan a mano. Site Sheet (su Killers.gs) baja cada hora
 * la tanda de killers del site (/walmart/killers/api/data) a su hoja "Killers".
 * Aquí solo se LEE esa hoja: Site Sheet es fuente permitida y openById no gasta
 * cuota de UrlFetch.
 *
 * QUÉ HACE: pasa lo que trae esa hoja a KILLERS HISTORICO, que es donde ya
 * vivía todo (validación de ventas, KILLERS ACTIVOS, reporte del mes). No hay
 * lógica nueva de killers ni hoja nueva: solo cambió DE DÓNDE llegan. Por eso
 * no se hace una copia espejo como en Promociones — el histórico ya es la copia
 * permanente de cada killer que se ha visto, incluidos los que Site Sheet ya
 * quitó.
 *
 * CÓMO: cada ~4 minutos (importación y precios) se lee la hoja y se calcula una
 * huella de la lista. Si la huella es la misma, no se escribe nada. Si cambió,
 * se abre una carga nueva (ORIGEN = SITE), los rangos que ya estaban solo se
 * marcan como vistos y los nuevos entran. Un renglón de LOG por cambio.
 *
 * COLUMNAS: por encabezado, con alias. Si el site renombra o mueve columnas no
 * se rompe; si renombra una de las obligatorias (SKU, NEGOCIADO, TERMINA) no
 * se escribe NADA y queda un aviso en el LOG con los encabezados reales.
 *
 * Lo pegado a mano (KILLERS PEGAR → 🎯 Procesar killers pegados) se queda como
 * respaldo y convive con esto: cada origen lleva su propia "última carga".
 */

var KS_HOJA     = 'Killers';                  // hoja en Site Sheet
var KS_ENC      = 'KILLERS_SITE_ENC';         // firma de encabezados de la última lectura
var KS_HUELLA   = 'KILLERS_SITE_HUELLA';      // huella de la última lista guardada
var KS_ULTIMA   = 'KILLERS_SITE_ULTIMA';      // número de la última carga del site
var KS_REVISADO = 'KILLERS_SITE_REVISADO';    // ms de la última lectura de Site Sheet
var KS_AVISO    = 'KILLERS_SITE_AVISO';       // un aviso por día y clave
var KS_PENDIENTE = 'KILLERS_ACTIVOS_PENDIENTE'; // '1' = hay que rehacer KILLERS ACTIVOS
var KS_CADA_MS  = 4 * 60 * 1000;

/**
 * Encabezados de la hoja "Killers" de Site Sheet, verificados contra la hoja
 * real el 05/10/2026:
 *   SKU · SKU BASE · TITULO · PUBLICADO · CUPON · NOS PAGAN · NEGOCIADO ·
 *   COMISION KILLER · COMISION MSI · INICIA · TERMINA · DIAS · POR VENCER · SOLO WFS
 * Obligatorias: SKU, NEGOCIADO, TERMINA (sin fecha de fin un killer valdría
 * para siempre). El resto son opcionales.
 */
var KS_ALIAS = {
  SKU:    ['SKU', 'SKU PUBLICACION'],
  TITULO: ['TITULO', 'DETALLES DEL ARTICULO', 'DETALLES'],
  PUB:    ['PUBLICADO', 'PRECIO ACTUAL'],
  CUPON:  ['CUPON', 'CUPON DE OFERTA'],
  NOS:    ['NOS PAGAN', 'RECIBIMOS'],
  NEGOC:  ['NEGOCIADO', 'PRECIO NEGOCIADO'],
  COMK:   ['COMISION KILLER', 'COMISION SOBRE EL CUPON KILLER'],
  COMMSI: ['COMISION MSI'],
  INI:    ['INICIA', 'INICIO', 'INICIO DE LA OFERTA'],
  FIN:    ['TERMINA', 'FIN', 'FINALIZACION DE LA OFERTA'],
  WFS:    ['SOLO WFS', 'VALIDA SOLO WFS']
};

/** Un aviso por día y por clave: esto corre cada 4 minutos y no puede llenar el LOG. */
function ksAvisarUnaVez_(clave, fn) {
  try {
    var marca = hoy_() + '|' + clave;
    if (prop_(KS_AVISO) === marca) return;
    setProp_(KS_AVISO, marca);
    fn();
  } catch (e) { /* avisar nunca debe tirar la corrida */ }
}

/** Lee la tabla cruda de Site Sheet. null si no se pudo. */
function ksTabla_() {
  try {
    var sh = SpreadsheetApp.openById(CFG.SITE_SHEET_ID).getSheetByName(KS_HOJA);
    if (!sh) {
      ksAvisarUnaVez_('falta', function () {
        logWarn_('KILLERS SITE', 'Site Sheet no tiene la hoja "' + KS_HOJA + '". ' +
                 'Se siguen usando los killers que ya están en KILLERS HISTORICO.');
      });
      return null;
    }
    var nf = sh.getLastRow(), nc = sh.getLastColumn();
    if (nf < 2 || nc < 1) return { enc: nc >= 1 ? sh.getRange(1, 1, 1, nc).getValues()[0] : [], datos: [] };
    var todo = sh.getRange(1, 1, nf, nc).getValues();
    return { enc: todo[0], datos: todo.slice(1) };
  } catch (e) {
    ksAvisarUnaVez_('error', function () {
      logWarn_('KILLERS SITE', 'No se pudo leer "' + KS_HOJA + '" de Site Sheet. ' +
               'Se siguen usando los killers que ya están en KILLERS HISTORICO.',
               { error: String(e && e.message || e) });
    });
    return null;
  }
}

/** Avisa (una vez) si el site cambió los nombres de sus columnas. */
function ksRevisarEncabezados_(enc) {
  try {
    var lista = enc.map(function (x) { return String(x || ''); });
    var firma = lista.join('|');
    var antes = prop_(KS_ENC);
    if (antes && antes !== firma) {
      var a = antes.split('|');
      logWarn_('KILLERS SITE', 'El site CAMBIÓ las columnas de la hoja de killers',
               { yaNoEstan: a.filter(function (x) { return x && lista.indexOf(x) < 0; }),
                 ahoraHay: lista.filter(function (x) { return x && a.indexOf(x) < 0; }),
                 total: lista.length });
    }
    setProp_(KS_ENC, firma);
  } catch (e) { /* opcional */ }
}

/**
 * Killers de Site Sheet con la MISMA forma que los que salían de KILLERS PEGAR
 * (ver leerPegado_). Devuelve null si no se pudo leer o faltan columnas
 * obligatorias; { killers: [...], descartados: n } si todo bien.
 */
function killersDelSite_() {
  var t = ksTabla_();
  if (!t) return null;
  ksRevisarEncabezados_(t.enc);

  var mapa = mapaColumnas_(t.enc);
  var col = function (llave) {
    var lista = KS_ALIAS[llave];
    for (var i = 0; i < lista.length; i++) {
      var j = mapa[norm_(lista[i])];
      if (j !== undefined) return j;
    }
    return -1;
  };
  var iSku = col('SKU'), iNeg = col('NEGOC'), iFin = col('FIN');
  if (iSku < 0 || iNeg < 0 || iFin < 0) {
    ksAvisarUnaVez_('sincolumnas', function () {
      logWarn_('KILLERS SITE', 'La hoja "' + KS_HOJA + '" no trae SKU, NEGOCIADO y TERMINA que yo reconozca. ' +
               'No se escribió nada.',
               { faltan: [iSku < 0 ? 'SKU' : '', iNeg < 0 ? 'NEGOCIADO' : '', iFin < 0 ? 'TERMINA' : '']
                          .filter(String),
                 encabezadosReales: t.enc.map(String).filter(function (x) { return x !== ''; }) });
    });
    return null;
  }
  var iTit = col('TITULO'), iPub = col('PUB'), iCup = col('CUPON'), iNos = col('NOS'),
      iComK = col('COMK'), iComM = col('COMMSI'), iIni = col('INI'), iWfs = col('WFS');

  var killers = [], descartados = 0;
  t.datos.forEach(function (f) {
    var sku = sku_(f[iSku]);
    if (!sku) return;
    var negoc = num_(f[iNeg]);
    var fin = fechaK_(f[iFin]);
    // Sin precio o sin fecha de fin no se acepta: no hay forma de saber cuándo vale.
    if (!(negoc > 0) || !(fin instanceof Date)) { descartados++; return; }
    var cupon = iCup >= 0 ? num_(f[iCup]) : 0;
    var nos = iNos >= 0 ? num_(f[iNos]) : 0;
    killers.push({
      sku: sku, general: skuBase_(sku),
      detalles: String(iTit >= 0 ? f[iTit] || '' : '').slice(0, 200),
      actual: iPub >= 0 ? num_(f[iPub]) : '',
      negoc: negoc, cupon: cupon,
      recibimos: nos || (negoc + cupon),
      ini: iIni >= 0 ? fechaK_(f[iIni]) : '', fin: fin,
      comCup: iComK >= 0 ? pct_(f[iComK]) : '',
      msi: tipoPublicacion_(sku) === 'PREMIUM' ? 'Sí' : 'No',
      comMsi: iComM >= 0 ? pct_(f[iComM]) : '',
      wfs: iWfs >= 0 ? f[iWfs] : '', devol: '', disp: '', obs: '',
      origen: 'SITE'
    });
  });
  return { killers: killers, descartados: descartados, filas: t.datos.length };
}

/** Huella de una lista de killers: la misma lista da la misma huella, en cualquier orden. */
function ksHuella_(killers) {
  var llaves = killers.map(function (k) {
    return llaveKiller_(k.sku, k.negoc, k.cupon, k.ini, k.fin);
  }).sort().join(';');
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, llaves, Utilities.Charset.UTF_8));
}

/**
 * Pasa los killers de Site Sheet a KILLERS HISTORICO si la lista cambió.
 *   forzar = true  → lee Site Sheet aunque se haya leído hace menos de 4 min
 * Devuelve { estado: 'reciente'|'sin_lectura'|'vacia'|'igual'|'cambio', ... }.
 * Nunca truena: si algo falla deja un aviso y el sistema sigue con lo que ya
 * tiene en el histórico.
 */
function sincronizarKillersSite_(forzar) {
  try {
    var ahora = Date.now();
    if (!forzar && ahora - Number(prop_(KS_REVISADO, '0')) < KS_CADA_MS) return { estado: 'reciente' };
    setProp_(KS_REVISADO, String(ahora));

    var s = killersDelSite_();
    if (!s) return { estado: 'sin_lectura' };
    if (!s.killers.length) {
      ksAvisarUnaVez_('vacia', function () {
        logWarn_('KILLERS SITE', 'La hoja "' + KS_HOJA + '" de Site Sheet no trae killers con precio y fecha. ' +
                 'No se tocó nada.', { filas: s.filas, descartados: s.descartados });
      });
      return { estado: 'vacia' };
    }

    var huella = ksHuella_(s.killers);
    if (huella === prop_(KS_HUELLA) && Number(prop_(KS_ULTIMA, '0')) > 0) {
      return { estado: 'igual', n: s.killers.length };
    }

    var carga = nuevaCarga_();
    var h = guardarEnHistorico_(s.killers, carga);
    setProp_(KS_ULTIMA, String(carga.n));
    setProp_(KS_HUELLA, huella);
    setProp_(KS_PENDIENTE, '1');            // KILLERS ACTIVOS se rehace en la siguiente pasada

    var vigentes = s.killers.filter(function (k) {
      return (!(k.ini instanceof Date) || ms_(k.ini) <= ahora) && ms_(k.fin) >= ahora;
    }).length;
    var datos = { leidos: s.killers.length, vigentes: vigentes,
                  nuevosEnHistorico: h.nuevos, yaEstaban: h.repetidos,
                  descartados: s.descartados, carga: carga.etiqueta };
    logOK_('KILLERS SITE', 'Killers del site (cambiaron)', datos);
    datos.estado = 'cambio';
    return datos;
  } catch (e) {
    logWarn_('KILLERS SITE', 'No se pudo sincronizar los killers del site; ' +
             'se siguen usando los del histórico', { error: String(e && e.message || e) });
    return { estado: 'error' };
  }
}
