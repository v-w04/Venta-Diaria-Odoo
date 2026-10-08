/**
 * VENTA DIARIA ODOO 2026 — Organizar el libro
 *
 * Pone orden en el libro: color de pestaña y posición por grupo, encabezado con el
 * mismo estilo, fila 1 congelada, una hoja "📑 Índice" (con link a cada hoja y para
 * qué sirve) y una "📖 Guía del menú" (una fila por opción del menú).
 *
 * NO borra nada ni toca datos, fórmulas, filtros ni anchos de las hojas del sistema.
 * Solo:  color de pestaña y posición · estilo del encabezado (fila 1) · congelar la
 * fila 1 si no había nada congelado · formato de precio/fecha en las hojas de
 * ORG_CON_FORMATO · las dos hojas de guía (Índice y Guía, que se reescriben).
 * Lo que no está en el registro de abajo se deja donde estaba y sale en el Índice
 * como SIN CLASIFICAR.
 *
 * Menú: 🗂️ Ordenar hojas e índice (corre completo y avisa).
 * Hoja nueva → UNA línea en ORG_HOJAS.  Cambió el menú → cambia ORG_GUIA_MENU.
 */

var ORG_INDICE = '📑 Índice';
var ORG_GUIA   = '📖 Guía del menú';
var ORG_PROP_HUELLA = 'ORG_HUELLA';

var ORG_GRUPOS = {
  GUIA:    { titulo: '📖 GUIA',                          color: '#00796b' },
  KILLERS: { titulo: '🔥 KILLERS Y PROMOCIONES',          color: '#d93025' },
  VENTAS:  { titulo: '🏬 VENTAS Y ALERTAS DE WALMART',    color: '#1a73e8' },
  PRECIOS: { titulo: '💲 PRECIOS MINIMOS',                color: '#188038' },
  SISTEMA: { titulo: '🛠️ SISTEMA',                        color: '#e37400' },
  OCULTAS: { titulo: '🙈 OCULTAS (respaldos y temporales)', color: '#9aa0a6' }
};

/** [nombre de hoja, grupo, para qué sirve, cómo se actualiza]. El orden de aquí es el orden del libro. */
var ORG_HOJAS = [
  [ORG_GUIA,               'GUIA',    'Qué hace cada opción del menú Venta Diaria y cuál te toca', 'Auto (la rehace Ordenar)'],

  ['KILLERS ACTIVOS',      'KILLERS', 'Lo que se carga a Walmart: killers vigentes + promociones de categoría (Carga = mínimo − puntos)', 'Auto, con los killers del site'],
  ['KILLERS BAJO MINIMO',  'KILLERS', 'Copia de Site Sheet: killers que no cubren tu mínimo, con categoría y % de pérdida. Más de 3% = no entra a ACTIVOS', 'Auto, cada ~4 min'],
  ['KILLERS EXCLUIDOS',    'KILLERS', 'SKUs exactos que NO deben entrar a KILLERS ACTIVOS (Walmart pidió precio base)', 'Manual (tú la editas)'],
  ['COMPARAR WALMART',     'KILLERS', 'KILLERS ACTIVOS contra el precio real de Walmart: decisión y % vs mínimo', 'Auto, cada 15 min'],
  ['CARGA PROMOCIONES',    'KILLERS', 'Lista lista para pegar en "Cargar promociones" del site (SKU base, categoría, puntos)', 'Menú: Armar carga de promociones'],
  ['PROMO TIPOS',          'KILLERS', 'Corrige la categoría de la promo por tipo de producto de Walmart (p. ej. Accesorios de Fotografia)', 'Manual (tú la editas)'],
  ['Promociones (site)',   'KILLERS', 'Copia de las promociones por SKU del site', 'Auto, con el site'],
  ['EXCEPCIONES CATEGORIA','KILLERS', 'Promociones del site que NO se cargan porque Walmart las tiene en otra categoría (solo informativa)', 'Auto'],
  ['COMISIONES',           'KILLERS', 'Comisión normal y puntos de promoción por categoría', 'Manual (tú la editas)'],
  ['KILLERS HISTORICO',    'KILLERS', 'Todos los killers que se han visto, por carga y mes', 'Auto'],
  ['KILLERS PEGAR',        'KILLERS', 'Respaldo manual: pegado de killers del seller center', 'Manual'],

  ['WALMART',              'VENTAS',  'Ventas de Walmart de Odoo con el análisis de precio contra el mínimo', 'Auto, cada 10 min'],
  ['Histórico de alertas', 'VENTAS',  'Ventas de Walmart que se fueron por debajo del mínimo', 'Auto'],
  ['PEDIDOS CVA',          'VENTAS',  'Ventas de SKUs -CVA de cualquier plataforma', 'Auto'],
  ['SKU ASIGNADOS',        'VENTAS',  'SKUs vinculados a otro SKU principal', 'Manual (tú la editas)'],
  ['BUSCAR VENTAS',        'VENTAS',  'Pega números de venta y regresa su detalle de Odoo', 'Menú: Buscar ventas'],
  ['Sobreventa WFS',       'VENTAS',  'Traslados en espera hacia WFS (sobreventa)', 'Auto, cada 30 min'],
  ['Sobreventa Pick',      'VENTAS',  'Traslados en espera de pick (sobreventa)', 'Auto, cada 30 min'],

  ['PRECIOS ERIK',         'PRECIOS', 'Precio mínimo clásica y premium (EM y CVA) bajado de Site Sheet', 'Auto, cada 15 min'],

  ['LOG Ventas',           'SISTEMA', 'Bitácora de todo lo que hacen los procesos automáticos', 'Auto']
];

