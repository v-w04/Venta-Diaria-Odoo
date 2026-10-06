/**
 * VENTA DIARIA ODOO 2026 — API de órdenes de Walmart (prueba)
 *
 * Walmart maneja dos números por pedido: el de COMPRA (purchaseOrderId, 609…)
 * y el de PEDIDO del cliente (customerOrderId, 6000…). Odoo guarda solo uno,
 * así que para cruzar y saber el estado y el día de envío se consulta la API
 * de Walmart, que trae los dos.
 *
 * Esta primera parte es solo la PRUEBA: guardar las credenciales y consultar
 * UN número para ver qué responde tu cuenta. No modifica ninguna hoja de
 * datos; el resultado queda en una alerta y en LOG Ventas.
 *
 * CREDENCIALES: Client ID y Client Secret viven en Script Properties
 * (WM_CLIENT_ID, WM_CLIENT_SECRET). Se capturan con el menú
 * Configuración → Configurar API de Walmart. NUNCA van en el código ni en el repo.
 *
 * Referencia de la cuenta: docs del proyecto (walmart-api.md). Base
 * https://marketplace.walmartapis.com · mercado mx · versión 3.1 · token 900 s.
 */

var WM_BASE = 'https://marketplace.walmartapis.com';

/** Menú: guarda Client ID y Client Secret en Script Properties. */
function configurarWalmart() {
  var ui = SpreadsheetApp.getUi();
  var campos = [
    ['WM_CLIENT_ID',     'Client ID de la API de Walmart'],
    ['WM_CLIENT_SECRET', 'Client Secret de la API de Walmart']
  ];
  for (var i = 0; i < campos.length; i++) {
    var k = campos[i][0];
    var actual = prop_(k);
    var r = ui.prompt('Configurar API de Walmart — ' + (i + 1) + '/2',
      campos[i][1] + '\n\nActual: ' + (actual ? '(ya hay uno guardado)' : '—') +
      '\n\nDéjalo vacío para quedarte con el actual.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = r.getResponseText().trim();
    if (v) setProp_(k, v);
  }
  CacheService.getScriptCache().remove('WM_TOKEN');
  ui.alert('Guardado. Ahora usa  Configuración → Probar un pedido en la API de Walmart.');
}

/** Token OAuth cacheado 14 min. */
function wmToken_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get('WM_TOKEN');
  if (t) return t;

  var id = prop_('WM_CLIENT_ID'), sec = prop_('WM_CLIENT_SECRET');
  if (!id || !sec) {
    throw new Error('Falta configurar la API de Walmart. Menú ⚙️ Venta Diaria → Configuración → Configurar API de Walmart…');
  }
  var res = UrlFetchApp.fetch(WM_BASE + '/v3/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=client_credentials',
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(id + ':' + sec),
      'WM_SVC.NAME': 'Venta Diaria Odoo',
      'WM_QOS.CORRELATION_ID': Utilities.getUuid(),
      'WM_MARKET': 'mx',
      'WM_GLOBAL_VERSION': '3.1',
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  });
  contarLlamada_();
  if (res.getResponseCode() !== 200) {
    throw new Error('Walmart rechazó el token (HTTP ' + res.getResponseCode() + '): ' +
                    res.getContentText().slice(0, 300));
  }
  var tok = JSON.parse(res.getContentText()).access_token;
  cache.put('WM_TOKEN', tok, 840);
  return tok;
}

