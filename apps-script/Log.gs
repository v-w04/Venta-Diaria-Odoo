/**
 * VENTA DIARIA ODOO 2026 — Bitácora en "LOG Ventas"
 *
 * Mismo formato que el código anterior:
 *   A Hora | B Emoji | C Nivel | D Etapa | E Mensaje | F Detalles (JSON)
 *
 * Limpieza: una vez al día se borra lo que tenga más de CFG.RETENCION.DIAS_LOG
 * días; además nunca pasa de CFG.RETENCION.LOG filas. Las corridas sin ventas
 * ya no escriben renglón (ver importarVentasAuto).
 */

function log_(emoji, nivel, etapa, mensaje, detalles) {
  try {
    var sh = hoja_(CFG.H.LOG, ENC_LOG);
    sh.appendRow([
      ahora_(), emoji, nivel, etapa,
      String(mensaje || '').slice(0, 500),
      detalles ? JSON.stringify(detalles).slice(0, 5000) : ''
    ]);
    limpiarLog_(sh);
  } catch (e) {
    console.error('log_ falló: ' + e);   // la bitácora nunca tumba la corrida
  }
}

/**
 * Deja el LOG corto: una vez al día borra lo viejo y, si aun así creció
 * mucho, recorta por número de filas.
 */
function limpiarLog_(sh) {
  var n = sh.getLastRow();
  if (n < 3) return;
  var hoy = hoy_();
  var porDias = prop_('LOG_LIMPIADO_DIA') !== hoy;
  if (porDias) setProp_('LOG_LIMPIADO_DIA', hoy);

  var sobran = 0;
  if (porDias) {
    var corte = Date.now() - CFG.RETENCION.DIAS_LOG * 86400000;
    var fechas = sh.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < fechas.length; i++) {
      var d = fechas[i][0];
      var t = (d instanceof Date) ? d.getTime() : Date.parse(String(d).replace(' ', 'T'));
      if (!t || isNaN(t) || t >= corte) break;
      sobran++;
    }
  }
  if (n - sobran > CFG.RETENCION.LOG) sobran = n - CFG.RETENCION.LOG;
  if (sobran > 0) {
    sh.getRange(2, 1, sobran, sh.getMaxColumns()).clearContent();
    sh.deleteRows(2, sobran);
  }
}

function logInfo_(etapa, msg, det) { log_('ℹ', 'INFO', etapa, msg, det); }
function logOK_(etapa, msg, det)   { log_('✔', 'OK',   etapa, msg, det); }
function logWarn_(etapa, msg, det) { log_('⚠', 'WARN', etapa, msg, det); }

function logError_(etapa, err, det) {
  // Nunca tragarse el mensaje real de Google.
  var texto = String(err && err.message ? err.message : err);
  var d = det || {};
  d.error = texto;
  if (err && err.stack) d.stack = String(err.stack).slice(0, 1500);
  if (esErrorDeCuota_(texto))  d.causa = 'CUOTA_GOOGLE';
  if (esErrorDeCeldas_(texto)) d.causa = 'TOPE_CELDAS_LIBRO';
  log_('✖', 'ERROR', etapa, texto, d);
}