/**
 * [sección, opción, qué hace, cuándo usarla, nivel]
 * nivel: DIARIO = lo usas en tu operación | A VECES = cuando toca | SOPORTE = solo si algo falla o se configura | CUIDADO = borra o rehace cosas
 * Debe coincidir 1 a 1 con onOpen (Menu.gs).
 */
var ORG_GUIA_MENU = [
  ['⚙️ Venta Diaria', '🔄 Importar ventas de Odoo ahora', 'Baja las ventas nuevas de Odoo y revisa precios y alertas. Es lo mismo que hace solo el trigger de 10 min.', 'Cuando quieras datos frescos ya', 'A VECES'],
  ['⚙️ Venta Diaria', '💲 Actualizar PRECIOS ERIK desde Site Sheet', 'Rehace PRECIOS ERIK con los mínimos de Site Sheet.', 'Normalmente solo (cada 15 min)', 'A VECES'],
  ['⚙️ Venta Diaria', '🔄 Traer killers de Site Sheet y actualizar KILLERS ACTIVOS', 'Trae los killers del site, quita los excluidos y los que pierden más de 3%, y rehace KILLERS ACTIVOS.', 'Cuando cambien killers y quieras verlo ya', 'DIARIO'],
  ['⚙️ Venta Diaria', '🎯 Procesar killers pegados (respaldo manual)', 'Procesa lo que pegaste en KILLERS PEGAR.', 'Solo si Site Sheet no trae los killers', 'SOPORTE'],
  ['⚙️ Venta Diaria', '📅 Reporte de killers del mes', 'Arma una hoja KILLERS <MES> con cada SKU, sus rangos y lo vendido en cada uno.', 'Al cierre de mes', 'A VECES'],
  ['⚙️ Venta Diaria', '📦 Revisar sobreventa (Walmart)', 'Llena Sobreventa WFS y Sobreventa Pick con los traslados en espera.', 'Normalmente solo (cada 30 min)', 'A VECES'],
  ['⚙️ Venta Diaria', '✅ Comparar KILLERS ACTIVOS contra Walmart', 'Compara lo que cargas contra el precio real de Walmart y da la decisión (DEJAR, REVISAR KAM, CAMBIO / QUITAR).', 'Después de subir precios a Walmart', 'DIARIO'],
  ['⚙️ Venta Diaria', '🏷️ Armar carga de promociones para el site', 'Asistente: eliges categoría, puntos y marcas, y arma CARGA PROMOCIONES lista para pegar en el site.', 'Cuando vayas a cargar promociones al site', 'DIARIO'],
  ['⚙️ Venta Diaria', '🔎 Buscar ventas (pegadas en BUSCAR VENTAS)', 'Busca en Odoo los números de venta que pegaste y escribe su detalle.', 'Cuando necesites fechas de envío u otros datos de un pedido', 'A VECES'],
  ['⚙️ Venta Diaria', '📊 Resumen de Walmart', 'Muestra un resumen de las ventas de Walmart.', 'Cuando quieras ver cómo va', 'A VECES'],
  ['⚙️ Venta Diaria', '🩺 Diagnóstico', 'Revisa que todo esté conectado y dice qué falta.', 'Si algo no baja', 'SOPORTE'],
  ['⚙️ Venta Diaria', '🧹 Limpiar hojas que no uso…', 'Te deja elegir hojas para borrar (con respaldo) o compactarlas.', 'Si el libro se acerca al límite de celdas', 'CUIDADO'],
  ['⚙️ Venta Diaria', '🗂️ Ordenar hojas e índice', 'Pone colores, orden y encabezados iguales y rehace el Índice y esta guía. No borra nada.', 'Cuando aparezca una hoja nueva', 'A VECES'],
  ['Configuración', '🔌 Configurar Odoo…', 'Guarda los datos de conexión a Odoo.', 'Una vez', 'SOPORTE'],
  ['Configuración', '🧪 Probar conexión a Odoo', 'Prueba que Odoo conteste.', 'Si algo no baja', 'SOPORTE'],
  ['Configuración', '⚙️ Configurar bandas de alerta de precios…', 'Cambia los cortes de DEJAR / REVISAR KAM / CAMBIO (3% y 10%).', 'Si quieres otros cortes', 'SOPORTE'],
  ['Configuración', '🔑 Configurar API de Walmart…', 'Guarda las llaves de la API de Walmart.', 'Una vez', 'SOPORTE'],
  ['Configuración', '🧪 Probar un pedido en la API de Walmart', 'Consulta un pedido en la API de Walmart para probar la conexión.', 'Si la API falla', 'SOPORTE'],
  ['Configuración', '⏱️ Instalar / reinstalar triggers', 'Crea los 3 triggers (ventas 10 min, precios 15 min, sobreventa 30 min).', 'Una vez, o si dejaron de correr', 'SOPORTE']
];

