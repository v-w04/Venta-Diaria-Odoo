/**
 * CARGA PROMOCIONES — arma, con un asistente (popup), la lista que se pega en
 * "Cargar promociones" del site. Sirve para CUALQUIER categoría, no solo Fotografía.
 *
 * Menú → "Armar carga de promociones para el site":
 *   1) eliges la categoría (lista desplegable de COMISIONES), los puntos de reducción,
 *      las marcas (opcional), si entran clásicas / premium / las que ya tienen killer,
 *      y el stock mínimo;
 *   2) "Agregar y capturar otra" para sumar más categorías al mismo armado;
 *   3) "Generar hoja" → se arma CARGA PROMOCIONES con todo junto.
 *
 * Reglas fijas (lo que ya definimos):
 *   · Solo SKUs cuyo departamento en Walmart es esa categoría: si Walmart lo tiene en otra,
 *     no se fuerza.
 *   · El site no acepta -MSI ni -2/-3: sale el SKU BASE, una sola vez.
 *   · La categoría que sale es la de la regla; si el site ya vio ventas del SKU, manda la que
 *     Walmart realmente cobró (p. ej. Accesorios de Fotografia); la hoja PROMO TIPOS corrige por
 *     tipo de producto (opcional). Lo que Walmart cobra en una categoría que no es esa, no se carga.
 *   · Un SKU que el site marca "mal_capturada" no se vuelve a proponer.
 *
 * Copia las columnas A:C de los renglones LISTO y pégalas en el site.
 */
var CP_HOJA  = 'CARGA PROMOCIONES';
var CP_TIPOS = 'PROMO TIPOS';
var CP_ENC_TIPOS = ['TIPO DE PRODUCTO (WALMART)', 'CATEGORIA PARA EL SITE'];
var CP_ENC = ['SKU (BASE, SIN -MSI)', 'CATEGORIA', 'REDUCCION (puntos)', 'ESTADO', 'EN EL SITE',
              'VARIANTES QUE ENTRAN', 'VARIANTES CON KILLER', 'STOCK', 'TIPO DE PRODUCTO', 'REGLA'];
// Opcional: corrige la categoría por tipo de producto de Walmart (precarga con lo que vimos en Fotografía).
var CP_TIPOS_INI = [
  ['Adaptadores de Montura de Lente', 'Accesorios de Fotografia'],
  ['Estabilizadores para cámaras', 'Accesorios de Fotografia'],
  ['Impresoras fotográficas', 'Accesorios de Fotografia'],
  ['Cartuchos para impresora', 'Accesorios de Fotografia'],
  ['Papel Fotográfico', 'Accesorios de Fotografia']
];

function cpLeerTipos_() {
  var sh = hoja_(CP_TIPOS, CP_ENC_TIPOS);
  if (prop_('CP_TIPOS_V2') !== '1') {
    sh.getRange(1, 1, 1, 2).setValues([CP_ENC_TIPOS]);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 3)).clearContent();
    if (sh.getMaxRows() < CP_TIPOS_INI.length + 1) sh.insertRowsAfter(sh.getMaxRows(), CP_TIPOS_INI.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, CP_TIPOS_INI.length, 2).setValues(CP_TIPOS_INI);
    setProp_('CP_TIPOS_V2', '1');
  }
  var m = {};
  if (sh.getLastRow() > 1) {
    var dt = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 2)).getValues();
    var mt = mapaColumnas_(dt[0]), cT = mt[norm_(CP_ENC_TIPOS[0])], cC = mt[norm_(CP_ENC_TIPOS[1])];
    if (cT === undefined || cC === undefined) {
      logWarn_('CARGA PROMOCIONES', 'PROMO TIPOS no trae sus encabezados; se ignora', { encabezados: dt[0] });
    } else {
      dt.slice(1).forEach(function (r) {
        var t = norm_(r[cT]), c = String(r[cC] || '').trim();
        if (t && c) m[t] = c;
      });
    }
  }
  return m;
}

/** Variante → SKU base como lo pide el site: sin -MSI, -MSI-2..9 ni -2..9 (conserva -CVA). */
function cpBaseSite_(s) {
  return sku_(s).replace(/-OB$|-OPENBOX$/, '').replace(/-(MSI(-[2-9])?|[2-9])$/, '');
}

