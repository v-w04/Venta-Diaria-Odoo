/**
 * VENTA DIARIA ODOO 2026 — Sobreventa (fusionado de "Sobreventa Odoo 2026")
 *
 * Baja de Odoo los pickings en estado "waiting"/"confirmed" (lo que ya se
 * vendió y todavía no se surte = sobreventa) y los reparte en dos hojas,
 * SIEMPRE filtrando por cliente WALMART:
 *
 *   · Sobreventa WFS   → picking type 14 (Órdenes de entrega Walmart WFS)
 *   · Sobreventa Pick  → picking type 3  (ElectronicsMexico: Pick)
 *
 * Reusa la MISMA conexión a Odoo que Venta Diaria (odooEjecutar_,
 * odooCompanyId_): las credenciales viven en Script Properties, no en el
 * código. Cada hoja es una foto completa: se reescribe entera en cada corrida
 * (no es un histórico). 12 columnas, idénticas al libro original.
 *
 * Lógica calcada del script original que ya funcionaba en producción:
 *   auth → company → verifica picking types → stock.picking waiting/confirmed
 *   → stock.move → default_code de los productos → una fila por SKU.
 */

// Estado de Odoo → etiqueta que se ve en la hoja (igual que el original).
var SOB_ESTADO = { waiting: 'En espera', confirmed: 'Confirmado', assigned: 'Listo' };