var ORG_NIVEL_COLOR = { 'DIARIO': '#d9ead3', 'A VECES': '#fff2cc', 'SOPORTE': '#eeeeee', 'CUIDADO': '#f4cccc' };

/** Hojas con encabezado propio en otra fila o que el usuario llena: no se les pone estilo de encabezado ni se congela. */
var ORG_SIN_ENCABEZADO = ['PRECIOS ERIK', 'Sobreventa WFS', 'Sobreventa Pick', 'KILLERS PEGAR', 'BUSCAR VENTAS'];
/** Solo estas hojas reciben formato unificado de precio/fecha (las demás ya tienen el suyo). */
var ORG_CON_FORMATO = ['KILLERS BAJO MINIMO', 'CARGA PROMOCIONES'];

var ORG_RE_DINERO = /^(PRECIO|MINIMO|NORMAL|MAXIMO|NOS PAGAN|PUBLICADO|NEGOCIADO|CUPON|FALTA)\b/;
var ORG_RE_FECHA  = /^(ACTUALIZADO|INICIA|TERMINA|INICIO|FIN)\b/;
var ORG_FMT_DINERO = '$#,##0.00';
var ORG_FMT_FECHA  = 'yyyy-mm-dd hh:mm';

function orgNorm_(t) {
  return String(t === null || t === undefined ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Reintenta etapas que Sheets agota por tiempo (4 intentos, 8 s × n). Otros errores salen de una vez. */
function orgReintentar_(fn) {
  var ultimo;
  for (var i = 1; i <= 4; i++) {
    try { return fn(); }
    catch (e) {
      ultimo = e;
      if (!/tiempo|timed? ?out|agot|servicio hojas|service/i.test(String(e && e.message || e))) throw e;
      Utilities.sleep(8000 * i);
    }
  }
  throw ultimo;
}

function orgGrupoOculta_(nombre) {
  return /respaldo/i.test(nombre) || /^_.*tmp$/i.test(nombre);
}

/** Recorta una hoja nueva para no gastar celdas del libro (tope de 10 millones). */
function orgRecortar_(h, filas, cols) {
  if (h.getMaxColumns() > cols) h.deleteColumns(cols + 1, h.getMaxColumns() - cols);
  if (h.getMaxRows() > filas) h.deleteRows(filas + 1, h.getMaxRows() - filas);
}

function orgGuia_(ss) {
  var h = ss.getSheetByName(ORG_GUIA) || ss.insertSheet(ORG_GUIA);
  h.clear();
  var filas = [['SECCION DEL MENU', 'OPCION', 'QUE HACE', 'CUANDO USARLA', 'NIVEL']].concat(ORG_GUIA_MENU);
  var nF = filas.length;
  if (h.getMaxRows() < nF + 3) h.insertRowsAfter(h.getMaxRows(), nF + 3 - h.getMaxRows());
  if (h.getMaxColumns() < 5) h.insertColumnsAfter(h.getMaxColumns(), 5 - h.getMaxColumns());
  h.getRange(1, 1, nF, 5).setValues(filas);
  h.getRange(1, 1, 1, 5).setFontWeight('bold').setFontColor('#ffffff').setBackground(ORG_GRUPOS.GUIA.color);
  var bg = [];
  for (var i = 1; i < nF; i++) {
    var c = ORG_NIVEL_COLOR[filas[i][4]] || '#ffffff';
    bg.push([c, c, c, c, c]);
  }
  h.getRange(2, 1, nF - 1, 5).setBackgrounds(bg).setVerticalAlignment('top');
  h.getRange(2, 3, nF - 1, 2).setWrap(true);
  [170, 300, 520, 330, 90].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  h.setFrozenRows(1);
  try { var f = h.getFilter(); if (f) f.remove(); } catch (e) {}
  h.getRange(1, 1, nF, 5).createFilter();
  h.getRange(1, 1).setNote('DIARIO = lo usas en tu operacion. A VECES = cuando toca. SOPORTE = solo si algo falla o se configura. CUIDADO = borra o rehace cosas.\nLo que no esta en el menu corre solo.');
  orgRecortar_(h, nF + 3, 5);
}

/** Formato unificado de dinero y fecha, buscando la columna por ENCABEZADO; solo si sus celdas son números / fechas reales. */
function orgFormatos_(ss) {
  var total = 0, fallas = [];
  var limite = new Date().getTime() + 200 * 1000;
  ORG_CON_FORMATO.forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (!h) return;
    if (new Date().getTime() > limite) { fallas.push('(tiempo) ' + n); return; }
    try { total += orgReintentar_(function () { return orgFormatosHoja_(h); }); }
    catch (e) { fallas.push(n); console.log('Formatos ' + n + ': ' + e.message); }
  });
  orgFormatos_.fallas = fallas;
  return total;
}

