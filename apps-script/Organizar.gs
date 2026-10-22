/**
 * VENTA DIARIA ODOO 2026 — Organizar el libro (ordenar + limpiar + vigilar lo que no se usa)
 *
 * Un solo botón del menú (🗂️ Ordenar hojas e índice) que:
 *  1. BORRA hojas temporales y de respaldo (nombre con "respaldo", "_algo_tmp", "Copia de …").
 *     Nunca borra hojas del sistema ni las del registro ORG_HOJAS.
 *  2. Pone orden y color de pestaña por grupo (el orden sale de ORG_HOJAS).
 *  3. Rehace "📑 Índice" (links, para qué sirve, filas, último cambio visto) y "📖 Guía del menú".
 *  4. Unifica encabezados (fila 1) y formato de precio/fecha donde se indica.
 *  5. Manda AL FINAL, con su propio color y sección, las hojas que parecen sin uso:
 *     no están en el registro ni las usa el sistema (hojasProtegidas_) Y además están
 *     vacías o llevan ORG_DIAS_SIN_USO días o más sin cambios. Esas NO se borran: tú decides
 *     (clic derecho > Eliminar, o 🧹 Limpiar hojas que no uso… con respaldo).
 *
 * "Sin cambios" se mide con una huella de cada hoja (tamaño + primeras y últimas filas) guardada
 * en Script Properties (ORG_VISTO) cada vez que corre Ordenar. Apps Script no guarda la fecha de
 * última edición por hoja, así que cuenta desde la primera vez que Ordenar la vio.
 *
 * Datos, fórmulas, filtros y anchos de las hojas del sistema NO se tocan.
 * Hoja nueva que el código crea → UNA línea en ORG_HOJAS.  Cambió el menú → cambia ORG_GUIA_MENU.
 */

var ORG_INDICE = '📑 Índice';
var ORG_GUIA   = '📖 Guía del menú';
var ORG_PROP_HUELLA = 'ORG_HUELLA';
var ORG_PROP_VISTO  = 'ORG_VISTO';
var ORG_DIAS_SIN_USO = 30;
var ORG_PROP_ANCHO = 'ORG_ANCHO';
var ORG_ANCHO_MAX = 280;      // tope en píxeles para columnas de contenido largo
var ORG_ANCHO_MIN = 60;

var ORG_GRUPOS = {
  GUIA:    { titulo: '📖 GUIA',                          color: '#00796b' },
  KILLERS: { titulo: '🔥 KILLERS',          color: '#d93025' },
  VENTAS:  { titulo: '🏬 VENTAS Y ALERTAS DE WALMART',    color: '#1a73e8' },
  PRECIOS: { titulo: '💲 PRECIOS MINIMOS',                color: '#188038' },
  SISTEMA: { titulo: '🛠️ SISTEMA',                        color: '#e37400' },
  OCULTAS: { titulo: '🙈 OCULTAS (a propósito)',          color: '#9aa0a6' },
  SINUSO:  { titulo: '🗑️ POSIBLEMENTE SIN USO — revísalas y bórralas si no sirven', color: '#8d6e63' }
};

