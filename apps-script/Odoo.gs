/**
 * VENTA DIARIA ODOO 2026 — Cliente XML-RPC de Odoo 18
 *
 * OJO con dos cosas que ya costaron horas en otros proyectos:
 *  1. El tag de struct es <name>, NUNCA <n>. Odoo responde
 *     "TypeError: unhashable type: 'list'" si se abrevia.
 *  2. Odoo 18 puede no tener módulos que la documentación da por hechos.
 *     Por eso los campos se verifican contra ir.model.fields en vez de
 *     hardcodearse.
 *
 * Cada llamada a Odoo es un UrlFetchApp.fetch y se cobra a la cuota de
 * 20,000/día de la cuenta que instaló el trigger. El uid se cachea para no
 * pagar el authenticate en cada corrida.
 */

// ── Serialización ─────────────────────────────────────────────────────────

function xrEsc_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function xrVal_(v) {
  if (v === null || v === undefined) return '<value><boolean>0</boolean></value>';
  if (typeof v === 'boolean') return '<value><boolean>' + (v ? 1 : 0) + '</boolean></value>';
  if (typeof v === 'number') {
    return (v % 1 === 0 && Math.abs(v) < 2147483647)
      ? '<value><int>' + v + '</int></value>'
      : '<value><double>' + v + '</double></value>';
  }
  if (v instanceof Date) {
    return '<value><string>' +
      Utilities.formatDate(v, 'UTC', "yyyy-MM-dd HH:mm:ss") + '</string></value>';
  }
  if (Object.prototype.toString.call(v) === '[object Array]') {
    var a = '<value><array><data>';
    for (var i = 0; i < v.length; i++) a += xrVal_(v[i]);
    return a + '</data></array></value>';
  }
  if (typeof v === 'object') {
    var s = '<value><struct>';
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      // <name> completo. NO <n>.
      s += '<member><name>' + xrEsc_(k) + '</name>' + xrVal_(v[k]) + '</member>';
    }
    return s + '</struct></value>';
  }
  return '<value><string>' + xrEsc_(v) + '</string></value>';
}

function xrBody_(metodo, params) {
  var b = '<?xml version="1.0"?><methodCall><methodName>' + metodo +
          '</methodName><params>';
  for (var i = 0; i < params.length; i++) {
    b += '<param>' + xrVal_(params[i]) + '</param>';
  }
  return b + '</params></methodCall>';
}

// ── Parseo ────────────────────────────────────────────────────────────────

function xrParseValor_(el) {
  var hijos = el.getChildren();
  if (!hijos.length) return el.getText();              // <value>texto</value>
  var n = hijos[0], t = n.getName();
  switch (t) {
    case 'int': case 'i4': return parseInt(n.getText(), 10);
    case 'double':         return parseFloat(n.getText());
    case 'boolean':        return n.getText() === '1';
    case 'nil':            return null;
    case 'string':
    case 'dateTime.iso8601':
    case 'base64':         return n.getText();
    case 'array': {
      var out = [];
      var data = n.getChild('data');
      if (data) {
        var vs = data.getChildren('value');
        for (var i = 0; i < vs.length; i++) out.push(xrParseValor_(vs[i]));
      }
      return out;
    }
    case 'struct': {
      var o = {};
      var ms = n.getChildren('member');
      for (var j = 0; j < ms.length; j++) {
        var nm = ms[j].getChild('name');
        var vl = ms[j].getChild('value');
        if (nm) o[nm.getText()] = vl ? xrParseValor_(vl) : null;
      }
      return o;
    }
  }
  return n.getText();
}

function xrParse_(xml) {
  var raiz = XmlService.parse(xml).getRootElement();

  var fault = raiz.getChild('fault');
  if (fault) {
    var f = xrParseValor_(fault.getChild('value'));
    var msg = (f && (f.faultString || f.faultCode)) || JSON.stringify(f);
    throw new Error('Odoo fault: ' + msg);
  }

  var params = raiz.getChild('params');
  if (!params) return null;
  var p = params.getChild('param');
  if (!p) return null;
  return xrParseValor_(p.getChild('value'));
}

// ── Llamada ───────────────────────────────────────────────────────────────