function orgFormatosHoja_(h) {
  var total = 0;
  var nF = h.getLastRow(), nC = h.getLastColumn();
  if (nF < 2 || nC < 1) return 0;
  var muestra = h.getRange(1, 1, Math.min(nF, 8), nC).getValues();
  var fmts = h.getRange(2, 1, 1, nC).getNumberFormats()[0];
  var enc = muestra[0];
  for (var c = 0; c < nC; c++) {
    var t = orgNorm_(enc[c]);
    if (!t) continue;
    var tipo = ORG_RE_DINERO.test(t) ? 'D' : (ORG_RE_FECHA.test(t) ? 'F' : '');
    if (!tipo) continue;
    var hay = false;
    for (var r = 1; r < muestra.length; r++) {
      var x = muestra[r][c];
      if (tipo === 'D' ? (typeof x === 'number') : (x instanceof Date)) { hay = true; break; }
    }
    if (!hay) continue;
    var fmt = tipo === 'D' ? ORG_FMT_DINERO : ORG_FMT_FECHA;
    if (fmts[c] === fmt) continue;
    h.getRange(2, c + 1, nF - 1, 1).setNumberFormat(fmt);
    total++;
  }
  return total;
}

/** Menú: ordena y avisa. */
function orgOrdenar() {
  var ui = SpreadsheetApp.getUi();
  var avisos = [], r = null;
  try { r = orgReintentar_(function () { return orgAplicar_(true); }); } catch (e) { avisos.push('Orden/índice: ' + e.message); }
  if (!r) {
    ui.alert('🗂️ Ordenar hojas', 'No terminó:\n  ' + avisos.join('\n  ') +
      '\n\nEs Sheets ocupado (corridas automáticas). Espera 2 minutos sin tocar el libro y vuelve a correrlo: retoma donde se quedó.', ui.ButtonSet.OK);
    return;
  }
  var falt = (orgFormatos_.fallas || []);
  if (falt.length) avisos.push('Formatos pendientes en: ' + falt.join(', ') + ' (vuelve a correrlo y los termina)');
  ui.alert('🗂️ Libro ordenado',
    r.ordenadas + ' hojas con color y orden.\n' +
    r.encabezados + ' encabezados unificados.\n' +
    r.formatos + ' columnas de precio/fecha con formato unificado.\n' +
    'Índice: hoja "' + ORG_INDICE + '" (la primera).\n' +
    (r.sinClasificar.length
      ? '\nSIN CLASIFICAR (no están en el registro, las dejé donde estaban):\n  ' + r.sinClasificar.join('\n  ')
      : '\nNo quedó ninguna hoja sin clasificar.') +
    (avisos.length ? '\n\n⚠ ' + avisos.join('\n⚠ ') : ''),
    ui.ButtonSet.OK);
}

