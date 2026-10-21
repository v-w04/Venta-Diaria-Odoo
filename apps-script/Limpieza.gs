/**
 * VENTA DIARIA ODOO 2026 — Limpieza del libro
 *
 * Este es el botón que además ARREGLA el error que está tirando la
 * importación:
 *
 *   Exception: Esta acción aumentará el número de celdas del libro de trabajo
 *   por encima del límite de 10000000 celdas.
 *
 * Google cuenta filas × columnas de CADA hoja, tenga datos o no. Una hoja
 * nueva vacía ya son 1,000 × 26 = 26,000 celdas; las viejas suelen traer
 * 1,000,000. Con 76 hojas el libro se topó.
 *
 * Dos herramientas:
 *   🧹 Limpiar hojas que no uso…  → borra hojas completas (tú eliges cuáles)
 *   📐 Compactar hojas             → recorta filas/columnas vacías de las que se quedan
 *
 * Nada se borra sin que lo palomees. Antes de borrar se ofrece respaldo.
 */

/** Las únicas hojas que el proyecto necesita. Nunca se proponen para borrar. */
function hojasProtegidas_() {
  var hojas = Object.keys(CFG.H).map(function (k) { return CFG.H[k]; });
  // Las hojas de sobreventa (WFS / Pick) también son del sistema.
  CFG.SOBREVENTA.DESTINOS.forEach(function (d) { hojas.push(d.hoja); });
  hojas.push(CR_HOJA);             // CATEGORIA REVISAR (CompararWalmart.gs)
  hojas.push(CD_ESPEJO, CD_DET_ESPEJO);   // COBRO DISTINTO y su detalle (CobroDistinto.gs)
  hojas.push(K_BAJO);              // killers bajo mínimo (copia de Site Sheet)
  hojas.push(ORG_INDICE, ORG_GUIA);  // índice y guía del menú (Organizar.gs)
  hojas.push(PL_HOJA);             // PRECIO LIBRE (Precios.gs)
  hojas.push(EX.HOJA.EXPORTAR, EX.HOJA.MINIMO, EX.HOJA.MAXIMO, EX.HOJA.VARIACIONES);   // precios para subir a Walmart (Exportar.gs)
  return hojas;
}

function limpiarHojas() {
  var html = HtmlService.createHtmlOutputFromFile('PanelLimpieza')
    .setWidth(820).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, '🧹 Limpiar hojas que no uso');
}

/** Datos para el diálogo. */
function lpListarHojas() {
  var prot = hojasProtegidas_();
  var protSet = {};
  prot.forEach(function (p) { protSet[norm_(p)] = true; });

  var c = celdasDelLibro_();
  var filas = c.hojas.map(function (h) {
    var protegida = !!protSet[norm_(h.nombre)];
    var motivo = '';
    if (protegida) motivo = 'Hoja del sistema';
    else if (h.conDatos === 0) motivo = 'Vacía';
    else if (h.conDatos <= 2) motivo = 'Prácticamente vacía';
    else motivo = 'No la usa el proyecto';

    return {
      nombre: h.nombre,
      celdas: h.celdas,
      filas: h.filas,
      cols: h.cols,
      conDatos: h.conDatos,
      protegida: protegida,
      sugerida: !protegida,
      motivo: motivo,
      // Cuánto se ahorraría compactándola en vez de borrarla
      compactable: Math.max(0, h.celdas - Math.max(h.conDatos, 10) * Math.min(h.cols, 30))
    };
  });

  filas.sort(function (a, b) {
    if (a.protegida !== b.protegida) return a.protegida ? -1 : 1;
    return b.celdas - a.celdas;
  });

  return {
    total: c.total,
    limite: CFG.LIMITE_CELDAS,
    nHojas: c.hojas.length,
    hojas: filas
  };
}

/** Borra las hojas seleccionadas. Devuelve el reporte. */
function lpBorrarHojas(nombres, conRespaldo) {
  var prot = {};
  hojasProtegidas_().forEach(function (p) { prot[norm_(p)] = true; });

  var ss = libro_();
  var antes = celdasDelLibro_().total;
  var borradas = [], rechazadas = [], respaldo = '';

  if (conRespaldo) {
    try {
      var copia = DriveApp.getFileById(CFG.LIBRO_ID)
        .makeCopy('RESPALDO Venta Diaria Odoo ' + ahora_());
      respaldo = copia.getUrl();
    } catch (e) {
      logWarn_('LIMPIEZA', 'No se pudo hacer el respaldo: no se borró nada', { error: String(e) });
      throw new Error('No se pudo hacer el respaldo, así que NO se borró ninguna hoja.\n' +
                      'Quita la palomita de respaldo si quieres borrar sin copia.\n\n' + e);
    }
  }

  for (var i = 0; i < nombres.length; i++) {
    var n = nombres[i];
    if (prot[norm_(n)]) { rechazadas.push(n + ' (protegida)'); continue; }
    var sh = ss.getSheetByName(n);
    if (!sh) { rechazadas.push(n + ' (ya no existe)'); continue; }
    try {
      ss.deleteSheet(sh);
      borradas.push(n);
    } catch (e) {
      rechazadas.push(n + ' (' + e + ')');
    }
  }

  SpreadsheetApp.flush();
  var despues = celdasDelLibro_().total;

  logOK_('LIMPIEZA', 'Se borraron ' + borradas.length + ' hoja(s)', {
    borradas: borradas, rechazadas: rechazadas,
    celdasAntes: antes, celdasDespues: despues,
    liberadas: antes - despues, respaldo: respaldo
  });

  return {
    borradas: borradas, rechazadas: rechazadas,
    antes: antes, despues: despues, liberadas: antes - despues,
    respaldo: respaldo
  };
}

