/**
 * VENTA DIARIA ODOO 2026 — Acceso al site (electronicsmexico.site)
 *
 * Para traer las PROMOCIONES que capturas en Ofertas especiales → Promociones.
 * Paso 1 (ahora): revisarPromocionesSite() prueba dónde las da el site y deja
 * en el LOG qué contestó. Con eso se arma la bajada automática.
 *
 * Credenciales: SOLO en Script Properties (SITE_URL, SITE_API_KEY).
 * La llave es la misma que ya usa Site Sheet (X-API-Key).
 */

var SITE_RUTAS_PROMO = [
  '/walmart/killers/api/data',
  '/walmart/killers/api/promociones',
  '/walmart/killers/api/promos',
  '/walmart/ofertas/api/promociones',
  '/walmart/ofertas-especiales/api/promociones'
];

/** Menú: guarda URL y llave del site en Script Properties. */
function configurarSite() {
  var ui = SpreadsheetApp.getUi();
  var url = ui.prompt('Acceso al site (1/2)', 'URL del site (Enter = https://electronicsmexico.site)',
                      ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  var key = ui.prompt('Acceso al site (2/2)', 'API key del site (la misma que usa Site Sheet)',
                      ui.ButtonSet.OK_CANCEL);
  if (key.getSelectedButton() !== ui.Button.OK) return;
  var u = (url.getResponseText().trim() || 'https://electronicsmexico.site').replace(/\/+$/, '');
  var k = key.getResponseText().trim();
  if (!k) { avisar_('No escribiste la llave. No se guardó nada.'); return; }
  setProp_('SITE_URL', u);
  setProp_('SITE_API_KEY', k);
  avisar_('Listo. Acceso al site guardado (la llave queda en Script Properties, no en el código).');
}

function siteGet_(ruta) {
  var base = prop_('SITE_URL', 'https://electronicsmexico.site');
  var key = prop_('SITE_API_KEY');
  if (!key) throw new Error('Falta la llave del site: Configuración → Configurar acceso al site…');
  var r = UrlFetchApp.fetch(base + ruta, {
    method: 'get', muteHttpExceptions: true, followRedirects: false,
    headers: { 'X-API-Key': key, 'Accept': 'application/json' }
  });
  return { code: r.getResponseCode(), text: r.getContentText() };
}

/** Resumen de un JSON: llaves de primer nivel y tamaño de cada una. */
function resumenJson_(obj) {
  if (Array.isArray(obj)) return { tipo: 'lista', n: obj.length, ejemplo: obj[0] };
  var out = {};
  Object.keys(obj || {}).forEach(function (k) {
    var v = obj[k];
    out[k] = Array.isArray(v) ? ('lista ' + v.length) : (v && typeof v === 'object' ? 'objeto' : String(v).slice(0, 40));
  });
  return out;
}

/** Menú: prueba las rutas del site y deja en el LOG qué hay de promociones. */
function revisarPromocionesSite() {
  var lineas = [];
  SITE_RUTAS_PROMO.forEach(function (ruta) {
    var res;
    try { res = siteGet_(ruta); } catch (e) { lineas.push(ruta + ' → ' + e.message); return; }
    var info = { ruta: ruta, http: res.code, bytes: res.text.length };
    if (res.code === 200) {
      try {
        var j = JSON.parse(res.text);
        info.llaves = resumenJson_(j);
        Object.keys(j || {}).forEach(function (k) {
          if (/promo/i.test(k) && Array.isArray(j[k])) {
            info.promo_llave = k;
            info.promo_n = j[k].length;
            info.promo_ejemplo = j[k][0];
          }
        });
        if (Array.isArray(j)) info.ejemplo = j[0];
      } catch (e) {
        info.noJson = res.text.slice(0, 120);
      }
    }
    logInfo_('SITE', 'Prueba ' + ruta, info);
    lineas.push(ruta + ' → HTTP ' + res.code +
                (info.promo_llave ? '  ✅ ' + info.promo_llave + ': ' + info.promo_n : ''));
  });
  avisar_('Revisión del site (detalle en LOG Ventas, etapa SITE):\n\n' + lineas.join('\n'));
}