function orgAplicar_(completo) {
  var ss = SpreadsheetApp.getActive();
  var hojas = ss.getSheets();
  var porNombre = {};
  hojas.forEach(function (h) { porNombre[h.getName()] = h; });

  var reg = {};
  ORG_HOJAS.forEach(function (f) { reg[f[0]] = { grupo: f[1], desc: f[2], act: f[3] }; });

  var ocultas = [], sinClas = [];
  hojas.forEach(function (h) {
    var n = h.getName();
    if (n === ORG_INDICE || n === ORG_GUIA || reg[n]) return;
    if (orgGrupoOculta_(n) || h.isSheetHidden()) { ocultas.push(n); return; }
    sinClas.push(n);
  });

  orgGuia_(ss);
  porNombre[ORG_GUIA] = ss.getSheetByName(ORG_GUIA);
  var ind = porNombre[ORG_INDICE] || ss.insertSheet(ORG_INDICE);
  porNombre[ORG_INDICE] = ind;

  var deseado = [ORG_INDICE];
  ORG_HOJAS.forEach(function (f) { if (porNombre[f[0]]) deseado.push(f[0]); });
  sinClas.forEach(function (n) { deseado.push(n); });
  ocultas.sort().forEach(function (n) { deseado.push(n); });

  var resumen = { ordenadas: 0, encabezados: 0, formatos: 0, sinClasificar: sinClas };

  deseado.forEach(function (n, i) {
    var h = porNombre[n];
    if (!h || h.isSheetHidden()) return;
    if (h.getIndex() !== i + 1) { ss.setActiveSheet(h); ss.moveActiveSheet(i + 1); }
  });
  ss.setActiveSheet(ind);

  deseado.forEach(function (n) {
    var h = porNombre[n];
    if (!h) return;
    var c = null;
    if (n === ORG_INDICE) c = '#202124';
    else if (reg[n]) c = ORG_GRUPOS[reg[n].grupo].color;
    else if (ocultas.indexOf(n) !== -1) c = ORG_GRUPOS.OCULTAS.color;
    try { h.setTabColor(c); } catch (e) {}
    resumen.ordenadas++;
  });

  orgIndice_(ind, reg, porNombre, sinClas, ocultas);
  PropertiesService.getScriptProperties().setProperty(ORG_PROP_HUELLA, deseado.join('|'));

  ORG_HOJAS.forEach(function (f) {
    var h = porNombre[f[0]];
    if (!h || ORG_SIN_ENCABEZADO.indexOf(f[0]) !== -1) return;
    if (orgEncabezado_(h, ORG_GRUPOS[f[1]].color, completo)) resumen.encabezados++;
  });
  resumen.formatos = completo ? orgFormatos_(ss) : 0;
  return resumen;
}