/** GET a la API de Walmart. Devuelve { code, texto, json }. No truena por HTTP. */
function wmGet_(ruta) {
  var res = UrlFetchApp.fetch(WM_BASE + ruta, {
    method: 'get',
    headers: {
      'WM_SEC.ACCESS_TOKEN': wmToken_(),
      'WM_QOS.CORRELATION_ID': Utilities.getUuid(),
      'WM_SVC.NAME': 'Venta Diaria Odoo',
      'WM_MARKET': 'mx',
      'WM_GLOBAL_VERSION': '3.1',
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  });
  contarLlamada_();
  var texto = res.getContentText();
  var json = null;
  try { json = JSON.parse(texto); } catch (e) { /* no era JSON */ }
  return { code: res.getResponseCode(), texto: texto, json: json };
}

/** Saca la(s) orden(es) de cualquiera de las dos formas de respuesta. */
function wmOrdenes_(json) {
  if (!json) return [];
  var o = null;
  if (json.order) o = json.order;
  else if (json.list && json.list.elements && json.list.elements.order) o = json.list.elements.order;
  else if (json.purchaseOrderId) o = json;
  if (!o) return [];
  return Array.isArray(o) ? o : [o];
}

function wmFecha_(ms) {
  var n = Number(ms);
  if (!n) return '';
  return Utilities.formatDate(new Date(n), CFG.TZ, 'dd/MM/yyyy HH:mm');
}

/** Resumen legible de una orden de Walmart. */
function wmResumen_(o) {
  var out = ['Compra (purchaseOrderId): ' + (o.purchaseOrderId || ''),
             'Pedido (customerOrderId): ' + (o.customerOrderId || ''),
             'Fecha: ' + wmFecha_(o.orderDate)];
  var lineas = (o.orderLines && o.orderLines.orderLine) || [];
  if (!Array.isArray(lineas)) lineas = [lineas];
  lineas.forEach(function (l) {
    var sts = (l.orderLineStatuses && l.orderLineStatuses.orderLineStatus) || [];
    if (!Array.isArray(sts)) sts = [sts];
    var sku = l.item && l.item.sku || '';
    var qty = l.orderLineQuantity && l.orderLineQuantity.amount || '';
    out.push('  Línea ' + (l.lineNumber || '') + ' · ' + sku + ' · cant ' + qty);
    sts.forEach(function (s) {
      var ti = s.trackingInfo || {};
      var car = ti.carrierName && (ti.carrierName.carrier || ti.carrierName.otherCarrier) || '';
      out.push('     ' + (s.status || '') + (ti.shipDateTime ? ' · enviado ' + wmFecha_(ti.shipDateTime) : '') +
               (ti.trackingNumber ? ' · guía ' + ti.trackingNumber : '') + (car ? ' · ' + car : ''));
    });
  });
  return out.join('\n');
}

/** Menú: consulta UN número (de compra o de pedido) y muestra qué responde la API. */
function probarPedidoWalmart() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Probar un pedido en la API de Walmart',
    'Escribe UN número de venta de Walmart (el de compra, 609…, o el de pedido, 6000…).',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var num = bvNorm_(r.getResponseText());
  if (!num) return;

  try {
    var intentos = [
      { que: 'por número de compra', ruta: '/v3/orders/' + encodeURIComponent(num) },
      { que: 'por número de pedido', ruta: '/v3/orders?customerOrderId=' + encodeURIComponent(num) + '&limit=10' }
    ];
    var lineas = [], hallada = null, crudo = {};
    for (var i = 0; i < intentos.length && !hallada; i++) {
      var x = wmGet_(intentos[i].ruta);
      crudo[intentos[i].que] = { http: x.code, resp: x.texto.slice(0, 900) };
      var ords = (x.code === 200) ? wmOrdenes_(x.json) : [];
      lineas.push(intentos[i].que + ': HTTP ' + x.code + (ords.length ? ' · ' + ords.length + ' orden(es)' : ' · sin resultado'));
      if (ords.length) hallada = ords;
    }
    logInfo_('WALMART API', 'Prueba de pedido ' + num, crudo);

    if (!hallada) {
      avisar_('❌ La API no devolvió ese pedido\n\n' + lineas.join('\n') +
              '\n\nLa respuesta cruda quedó en LOG Ventas (etapa WALMART API).');
      return;
    }
    avisar_('✅ La API respondió\n\n' + lineas.join('\n') + '\n\n' +
            hallada.slice(0, 3).map(wmResumen_).join('\n\n').slice(0, 1800) +
            '\n\nLlamadas hoy: ' + llamadasDeHoy_());
  } catch (e) {
    logError_('WALMART API', e);
    avisar_('❌ Falló la prueba\n\n' + e);
  }
}
