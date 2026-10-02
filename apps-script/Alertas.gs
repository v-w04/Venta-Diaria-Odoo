/**
 * VENTA DIARIA ODOO 2026 — Ventas de Walmart y su histórico de alertas
 *
 * NO manda correos. Ninguno. Todo queda escrito para consulta.
 *
 * Formatos: los MISMOS de siempre. No se agregan columnas.
 *   · WALMART              A–L venta · M Precio referencia (el mínimo que aplicó)
 *   · Histórico de alertas A Fecha alerta · B SO · C Cliente · D Vendedor ·
 *                          E SKU · F Cantidad · G VENTA · H ERIK · I DIFERENCIA
 *
 * Regla: alerta cuando J (precio unitario) queda por debajo del mínimo de
 * PRECIOS ERIK, salvo que:
 *   · había un killer de ese SKU a ese precio en la fecha de la venta
 *     (KILLERS HISTORICO + KILLERS KAM), o
 *   · había promoción de comisión y el precio alcanza el mínimo ajustado.
 * Nunca alertan: prefijos RES-/WL-/OB- · ventas internas, insumos y
 * pruebas · SKUs sin precio en PRECIOS ERIK.
 */

/** Carga lo necesario para evaluar. Si PRECIOS ERIK está vacía, la llena primero. */
function contextoPrecios_() {
  var tabla = tablaPrecios_();
  if (!tabla.nMinimos) {
    try { actualizarPreciosErik_(true); } catch (e) { logError_('PRECIOS', e); }
    tabla = tablaPrecios_();
  }
  return { tabla: tabla, killers: killersParaValidar_(tabla), listaCaida: false,
           asignados: leerAsignados_() };
}

/**
 * Filas A–L de Walmart recién bajadas → WALMART (A–M) y, si quedaron bajo
 * mínimo, al histórico. Devuelve { escritas, alertas }.
 */
function procesarWalmart_(filasWm) {
  repararFormatosUnaVez_();
  var ctx = contextoPrecios_();
  var completas = {};
  var aEscribir = filasWm.map(function (f) {
    var c = f.slice(0, 12).concat(evaluarVentaWalmart_(f, ctx.tabla, ctx.killers, ctx.listaCaida, ctx.asignados));
    completas[String(Number(c[0]) || c[0])] = c;
    return c.slice(0, N_COLS_WALMART);                 // A–M, nada más
  });

  var escritas = agregarSinDuplicar_(CFG.H.WALMART, ENC_WALMART, aEscribir);
  var alertas = escritas
    .map(function (f) { return completas[String(Number(f[0]) || f[0])]; })
    .filter(function (c) { return c && c[W.SEM] === 'BAJO MINIMO'; });
  var n = registrarAlertas_(alertas);

  return { escritas: escritas.length, alertas: n };
}

/** Ya no hay PENDIENTES (la lista de killers no depende de un IMPORTRANGE). */
function revisarPendientesWalmart_() {
  return { revisadas: 0, alertas: 0 };
}

/**
 * Escribe en "Histórico de alertas", columnas A–I fijas, como siempre.
 * No duplica: la llave es SO | SKU | precio, igual que antes.
 */
function registrarAlertas_(filas) {
  if (!filas || !filas.length) return 0;
  repararFormatosUnaVez_();

  var sh = libro_().getSheetByName(CFG.H.ALERTAS);
  if (!sh) {
    sh = libro_().insertSheet(CFG.H.ALERTAS);
    sh.getRange(1, 1, 1, ENC_ALERTAS.length).setValues([ENC_ALERTAS]);
  }

  // Las claves se arman por NOMBRE de encabezado: si la hoja trae las columnas
  // en otro orden, igual se detecta el duplicado y no se repite la alerta.
  var claves = {};
  filasOrdenadas_(sh, ENC_ALERTAS).forEach(function (r) {
    claves[String(r[1]) + '|' + sku_(r[4]) + '|' + num_(r[6])] = true;
  });

  var ahora = new Date();
  var nuevas = [];
  filas.forEach(function (f) {
    var k = String(f[1]) + '|' + sku_(f[6]) + '|' + num_(f[9]);
    if (claves[k]) return;
    claves[k] = true;
    var min = num_(f[W.REF]), J = num_(f[9]);
    nuevas.push([ahora, f[1], f[3], f[4], f[6], f[8], J, min, min - J]);
  });

  if (nuevas.length) {
    // Y se escriben en la columna que les toque hoy, no en A–I a ciegas.
    var colAncla = mapaFisico_(sh, ENC_ALERTAS)[0] + 1;
    agregarFilas_(sh, enOrdenFisico_(sh, ENC_ALERTAS, nuevas), colAncla);
    logWarn_('ALERTAS', nuevas.length + ' venta(s) de Walmart por debajo del mínimo',
             { skus: nuevas.slice(0, 10).map(function (a) { return a[4]; }) });
  }
  return nuevas.length;
}

