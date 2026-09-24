/**
 * VENTA DIARIA ODOO 2026 — Importación de ventas desde Odoo
 *
 * Solo se trae de Odoo lo que se usa, y cada cosa va a su hoja:
 *
 *   WALMART      ← ventas del cliente WALMART, con su análisis de precio
 *   PEDIDOS CVA  ← ventas de SKUs -CVA de CUALQUIER plataforma
 *
 * Odoo hace el filtro (cliente WALMART o SKU -CVA): no se baja nada más.
 * Una venta -CVA hecha en Walmart va a las dos hojas.
 * Cada hoja se deduplica contra sí misma por ID Línea.
 *
 * Ya no existe "Órdenes de venta (acumulado)": se migra y se borra una vez.
 */

function importarVentasAuto() {
  var lock = candado_(60000);
  if (!lock) { logWarn_('AUTO', 'Otra corrida en curso, se omite'); return; }
  try {
    var r = importarVentas_();
    // Solo se escribe en el LOG cuando entró algo. Las corridas en vacío no
    // dejan renglón, salvo la PRIMERA del día: ese "Trigger vivo" sirve para
    // saber de un vistazo que el trigger sigue corriendo.
    if (r.walmart || r.cva || r.pendientes) {
      logOK_('AUTO', 'Importación terminada', r);
    } else {
      var hoy = hoy_();
      if (prop_('LOG_LATIDO_DIA') !== hoy) {
        setProp_('LOG_LATIDO_DIA', hoy);
        logOK_('AUTO', 'Trigger vivo (sin ventas nuevas)', r);
      }
    }
  } catch (e) {
    logError_('AUTO', e);
  } finally {
    lock.releaseLock();
  }
}