/** [nombre de hoja, grupo, para qué sirve, cómo se actualiza]. El orden de aquí es el orden del libro. */
var ORG_HOJAS = [
  [ORG_GUIA,               'GUIA',    'Qué hace cada opción del menú Venta Diaria y cuál te toca', 'Auto (la rehace Ordenar)'],

  ['KILLERS ACTIVOS',      'KILLERS', 'Lo que se carga a Walmart: los killers vigentes tal como los da el site', 'Auto, con los killers del site'],
  ['KILLERS BAJO MINIMO',  'KILLERS', 'Copia de Site Sheet: killers que no cubren tu mínimo, con categoría y % de pérdida. Más de 3% = no entra a ACTIVOS', 'Auto, cada ~4 min'],
  ['PRECIO LIBRE',         'KILLERS', 'Productos que vendes siempre más baratos a propósito: no alertan bajo mínimo (por SKU base)', 'Manual (tú la editas)'],
  ['CATEGORIA REVISAR',    'KILLERS', 'Killers cuya categoría del KAM no coincide con el departamento de Walmart (aumentan la pérdida); para corregirlos en el site', 'Auto, con COMPARAR WALMART'],
  ['COBRO DISTINTO',       'KILLERS', 'Copia de Site Sheet: SKUs a los que Walmart les cobró más comisión de la debida. Un SKU aquí NO entra a KILLERS ACTIVOS', 'Auto, cada ~4 min'],
  ['COBRO DISTINTO DETALLE','KILLERS', 'Copia de Site Sheet: el detalle por pedido de COBRO DISTINTO', 'Auto, cada ~4 min'],
  ['COMPARAR WALMART',     'KILLERS', 'KILLERS ACTIVOS contra el precio real de Walmart: decisión y % vs mínimo', 'Auto, cada 15 min'],
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
  ['EXPORTAR',             'PRECIOS', 'Precios normales para subir a Walmart: SKU WALMART, PRECIO FINAL, PRECIO -2% (× 0.98) y PRECIO CARGA (terminación 9)', 'Auto, cada 15 min'],
  ['MINIMO',               'PRECIOS', 'Precios mínimos para subir a Walmart: SKU WALMART y PRECIO MINIMO', 'Auto, cada 15 min'],
  ['MAXIMO',               'PRECIOS', 'Precios máximos para subir a Walmart: SKU WALMART y PRECIO MAXIMO', 'Auto, cada 15 min'],
  ['PRECIOS VARIACIONES',  'PRECIOS', 'Precios manuales por SKU publicado (IMPORTRANGE de tu otro libro). Ganan sobre el precio normal en EXPORTAR, MINIMO y MAXIMO; sin precio o #N/A se vuelven 0', 'Auto (IMPORTRANGE)'],

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
  ['⚙️ Venta Diaria', '📤 Actualizar EXPORTAR, MINIMO y MAXIMO', 'Rehace EXPORTAR, MINIMO y MAXIMO (lógica de CAMBIO DE PRECIOS) con los precios de Site Sheet, el inventario de WM_Inv y PRECIOS VARIACIONES. Escribe solo SKU y precios (sin columnas de apoyo ni fórmulas).', 'Normalmente solo (cada 15 min)', 'A VECES'],
  ['⚙️ Venta Diaria', '🔄 Traer killers de Site Sheet y actualizar KILLERS ACTIVOS', 'Trae los killers del site, quita los que el site marca con pérdida mayor a 3% (KILLERS BAJO MINIMO) y los de COBRO DISTINTO, y rehace KILLERS ACTIVOS.', 'Cuando cambien killers y quieras verlo ya', 'DIARIO'],
  ['⚙️ Venta Diaria', '🎯 Procesar killers pegados (respaldo manual)', 'Procesa lo que pegaste en KILLERS PEGAR.', 'Solo si Site Sheet no trae los killers', 'SOPORTE'],
  ['⚙️ Venta Diaria', '📅 Reporte de killers del mes', 'Arma una hoja KILLERS <MES> con cada SKU, sus rangos y lo vendido en cada uno.', 'Al cierre de mes', 'A VECES'],
  ['⚙️ Venta Diaria', '📦 Revisar sobreventa (Walmart)', 'Llena Sobreventa WFS y Sobreventa Pick con los traslados en espera.', 'Normalmente solo (cada 30 min)', 'A VECES'],
  ['⚙️ Venta Diaria', '✅ Comparar KILLERS ACTIVOS contra Walmart', 'Compara lo que cargas contra el precio real de Walmart y da la decisión (DEJAR, REVISAR KAM, CAMBIO / QUITAR).', 'Después de subir precios a Walmart', 'DIARIO'],
  ['⚙️ Venta Diaria', '🔎 Buscar ventas (pegadas en BUSCAR VENTAS)', 'Busca en Odoo los números de venta que pegaste y escribe su detalle.', 'Cuando necesites fechas de envío u otros datos de un pedido', 'A VECES'],
  ['⚙️ Venta Diaria', '📊 Resumen de Walmart', 'Muestra un resumen de las ventas de Walmart.', 'Cuando quieras ver cómo va', 'A VECES'],
  ['⚙️ Venta Diaria', '🩺 Diagnóstico', 'Revisa que todo esté conectado y dice qué falta.', 'Si algo no baja', 'SOPORTE'],
  ['⚙️ Venta Diaria', '🧹 Limpiar hojas que no uso…', 'Te deja elegir hojas para borrar (con respaldo) o compactarlas.', 'Si el libro se acerca al límite de celdas', 'CUIDADO'],
  ['⚙️ Venta Diaria', '🗂️ Ordenar hojas e índice', 'Pone colores, orden y encabezados iguales, rehace el Índice y esta guía, BORRA respaldos y temporales, y manda al final (sin borrarlas) las hojas que parecen sin uso.', 'Cuando aparezca una hoja nueva o de vez en cuando', 'CUIDADO'],
  ['Configuración', '🔌 Configurar Odoo…', 'Guarda los datos de conexión a Odoo.', 'Una vez', 'SOPORTE'],
  ['Configuración', '🧪 Probar conexión a Odoo', 'Prueba que Odoo conteste.', 'Si algo no baja', 'SOPORTE'],
  ['Configuración', '⚙️ Configurar bandas de alerta de precios…', 'Cambia los cortes de DEJAR / REVISAR KAM / CAMBIO (3% y 10%).', 'Si quieres otros cortes', 'SOPORTE'],
  ['Configuración', '🔑 Configurar API de Walmart…', 'Guarda las llaves de la API de Walmart.', 'Una vez', 'SOPORTE'],
  ['Configuración', '🧪 Probar un pedido en la API de Walmart', 'Consulta un pedido en la API de Walmart para probar la conexión.', 'Si la API falla', 'SOPORTE'],
  ['Configuración', '⏱️ Instalar / reinstalar triggers', 'Crea los 3 triggers (ventas 10 min, precios 15 min, sobreventa 30 min).', 'Una vez, o si dejaron de correr', 'SOPORTE']
];

