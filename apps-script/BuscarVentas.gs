/**
 * VENTA DIARIA ODOO 2026 — Buscar ventas
 *
 * Para revisar una lista de pedidos de Walmart sin armar nada a mano:
 *
 *   1. Pegas los números de venta (el "Número (SO)") en la columna A de la hoja
 *      "BUSCAR VENTAS", desde la fila 2.
 *   2. Menú ⚙️ Venta Diaria → 🔎 Buscar ventas.
 *   3. A la derecha (columnas C a P) queda, por cada pedido: si está en Odoo,
 *      si está en la hoja WALMART, fecha, estado, SKU, producto, cantidad,
 *      precio, total, estado de envío y el día en que se envió.
 *
 * Los que no existen en Odoo quedan marcados "NO" y en rojo.
 *
 * Busca DIRECTO en Odoo (no solo en la hoja WALMART, que recorta lo viejo), con
 * la misma conexión de siempre. El envío sale de los pickings de Odoo cuyo
 * documento origen es esa venta: se considera "Enviado" cuando la entrega de
 * SALIDA está en estado Hecho, y la fecha es la de esa entrega.
 *
 * No toca ninguna otra hoja. Cada corrida reescribe solo C:P de esta hoja.
 * Gasta ~6 llamadas a Odoo por cada 200 pedidos.
 */

var BV_ENC = ['NÚMERO DE VENTA', 'EN ODOO', 'EN HOJA WALMART', 'FECHA DE VENTA',
              'ESTADO SO', 'CLIENTE', 'SKU', 'PRODUCTO', 'CANTIDAD',
              'PRECIO UNITARIO', 'TOTAL ORDEN', 'ESTADO ENVÍO', 'ENVIADO EL',
              'ENTREGAS (detalle)'];
var BV_COL = 3;        // los resultados empiezan en la columna C
var BV_MAX = 500;      // tope de pedidos por corrida

var BV_SO_ESTADO = { draft: 'Cotización', sent: 'Cotización enviada',
                     sale: 'Venta confirmada', done: 'Bloqueada', cancel: 'Cancelada' };
var BV_PK_ESTADO = { draft: 'Borrador', waiting: 'En espera', confirmed: 'Confirmado',
                     assigned: 'Listo', done: 'Hecho', cancel: 'Cancelado' };