function odooConfig_() {
  var c = {
    url:  String(prop_('ODOO_URL')).replace(/\/+$/, ''),
    db:   prop_('ODOO_DB'),
    user: prop_('ODOO_USER'),
    pass: prop_('ODOO_PASS')
  };
  var faltan = [];
  if (!c.url)  faltan.push('ODOO_URL');
  if (!c.db)   faltan.push('ODOO_DB');
  if (!c.user) faltan.push('ODOO_USER');
  if (!c.pass) faltan.push('ODOO_PASS');
  if (faltan.length) {
    throw new Error('Falta configurar en Script Properties: ' + faltan.join(', ') +
                    '. Menú ⚙️ Venta Diaria → Configuración → Configurar Odoo…');
  }
  return c;
}

function xrLlamar_(endpoint, metodo, params) {
  var c = odooConfig_();
  var res = UrlFetchApp.fetch(c.url + '/xmlrpc/2/' + endpoint, {
    method: 'post',
    contentType: 'text/xml',
    payload: xrBody_(metodo, params),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var txt = res.getContentText();
  if (code !== 200) {
    throw new Error('Odoo HTTP ' + code + ': ' + txt.slice(0, 300));
  }
  contarLlamada_();
  return xrParse_(txt);
}

/** uid cacheado 6 h: ahorra un authenticate por corrida. */
function odooUid_() {
  var cache = CacheService.getScriptCache();
  var k = 'ODOO_UID';
  var v = cache.get(k);
  if (v) return parseInt(v, 10);

  var c = odooConfig_();
  var uid = xrLlamar_('common', 'authenticate', [c.db, c.user, c.pass, {}]);
  if (!uid || uid === true || uid === false) {
    throw new Error('Odoo rechazó las credenciales (authenticate devolvió ' + uid + ')');
  }
  cache.put(k, String(uid), 21600);
  return uid;
}

function odooEjecutar_(modelo, metodo, args, kwargs) {
  var c = odooConfig_();
  return xrLlamar_('object', 'execute_kw',
    [c.db, odooUid_(), c.pass, modelo, metodo, args || [], kwargs || {}]);
}

/**
 * Campos que EXISTEN de verdad en un modelo de esta instancia.
 * Se cachea en Script Properties porque no cambia casi nunca.
 */
function odooCamposExistentes_(modelo, candidatos) {
  var k = 'CAMPOS_' + modelo.replace(/\./g, '_');
  var guardado = prop_(k);
  var todos;
  if (guardado) {
    todos = JSON.parse(guardado);
  } else {
    var filas = odooEjecutar_('ir.model.fields', 'search_read',
      [[['model', '=', modelo]]], { fields: ['name'], limit: 2000 });
    todos = filas.map(function (f) { return f.name; });
    setProp_(k, JSON.stringify(todos));
  }
  var set = {};
  for (var i = 0; i < todos.length; i++) set[todos[i]] = true;
  return candidatos.filter(function (c) { return !!set[c]; });
}

/**
 * Id de la empresa ElectronicsMexico. La instancia es multiempresa: sin este
 * filtro se colarían ventas de otras razones sociales. Se cachea.
 */
function odooCompanyId_() {
  var guardado = prop_('ODOO_COMPANY_ID');
  if (guardado) return Number(guardado);
  var filas = odooEjecutar_('res.company', 'search_read',
    [[['name', '=', CFG.COMPANY_NAME]]], { fields: ['id', 'name'], limit: 1 });
  if (!filas || !filas.length) return 0;          // sin filtro, pero no truena
  setProp_('ODOO_COMPANY_ID', String(filas[0].id));
  return filas[0].id;
}

// ── Contador de llamadas (UserProperties: Google cobra por usuario) ───────

function contarLlamada_() {
  try {
    var d = hoy_();
    if (uprop_('FETCH_DIA') !== d) {
      setUprop_('FETCH_DIA', d);
      setUprop_('FETCH_N', '0');
    }
    setUprop_('FETCH_N', String(Number(uprop_('FETCH_N', '0')) + 1));
  } catch (e) { /* nunca tumbar la corrida por el contador */ }
}

function llamadasDeHoy_() {
  return (uprop_('FETCH_DIA') === hoy_()) ? Number(uprop_('FETCH_N', '0')) : 0;
}