/**
 * UNA vez: deja WALMART e Histórico de alertas como estaban.
 *  · Histórico: versiones anteriores de este código agregaron columnas a la
 *    derecha (Fecha alerta, Producto, J: Precio, N: Ref, Importe, Total,
 *    Publicación, Origen, Fecha venta, ID Línea) y una alerta quedó repartida.
 *    Se regresa a A–I y se borran esas columnas.
 *  · WALMART: se borran las columnas N–U que agregó el código nuevo
 *    (SKU base … Notas). A–M quedan intactas.
 * Solo borra columnas cuyo encabezado es uno de los que puso este código.
 */
var ENC_AGREGADOS_ALERTAS = ['FECHA ALERTA', 'PRODUCTO', 'J: PRECIO', 'N: REF', 'IMPORTE',
                             'TOTAL', 'PUBLICACION', 'ORIGEN', 'FECHA VENTA', 'ID LINEA', 'DIFF (N-J)'];
var ENC_AGREGADOS_WALMART = ['SKU BASE', 'PUBLICACION', 'ORIGEN', 'REFERENCIA USADA',
                             'DIFERENCIA $', 'DIFERENCIA %', 'SEMAFORO', 'NOTAS'];

function repararFormatosUnaVez_() {
  if (prop_('FORMATOS_REPARADOS') === '1') return;
  var ss = libro_();

  // ── Histórico de alertas ──
  var al = ss.getSheetByName(CFG.H.ALERTAS);
  if (al && al.getLastColumn() > 9) {
    var nc = al.getLastColumn(), n = al.getLastRow();
    var enc = al.getRange(1, 1, 1, nc).getValues()[0].map(norm_);
    var col = function (nombre) { var i = enc.indexOf(nombre); return i > 8 ? i : -1; };
    var cFecha = col('FECHA ALERTA'), cPrecio = col('J: PRECIO'), cRef = col('N: REF');
    if (n > 1) {
      var datos = al.getRange(2, 1, n - 1, nc).getValues();
      var cambio = false;
      datos.forEach(function (r) {
        if ((r[0] === '' || r[0] === null) && cFecha >= 0 && r[cFecha] !== '') {
          r[0] = r[cFecha];
          if (cPrecio >= 0 && r[6] === '') r[6] = r[cPrecio];
          if (cRef >= 0 && r[7] === '') r[7] = r[cRef];
          if (r[8] === '' && num_(r[7]) && num_(r[6])) r[8] = num_(r[7]) - num_(r[6]);
          cambio = true;
        }
      });
      if (cambio) al.getRange(2, 1, datos.length, 9).setValues(datos.map(function (r) { return r.slice(0, 9); }));
    }
    for (var c = nc - 1; c >= 9; c--) {
      if (ENC_AGREGADOS_ALERTAS.indexOf(enc[c]) >= 0) al.deleteColumn(c + 1);
    }
  }

  // ── WALMART ──
  var wm = ss.getSheetByName(CFG.H.WALMART);
  if (wm && wm.getLastColumn() > N_COLS_WALMART) {
    var ncw = wm.getLastColumn();
    var encw = wm.getRange(1, 1, 1, ncw).getValues()[0].map(norm_);
    for (var d = ncw - 1; d >= N_COLS_WALMART; d--) {
      if (ENC_AGREGADOS_WALMART.indexOf(encw[d]) >= 0) wm.deleteColumn(d + 1);
    }
  }

  setProp_('FORMATOS_REPARADOS', '1');
  logOK_('FORMATO', 'WALMART e Histórico de alertas regresados a su formato original');
}

/** Resumen rápido para consultar sin abrir las hojas. */
function resumenWalmart() {
  var sh = libro_().getSheetByName(CFG.H.WALMART);
  if (!sh || sh.getLastRow() < 2) { avisar_('Todavía no hay ventas de Walmart.'); return; }

  var datos = filasOrdenadas_(sh, ENC_WALMART);
  var importe = 0, sinRef = 0;
  datos.forEach(function (f) {
    importe += num_(f[10]);
    if (!num_(f[12])) sinRef++;
  });

  var al = libro_().getSheetByName(CFG.H.ALERTAS);
  var cel = celdasDelLibro_();
  avisar_(
    'WALMART — resumen\n\n' +
    'Ventas: ' + datos.length + '\n' +
    'Importe total: $' + Math.round(importe).toLocaleString('es-MX') + '\n' +
    'Sin precio en PRECIOS ERIK: ' + sinRef + '\n\n' +
    'Histórico de alertas: ' + (al ? Math.max(0, ultimaFilaColA_(al) - 1) : 0) + ' registros\n' +
    'Celdas del libro: ' + cel.total.toLocaleString('es-MX') + ' / 10,000,000\n' +
    'Llamadas a Odoo hoy: ' + llamadasDeHoy_()
  );
}
