/**
 * ============================================================
 *  Columnas — todo se busca por ENCABEZADO, nunca por posicion
 * ============================================================
 *
 * REGLA DEL PROYECTO: ninguna parte del codigo ni de las formulas puede
 * depender de que una columna este en la letra C o en el indice 4. Si
 * alguien mueve, inserta o borra una columna, la logica tiene que seguir
 * funcionando; y si falta una columna que se necesita, tiene que avisar
 * con un ERROR claro en el Log, no dar datos corridos en silencio.
 *
 * Dos juegos de herramientas:
 *
 *   1) Para el SCRIPT (getValues):
 *        var c = colsDe_(encabezados, ['SKU', 'MINIMO'], 'Concentrado');
 *        fila[c.MINIMO]
 *      Si falta una requerida: ERROR en el Log y se detiene.
 *
 *   2) Para las FORMULAS que el script escribe:
 *        fxCol_('Walmart', 'SKU', 2)                -> la columna SKU desde la fila 2
 *        fxBuscar_(llave, 'Catalogo', 'SKU', 'NOMBRE')  -> VLOOKUP por encabezado
 *      Usan INDIRECT con el rango escrito como TEXTO. Asi, si alguien inserta
 *      una columna en la hoja fuente, Sheets NO recorre la referencia (con
 *      'Walmart'!$A:$L normal la recorreria a $B:$M y, cuando el script
 *      reescribe la hoja desde A, la formula quedaria apuntando mal para
 *      siempre). El MATCH contra la fila 1 encuentra la columna donde este.
 */

/** Encabezado normalizado: sin acentos, mayusculas, espacios simples. */
function normEnc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Mapa {nombre pedido -> indice 0-based} a partir de una fila de encabezados.
 * `requeridas`: si falta alguna, ERROR en el Log y throw.
 * `opcionales`: si faltan, quedan en -1 (el que llama decide).
 */
function colsDe_(encabezados, requeridas, nombreHoja, opcionales) {
  var idx = {};
  (encabezados || []).forEach(function (e, i) {
    var k = normEnc_(e);
    if (k && !(k in idx)) idx[k] = i;
  });

  var out = {}, faltan = [];
  (requeridas || []).forEach(function (n) {
    var k = normEnc_(n);
    if (k in idx) out[n] = idx[k]; else faltan.push(n);
  });
  (opcionales || []).forEach(function (n) {
    var k = normEnc_(n);
    out[n] = (k in idx) ? idx[k] : -1;
  });

  if (faltan.length) {
    var msg = 'En la hoja "' + nombreHoja + '" falta la columna ' +
              faltan.map(function (x) { return '"' + x + '"'; }).join(', ') +
              '. Revisa que nadie haya renombrado o borrado el encabezado.';
    try {
      logError_('COLUMNAS', msg, { hoja: nombreHoja, encontrados: (encabezados || []).slice(0, 40) });
    } catch (e) {}
    throw new Error(msg);
  }
  return out;
}

/** Lee la fila de encabezados de una hoja y devuelve el mapa. */
function colsHoja_(hoja, requeridas, opcionales, filaEnc) {
  filaEnc = filaEnc || 1;
  var nC = Math.max(1, hoja.getLastColumn());
  var enc = hoja.getRange(filaEnc, 1, 1, nC).getValues()[0];
  return colsDe_(enc, requeridas, hoja.getName(), opcionales);
}

/** Igual, pero la hoja por nombre. Si la hoja no existe, ERROR claro. */
function colsDeHoja_(ss, nombreHoja, requeridas, opcionales, filaEnc) {
  var h = ss.getSheetByName(nombreHoja);
  if (!h) {
    var msg = 'No existe la hoja "' + nombreHoja + '".';
    try { logError_('COLUMNAS', msg); } catch (e) {}
    throw new Error(msg);
  }
  return colsHoja_(h, requeridas, opcionales, filaEnc);
}

/* ---------------- Formulas ---------------- */