function cpSinAcentos_(t) { return norm_(String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')); }

/** Menú: abre el asistente. */
function armarCargaPromos() {
  var html = HtmlService.createHtmlOutputFromFile('PanelPromos').setWidth(560).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, '🏷️ Armar carga de promociones para el site');
}

/** Datos para los desplegables del asistente. */
function cpOpciones() {
  var pc = promosCategoria_();
  var cats = Object.keys(pc.cats).map(function (k) {
    var i = pc.cats[k];
    var marcas = pc.marcas.filter(function (m) { return m.cat === k; }).map(function (m) { return m.pref; });
    return { nombre: i.nombre, comision: i.normal === undefined ? '' : Math.round(i.normal * 1000) / 10,
             puntos: i.red > 0 ? Math.round(i.red * 1000) / 10 : '', marcas: marcas.join(', '),
             soloKillers: !!i.soloKillers };
  }).sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; });
  return { categorias: cats };
}

/**
 * reglas: [{ categoria, puntos, marcas:'DJI, NIK', clasicas, premium, conKiller, stockMin }]
 * Arma la hoja CARGA PROMOCIONES con todas juntas y devuelve el resumen.
 */
function cpGenerar(reglas) {
  if (!reglas || !reglas.length) throw new Error('Agrega al menos una categoría.');
  var act = libro_().getSheetByName(K_ACT);
  if (!act || act.getLastRow() < 2) throw new Error('KILLERS ACTIVOS está vacía. Corre primero "Traer killers de Site Sheet".');
  SpreadsheetApp.flush();
  var pc = promosCategoria_();
  var promos = null; try { promos = promosDelSite_(); } catch (e) { promos = null; }
  var tipos = cpLeerTipos_();

  // Killers VIGENTES (no cuentan las promociones que ya están en la hoja)
  var a = act.getRange(1, 1, act.getLastRow(), act.getLastColumn()).getValues();
  var ma = mapaColumnas_(a[0]);
  var xS = ma[norm_('SKU')], xO = ma[norm_('ORIGEN')], xE = ma[norm_('ESTADO')];
  if (xS === undefined) throw new Error('KILLERS ACTIVOS no trae la columna SKU.');
  var conKiller = {};
  for (var i = 1; i < a.length; i++) {
    var s0 = sku_(a[i][xS]);
    if (!s0) continue;
    var esPromo = xO !== undefined && String(a[i][xO]) === 'PROMO CATEGORIA';
    var vigente = xE === undefined || String(a[i][xE]) === 'VIGENTE';
    if (!esPromo && vigente) conKiller[s0] = true;
  }

  // Reglas limpias
  var R = [];
  reglas.forEach(function (r) {
    var ck = pc.nombres[norm_(r.categoria)];
    if (!ck) throw new Error('La categoría "' + r.categoria + '" no está en COMISIONES.');
    var puntos = Number(r.puntos);
    if (!(puntos > 0) && pc.cats[ck].red > 0) puntos = pc.cats[ck].red * 100;
    if (!(puntos > 0)) throw new Error('Falta la reducción (puntos) para ' + pc.cats[ck].nombre + '.');
    var marcas = String(r.marcas || '').split(/[,;\s]+/).map(function (x) { return norm_(x); }).filter(function (x) { return x; });
    R.push({ ck: ck, nombre: pc.cats[ck].nombre, puntos: Math.round(puntos * 100) / 100, marcas: marcas,
             clasicas: r.clasicas !== false, premium: r.premium !== false, conKiller: r.conKiller === true,
             stockMin: Number(r.stockMin) >= 0 && r.stockMin !== '' && r.stockMin !== null ? Number(r.stockMin) : 4 });
  });

  var st = {}; try { st = stockOdoo_(); } catch (e) { st = {}; }
  var grupos = {}, dash = leerDashboard_();
  R.forEach(function (rg, ri) {
    dash.forEach(function (d) {
      var s = d.sku;
      if (skuIgnorado_(s) || /-(OB|OPENBOX)$/.test(s)) return;
      if (pc.nombres[norm_(d.shelf)] !== rg.ck) return;                 // su departamento en Walmart debe ser esa categoría
      if (rg.marcas.length && !rg.marcas.some(function (m) { return s.indexOf(m) === 0; })) return;
      var prem = tipoPublicacion_(s) === 'PREMIUM';
      if ((prem && !rg.premium) || (!prem && !rg.clasicas)) return;
      var b = cpBaseSite_(s);
      if (grupos[b] && grupos[b].regla !== ri) return;                  // ya la reclamó otra regla
      var g = grupos[b] = grupos[b] || { base: b, regla: ri, shelf: d.shelf, tipo: '', sin: [], con: [], stock: 0 };
      if (!g.tipo && d.tipo) g.tipo = d.tipo;
      var tot = st[s] !== undefined ? st[s] : (st[skuSinVariante_(s)] !== undefined ? st[skuSinVariante_(s)] :
                (st[skuBase_(s)] !== undefined ? st[skuBase_(s)] : d.tot));
      var hayStock = tot >= rg.stockMin || d.wfs > 0;
      if (conKiller[s]) { g.con.push(s); if (rg.conKiller && hayStock) { g.sin.push(s); g.stock = Math.max(g.stock, tot); } }
      else if (hayStock) { g.sin.push(s); g.stock = Math.max(g.stock, tot); }
    });
  });

  var listos = [], otros = [], nuevos = 0, noCargar = 0, porRegla = R.map(function (rg) { return { categoria: rg.nombre, puntos: rg.puntos, listos: 0 }; });
  Object.keys(grupos).forEach(function (b) {
    var g = grupos[b], rg = R[g.regla];
    if (!g.sin.length) return;                                         // todo sin stock o con killer (y la regla no los incluye)
    var ps = promos ? promoSiteDeSku_(promos, b) : null;
    var estado = 'LISTO', cat = tipos[norm_(g.tipo)] || rg.nombre;
    if (ps && ps.catCobra) {                                           // lo que Walmart realmente cobra manda
      var cc = cpSinAcentos_(ps.catCobra), hit = null;
      Object.keys(tipos).forEach(function (k) { if (cpSinAcentos_(tipos[k]) === cc) hit = tipos[k]; });
      if (hit) cat = hit;
      else if (pc.nombres[norm_(ps.catCobra)] === rg.ck) cat = rg.nombre;
      else { estado = 'NO SE CARGA: Walmart cobra en ' + ps.catCobra; noCargar++; }
    }
    if (estado === 'LISTO' && ps) {
      var ev = promoSiteEval_(promos, pc, b, g.shelf);
      if (ev.motivo) { estado = 'NO SE CARGA: ' + ev.motivo; noCargar++; }
    }
    if (estado === 'LISTO') { porRegla[g.regla].listos++; if (!ps) nuevos++; }
    var fila = [b, estado === 'LISTO' ? cat : '', estado === 'LISTO' ? rg.puntos : '', estado, ps ? 'SI' : 'NO',
                g.sin.join(', '), g.con.join(', '), g.stock, g.tipo, rg.nombre];
    (estado === 'LISTO' ? listos : otros).push(fila);
  });
  var cmp = function (x, y) {
    return (x[9] < y[9] ? -1 : x[9] > y[9] ? 1 : 0) || (x[4] === y[4] ? 0 : x[4] === 'NO' ? -1 : 1) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
  };
  listos.sort(cmp);
  otros.sort(function (x, y) { return x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : (x[0] < y[0] ? -1 : 1); });
  var filas = listos.concat(otros);

  var h = hoja_(CP_HOJA, CP_ENC);
  var ancho = Math.max(h.getLastColumn(), CP_ENC.length);
  if (h.getMaxColumns() < ancho) h.insertColumnsAfter(h.getMaxColumns(), ancho - h.getMaxColumns());
  if (h.getMaxRows() < filas.length + 1) h.insertRowsAfter(h.getMaxRows(), filas.length + 1 - h.getMaxRows());
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, ancho).clearContent().clearFormat();
  h.getRange(1, 1, 1, ancho).clearContent();
  h.getRange(1, 1, 1, CP_ENC.length).setValues([CP_ENC]).setFontWeight('bold');
  h.getRange(1, 1).setNote('Copia A:C de los renglones LISTO y pégalos en "Cargar promociones" del site.\nEl SKU va sin -MSI.');
  if (filas.length) {
    h.getRange(2, 1, filas.length, CP_ENC.length).setValues(filas);
    h.getRange(2, 4, filas.length, 1).setBackgrounds(filas.map(function (f) { return [f[3] === 'LISTO' ? '#d9ead3' : '#fff2cc']; }));
  }
  h.setFrozenRows(1);
  var res = { listos: listos.length, nuevos: nuevos, noCargar: noCargar, porRegla: porRegla };
  logInfo_('CARGA PROMOCIONES', 'Lista armada', { reglas: R.length, listos: res.listos, nuevos: nuevos, noCargar: noCargar });
  return res;
}
