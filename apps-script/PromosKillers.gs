/**
 * VENTA DIARIA ODOO 2026 — CARGA KILLERS (promociones por SKU para subir al site)
 *
 * Hoja lista para bajar como CSV y subir en "Cargar promociones" del site, con el MISMO formato de la
 * plantilla del site (plantilla_promociones_walmart.xlsx):
 *
 *     SKU | CATEGORIA | REDUCCION (PUNTOS)
 *
 * Qué entra: los killers de KILLERS ACTIVOS (origen SITE, no vencidos) de las categorías de PK.REGLAS
 *   · Videojuegos  → reducción 4.5 puntos
 *   · Fotografía   → reducción 7 puntos   (cámaras, lentes y accesorios de fotografía)
 * No importa la categoría que traiga el producto en Walmart: al estar dentro del killer, la promoción es
 * obligatoria para las métricas del site.
 *
 * El SKU va como lo pide el site: SIN -MSI (ni -MSI-2…9, ni -2…9); la promoción cubre sola la Premium.
 * Sin repetidos (varias publicaciones del mismo producto salen en un solo renglón).
 *
 * La hoja lleva SOLO esas 3 columnas para que el CSV baje limpio. Menú: 🎮 Armar CARGA KILLERS (foto y videojuegos).
 * Las clásicas de fotografía por categoría se cargan con la promoción por categoría del site (o con 🏷️ Armar carga).
 */

var PK = {
  HOJA: 'CARGA KILLERS',
  ENC: ['SKU', 'CATEGORIA', 'REDUCCION (PUNTOS)'],
  // coincide si el nombre de la categoría del killer (sin acentos, minúsculas) contiene alguna de las palabras
  REGLAS: [
    { palabras: ['videojuego'],            categoria: 'Videojuegos',      puntos: 4.5 },
    { palabras: ['fotograf', 'camara', 'lente'], categoria: 'Camaras y Lentes', puntos: 7 }
  ]
};

/** Pura: de las filas de KILLERS ACTIVOS ([encabezados, …filas]) a las filas de la hoja [[sku, categoria, puntos]]. */
function pkFilas_(a) {
  var m = mapaColumnas_(a[0]);
  var iS = m[norm_('SKU')], iC = m[norm_('KAM')], iO = m[norm_('ORIGEN')], iE = m[norm_('ESTADO')];
  var iG = m[norm_('SKU GENERAL')];
  if (iS === undefined || iC === undefined) throw new Error('KILLERS ACTIVOS no trae las columnas SKU y KAM (categoría).');
  var vistos = {}, out = [];
  for (var i = 1; i < a.length; i++) {
    var s0 = sku_(a[i][iS]);
    if (!s0) continue;
    if (iO !== undefined && String(a[i][iO]) !== 'SITE') continue;                       // solo killers (no filas PROMO CATEGORIA)
    if (iE !== undefined && /VENCID/.test(norm_(a[i][iE]))) continue;
    var cat = cpSinAcentos_(a[i][iC]), regla = null;
    PK.REGLAS.forEach(function (r) {
      if (!regla && r.palabras.some(function (p) { return cat.toLowerCase().indexOf(p) >= 0; })) regla = r;
    });
    if (!regla) continue;
    var base = cpBaseSite_(s0);
    if (vistos[base]) continue;
    vistos[base] = true;
    out.push([base, regla.categoria, regla.puntos]);
  }
  out.sort(function (x, y) { return x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : (x[0] < y[0] ? -1 : 1); });
  return out;
}

/** Menú: arma la hoja CARGA KILLERS. */
function armarCargaKillers() {
  var lock = candado_(120000);
  if (!lock) { avisar_('La importación automática está corriendo en este momento.\n\nEspera a que termine (revisa LOG Ventas) y vuelve a darle.'); return; }
  try {
    var act = libro_().getSheetByName(K_ACT);
    if (!act || act.getLastRow() < 2) throw new Error('KILLERS ACTIVOS está vacía. Corre primero "Traer killers de Site Sheet".');
    var a = act.getRange(1, 1, act.getLastRow(), act.getLastColumn()).getValues();
    var filas = pkFilas_(a);
    var sh = hoja_(PK.HOJA, PK.ENC);
    escribirPorEncabezado_(sh, PK.ENC, filas, { clave: 'ENC_ESCRITOS_CARGA_KILLERS' });
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
    SpreadsheetApp.flush();
    var cuenta = {};
    filas.forEach(function (f) { cuenta[f[1]] = (cuenta[f[1]] || 0) + 1; });
    logInfo_('CARGA KILLERS', 'Hoja armada', { skus: filas.length, porCategoria: cuenta });
    avisar_('CARGA KILLERS lista: ' + filas.length + ' SKUs\n\n' +
            Object.keys(cuenta).map(function (k) {
              var r = PK.REGLAS.filter(function (x) { return x.categoria === k; })[0];
              return '  ' + k + ': ' + cuenta[k] + ' (' + (r ? r.puntos : '') + ' puntos)';
            }).join('\n') +
            '\n\nBájala como CSV (Archivo → Descargar → CSV, con esta hoja abierta) y súbela en "Cargar promociones" del site.' +
            '\nEl SKU va sin -MSI.');
  } catch (e) {
    logError_('CARGA KILLERS', e);
    avisar_('No se pudo armar CARGA KILLERS:\n\n' + e);
  } finally {
    lock.releaseLock();
  }
}