/** Menú: revisa la sobreventa ahora y avisa cuántas filas quedaron. */
function revisarSobreventa() {
  var lock = candado_(3 * 60 * 1000);
  if (!lock) { avisar_('Hay otra corrida en curso. Intenta en un minuto.'); return; }
  try {
    var r = sobreventa_();
    avisar_('Sobreventa actualizada (solo WALMART):\n\n' +
      CFG.SOBREVENTA.DESTINOS.map(function (d) {
        return '  · ' + d.hoja + ': ' + (r.porHoja[d.hoja] || 0) + ' línea(s)';
      }).join('\n') +
      '\n\nPickings en espera/confirmados: ' + r.pickings +
      '\nLlamadas a Odoo hoy: ' + llamadasDeHoy_());
  } catch (e) {
    logError_('SOBREVENTA', e);
    avisar_('❌ Falló la sobreventa\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}

/** Trigger: corre en silencio y solo deja renglón en el LOG si hubo algo. */
function sobreventaAuto() {
  var lock = candado_(60 * 1000);
  if (!lock) return;                 // ya hay otra corrida; no encimar llamadas
  try {
    var r = sobreventa_();
    // Solo deja renglón si HAY sobreventa; si no, corre en silencio.
    if (r.pickings) {
      logOK_('SOBREVENTA', 'Sobreventa Walmart', { pickings: r.pickings, porHoja: r.porHoja });
    }
  } catch (e) {
    logError_('SOBREVENTA', e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Núcleo. Devuelve { pickings, porHoja:{<hoja>:n} }.
 * No manda correos ni alertas: solo actualiza las hojas.
 */
function sobreventa_() {
  var company = odooCompanyId_();
  var ctx = company ? { company_id: company } : {};

  // Todos los picking types que nos interesan (WFS + Pick).
  var tipos = [];
  CFG.SOBREVENTA.DESTINOS.forEach(function (d) { tipos = tipos.concat(d.tipos); });

  // Verifica los tipos contra Odoo (solo para dejar el nombre en el LOG y
  // avisar si alguno ya no existe). No es crítico si falla.
  try {
    var tv = sobBuscar_('stock.picking.type',
      [['id', 'in', tipos], ['active', '=', true]], ['id', 'name'], ctx);
    var vistos = {};
    tv.forEach(function (t) { vistos[t.id] = true; });
    var faltan = tipos.filter(function (id) { return !vistos[id]; });
    if (faltan.length) {
      logWarn_('SOBREVENTA', 'Hay picking types que Odoo ya no reconoce', { ids: faltan });
    }
  } catch (e) { /* la verificación es opcional */ }

  // 1) Pickings en espera / confirmados de esos tipos.
  var pickings = sobBuscar_('stock.picking',
    [['picking_type_id', 'in', tipos], ['state', 'in', CFG.SOBREVENTA.ESTADOS]],
    ['id', 'name', 'state', 'scheduled_date', 'origin',
     'partner_id', 'location_id', 'location_dest_id', 'picking_type_id'], ctx);

  // 2) Solo WALMART (el contacto viene como [id, "WALMART"]).
  pickings = pickings.filter(function (p) {
    return Array.isArray(p.partner_id) &&
           norm_(p.partner_id[1]).indexOf(norm_(CFG.SOBREVENTA.CONTACTO)) >= 0;
  });

  var res = { pickings: pickings.length, porHoja: {} };

  if (!pickings.length) {
    // No hay sobreventa Walmart: deja las hojas vacías (solo timestamp + títulos).
    CFG.SOBREVENTA.DESTINOS.forEach(function (d) {
      escribirSobreventa_(d.hoja, []);
      res.porHoja[d.hoja] = 0;
    });
    return res;
  }

  // 3) Movimientos (una línea por SKU) de esos pickings.
  var idsPk = pickings.map(function (p) { return p.id; });
  var moves = sobBuscarEnLotes_('stock.move', idsPk, 'picking_id',
    [['state', 'not in', ['cancel', 'draft']]],
    ['id', 'picking_id', 'product_id', 'product_uom_qty', 'quantity', 'state'], ctx);

  // 4) SKU real (default_code) de cada producto.
  var idsProd = {};
  moves.forEach(function (m) {
    if (Array.isArray(m.product_id)) idsProd[m.product_id[0]] = true;
  });
  var prod = {};
  var listaProd = Object.keys(idsProd).map(Number);
  if (listaProd.length) {
    sobBuscarEnLotes_('product.product', listaProd, 'id', [],
      ['id', 'default_code', 'display_name'], ctx).forEach(function (p) {
        prod[p.id] = { sku: p.default_code || '', nombre: p.display_name || '' };
      });
  }

  // 5) Movimientos agrupados por picking.
  var porPicking = {};
  moves.forEach(function (m) {
    var pid = Array.isArray(m.picking_id) ? m.picking_id[0] : null;
    if (!pid) return;
    (porPicking[pid] || (porPicking[pid] = [])).push(m);
  });

  // 6) Filas por hoja (una por movimiento), según el picking type.
  var hojaDeTipo = {};
  CFG.SOBREVENTA.DESTINOS.forEach(function (d) {
    d.tipos.forEach(function (id) { hojaDeTipo[id] = d.hoja; });
  });
  var filas = {};
  CFG.SOBREVENTA.DESTINOS.forEach(function (d) { filas[d.hoja] = []; });

  pickings.forEach(function (p) {
    var tipoId = Array.isArray(p.picking_type_id) ? p.picking_type_id[0] : null;
    var hoja = hojaDeTipo[tipoId];
    if (!hoja) return;                                  // tipo que no mapeamos

    var base = [
      p.name || '',
      Array.isArray(p.location_id)      ? p.location_id[1]      : '',
      Array.isArray(p.location_dest_id) ? p.location_dest_id[1] : '',
      Array.isArray(p.partner_id)       ? p.partner_id[1]       : '',
      fecha_(p.scheduled_date),
      p.origin || '',
      SOB_ESTADO[p.state] || p.state || '',
      Array.isArray(p.picking_type_id)  ? p.picking_type_id[1]  : ''
    ];

    var movs = porPicking[p.id] || [];
    if (!movs.length) {
      filas[hoja].push(base.concat(['', '', 0, 0]));
      return;
    }
    movs.forEach(function (m) {
      var pid = Array.isArray(m.product_id) ? m.product_id[0] : null;
      var info = (pid && prod[pid]) || { sku: '', nombre: '' };
      filas[hoja].push(base.concat([
        info.sku, info.nombre,
        num_(m.product_uom_qty), num_(m.quantity)
      ]));
    });
  });

  // 7) Escribir cada hoja (foto completa).
  CFG.SOBREVENTA.DESTINOS.forEach(function (d) {
    escribirSobreventa_(d.hoja, filas[d.hoja]);
    res.porHoja[d.hoja] = filas[d.hoja].length;
  });

  return res;
}

/**
 * Escribe una hoja de sobreventa como foto completa:
 *   fila 1 = "Última actualización: …", fila 2 = encabezados, datos desde la 3.
 * Mismo formato que el libro original.
 */
function escribirSobreventa_(nombre, filas) {
  var sh = hoja_(nombre, null);
  sh.clearContents();

  sh.getRange(1, 1).setValue('Última actualización: ' + ahora_());
  sh.getRange(2, 1, 1, ENC_SOBREVENTA.length).setValues([ENC_SOBREVENTA]);

  if (filas && filas.length) {
    sh.getRange(3, 1, filas.length, ENC_SOBREVENTA.length).setValues(filas);
  }
}

// ── Lectura de Odoo con paginación (reusa la conexión de Venta Diaria) ──────

/**
 * search_read paginado (lotes de 1000) sobre la conexión ya configurada.
 * Reintenta una vez ante un HTTP 429 de Odoo (rate limit por ráfaga).
 */
function sobBuscar_(modelo, dominio, campos, ctx) {
  var limit = 1000, offset = 0, todo = [];
  while (true) {
    var kw = { fields: campos, limit: limit, offset: offset };
    if (ctx) kw.context = ctx;
    var lote = sobEjecutar_(modelo, 'search_read', [dominio], kw) || [];
    todo = todo.concat(lote);
    if (lote.length < limit) break;
    offset += lote.length;
  }
  return todo;
}

/**
 * Igual que sobBuscar_ pero trocea un dominio [campo, 'in', ids] en bloques de
 * 200 ids, para no armar un XML gigante ni pedirle demasiado a Odoo de golpe.
 */
function sobBuscarEnLotes_(modelo, ids, campo, dominioExtra, campos, ctx) {
  var out = [];
  for (var i = 0; i < ids.length; i += 200) {
    var trozo = ids.slice(i, i + 200);
    var dom = [[campo, 'in', trozo]].concat(dominioExtra || []);
    out = out.concat(sobBuscar_(modelo, dom, campos, ctx));
  }
  return out;
}

/** Una llamada a Odoo con un reintento ante 429 (espera y vuelve a intentar). */
function sobEjecutar_(modelo, metodo, args, kw) {
  try {
    return odooEjecutar_(modelo, metodo, args, kw);
  } catch (e) {
    var msg = String(e && e.message || e);
    if (msg.indexOf('429') >= 0) {
      Utilities.sleep(4000);
      return odooEjecutar_(modelo, metodo, args, kw);
    }
    throw e;
  }
}
