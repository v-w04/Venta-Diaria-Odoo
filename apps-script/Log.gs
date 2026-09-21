/**
 * VENTA DIARIA ODOO 2026 — Bitácora en "LOG Ventas"
 *
 * Mismo formato que el código anterior:
 *   A Hora | B Emoji | C Nivel | D Etapa | E Mensaje | F Detalles (JSON)
 *
 * Diferencia: antes se BORRABA el log al inicio de cada corrida, así que
 * nunca se veía qué pasó hace una hora. Ahora se acumula y se recorta solo
 * a CFG.RETENCION.LOG filas.
 */

function log_(emoji, nivel, etapa, mensaje, detalles) {
  try {
    var sh = hoja_(CFG.H.LOG, ENC_LOG);
    sh.appendRow([
      ahora_(), emoji, nivel, etapa,
      String(mensaje || '').slice(0, 500),
      detalles ? JSON.stringify(detalles).slice(0, 5000) : ''
    ]);
    var n = sh.getLastRow();
    var tope = CFG.RETENCION.LOG;
    if (n > tope + 200) {
      var sobran = n - tope;
      sh.getRange(2, 1, sobran, sh.getMaxColumns()).clearContent();
      sh.deleteRows(2, sobran);
    }
  } catch (e) {
    console.error('log_ falló: ' + e);   // la bitácora nunca tumba la corrida
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
