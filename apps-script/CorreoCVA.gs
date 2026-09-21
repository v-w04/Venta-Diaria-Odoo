/**
 * VENTA DIARIA ODOO 2026 — Correo de ventas CVA
 *
 * ÚNICO correo que manda este proyecto, y ÚNICO destinatario:
 *   victor.walmart.04@gmail.com   (CFG.CORREO_CVA)
 *
 * No avisa si el precio está bien o mal. Avisa QUE HUBO VENTAS de producto
 * CVA, de cualquier plataforma, con el detalle. Nada más.
 *
 * Cómo sabe qué avisar: guarda hasta qué fila de PEDIDOS CVA ya avisó
 * (CVA_FILA_AVISADA). Lo nuevo es todo lo que esté debajo. Así no depende
 * de guardar las filas en Script Properties (tope de 9 KB por valor).
 *
 * Agrupado: máximo un correo cada 20 minutos (MailApp: 100/día en Gmail).
 */

var CVA_MIN_ENTRE_CORREOS = 20;

/**
 * Se llama ANTES de escribir en PEDIDOS CVA. La primera vez fija la marca en
 * la última fila actual: así no se reenvía todo el histórico que ya existía.
 */
function marcaCvaInicial_() {
  if (prop_('CVA_FILA_AVISADA') !== '') return;
  var sh = libro_().getSheetByName(CFG.H.CVA);
  setProp_('CVA_FILA_AVISADA', String(sh ? Math.max(sh.getLastRow(), 1) : 1));
}

/** Manda el correo con las filas de PEDIDOS CVA que aún no se avisaron. */
function enviarCorreoCVA_(forzar) {
  try {
    var sh = libro_().getSheetByName(CFG.H.CVA);
    if (!sh) return false;
    var hasta = sh.getLastRow();
    var desde = Number(prop_('CVA_FILA_AVISADA', '1'));
    if (hasta <= desde) return false;

    var ultimo = Number(prop_('CVA_ULTIMO_CORREO', '0'));
    if (!forzar && ultimo && (Date.now() - ultimo) / 60000 < CVA_MIN_ENTRE_CORREOS) {
      return false;   // se junta con el siguiente
    }

    var filas = sh.getRange(desde + 1, 1, hasta - desde, 12).getValues()
      .filter(function (f) { return f[0] !== '' && f[0] !== null; });
    if (!filas.length) { setProp_('CVA_FILA_AVISADA', String(hasta)); return false; }

    MailApp.sendEmail({
      to: CFG.CORREO_CVA,
      subject: '🟣 Ventas CVA — ' + filas.length + ' línea(s) · ' + hoy_(),
      htmlBody: armarCorreoCVA_(filas),
      name: 'Venta Diaria Odoo'
    });

    setProp_('CVA_FILA_AVISADA', String(hasta));
    setProp_('CVA_ULTIMO_CORREO', String(Date.now()));
    logOK_('CVA', 'Correo de ventas CVA enviado', { lineas: filas.length, a: CFG.CORREO_CVA });
    return true;

  } catch (e) {
    logError_('CVA', e, { nota: 'No se pudo mandar el correo de ventas CVA' });
    return false;
  }
}

function armarCorreoCVA_(filas) {
  var total = 0, piezas = 0, tr = '';
  var td = 'padding:6px 8px;border-bottom:1px solid #eee';
  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    total += num_(f[10]);
    piezas += num_(f[8]);
    var fd = (f[2] instanceof Date) ? f[2] : new Date(f[2]);
    var fecha = isNaN(fd.getTime()) ? String(f[2]).slice(0, 16)
                                    : Utilities.formatDate(fd, CFG.TZ, 'dd/MM HH:mm');
    tr += '<tr>' +
      '<td style="' + td + '">' + fecha + '</td>' +
      '<td style="' + td + '"><b>' + f[3] + '</b></td>' +
      '<td style="' + td + ';font-family:monospace">' + f[6] + '</td>' +
      '<td style="' + td + '">' + String(f[7]).slice(0, 60) + '</td>' +
      '<td style="' + td + ';text-align:right">' + f[8] + '</td>' +
      '<td style="' + td + ';text-align:right">$' +
        num_(f[9]).toLocaleString('es-MX', { minimumFractionDigits: 2 }) + '</td>' +
      '<td style="' + td + ';text-align:right"><b>$' +
        num_(f[10]).toLocaleString('es-MX', { minimumFractionDigits: 2 }) + '</b></td>' +
      '<td style="' + td + ';font-size:12px;color:#666">' + f[1] + '</td>' +
      '</tr>';
  }

  return '' +
  '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">' +
    '<h2 style="margin:0 0 4px">🟣 Ventas CVA</h2>' +
    '<p style="margin:0 0 16px;color:#666">' +
      filas.length + ' línea(s) · ' + piezas + ' pieza(s) · ' +
      '<b>$' + total.toLocaleString('es-MX', { minimumFractionDigits: 2 }) + '</b>' +
    '</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:13px">' +
      '<thead><tr style="background:#f5f5f5;text-align:left">' +
        '<th style="padding:8px">Fecha</th><th style="padding:8px">Plataforma</th>' +
        '<th style="padding:8px">SKU</th><th style="padding:8px">Producto</th>' +
        '<th style="padding:8px;text-align:right">Cant</th>' +
        '<th style="padding:8px;text-align:right">P. unit</th>' +
        '<th style="padding:8px;text-align:right">Importe</th>' +
        '<th style="padding:8px">SO</th>' +
      '</tr></thead><tbody>' + tr + '</tbody>' +
    '</table>' +
    '<p style="margin-top:20px;font-size:12px;color:#999">Venta Diaria Odoo 2026 · hoja PEDIDOS CVA</p>' +
  '</div>';
}

/** Menú: manda ya lo que esté pendiente, sin esperar la agrupación. */
function enviarCorreoCVAPendiente() {
  marcaCvaInicial_();
  var ok = enviarCorreoCVA_(true);
  avisar_(ok ? 'Correo enviado a ' + CFG.CORREO_CVA
             : 'No hay ventas CVA nuevas que avisar.');
}