/**
 * Recorta filas y columnas vacías de las hojas que se quedan.
 * Es lo que más celdas libera sin perder un solo dato.
 */
function lpCompactar(nombres) {
  var ss = libro_();
  var antes = celdasDelLibro_().total;
  var detalle = [];
  var lista = (nombres && nombres.length) ? nombres
            : ss.getSheets().map(function (s) { return s.getName(); });

  for (var i = 0; i < lista.length; i++) {
    var sh = ss.getSheetByName(lista[i]);
    if (!sh) continue;
    var antesH = sh.getMaxRows() * sh.getMaxColumns();

    var filasUsadas = Math.max(sh.getLastRow(), 1);
    var colsUsadas  = Math.max(sh.getLastColumn(), 1);

    // Colchón: 200 filas para que la importación no tenga que insertar cada vez.
    var filasObjetivo = filasUsadas + 200;
    // PRECIOS ERIK tiene fórmulas que se desbordan hacia abajo (N–Q). Quitarle
    // filas la dejaría sin espacio para crecer: solo se le recortan columnas.
    if (lista[i] === CFG.H.PRECIOS) {
      filasObjetivo = sh.getMaxRows();
    }
    // Colchón de 5 columnas: no se borran las columnas en blanco que acabas de preparar (formato, validación).
    var colsObjetivo  = colsUsadas + 5;

    try {
      if (sh.getMaxRows() > filasObjetivo) {
        sh.deleteRows(filasObjetivo + 1, sh.getMaxRows() - filasObjetivo);
      }
      if (sh.getMaxColumns() > colsObjetivo) {
        sh.deleteColumns(colsObjetivo + 1, sh.getMaxColumns() - colsObjetivo);
      }
    } catch (e) {
      detalle.push({ hoja: lista[i], error: String(e) });
      continue;
    }

    var despuesH = sh.getMaxRows() * sh.getMaxColumns();
    if (despuesH < antesH) {
      detalle.push({ hoja: lista[i], antes: antesH, despues: despuesH });
    }
  }

  SpreadsheetApp.flush();
  var despues = celdasDelLibro_().total;
  logOK_('LIMPIEZA', 'Compactado', {
    hojas: detalle.length, celdasAntes: antes, celdasDespues: despues,
    liberadas: antes - despues
  });

  return { antes: antes, despues: despues, liberadas: antes - despues, detalle: detalle };
}

/** Diagnóstico general: config, celdas, cuota, frescura. */
function diagnostico() {
  var c = celdasDelLibro_();
  var ss = libro_();
  var lineas = [];

  lineas.push('📊 LIBRO');
  lineas.push('  Hojas: ' + c.hojas.length);
  lineas.push('  Celdas: ' + c.total.toLocaleString('es-MX') + ' / 10,000,000 (' +
              Math.round(c.total / CFG.LIMITE_CELDAS * 100) + '%)');
  if (c.total >= CFG.AVISO_CELDAS) {
    lineas.push('  ⚠️ Estás cerca del tope. Usa 🧹 Limpiar / 📐 Compactar.');
  }

  lineas.push('');
  lineas.push('🔌 ODOO');
  try {
    odooConfig_();
    lineas.push('  Configuración: ✅ completa');
    lineas.push('  URL: ' + prop_('ODOO_URL'));
    lineas.push('  Base: ' + prop_('ODOO_DB'));
    lineas.push('  Usuario: ' + prop_('ODOO_USER'));
  } catch (e) {
    lineas.push('  ❌ ' + e.message);
  }
  lineas.push('  Llamadas contadas hoy: ' + llamadasDeHoy_() + ' (tope de la cuenta: 20,000)');
  lineas.push('  ⚠️ Google no publica tu consumo real: los 20,000 son UNA bolsa');
  lineas.push('     compartida por TODOS los Apps Script de esta cuenta.');

  lineas.push('');
  lineas.push('💲 PRECIOS ERIK');
  try {
    var t = tablaPrecios_();
    lineas.push('  SKUs con mínimo (A–D): ' + t.nMinimos);
    lineas.push('  Cupones Walmart (P–Q): ' + t.nCupones +
                (t.nCupones ? '' : '  ⚠️ vacía: las ventas bajo mínimo quedan PENDIENTES'));
  } catch (e) { lineas.push('  ❌ ' + e.message); }
  lineas.push('  Última actualización desde Site Sheet: ' + (prop_('PRECIOS_ERIK_ACTUALIZADO') || '—'));
  lineas.push('  Leer Site Sheet NO gasta cuota de UrlFetch.');

  lineas.push('');
  lineas.push('📄 HOJAS DEL SISTEMA');
  hojasProtegidas_().forEach(function (n) {
    var sh = ss.getSheetByName(n);
    lineas.push('  ' + (sh ? '✅' : '❌') + ' ' + n +
                (sh ? '  (' + Math.max(0, sh.getLastRow() - 1) + ' filas)' : '  falta'));
  });

  var sobran = c.hojas.filter(function (h) {
    return hojasProtegidas_().indexOf(h.nombre) < 0;
  });
  if (sobran.length) {
    lineas.push('');
    lineas.push('🧹 SOBRAN ' + sobran.length + ' hoja(s) que el proyecto no usa,');
    lineas.push('   ocupando ' + sobran.reduce(function (a, h) { return a + h.celdas; }, 0)
                .toLocaleString('es-MX') + ' celdas.');
  }

  lineas.push('');
  lineas.push('📧 CORREO');
  lineas.push('  Único destinatario: ' + CFG.CORREO_CVA);
  lineas.push('  Solo avisa ventas CVA. Las alertas de precio NO mandan correo.');

  SpreadsheetApp.getUi().alert('Diagnóstico', lineas.join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}
