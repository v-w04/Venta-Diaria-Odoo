/**
 * VENTA DIARIA ODOO 2026 — Importación de ventas desde Odoo
 *
 * Una corrida baja las líneas de venta nuevas y las reparte:
 *
 *   Órdenes de venta (acumulado)  ← TODAS las plataformas, sin análisis
 *   WALMART                       ← canal Walmart + análisis de precio
 *   PEDIDOS CVA                   ← SKUs -CVA de cualquier plataforma (+ correo)
 *
 * Cada hoja se deduplica contra sí misma por ID Línea, así que no se repite
 * nada de lo que el código anterior ya había repartido.
 *
 * Costo: 3 a 5 llamadas a Odoo por corrida → ~600/día cada 10 min, 3% de la
 * cuota de 20,000 de la cuenta.
 *
 * Qué cambió contra el código anterior:
 *   · Ya no se reparte a una hoja por cliente (eso llenó el libro).
 *   · Ya no hay cierre nocturno que vaciaba la hoja principal: ahora acumula,
 *     con recorte automático a 365 días.
 *   · Filtra por empresa ElectronicsMexico igual que antes.
 *   · La fecha se interpreta como UTC (antes podía quedar corrida 6 h).
 */

function importarVentasAuto() {
  var lock = candado_(60000);
  if (!lock) { logWarn_('AUTO', 'Otra corrida en curso, se omite'); return; }
  try {
    var r = importarVentas_();
    if (r.nuevas > 0 || r.pendientes > 0) logOK_('AUTO', 'Importación terminada', r);
  } catch (e) {
    logError_('AUTO', e);
    if (esErrorDeCeldas_(String(e && e.message || e))) {
      logWarn_('AUTO', 'El libro está en el tope de celdas. ' +
               'Menú ⚙️ Venta Diaria → 🧹 Limpiar hojas que no uso.');
    }
  } finally {
    lock.releaseLock();
  }
}

/** Menú: importar a mano. */
function importarVentasAhora() {
  var lock = candado_(30000);
  if (!lock) { avisar_('Hay otra corrida en curso. Intenta en un minuto.'); return; }
  try {
    var r = importarVentas_();
    avisar_(
      'Importación terminada\n\n' +
      'Líneas revisadas en Odoo: ' + r.revisadas + '\n' +
      'Nuevas en Órdenes de venta: ' + r.nuevas + '\n' +
      '  · Walmart: ' + r.walmart + '\n' +
      '  · CVA: ' + r.cva + '\n' +
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
  var t0 = Date.now();
  var llamadas0 = llamadasDeHoy_();
  var res = { revisadas: 0, nuevas: 0, walmart: 0, cva: 0, alertas: 0,
              pendientes: 0, llamadas: 0, seg: 0 };

  // ── 1. Bajar las líneas ───────────────────────────────────────────────
  //  NORMAL   id > última importada: casi siempre una llamada.
  //  BARRIDO  toda la ventana de 7 días, cada hora, para recoger órdenes
  //           confirmadas tarde (id menor que la marca de agua).
  var desde = new Date(Date.now() - CFG.DIAS_VENTANA * 86400000);
  var desdeStr = Utilities.formatDate(desde, 'UTC', 'yyyy-MM-dd HH:mm:ss');

  var ultimoId = Number(prop_('ULTIMO_ID_LINEA', '0'));
  var tocaBarrido = (Date.now() - Number(prop_('ULTIMO_BARRIDO', '0'))) > 3600000;

  var dominio = [['create_date', '>=', desdeStr], ['state', 'in', CFG.ESTADOS_SO]];
  var company = odooCompanyId_();
  if (company) dominio.push(['company_id', '=', company]);
  if (!tocaBarrido && ultimoId) dominio.push(['id', '>', ultimoId]);

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
  res.revisadas = lineas.length;

  var maxId = ultimoId;
  lineas.forEach(function (l) { if (Number(l.id) > maxId) maxId = Number(l.id); });

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

    // ── 4. Filas A–L (mismo orden que el código anterior) ──────────────
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

    // ── 5. Repartir ─────────────────────────────────────────────────────
    var nuevas = agregarSinDuplicar_(CFG.H.VENTAS, ENC_VENTAS, filas);
    res.nuevas = nuevas.length;

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

  // ── 6. Ventas Walmart que quedaron PENDIENTES en corridas anteriores ──
  var rp = revisarPendientesWalmart_();
  res.pendientes = rp.revisadas;
  res.alertas += rp.alertas;

  // ── 7. Correo CVA con lo que no se haya avisado (agrupado) ────────────
  enviarCorreoCVA_(false);

  // ── 8. Marca de agua y retención ──────────────────────────────────────
  if (maxId > ultimoId) setProp_('ULTIMO_ID_LINEA', String(maxId));
  recortarPorFecha_(CFG.H.VENTAS, 2, CFG.RETENCION.VENTAS);

  res.llamadas = llamadasDeHoy_() - llamadas0;
  res.seg = (Date.now() - t0) / 1000;
  return res;
}

/**
 * Borra las filas más viejas que N días mirando la columna de fecha
 * (índice 0-based). clearContent antes de deleteRows. La fila 1 nunca se toca.
 */
function recortarPorFecha_(nombreHoja, colFecha, dias) {
  if (!dias) return 0;
  var sh = libro_().getSheetByName(nombreHoja);
  if (!sh) return 0;
  var n = sh.getLastRow();
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
    sh.getRange(2, 1, borrar, sh.getMaxColumns()).clearContent();
    sh.deleteRows(2, borrar);
    logInfo_('RETENCION', 'Filas viejas recortadas de ' + nombreHoja, { filas: borrar, dias: dias });
  }
  return borrar;
}