/** Menú: importar a mano. */
function importarVentasAhora() {
  // Botón: espera hasta 3 min a que termine el trigger que esté corriendo.
  var lock = candado_(180000);
  if (!lock) { avisar_('La importación automática está corriendo en este momento y no terminó en 3 minutos.\n\nNo pasa nada: espera a que termine (revisa LOG Ventas) y vuelve a darle.'); return; }
  try {
    var r = importarVentas_();
    avisar_(
      'Importación terminada\n\n' +
      'Líneas nuevas revisadas: ' + r.revisadas + '\n' +
      '  · WALMART: ' + r.walmart + '\n' +
      '  · PEDIDOS CVA: ' + r.cva + '\n' +
      'Alertas de precio: ' + r.alertas + '\n' +
      'Llamadas a Odoo: ' + r.llamadas
    );
  } catch (e) {
    logError_('MANUAL', e);
    avisar_('Falló la importación:\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}

function importarVentas_() {
  migrarOrdenesUnaVez_();
  repararFormatosUnaVez_();

  var t0 = Date.now();
  var llamadas0 = llamadasDeHoy_();
  var res = { revisadas: 0, walmart: 0, cva: 0, alertas: 0,
              pendientes: 0, llamadas: 0, seg: 0 };

  // ── 1. Bajar las líneas ───────────────────────────────────────────────
  //  NORMAL   id > última importada: casi siempre una llamada.
  //  BARRIDO  cada hora, 2 días completos: órdenes confirmadas tarde.
  var ultimoId = Number(prop_('ULTIMO_ID_LINEA', '0'));
  var tocaBarrido = (Date.now() - Number(prop_('ULTIMO_BARRIDO', '0'))) > 3600000;
  var dias = (tocaBarrido || !ultimoId) ? CFG.DIAS_BARRIDO : CFG.DIAS_VENTANA;
  var desdeStr = Utilities.formatDate(new Date(Date.now() - dias * 86400000),
                                      'UTC', 'yyyy-MM-dd HH:mm:ss');

  var dominio = [['create_date', '>=', desdeStr], ['state', 'in', CFG.ESTADOS_SO]];
  var company = odooCompanyId_();
  if (company) dominio.push(['company_id', '=', company]);
  if (!tocaBarrido && ultimoId) dominio.push(['id', '>', ultimoId]);
  // Solo lo que se usa: cliente WALMART, o producto -CVA de cualquier plataforma.
  dominio.push('|',
    ['order_partner_id.name', '=', CFG.CANAL_WALMART],
    ['product_id.default_code', 'ilike', CFG.SUFIJO_CVA]);

  var campos = odooCamposExistentes_('sale.order.line', [
    'id', 'order_id', 'product_id', 'product_uom_qty', 'price_unit', 'price_subtotal'
  ]);

  var lineas = [], offset = 0, pagina = 500;
  while (true) {
    var trozo = odooEjecutar_('sale.order.line', 'search_read', [dominio],
      { fields: campos, limit: pagina, offset: offset, order: 'id asc' });
    if (!trozo || !trozo.length) break;
    lineas = lineas.concat(trozo);
    if (trozo.length < pagina) break;
    offset += pagina;
    if (lineas.length >= CFG.MAX_LINEAS_CORRIDA) break;
    if (Date.now() - t0 > 240000) break;
  }
  if (tocaBarrido) setProp_('ULTIMO_BARRIDO', String(Date.now()));

  var maxId = ultimoId;
  lineas.forEach(function (l) { if (Number(l.id) > maxId) maxId = Number(l.id); });

  // Solo lo que todavía no está en WALMART ni en PEDIDOS CVA.
  var yaWm = idsDeHoja_(hoja_(CFG.H.WALMART, ENC_WALMART));
  var yaCva = idsDeHoja_(hoja_(CFG.H.CVA, ENC_VENTAS));
  lineas = lineas.filter(function (l) { return !yaWm[String(l.id)] && !yaCva[String(l.id)]; });
  res.revisadas = lineas.length;

  if (lineas.length) {
    // ── 2. Órdenes (1 llamada) ──────────────────────────────────────────
    var idsOrden = {};
    lineas.forEach(function (l) { if (l.order_id && l.order_id[0]) idsOrden[l.order_id[0]] = true; });
    var ordenes = {};
    var listaOrden = Object.keys(idsOrden).map(Number);
    if (listaOrden.length) {
      odooEjecutar_('sale.order', 'read', [listaOrden],
        { fields: ['id', 'name', 'date_order', 'partner_id', 'user_id', 'state', 'amount_total'] })
        .forEach(function (o) { ordenes[o.id] = o; });
    }

    // ── 3. Productos (1 llamada) ────────────────────────────────────────
    var idsProd = {};
    lineas.forEach(function (l) { if (l.product_id && l.product_id[0]) idsProd[l.product_id[0]] = true; });
    var prods = {};
    var listaProd = Object.keys(idsProd).map(Number);
    if (listaProd.length) {
      var camposProd = odooCamposExistentes_('product.product',
        ['id', 'default_code', 'display_name', 'name']);
      odooEjecutar_('product.product', 'read', [listaProd], { fields: camposProd })
        .forEach(function (p) { prods[p.id] = p; });
    }

    // ── 4. Filas A–L ────────────────────────────────────────────────────
    var m2o = function (v) { return (v && v.length > 1) ? String(v[1]) : ''; };
    var filas = [];
    lineas.forEach(function (l) {
      var o = ordenes[l.order_id && l.order_id[0]];
      if (!o) return;
      var p = prods[l.product_id && l.product_id[0]] || {};
      filas.push([
        l.id,                                           // A ID Línea
        o.name || '',                                   // B Número (SO)
        fecha_(o.date_order),                           // C Fecha creación
        m2o(o.partner_id),                              // D Cliente (canal)
        m2o(o.user_id),                                 // E Vendedor
        o.state || '',                                  // F Estado SO
        sku_(p.default_code || ''),                     // G SKU
        p.display_name || p.name || m2o(l.product_id),  // H Producto
        num_(l.product_uom_qty),                        // I Cantidad
        num_(l.price_unit),                             // J Precio unitario
        num_(l.price_subtotal),                         // K Importe línea
        num_(o.amount_total)                            // L Total orden
      ]);
    });

    // ── 5. Cada venta a su hoja ─────────────────────────────────────────
    var wm = filas.filter(function (f) { return esWalmart_(f[3]); });
    if (wm.length) {
      var rw = procesarWalmart_(wm);
      res.walmart = rw.escritas;
      res.alertas = rw.alertas;
    }

    var cva = filas.filter(function (f) { return esCVA_(f[6]); });
    if (cva.length) {
      marcaCvaInicial_();   // la primera vez no reenvía el histórico
      res.cva = agregarSinDuplicar_(CFG.H.CVA, ENC_VENTAS, cva).length;
    }
  }

  // La hoja SKU ASIGNADOS tiene que existir para que la llenes.
  asegurarAsignados_();

  // ── 6. Ventas Walmart que quedaron PENDIENTES en corridas anteriores ──
  var rp = revisarPendientesWalmart_();
  res.pendientes = rp.revisadas;
  res.alertas += rp.alertas;

  // ── 7. Reporte diario de ventas CVA (una vez al día, desde las 8 am) ──
  enviarCorreoCVA_();

  // ── 8. Marca de agua y retención ──────────────────────────────────────
  if (maxId > ultimoId) setProp_('ULTIMO_ID_LINEA', String(maxId));
  recortarPorFecha_(CFG.H.WALMART, 2, CFG.RETENCION.WALMART);

  res.llamadas = llamadasDeHoy_() - llamadas0;
  res.seg = (Date.now() - t0) / 1000;
  return res;
}

/**
 * Borra las filas más viejas que N días mirando la columna de fecha
 * (índice 0-based). La fila 1 nunca se toca.
 */
function recortarPorFecha_(nombreHoja, colFecha, dias) {
  if (!dias) return 0;
  var sh = libro_().getSheetByName(nombreHoja);
  if (!sh) return 0;
  var n = ultimaFilaColA_(sh);
  if (n < 3) return 0;

  var corte = Date.now() - dias * 86400000;
  var fechas = sh.getRange(2, colFecha + 1, n - 1, 1).getValues();
  var borrar = 0;
  for (var i = 0; i < fechas.length; i++) {
    var d = fechas[i][0];
    var t = (d instanceof Date) ? d.getTime() : Date.parse(d);
    if (!t || isNaN(t)) break;
    if (t < corte) borrar++; else break;
  }
  if (borrar > 0) {
    sh.deleteRows(2, borrar);
    logInfo_('RETENCION', 'Filas viejas recortadas de ' + nombreHoja, { filas: borrar, dias: dias });
  }
  return borrar;
}

/**
 * UNA sola vez: vacía y elimina "Órdenes de venta (acumulado)".
 * Antes de borrarla pasa lo que sirve:
 *   · cliente WALMART que no esté en WALMART  → WALMART (sin análisis: son
 *     ventas viejas; compararlas contra el precio de hoy daría alertas falsas)
 *   · SKU -CVA que no esté en PEDIDOS CVA     → PEDIDOS CVA (no entran al
 *     reporte diario: son histórico)
 */
function migrarOrdenesUnaVez_() {
  if (prop_('ORDENES_MIGRADAS') === '1') return;
  var ss = libro_();
  var sh = ss.getSheetByName(CFG.HOJA_ORDENES_VIEJA);
  if (!sh) { setProp_('ORDENES_MIGRADAS', '1'); return; }

  var n = ultimaFilaColA_(sh);
  var wm = [], cva = [], total = 0;
  if (n >= 2) {
    sh.getRange(2, 1, n - 1, 12).getValues().forEach(function (f) {
      if (f[0] === '' || f[0] === null || isNaN(Number(f[0]))) return;
      total++;
      if (esWalmart_(f[3])) wm.push(f);
      if (esCVA_(f[6])) cva.push(f);
    });
  }

  var aWm = agregarSinDuplicar_(CFG.H.WALMART, ENC_WALMART, wm).length;

  marcaCvaInicial_();
  var aCva = agregarSinDuplicar_(CFG.H.CVA, ENC_VENTAS, cva).length;
  if (aCva) setProp_('CVA_FILA_AVISADA', String(ultimaFilaColA_(ss.getSheetByName(CFG.H.CVA))));

  ss.deleteSheet(sh);
  setProp_('ORDENES_MIGRADAS', '1');
  logOK_('MIGRAR', 'Se eliminó "' + CFG.HOJA_ORDENES_VIEJA + '"', {
    filasRevisadas: total, walmartPasadas: aWm, cvaPasadas: aCva
  });
}


/**
 * SKU ASIGNADOS: si no existe, la crea ya con formato.
 * A = SKU principal (el publicado, con precio y killer) · B en adelante = los
 * SKUs de Odoo vinculados. Si ya existe, solo llena encabezados vacíos.
 */
function asegurarAsignados_() {
  var ss = libro_();
  if (ss.getSheetByName(CFG.H.ASIGNADOS)) { hoja_(CFG.H.ASIGNADOS, ENC_ASIGNADOS); return; }
  var sh = hoja_(CFG.H.ASIGNADOS, ENC_ASIGNADOS);
  var n = ENC_ASIGNADOS.length;
  sh.getRange(1, 1, 1, n)
    .setBackground('#1565c0').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.getRange(1, 1).setBackground('#0d47a1')
    .setNote('SKU publicado en Walmart (el que tiene precio en PRECIOS ERIK y killer).\n' +
             'A la derecha, un SKU de Odoo vinculado por celda. Sin -MSI ni -2.');
  sh.setRowHeight(1, 32);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.setColumnWidths(1, n, 260);
  sh.getRange(2, 1, sh.getMaxRows() - 1, n).setNumberFormat('@');   // SKUs como texto
  sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setFontWeight('bold').setBackground('#e3f2fd');
  logOK_('ASIGNADOS', 'Hoja SKU ASIGNADOS creada con formato');
}
