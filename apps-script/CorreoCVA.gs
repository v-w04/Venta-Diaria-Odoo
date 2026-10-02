/**
 * VENTA DIARIA ODOO 2026 — Reporte diario de ventas CVA
 *
 * UN correo al día, a partir de las CFG.CVA_HORA_REPORTE (8 am), a un solo
 * destinatario: victor.walmart.04@gmail.com (CFG.CORREO_CVA).
 *
 * Trae todo lo vendido de CVA desde el correo anterior (el día completo de
 * ayer): total en pesos, piezas y la lista. Nada más. Si no hubo ventas, no
 * se manda nada.
 *
 * No necesita trigger propio: cada importación (cada 10 min) revisa si ya
 * toca mandarlo. Cómo sabe qué incluir: guarda hasta qué fila de PEDIDOS CVA
 * ya reportó (CVA_FILA_AVISADA).
 */

/**
 * Se llama ANTES de escribir en PEDIDOS CVA. La primera vez fija la marca en
 * la última fila actual: así no se reenvía todo el histórico que ya existía.
 */
function marcaCvaInicial_() {
  if (prop_('CVA_FILA_AVISADA') !== '') return;
  var sh = libro_().getSheetByName(CFG.H.CVA);
  setProp_('CVA_FILA_AVISADA', String(sh ? Math.max(ultimaFilaColA_(sh), 1) : 1));
}

/** Manda el reporte del día si ya es hora y no se ha mandado hoy. */
function enviarCorreoCVA_() {
  try {
    var hoy = hoy_();
    var hora = Number(Utilities.formatDate(new Date(), CFG.TZ, 'H'));
    if (hora < CFG.CVA_HORA_REPORTE) return false;
    if (prop_('CVA_DIA_REPORTE') === hoy) return false;

    var sh = libro_().getSheetByName(CFG.H.CVA);
    if (!sh) return false;
    var hasta = ultimaFilaColA_(sh);
    var desde = Number(prop_('CVA_FILA_AVISADA', String(hasta)));

    setProp_('CVA_DIA_REPORTE', hoy);           // una vez al día, pase lo que pase
    if (hasta <= desde) return false;           // sin ventas: no se manda nada

    // Por NOMBRE de encabezado: si alguien mueve una columna de PEDIDOS CVA,
    // el correo sigue leyendo bien el SKU, la cantidad y el importe.
    var filas = filasOrdenadas_(sh, ENC_VENTAS, desde + 1)
      .filter(function (f) { return f[0] !== '' && f[0] !== null; });
    setProp_('CVA_FILA_AVISADA', String(hasta));
    if (!filas.length) return false;

    var total = 0, piezas = 0;
    filas.forEach(function (f) { total += num_(f[10]); piezas += num_(f[8]); });

    MailApp.sendEmail({
      to: CFG.CORREO_CVA,
      subject: 'Ventas CVA — $' + dinero_(total) + ' · ' + piezas + ' pieza(s)',
      htmlBody: armarCorreoCVA_(filas, total, piezas),
      name: 'Venta Diaria Odoo'
    });
    logOK_('CVA', 'Reporte diario de ventas CVA enviado',
           { lineas: filas.length, piezas: piezas, total: total, a: CFG.CORREO_CVA });
    return true;

  } catch (e) {
    logError_('CVA', e, { nota: 'No se pudo mandar el reporte diario de ventas CVA' });
    return false;
  }
}

function dinero_(n) {
  return Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Correo sencillo: total, piezas y la lista. */
function armarCorreoCVA_(filas, total, piezas) {
  var td = 'padding:6px 10px;border-bottom:1px solid #eee;';
  var th = 'padding:6px 10px;border-bottom:2px solid #ccc;text-align:left;';
  var tr = filas.map(function (f) {
    var fd = (f[2] instanceof Date) ? f[2] : new Date(f[2]);
    var fecha = isNaN(fd.getTime()) ? String(f[2]).slice(0, 10)
                                    : Utilities.formatDate(fd, CFG.TZ, 'dd/MM');
    return '<tr>' +
      '<td style="' + td + '">' + fecha + '</td>' +
      '<td style="' + td + '">' + f[3] + '</td>' +
      '<td style="' + td + 'font-family:monospace">' + f[6] + '</td>' +
      '<td style="' + td + '">' + String(f[7]).replace(/^\[[^\]]*\]\s*/, '').slice(0, 55) + '</td>' +
      '<td style="' + td + 'text-align:right">' + num_(f[8]) + '</td>' +
      '<td style="' + td + 'text-align:right">$' + dinero_(num_(f[10])) + '</td>' +
      '</tr>';
  }).join('');

  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' +
    '<p style="font-size:16px;margin:0 0 12px">' +
      '<b>Ventas CVA: $' + dinero_(total) + '</b> · ' + piezas + ' pieza(s)</p>' +
    '<table style="border-collapse:collapse;font-size:13px">' +
      '<tr><th style="' + th + '">Fecha</th><th style="' + th + '">Plataforma</th>' +
      '<th style="' + th + '">SKU</th><th style="' + th + '">Producto</th>' +
      '<th style="' + th + 'text-align:right">Piezas</th>' +
      '<th style="' + th + 'text-align:right">Importe</th></tr>' +
      tr +
    '</table></div>';
}