var ORG_NIVEL_COLOR = { 'DIARIO': '#d9ead3', 'A VECES': '#fff2cc', 'SOPORTE': '#eeeeee', 'CUIDADO': '#f4cccc' };

/** Hojas con encabezado propio en otra fila o que el usuario llena: no se les pone estilo de encabezado ni se congela. */
var ORG_SIN_ENCABEZADO = ['PRECIOS ERIK', 'Sobreventa WFS', 'Sobreventa Pick', 'KILLERS PEGAR', 'BUSCAR VENTAS', 'PRECIOS VARIACIONES'];
/** Solo estas hojas reciben formato unificado de precio/fecha (las demás ya tienen el suyo). */
var ORG_CON_FORMATO = ['KILLERS BAJO MINIMO', 'COBRO DISTINTO', 'COBRO DISTINTO DETALLE', 'COMPARAR WALMART', 'KILLERS HISTORICO',
                       'WALMART', 'PEDIDOS CVA', 'Histórico de alertas'];
// Hojas sin encabezado en la fila 1: columnas de dinero fijas (desde la fila 3)
var ORG_DINERO_FIJO = { 'PRECIOS ERIK': [3, 4, 15, 17] };

var ORG_RE_DINERO = /^(PRECIO|MINIMO|NORMAL|MAXIMO|NOS PAGAN|PUBLICADO|NEGOCIADO|CUPON|FALTA|CLASICA|PREMIUM|RECIBIMOS|ENTRA|CARGA \(|DIFERENCIA VS|IMPORTE|TOTAL ORDEN|PESOS|DIF|COM|ENVIO)\b|^VENTA$/;
var ORG_RE_FECHA  = /^(ACTUALIZADO|INICIA|TERMINA|INICIO|INI|FIN|FECHA|CAPTURADA|CAT CORTE|REGISTRADO|VENTA DIARIA ODOO|CORTE)\b/;
var ORG_FMT_DINERO = '$#,##0.00';
var ORG_FMT_FECHA  = 'yyyy-mm-dd hh:mm';

function orgNorm_(t) {
  return String(t === null || t === undefined ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Reintenta etapas que Sheets agota por tiempo (4 intentos, 10 s × n). Otros errores salen de una vez. */
function orgReintentar_(fn) {
  var ultimo;
  for (var i = 1; i <= 4; i++) {
    try { return fn(); }
    catch (e) {
      ultimo = e;
      if (!/tiempo|timed? ?out|agot|servicio hojas|service/i.test(String(e && e.message || e))) throw e;
      Utilities.sleep(10000 * i);
    }
  }
  throw ultimo;
}

/** Temporal o respaldo: se BORRA al ordenar (si no es del sistema ni del registro). */
function orgEsTemporal_(nombre) {
  return /respaldo/i.test(nombre) || /^_.*tmp$/i.test(nombre) || /^copia de /i.test(nombre);
}

/** Hojas que el sistema usa: protegidas del proyecto + registro + las dos de guía. */
function orgProtegidas_() {
  var s = {};
  try { hojasProtegidas_().forEach(function (n) { s[n] = true; }); } catch (e) {}
  ORG_HOJAS.forEach(function (f) { s[f[0]] = true; });
  s[ORG_INDICE] = true; s[ORG_GUIA] = true;
  return s;
}

/** Borra temporales y respaldos. Devuelve los nombres borrados. */
function orgLimpiar_(ss) {
  var prot = orgProtegidas_(), quitadas = [];
  ss.getSheets().forEach(function (h) {
    var n = h.getName();
    if (prot[n] || !orgEsTemporal_(n)) return;
    if (ss.getSheets().length <= 1) return;
    orgReintentar_(function () { ss.deleteSheet(h); });
    quitadas.push(n);
  });
  return quitadas;
}

/** Huella barata de una hoja: tamaño + primeras y últimas filas. */
function orgHuella_(h) {
  var nF = h.getLastRow(), nCtot = h.getLastColumn(), nC = Math.min(nCtot, 40);
  if (nF < 1 || nC < 1) return '0|0|0';
  var txt = [];
  h.getRange(1, 1, Math.min(2, nF), nC).getDisplayValues().forEach(function (f) { txt.push(f.join('\t')); });
  if (nF > 2) {
    var ini = Math.max(3, nF - 1);
    h.getRange(ini, 1, nF - ini + 1, nC).getDisplayValues().forEach(function (f) { txt.push(f.join('\t')); });
  }
  var s = txt.join('\n'), x = 0;
  for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return nF + '|' + nCtot + '|' + x;
}

function orgHoy_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function orgDias_(fecha) {
  if (!fecha) return 0;
  var a = String(fecha).split('-'), b = orgHoy_().split('-');
  var d1 = Date.UTC(+a[0], +a[1] - 1, +a[2]), d2 = Date.UTC(+b[0], +b[1] - 1, +b[2]);
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

/** Actualiza la huella de cada hoja y devuelve {nombre: {h, d (último cambio visto), p (primera vez vista)}}. */
function orgVisto_(hojas) {
  var props = PropertiesService.getScriptProperties();
  var prev = {};
  try { prev = JSON.parse(props.getProperty(ORG_PROP_VISTO) || '{}'); } catch (e) {}
  var hoy = orgHoy_(), out = {}, limite = new Date().getTime() + 120 * 1000;
  hojas.forEach(function (h) {
    var n = h.getName(), a = prev[n];
    if (new Date().getTime() > limite) { out[n] = a || { h: '', d: hoy, p: hoy }; return; }
    var hu;
    try { hu = orgReintentar_(function () { return orgHuella_(h); }); }
    catch (e) { out[n] = a || { h: '', d: hoy, p: hoy }; return; }
    if (!a) out[n] = { h: hu, d: hoy, p: hoy };
    else if (a.h !== hu) out[n] = { h: hu, d: hoy, p: a.p || hoy };
    else out[n] = a;
  });
  props.setProperty(ORG_PROP_VISTO, JSON.stringify(out));
  return out;
}

/** Hojas que ni el sistema ni el registro conocen Y están vacías o llevan ORG_DIAS_SIN_USO días sin cambios. {nombre: motivo} */
function orgSinUso_(hojas, prot, visto) {
  var res = {};
  hojas.forEach(function (h) {
    var n = h.getName();
    if (prot[n]) return;
    var v = visto[n];
    if (h.getLastRow() < 2) { res[n] = 'vacía'; return; }
    var dias = v ? orgDias_(v.d) : 0;
    if (dias >= ORG_DIAS_SIN_USO) res[n] = 'sin cambios hace ' + dias + ' días';
  });
  return res;
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
  ORG_CON_FORMATO.concat(Object.keys(ORG_DINERO_FIJO)).forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (!h) return;
    if (new Date().getTime() > limite) { fallas.push('(tiempo) ' + n); return; }
    try { total += orgReintentar_(function () { return orgFormatosHoja_(h); }); }
    catch (e) { fallas.push(n); console.log('Formatos ' + n + ': ' + e.message); }
  });
  orgFormatos_.fallas = fallas;
  if (!fallas.length) setProp_('ORG_FMT_MIG_V1', '1');   // ya se migraron los formatos viejos: de aquí en adelante solo General
  return total;
}

/** Formatos que el script o Sheets ponían solos antes; la primera corrida los cambia por los nuevos, después ya no. */
function orgFmtLegado_() {
  if (prop_('ORG_FMT_MIG_V1') === '1') return null;
  return ['#,##0.00', '#,##0', '"$"#,##0.00', '"$"#,##0', '$#,##0', 'mm-dd-yy', 'm/d/yyyy h:mm:ss', 'yyyy-mm-dd h:mm:ss',
          'yyyy-mm-dd hh:mm', 'dd/MM/yyyy HH:mm', 'm/d/yyyy', 'mm/dd/yyyy', 'm/d/yyyy h:mm'];
}

function orgFormatosHoja_(h) {
  var total = 0;
  var nF = h.getLastRow(), nC = h.getLastColumn();
  var fijo = ORG_DINERO_FIJO[h.getName()];
  if (fijo) {
    if (nF < 3) return 0;
    fijo.forEach(function (c) {
      if (c > nC) return;
      total += formatoSuave_(h, c, 3, nF - 2, ORG_FMT_DINERO, orgFmtLegado_());
    });
    return total;
  }
  if (nF < 2 || nC < 1) return 0;
  var muestra = h.getRange(1, 1, Math.min(nF, 8), nC).getValues();
  var enc = muestra[0], legado = orgFmtLegado_();
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
    // Formato suave: solo celdas en General (o con un formato viejo del script la primera vez). Si ya le
    // pusiste tu propio formato a la columna, se respeta y se extiende a los renglones nuevos.
    total += formatoSuave_(h, c + 1, 2, nF - 1, tipo === 'D' ? ORG_FMT_DINERO : ORG_FMT_FECHA, legado);
  }
  return total;
}

/** Menú: limpia, ordena y avisa. */
function orgOrdenar() {
  var ui = SpreadsheetApp.getUi();
  var avisos = [], r = null, quitadas = [];
  try { quitadas = orgLimpiar_(SpreadsheetApp.getActive()); } catch (e) { avisos.push('Limpieza de respaldos: ' + e.message); }
  try { r = orgAplicar_(true); } catch (e) { avisos.push('Orden/índice: ' + e.message); }
  if (!r) {
    ui.alert('🗂️ Ordenar hojas', 'No terminó:\n  ' + avisos.join('\n  ') +
      (quitadas.length ? '\n\nYa borré: ' + quitadas.join(', ') : '') +
      '\n\nEs Sheets ocupado (corridas automáticas). Espera 2 minutos sin tocar el libro y vuelve a correrlo: retoma donde se quedó.', ui.ButtonSet.OK);
    return;
  }
  var falt = (orgFormatos_.fallas || []);
  if (falt.length) avisos.push('Formatos pendientes en: ' + falt.join(', ') + ' (vuelve a correrlo y los termina)');
  var faltA = (orgAnchos_.faltan || []);
  if (faltA.length) avisos.push('Anchos pendientes en: ' + faltA.join(', ') + ' (vuelve a correrlo y los termina)');
  var sinUso = Object.keys(r.sinUso);
  ui.alert('🗂️ Libro ordenado',
    r.ordenadas + ' hojas con color y orden.\n' +
    r.encabezados + ' encabezados unificados.\n' +
    r.formatos + ' columnas de precio/fecha con formato unificado.\n' +
    r.anchos + ' hojas con ancho de columnas ajustado (encabezado completo).\n' +
    'Índice: hoja "' + ORG_INDICE + '" (la primera).\n' +
    (quitadas.length ? '\nBORRADAS (respaldos/temporales):\n  ' + quitadas.join('\n  ') + '\n' : '\nNo había respaldos ni temporales que borrar.\n') +
    (sinUso.length
      ? '\nPOSIBLEMENTE SIN USO (las mandé al final, NO las borré):\n  ' + sinUso.map(function (n) { return n + ' — ' + r.sinUso[n]; }).join('\n  ') + '\n'
      : '\nNinguna hoja parece sin uso (se vigilan cambios desde hoy; salen a los ' + ORG_DIAS_SIN_USO + ' días).\n') +
    (r.sinClasificar.length
      ? '\nSIN CLASIFICAR (nuevas, no están en el registro; las dejé donde estaban):\n  ' + r.sinClasificar.join('\n  ') + '\n'
      : '') +
    (avisos.length ? '\n⚠ ' + avisos.join('\n⚠ ') : ''),
    ui.ButtonSet.OK);
}

function orgAplicar_(completo) {
  var ss = SpreadsheetApp.getActive();
  var porNombre = {};
  ss.getSheets().forEach(function (h) { porNombre[h.getName()] = h; });

  var reg = {};
  ORG_HOJAS.forEach(function (f) { reg[f[0]] = { grupo: f[1], desc: f[2], act: f[3] }; });
  var prot = orgProtegidas_();

  var ind = porNombre[ORG_INDICE] || ss.insertSheet(ORG_INDICE);
  porNombre[ORG_INDICE] = ind;
  if (!porNombre[ORG_GUIA]) porNombre[ORG_GUIA] = ss.insertSheet(ORG_GUIA);

  var visto = completo ? orgVisto_(ss.getSheets()) : {};
  var sinUso = completo ? orgSinUso_(ss.getSheets(), prot, visto) : {};

  var ocultas = [], sinClas = [], sinUsoL = [], sistema = [];
  ss.getSheets().forEach(function (h) {
    var n = h.getName();
    if (n === ORG_INDICE || n === ORG_GUIA || reg[n]) return;
    if (sinUso[n]) { sinUsoL.push(n); return; }
    if (h.isSheetHidden()) { ocultas.push(n); return; }
    if (prot[n]) { sistema.push(n); return; }
    sinClas.push(n);
  });

  var deseado = [ORG_INDICE];
  ORG_HOJAS.forEach(function (f) { if (ss.getSheetByName(f[0])) deseado.push(f[0]); });
  sistema.forEach(function (n) { deseado.push(n); });
  sinClas.forEach(function (n) { deseado.push(n); });
  ocultas.sort().forEach(function (n) { deseado.push(n); });
  sinUsoL.sort().forEach(function (n) { deseado.push(n); });

  var resumen = { ordenadas: 0, encabezados: 0, formatos: 0, sinClasificar: sinClas, sinUso: sinUso };

  deseado.forEach(function (n, i) {
    var h = ss.getSheetByName(n);
    if (!h || h.isSheetHidden()) return;
    if (h.getIndex() !== i + 1) {
      orgReintentar_(function () { ss.setActiveSheet(h); ss.moveActiveSheet(i + 1); });
      SpreadsheetApp.flush();
    }
  });
  orgReintentar_(function () { ss.setActiveSheet(ind); });

  deseado.forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (!h) return;
    var c = null;
    if (n === ORG_INDICE) c = '#202124';
    else if (reg[n]) c = ORG_GRUPOS[reg[n].grupo].color;
    else if (sinUso[n]) c = ORG_GRUPOS.SINUSO.color;
    else if (ocultas.indexOf(n) !== -1) c = ORG_GRUPOS.OCULTAS.color;
    try {
      var act = h.getTabColor();
      if ((act || null) !== c) orgReintentar_(function () { h.setTabColor(c); });
    } catch (e) {}
    resumen.ordenadas++;
  });

  orgReintentar_(function () { orgGuia_(ss); });
  SpreadsheetApp.flush();
  orgReintentar_(function () { orgIndice_(ind, ss, sinClas.concat(sistema), ocultas, sinUso, visto); });
  PropertiesService.getScriptProperties().setProperty(ORG_PROP_HUELLA, deseado.join('|'));

  ORG_HOJAS.forEach(function (f) {
    var h = ss.getSheetByName(f[0]);
    if (!h || ORG_SIN_ENCABEZADO.indexOf(f[0]) !== -1) return;
    if (orgEncabezado_(h, ORG_GRUPOS[f[1]].color, completo)) resumen.encabezados++;
  });
  resumen.formatos = completo ? orgFormatos_(ss) : 0;
  resumen.anchos = completo ? orgAnchos_(ss) : 0;
  return resumen;
}