/** Menú: busca los pedidos pegados en la columna A. */
function buscarVentas() {
  var lock = candado_(180000);
  if (!lock) {
    avisar_('Hay otra corrida en curso (importación o sobreventa).\n\nEspera un minuto y vuelve a darle.');
    return;
  }
  try {
    var sh = bvHoja_();
    var nums = bvLeerNumeros_(sh);
    if (!nums.length) {
      avisar_('Pega los números de venta en la columna A de "' + CFG.H.BUSCAR +
              '" (desde la fila 2) y vuelve a darle.');
      return;
    }
    if (nums.length > BV_MAX) {
      avisar_('Son ' + nums.length + ' números y el tope por corrida es ' + BV_MAX +
              '.\n\nPega la lista en dos partes.');
      return;
    }
    var r = bvBuscar_(nums);
    bvEscribir_(sh, r.filas);

    var datos = { pedidos: nums.length, enOdoo: r.enOdoo, noEstan: r.noEstan.length,
                  enHoja: r.enHoja, enviados: r.enviados };
    logOK_('BUSCAR', 'Búsqueda de ventas', datos);
    avisar_('Búsqueda terminada\n\n' +
      'Pedidos buscados: ' + nums.length + '\n' +
      '  · En Odoo: ' + r.enOdoo + '\n' +
      '  · NO están en Odoo: ' + r.noEstan.length +
        (r.noEstan.length ? '\n      ' + r.noEstan.slice(0, 10).join('\n      ') +
                            (r.noEstan.length > 10 ? '\n      …y ' + (r.noEstan.length - 10) + ' más' : '') : '') + '\n' +
      '  · En la hoja WALMART: ' + r.enHoja + '\n' +
      '  · Enviados: ' + r.enviados + '\n\n' +
      'El detalle está en las columnas C a P de "' + CFG.H.BUSCAR + '".\n' +
      'Llamadas a Odoo hoy: ' + llamadasDeHoy_());
  } catch (e) {
    logError_('BUSCAR', e);
    avisar_('❌ Falló la búsqueda\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}

/** La hoja se crea sola la primera vez. */
function bvHoja_() {
  var ss = libro_();
  var sh = ss.getSheetByName(CFG.H.BUSCAR);
  if (!sh) {
    sh = ss.insertSheet(CFG.H.BUSCAR);
    sh.getRange(1, 1).setValue('PEGA AQUÍ LOS NÚMEROS DE VENTA')
      .setFontWeight('bold').setBackground('#fff2cc');
    // Texto, para que un número largo no se convierta ni pierda dígitos al pegar.
    sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.setColumnWidth(1, 240);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Normaliza un número pegado: sin espacios ni comillas, sin notación científica. */
function bvNorm_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return v.toFixed(0);
  return String(v).replace(/['"\s]/g, '');
}

/** Números de la columna A (desde la fila 2), sin vacíos ni repetidos. */
function bvLeerNumeros_(sh) {
  var n = Math.max(sh.getMaxRows() - 1, 1);
  var vals = sh.getRange(2, 1, n, 1).getValues();
  var vistos = {}, out = [];
  vals.forEach(function (r) {
    var k = bvNorm_(r[0]);
    if (k && !vistos[k]) { vistos[k] = true; out.push(k); }
  });
  return out;
}

/** Números que ya están en la hoja WALMART (por encabezado "Número (SO)"). */
function bvEnHoja_() {
  var set = {};
  var sh = libro_().getSheetByName(CFG.H.WALMART);
  if (!sh || sh.getLastRow() < 2) return set;
  var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var i = mapaColumnas_(enc)[norm_('Número (SO)')];
  if (i === undefined) i = 1;                      // como siempre: columna B
  sh.getRange(2, i + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var k = bvNorm_(r[0]);
    if (k) set[k] = true;
  });
  return set;
}

function bvFecha_(s) {
  var d = fecha_(s);
  return (d instanceof Date) ? Utilities.formatDate(d, CFG.TZ, 'dd/MM/yyyy HH:mm') : '';
}

function bvTexto_(v) { return (typeof v === 'string') ? v : ''; }

/**
 * Consulta Odoo y arma las filas. Devuelve
 * { filas, enOdoo, noEstan:[...], enHoja, enviados }.
 */
function bvBuscar_(nums) {
  var company = odooCompanyId_();
  var ctx = company ? { company_id: company } : {};
  var ctxTodos = company ? { company_id: company, active_test: false } : { active_test: false };
  var extraSO = company ? [['company_id', '=', company]] : [];

  // 1) Las ventas, por nombre; las que no salgan, por referencia del cliente.
  var camposSO = odooCamposExistentes_('sale.order',
    ['id', 'name', 'client_order_ref', 'date_order', 'partner_id', 'state', 'amount_total']);
  var porNum = {};
  sobBuscarEnLotes_('sale.order', nums, 'name', extraSO, camposSO, ctx).forEach(function (o) {
    porNum[bvNorm_(o.name)] = o;
  });
  var faltan = nums.filter(function (n) { return !porNum[n]; });
  if (faltan.length && camposSO.indexOf('client_order_ref') >= 0) {
    sobBuscarEnLotes_('sale.order', faltan, 'client_order_ref', extraSO, camposSO, ctx).forEach(function (o) {
      var ref = bvNorm_(bvTexto_(o.client_order_ref));
      if (ref && !porNum[ref]) porNum[ref] = o;
    });
  }

  var idsSO = {}, nombresSO = {};
  Object.keys(porNum).forEach(function (k) {
    idsSO[porNum[k].id] = true;
    nombresSO[porNum[k].name] = true;
  });
  var listaSO = Object.keys(idsSO).map(Number);
  var listaNombres = Object.keys(nombresSO);

  // 2) Líneas de esas ventas.
  var lineasPorSO = {}, idsProd = {};
  if (listaSO.length) {
    var camposLin = odooCamposExistentes_('sale.order.line',
      ['id', 'order_id', 'product_id', 'product_uom_qty', 'price_unit', 'display_type']);
    sobBuscarEnLotes_('sale.order.line', listaSO, 'order_id', [], camposLin, ctx).forEach(function (l) {
      if (l.display_type) return;                   // secciones y notas, no son producto
      var oid = Array.isArray(l.order_id) ? l.order_id[0] : null;
      if (!oid) return;
      (lineasPorSO[oid] = lineasPorSO[oid] || []).push(l);
      if (Array.isArray(l.product_id)) idsProd[l.product_id[0]] = true;
    });
  }

  // 3) SKU real de cada producto (incluye archivados).
  var prod = {};
  var listaProd = Object.keys(idsProd).map(Number);
  if (listaProd.length) {
    sobBuscarEnLotes_('product.product', listaProd, 'id', [],
      ['id', 'default_code', 'display_name'], ctxTodos).forEach(function (p) {
        prod[p.id] = { sku: bvTexto_(p.default_code), nombre: bvTexto_(p.display_name) };
      });
  }

  // 4) Entregas (pickings) cuyo documento origen es la venta.
  var pickPorOrigen = {}, tipos = {};
  if (listaNombres.length) {
    var pk = sobBuscarEnLotes_('stock.picking', listaNombres, 'origin', [],
      ['id', 'name', 'origin', 'state', 'date_done', 'scheduled_date', 'picking_type_id'], ctx);
    var idsTipo = {};
    pk.forEach(function (p) {
      var o = bvTexto_(p.origin);
      (pickPorOrigen[o] = pickPorOrigen[o] || []).push(p);
      if (Array.isArray(p.picking_type_id)) idsTipo[p.picking_type_id[0]] = true;
    });
    var listaTipo = Object.keys(idsTipo).map(Number);
    if (listaTipo.length) {
      try {
        sobBuscarEnLotes_('stock.picking.type', listaTipo, 'id', [],
          ['id', 'name', 'code'], ctxTodos).forEach(function (t) { tipos[t.id] = t; });
      } catch (e) { /* sin tipos: se toman todas las entregas como de salida */ }
    }
  }

  // 5) Filas, en el orden en que se pegaron.
  var enHoja = bvEnHoja_();
  var res = { filas: [], enOdoo: 0, noEstan: [], enHoja: 0, enviados: 0 };

  nums.forEach(function (num) {
    var estaHoja = !!enHoja[num];
    if (estaHoja) res.enHoja++;
    var o = porNum[num];
    if (!o) {
      res.noEstan.push(num);
      res.filas.push([num, 'NO', estaHoja ? 'SI' : 'NO', '', '', '', '', '', '', '', '', '', '', '']);
      return;
    }
    res.enOdoo++;

    var picks = (pickPorOrigen[o.name] || []).slice();
    var salidas = picks.filter(function (p) {
      var t = Array.isArray(p.picking_type_id) ? tipos[p.picking_type_id[0]] : null;
      return t ? t.code === 'outgoing' : !Object.keys(tipos).length;
    }).filter(function (p) { return p.state !== 'cancel'; });

    var estadoEnvio, enviadoEl = '';
    if (o.state === 'cancel') {
      estadoEnvio = 'Venta cancelada';
    } else if (!picks.length) {
      estadoEnvio = 'Sin entrega en Odoo';
    } else if (!salidas.length) {
      estadoEnvio = 'Sin entrega de salida';
    } else {
      var hechas = salidas.filter(function (p) { return p.state === 'done'; });
      if (hechas.length === salidas.length) {
        estadoEnvio = 'Enviado';
      } else if (hechas.length) {
        estadoEnvio = 'Enviado parcial';
      } else {
        estadoEnvio = BV_PK_ESTADO[salidas[0].state] || bvTexto_(salidas[0].state);
      }
      if (hechas.length) {
        var maxD = 0;
        hechas.forEach(function (p) {
          var d = fecha_(p.date_done);
          if (d instanceof Date && d.getTime() > maxD) maxD = d.getTime();
        });
        if (maxD) enviadoEl = Utilities.formatDate(new Date(maxD), CFG.TZ, 'dd/MM/yyyy HH:mm');
      }
    }
    if (estadoEnvio === 'Enviado') res.enviados++;

    var detalle = picks.map(function (p) {
      var t = Array.isArray(p.picking_type_id) ? tipos[p.picking_type_id[0]] : null;
      var f = bvFecha_(p.date_done);
      return bvTexto_(p.name) + ' · ' +
             (t ? t.name : (Array.isArray(p.picking_type_id) ? p.picking_type_id[1] : '')) + ' · ' +
             (BV_PK_ESTADO[p.state] || bvTexto_(p.state)) + (f ? ' · ' + f : '');
    }).join('  |  ');

    var base = [
      num, 'SI', estaHoja ? 'SI' : 'NO',
      bvFecha_(o.date_order),
      BV_SO_ESTADO[o.state] || bvTexto_(o.state),
      Array.isArray(o.partner_id) ? o.partner_id[1] : ''
    ];
    var cola = [num_(o.amount_total), estadoEnvio, enviadoEl, detalle];

    var lineas = lineasPorSO[o.id] || [];
    if (!lineas.length) {
      res.filas.push(base.concat(['', '', '', '']).concat(cola));
      return;
    }
    lineas.forEach(function (l) {
      var pid = Array.isArray(l.product_id) ? l.product_id[0] : null;
      var info = (pid && prod[pid]) || { sku: '', nombre: '' };
      res.filas.push(base.concat([
        info.sku, info.nombre, num_(l.product_uom_qty), num_(l.price_unit)
      ]).concat(cola));
    });
  });

  return res;
}

/** Escribe C:P (foto completa). La columna A, donde pegas, no se toca. */
function bvEscribir_(sh, filas) {
  var nc = BV_ENC.length;
  var maxF = sh.getMaxRows();
  if (sh.getMaxColumns() < BV_COL + nc - 1) {
    sh.insertColumnsAfter(sh.getMaxColumns(), BV_COL + nc - 1 - sh.getMaxColumns());
  }
  sh.getRange(1, BV_COL, maxF, nc).clearContent().setBackground(null);
  sh.getRange(1, BV_COL, 1, nc).setValues([BV_ENC])
    .setFontWeight('bold').setBackground('#d9ead3');

  if (!filas.length) return;
  if (sh.getMaxRows() < filas.length + 1) {
    sh.insertRowsAfter(sh.getMaxRows(), filas.length + 1 - sh.getMaxRows());
  }
  // Número de venta como texto, para no perder dígitos.
  sh.getRange(2, BV_COL, filas.length, 1).setNumberFormat('@');
  sh.getRange(2, BV_COL, filas.length, nc).setValues(filas);

  // Precio unitario (L→col 12) y total (M→col 13) en pesos.
  sh.getRange(2, 12, filas.length, 2).setNumberFormat('$#,##0.00');

  // Los que no existen en Odoo, en rojo.
  var fondos = filas.map(function (f) {
    var c = (f[1] === 'NO') ? '#f4cccc' : null;
    var fila = [];
    for (var i = 0; i < nc; i++) fila.push(c);
    return fila;
  });
  sh.getRange(2, BV_COL, filas.length, nc).setBackgrounds(fondos);
}