/** Estilo del encabezado (fila 1) y fila congelada. true si cambió algo. */
function orgEncabezado_(h, color, forzar) {
  var nC = h.getLastColumn(), nF = h.getLastRow();
  if (nC < 1 || nF < 1) return false;
  var enc = h.getRange(1, 1, 1, nC);
  if (!String(h.getRange(1, 1).getValue() || '') && nC === 1) return false;
  var cambio = false;
  if (forzar || enc.getCell(1, 1).getBackground().toLowerCase() !== color) {
    enc.setFontWeight('bold').setFontColor('#ffffff').setBackground(color).setVerticalAlignment('middle');
    cambio = true;
  }
  if (h.getFrozenRows() === 0 && nF > 1) { h.setFrozenRows(1); cambio = true; }
  return cambio;
}

function orgIndice_(ind, reg, porNombre, sinClas, ocultas) {
  ind.clear();
  var tz = Session.getScriptTimeZone();
  var filas = [], banners = [];
  filas.push(['📑 ÍNDICE DEL LIBRO', '', '', '', '']);
  filas.push(['Actualizado ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + '. Da clic en el nombre para ir a la hoja.', '', '', '', '']);
  filas.push(['', '', '', '', '']);

  ['GUIA', 'KILLERS', 'VENTAS', 'PRECIOS', 'SISTEMA'].forEach(function (k) {
    var items = ORG_HOJAS.filter(function (f) { return f[1] === k && porNombre[f[0]]; });
    if (!items.length) return;
    filas.push([ORG_GRUPOS[k].titulo, 'PARA QUE SIRVE', 'SE ACTUALIZA', 'FILAS', '']);
    banners.push({ fila: filas.length, color: ORG_GRUPOS[k].color });
    items.forEach(function (f) {
      var h = porNombre[f[0]];
      filas.push(['=HYPERLINK("#gid=' + h.getSheetId() + '","' + f[0].replace(/"/g, '""') + '")', f[2], f[3], Math.max(h.getLastRow() - 1, 0), '']);
    });
    filas.push(['', '', '', '', '']);
  });
  if (sinClas.length) {
    filas.push(['❓ SIN CLASIFICAR', 'No están en el registro de Organizar.gs', '', 'FILAS', '']);
    banners.push({ fila: filas.length, color: '#202124' });
    sinClas.forEach(function (n) {
      filas.push(['=HYPERLINK("#gid=' + porNombre[n].getSheetId() + '","' + n.replace(/"/g, '""') + '")', '', '', Math.max(porNombre[n].getLastRow() - 1, 0), '']);
    });
    filas.push(['', '', '', '', '']);
  }
  if (ocultas.length) {
    filas.push([ORG_GRUPOS.OCULTAS.titulo, '', '', 'FILAS', '']);
    banners.push({ fila: filas.length, color: ORG_GRUPOS.OCULTAS.color });
    ocultas.forEach(function (n) {
      filas.push([n, 'Oculta a propósito (clic derecho > Mostrar hoja si la necesitas)', '', Math.max(porNombre[n].getLastRow() - 1, 0), '']);
    });
  }

  var nF = filas.length;
  if (ind.getMaxRows() < nF + 5) ind.insertRowsAfter(ind.getMaxRows(), nF + 5 - ind.getMaxRows());
  if (ind.getMaxColumns() < 5) ind.insertColumnsAfter(ind.getMaxColumns(), 5 - ind.getMaxColumns());
  ind.getRange(1, 1, nF, 5).setValues(filas.map(function (f) {
    return f.map(function (v) { return (typeof v === 'string' && v.charAt(0) === '=') ? '' : v; });
  }));
  filas.forEach(function (f, i) {
    if (typeof f[0] === 'string' && f[0].charAt(0) === '=') ind.getRange(i + 1, 1).setFormula(f[0]);
  });
  ind.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  ind.getRange(2, 1).setFontColor('#5f6368').setFontStyle('italic');
  banners.forEach(function (b) {
    ind.getRange(b.fila, 1, 1, 4).setBackground(b.color).setFontColor('#ffffff').setFontWeight('bold');
  });
  ind.getRange(1, 4, nF, 1).setHorizontalAlignment('right').setNumberFormat('#,##0');
  ind.setColumnWidth(1, 300); ind.setColumnWidth(2, 560); ind.setColumnWidth(3, 220); ind.setColumnWidth(4, 80);
  ind.setFrozenRows(0);
  ind.setHiddenGridlines(true);
  orgRecortar_(ind, nF + 5, 5);
}