function fxEsc_(s) { return String(s).replace(/"/g, '""'); }

/** INDIRECT("'Hoja'!rango") — referencia que Sheets no recorre al insertar columnas. */
function fxRango_(hoja, rango) {
  return 'INDIRECT("\'' + fxEsc_(String(hoja).replace(/'/g, "''")) + '\'!' + rango + '")';
}

/** Numero de columna del encabezado en la fila 1 de la hoja. */
function fxMatch_(hoja, enc) {
  return 'MATCH("' + fxEsc_(enc) + '",' + fxRango_(hoja, '1:1') + ',0)';
}

/**
 * Columna completa por encabezado. `desdeFila` = 1 la da completa (para
 * VLOOKUP), 2 la deja alineada renglon por renglon con los datos.
 *
 * Se arma la LETRA con ADDRESS(1, MATCH(...), 4) y se pide solo esa columna
 * ("'Hoja'!K:K"), asi nunca se pide un rango mas ancho que la hoja.
 */
function fxCol_(hoja, enc, desdeFila) {
  var letra = 'SUBSTITUTE(ADDRESS(1,' + fxMatch_(hoja, enc) + ',4),"1","")';
  var pref = "'" + fxEsc_(String(hoja).replace(/'/g, "''")) + "'!";
  var desde = (desdeFila && desdeFila > 1) ? String(desdeFila) : '';
  return 'INDIRECT("' + pref + '"&' + letra + '&"' + desde + ':"&' + letra + ')';
}

/** VLOOKUP por encabezados: busca `llave` en la columna encLlave y trae encValor. */
function fxBuscar_(llave, hoja, encLlave, encValor) {
  return 'VLOOKUP(' + llave + ',{' + fxCol_(hoja, encLlave) + ',' + fxCol_(hoja, encValor) + '},2,FALSE)';
}

/** ¿La llave existe en la columna encLlave? (para SI/NO) */
function fxExiste_(llave, hoja, encLlave) {
  return 'NOT(ISNA(MATCH(' + llave + ',' + fxCol_(hoja, encLlave) + ',0)))';
}

/** Letra de una columna por su posicion 1-based (para formatos de la hoja propia). */
function colLetra_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* ---------------- Esquemas ---------------- */

/**
 * Lo que cada hoja TIENE que traer para que los procesos funcionen. Se
 * revisa a pedido con revisarColumnas() (todavia sin boton en el menu).
 * Si falta algo: ERROR en el Log con la hoja y la columna.
 * PRECIOS ERIK no entra: su encabezado no esta en la fila 1.
 */
function esquemasRequeridos_() {
  return [
    { hoja: 'WALMART',          cols: ['Número (SO)', 'Fecha creación', 'SKU', 'Cantidad', 'Precio unitario', 'Precio referencia'] },
    { hoja: 'KILLERS ACTIVOS',  cols: ['SKU', 'PRECIO', 'Carga', 'Inicio de la oferta', 'Finalización de la oferta'], vaciaOk: true },
    { hoja: 'COMPARAR WALMART', cols: ['SKU', 'DECISIÓN', '% VS MÍNIMO', 'MÍNIMO APLICABLE', 'PRECIO EN WALMART', 'CARGA (LO QUE PUBLICAS)'], vaciaOk: true },
    { hoja: 'EXPORTAR',         cols: ['SKU WALMART', 'PRECIO FINAL', 'PRECIO -2%', 'PRECIO CARGA'] },
    { hoja: 'MINIMO',           cols: ['SKU WALMART', 'PRECIO MINIMO'] },
    { hoja: 'MAXIMO',           cols: ['SKU WALMART', 'PRECIO MAXIMO'] },
    { hoja: 'LOG Ventas',       cols: ['Hora', 'Nivel', 'Etapa', 'Mensaje'], vaciaOk: true }
  ];
}

/**
 * Revisa todos los esquemas. Devuelve la lista de problemas (vacia = todo bien).
 * No truena: deja un ERROR por hoja en el Log.
 */
function revisarEsquemas_(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var problemas = [];
  esquemasRequeridos_().forEach(function (e) {
    var h = ss.getSheetByName(e.hoja);
    if (!h) {
      if (!e.opcional) problemas.push('No existe la hoja "' + e.hoja + '"');
      return;
    }
    if (h.getLastRow() < 1) { if (!e.vaciaOk && !e.opcional) problemas.push('La hoja "' + e.hoja + '" esta vacia'); return; }
    var enc = h.getRange(1, 1, 1, Math.max(1, h.getLastColumn())).getValues()[0];
    var hay = {};
    enc.forEach(function (x) { hay[normEnc_(x)] = true; });
    var faltan = e.cols.filter(function (c) { return !hay[normEnc_(c)]; });
    if (faltan.length) problemas.push('Hoja "' + e.hoja + '": falta ' + faltan.join(', '));
  });

  problemas.forEach(function (p) { try { logError_('COLUMNAS', p); } catch (x) {} });
  return problemas;
}

/** Menu: revisar que todas las hojas traigan sus columnas. */
function revisarColumnas() {
  var p = revisarEsquemas_(SpreadsheetApp.getActive());
  var msg = p.length ? 'Problemas:\n\n  ' + p.join('\n  ') :
                       'Todas las hojas fuente traen las columnas que necesitan.';
  try { SpreadsheetApp.getUi().alert('Columnas', msg, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(msg); }
  return msg;
}
