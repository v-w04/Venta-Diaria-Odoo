/**
 * VENTA DIARIA ODOO 2026 — Instalación, triggers y pruebas
 *
 * Presupuesto de llamadas (regla: quedar por debajo del 60% de 20,000):
 *
 *   importarVentasAuto   cada 10 min → 144 corridas × 3-5 llamadas ≈ 600/día
 *   revisarPreciosAuto   cada 15 min →  96 corridas × 0 llamadas   =   0/día
 *
 * revisarPreciosAuto no gasta UrlFetch: lee Site Sheet por la API de Sheets.
 */

var TRIGGERS = [
  { fn: 'importarVentasAuto', min: 10 },
  { fn: 'revisarPreciosAuto', min: 15 }
];

/**
 * Quita TODOS los triggers de esta cuenta en el proyecto (incluidos los del
 * código anterior: cierreNocturno, alertarVendedorTurno…, que ya no existen)
 * y pone los dos nuevos.
 */
function instalarTriggers() {
  var viejos = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  quitarTriggers(true);
  TRIGGERS.forEach(function (t) {
    ScriptApp.newTrigger(t.fn).timeBased().everyMinutes(t.min).create();
  });
  crearHojas(true);
  var cuenta = Session.getEffectiveUser().getEmail();
  logOK_('INSTALAR', 'Triggers instalados', { cuenta: cuenta, quitados: viejos });
  avisar_('Triggers instalados en la cuenta ' + cuenta + ':\n\n' +
    TRIGGERS.map(function (t) { return '  · ' + t.fn + ' cada ' + t.min + ' min'; }).join('\n') +
    (viejos.length ? '\n\nSe quitaron ' + viejos.length + ' trigger(s) anteriores:\n  ' +
                     viejos.join('\n  ') : '') +
    '\n\nConsumo estimado: ~600 llamadas a Odoo al día (tope 20,000).\n\n' +
    'Si el código anterior tenía triggers instalados desde OTRA cuenta,\n' +
    'esos no se ven desde aquí: hay que quitarlos entrando con esa cuenta.');
}

function quitarTriggers(silencioso) {
  var ts = ScriptApp.getProjectTriggers();
  ts.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  if (!silencioso) avisar_('Se quitaron ' + ts.length + ' trigger(s).');
}

/** Crea las hojas del sistema que falten (lo usa instalarTriggers). */
function crearHojas(silencioso) {
  hoja_(CFG.H.WALMART, ENC_WALMART);
  hoja_(CFG.H.CVA,     ENC_VENTAS);
  hoja_(CFG.H.LOG,     ENC_LOG);
  hoja_(CFG.H.ASIGNADOS, ENC_ASIGNADOS);
  if (!libro_().getSheetByName(CFG.H.ALERTAS)) {
    hoja_(CFG.H.ALERTAS, ENC_ALERTAS);
  }
  if (!libro_().getSheetByName(CFG.H.PRECIOS)) hoja_(CFG.H.PRECIOS, null);
  if (!silencioso) avisar_('Listo. Hojas del sistema:\n\n' + hojasProtegidas_().join('\n'));
}

/** Pide las credenciales de Odoo y las guarda en Script Properties. */
function configurarOdoo() {
  var ui = SpreadsheetApp.getUi();
  var campos = [
    ['ODOO_URL',  'URL de Odoo',                'https://electronicsmexico.odoo.com'],
    ['ODOO_DB',   'Nombre de la base de datos', 'electronicsmexico'],
    ['ODOO_USER', 'Usuario (correo)',           ''],
    ['ODOO_PASS', 'API key',                    '']
  ];
  for (var i = 0; i < campos.length; i++) {
    var k = campos[i][0], etiqueta = campos[i][1], sugerido = campos[i][2];
    var actual = prop_(k);
    var vista = (k === 'ODOO_PASS' && actual) ? '(ya hay una guardada)' : (actual || sugerido);
    var r = ui.prompt('Configurar Odoo — ' + (i + 1) + '/4',
      etiqueta + '\n\nActual: ' + (vista || '—') +
      '\n\nDéjalo vacío para quedarte con el actual.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = r.getResponseText().trim();
    if (v) setProp_(k, v);
    else if (!actual && sugerido) setProp_(k, sugerido);
  }
  CacheService.getScriptCache().remove('ODOO_UID');
  ['CAMPOS_sale_order_line', 'CAMPOS_product_product', 'ODOO_COMPANY_ID'].forEach(function (k) {
    PropertiesService.getScriptProperties().deleteProperty(k);
  });
  ui.alert('Guardado. Ahora usa  Configuración → Probar conexión a Odoo.');
}

/** Prueba de vida: autentica, ubica la empresa y trae 1 línea. */
function probarOdoo() {
  try {
    var uid = odooUid_();
    var company = odooCompanyId_();
    var campos = odooCamposExistentes_('sale.order.line',
      ['id', 'order_id', 'product_id', 'product_uom_qty', 'price_unit', 'price_subtotal']);
    var dominio = [['state', 'in', CFG.ESTADOS_SO]];
    if (company) dominio.push(['company_id', '=', company]);
    var muestra = odooEjecutar_('sale.order.line', 'search_read', [dominio],
      { fields: campos, limit: 1, order: 'id desc' });

    logOK_('PRUEBA', 'Conexión a Odoo correcta', { uid: uid, company: company });
    avisar_('✅ Odoo responde\n\n' +
      'uid: ' + uid + '\n' +
      'Empresa ' + CFG.COMPANY_NAME + ': ' + (company ? 'id ' + company : '⚠️ no encontrada, sin filtro') + '\n\n' +
      'Última línea de venta:\n' + JSON.stringify(muestra[0], null, 2).slice(0, 700));
  } catch (e) {
    logError_('PRUEBA', e);
    avisar_('❌ Falló la conexión a Odoo\n\n' + e);
  }
}