/**
 * Ancho de columnas: nunca menor que el encabezado (se lee completo); si el contenido es corto se ajusta a él
 * y si es largo se corta en ORG_ANCHO_MAX. Se calcula con una muestra (encabezado + primeras 300 filas), no
 * con autoResize (muy lento en hojas grandes). Solo hojas del registro con encabezado en la fila 1; Índice y
 * Guía llevan su propio ancho. Una hoja ya ajustada se salta mientras no cambien sus encabezados
 * (firma en Script Properties ORG_ANCHO), así la segunda corrida casi no cuesta. Tiene tope de tiempo.
 */
function orgAnchos_(ss) {
  var props = PropertiesService.getScriptProperties();
  var hechas = {};
  try { hechas = JSON.parse(props.getProperty(ORG_PROP_ANCHO) || '{}'); } catch (e) {}
  var limite = new Date().getTime() + 150 * 1000, n = 0, faltan = [];
  ORG_HOJAS.forEach(function (f) {
    var nombre = f[0];
    if (nombre === ORG_GUIA || ORG_SIN_ENCABEZADO.indexOf(nombre) !== -1) return;
    var h = ss.getSheetByName(nombre);
    if (!h) return;
    var nC = Math.min(h.getLastColumn(), 60);
    if (nC < 1 || h.getLastRow() < 1) return;
    if (new Date().getTime() > limite) { faltan.push(nombre); return; }
    try {
      orgReintentar_(function () {
        var datos = h.getRange(1, 1, Math.min(h.getLastRow(), 301), nC).getDisplayValues();
        // Solo se ajustan las columnas que NO se habían ajustado antes (por encabezado). Si luego cambias
        // un ancho a mano, o mueves la columna, se respeta; una columna nueva sí se ajusta.
        var ya = Array.isArray(hechas[nombre]) ? hechas[nombre] : [];
        var nuevosEnc = datos[0].map(orgNorm_).filter(function (k) { return k && ya.indexOf(k) < 0; });
        if (!nuevosEnc.length) return;
        for (var c = 0; c < nC; c++) {
          if (ya.indexOf(orgNorm_(datos[0][c])) >= 0 || !orgNorm_(datos[0][c])) continue;
          var enc = String(datos[0][c] || ''), largo = 0;
          for (var r = 1; r < datos.length; r++) { var l = String(datos[r][c] || '').length; if (l > largo) largo = l; }
          var pxEnc = enc ? enc.length * 8 + 34 : 0;          // negrita + icono de filtro
          var pxCont = Math.min(largo * 6.6 + 16, ORG_ANCHO_MAX);
          h.setColumnWidth(c + 1, Math.round(Math.max(pxEnc, pxCont, ORG_ANCHO_MIN)));
        }
        hechas[nombre] = ya.concat(nuevosEnc);
        n++;
      });
    } catch (e) { faltan.push(nombre); console.log('Anchos ' + nombre + ': ' + e.message); }
  });
  props.setProperty(ORG_PROP_ANCHO, JSON.stringify(hechas));
  orgAnchos_.faltan = faltan;
  return n;
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

function orgUltimo_(visto, n) {
  var v = visto && visto[n];
  if (!v) return '';
  return v.d + (v.d === v.p ? ' (desde que la vigilo)' : '');
}

function orgIndice_(ind, ss, otras, ocultas, sinUso, visto) {
  ind.clear();
  var tz = Session.getScriptTimeZone();
  var filas = [], banners = [];
  var hoja = function (n) { return ss.getSheetByName(n); };
  var link = function (n) { return '=HYPERLINK("#gid=' + hoja(n).getSheetId() + '","' + n.replace(/"/g, '""') + '")'; };
  var nFilas = function (n) { return Math.max(hoja(n).getLastRow() - 1, 0); };

  filas.push(['📑 ÍNDICE DEL LIBRO', '', '', '', '']);
  filas.push(['Actualizado ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + '. Da clic en el nombre para ir a la hoja.', '', '', '', '']);
  filas.push(['', '', '', '', '']);

  ['GUIA', 'KILLERS', 'VENTAS', 'PRECIOS', 'SISTEMA'].forEach(function (k) {
    var items = ORG_HOJAS.filter(function (f) { return f[1] === k && hoja(f[0]); });
    if (!items.length) return;
    filas.push([ORG_GRUPOS[k].titulo, 'PARA QUE SIRVE', 'SE ACTUALIZA', 'FILAS', 'ULTIMO CAMBIO VISTO']);
    banners.push({ fila: filas.length, color: ORG_GRUPOS[k].color });
    items.forEach(function (f) {
      filas.push([link(f[0]), f[2], f[3], nFilas(f[0]), orgUltimo_(visto, f[0])]);
    });
    filas.push(['', '', '', '', '']);
  });
  if (otras.length) {
    filas.push(['❓ OTRAS (no están en el registro de Organizar.gs)', '', '', 'FILAS', 'ULTIMO CAMBIO VISTO']);
    banners.push({ fila: filas.length, color: '#202124' });
    otras.forEach(function (n) { filas.push([link(n), '', '', nFilas(n), orgUltimo_(visto, n)]); });
    filas.push(['', '', '', '', '']);
  }
  if (ocultas.length) {
    filas.push([ORG_GRUPOS.OCULTAS.titulo, '', '', 'FILAS', '']);
    banners.push({ fila: filas.length, color: ORG_GRUPOS.OCULTAS.color });
    ocultas.forEach(function (n) { filas.push([n, 'Oculta a propósito (clic derecho > Mostrar hoja si la necesitas)', '', nFilas(n), orgUltimo_(visto, n)]); });
    filas.push(['', '', '', '', '']);
  }
  var su = Object.keys(sinUso).sort();
  if (su.length) {
    filas.push([ORG_GRUPOS.SINUSO.titulo, 'MOTIVO', '', 'FILAS', 'ULTIMO CAMBIO VISTO']);
    banners.push({ fila: filas.length, color: ORG_GRUPOS.SINUSO.color });
    su.forEach(function (n) { filas.push([link(n), sinUso[n], 'No se borra sola', nFilas(n), orgUltimo_(visto, n)]); });
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
    ind.getRange(b.fila, 1, 1, 5).setBackground(b.color).setFontColor('#ffffff').setFontWeight('bold');
  });
  ind.getRange(1, 4, nF, 1).setHorizontalAlignment('right').setNumberFormat('#,##0');
  ind.setColumnWidth(1, 300); ind.setColumnWidth(2, 560); ind.setColumnWidth(3, 220); ind.setColumnWidth(4, 80); ind.setColumnWidth(5, 210);
  ind.setFrozenRows(0);
  ind.setHiddenGridlines(true);
  orgRecortar_(ind, nF + 5, 5);
}
