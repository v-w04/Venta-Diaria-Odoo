/**
 * VENTA DIARIA ODOO 2026 — Configuración
 * Electronics México · cuenta victor.walmart.04@gmail.com
 *
 * Aquí NO van credenciales. Todo lo secreto vive en Script Properties.
 * Menú: ⚙️ Venta Diaria → Configuración → Configurar Odoo…
 *
 * Propiedades que usa el proyecto (Script Properties):
 *   ODOO_URL   https://electronicsmexico.odoo.com
 *   ODOO_DB    electronicsmexico
 *   ODOO_USER  usuario de Odoo
 *   ODOO_PASS  API key
 *
 * Las hojas se llaman IGUAL que en el código anterior, para que todo lo
 * que ya estaba ahí (histórico, PRECIOS ERIK, WALMART) siga donde está.
 */

var CFG = {

  // ── Libros ──────────────────────────────────────────────────────────────
  LIBRO_ID: '17S65PqXK1DfJeHloJ4IFt-3K-MnQKOQaN_BiE9RUYaw', // Venta Diaria Odoo 2026

  // Site Sheet — de aquí salen los precios mínimos (EM y CVA).
  // Leer otro Google Sheet va por la API de Sheets: NO gasta UrlFetch.
  SITE_SHEET_ID:    '1Yjwyyv7EF5CJ3tJ2DgGzXO7QHxyrC0aCCSj1MHL5AKY',
  // Mínimos de los DOS masters: EM (propio) y CVA. Las ventas -CVA se
  // comparan contra el mínimo CVA; las demás contra el de EM.
  SITE_HOJAS_MINIMO: ['Precios EM Minimo', 'Precios CVA Minimo'],
  SITE_HOJA_LOG:    'Log',

  // Dashboard de Walmart (WM_Inv, "Walmart API"): de su hoja Inventario salen
  // departamento, stock y nombre para la promoción de categoría. Solo lectura.
  WM_DASH: { ID: '122_hEHeBaa6vYTABhdHdqnJqi_CXtpPB_g9N1d6Fr0Q', HOJA: 'Inventario' },

  // Empresa de Odoo (la instancia es multiempresa)
  COMPANY_NAME: 'ElectronicsMexico',

  // ── Las hojas que este proyecto usa (mismos nombres que antes) ──────────
  H: {
    WALMART:  'WALMART',                        // ventas Walmart + análisis de precio
    PRECIOS:  'PRECIOS ERIK',                   // precios mínimos EM + CVA (A–D)
    ALERTAS:  'Histórico de alertas',           // ventas Walmart bajo mínimo
    CVA:      'PEDIDOS CVA',                    // SKUs -CVA de cualquier plataforma
    K_PEGAR:  'KILLERS PEGAR',                  // pegado de Table Capture
    K_ACT:    'KILLERS ACTIVOS',                // killers vigentes (lo genera el script)
    K_HIST:   'KILLERS HISTORICO',              // todos los killers, por mes
    K_COM:    'COMISIONES',                     // comisión normal por categoría
    LOG:      'LOG Ventas',                     // bitácora del script
    ASIGNADOS:'SKU ASIGNADOS'                   // SKUs vinculados a otro SKU
  },

  // Hoja vieja que se elimina: lo que traiga de WALMART y -CVA se pasa a sus
  // hojas y luego se borra (una sola vez, ver migrarOrdenesUnaVez_).
  HOJA_ORDENES_VIEJA: 'Órdenes de venta (acumulado)',
  HOJA_CUPONES_VIEJA: 'CUPONES WALMART HIST',   // se pasa a KILLERS HISTORICO y se borra

  // ── PRECIOS ERIK — columnas que respeta el script ───────────────────────
  //   Filas 1-2 encabezado, datos desde la fila 3.
  //   A NOMBRE · B SKU GENERAL · C WALMART CLASICA · D WALMART PREMIUM
  //       ← las escribe el script desde Site Sheet (valores, no fórmulas)
  //   E–M vacías
  //   N–O KILLERS · P–Q SIN -2 (cupones)
  //       ← NO se tocan: siguen como las tengas (IMPORTRANGE o a mano)
  PE: {
    FILA_DATOS: 3,
    COL_NOMBRE: 1, COL_SKU: 2, COL_CLASICA: 3, COL_PREMIUM: 4,
    COL_KILLER_SKU: 14,    // N  SKU de la publicación con killer (…-MSI, …-MSI-2)
    COL_KILLER_PRECIO: 15, // O
    COL_CUPON_SKU: 16,     // P  ese SKU pelado a SKU general = como llega la venta de Odoo
    COL_CUPON_PRECIO: 17   // Q
  },

  // ── Reglas de negocio ───────────────────────────────────────────────────
  CANAL_WALMART: 'WALMART',   // cliente exacto en Odoo
  SUFIJO_CVA:    '-CVA',

  // Prefijos que NO se toman en cuenta nunca (publicaciones viejas)
  PREFIJOS_IGNORADOS: ['RES-', 'WL-', 'OB-'],

  // Ventas internas / insumos / pruebas: jamás generan alerta.
  CLIENTES_NO_COMERCIALES: ['VENTAS INTERNAS EM', 'INSUMOS', 'INSUMOS INTERNOS'],
  PRECIO_MINIMO_COMERCIAL: 50,

  // Alerta cuando J (precio unitario) < mínimo − tolerancia. Igual que antes.
  TOLERANCIA_PRECIO: 0.01,

  // ── Correo ──────────────────────────────────────────────────────────────
  // ÚNICO destinatario del proyecto. Solo avisa ventas CVA. No agregar más.
  CORREO_CVA: 'victor.walmart.04@gmail.com',
  // Un solo correo al día, a partir de esta hora, con todo lo vendido desde
  // el correo anterior (o sea, el día completo de ayer).
  CVA_HORA_REPORTE: 8,

  // ── Importación desde Odoo ──────────────────────────────────────────────
  DIAS_VENTANA: 7,          // corrida normal: líneas nuevas (id > última) de 7 días
  DIAS_BARRIDO: 2,          // barrido cada hora: órdenes confirmadas tarde
  MAX_LINEAS_CORRIDA: 3000, // tope por corrida (se corta a los 4 min de todos modos)
  ESTADOS_SO: ['sale', 'done'],

  // ── Retención (lo que evita volver al tope de 10M celdas) ───────────────
  RETENCION: {
    WALMART: 400,  // días en WALMART (ventas más viejas se recortan)
    LOG:    2000   // filas en LOG Ventas
  },

  LIMITE_CELDAS: 10000000,
  AVISO_CELDAS:  9000000,

  TZ: 'America/Mexico_City'
};

/** Ventas A–L (WALMART y PEDIDOS CVA), mismo orden que el código anterior. */
var ENC_VENTAS = [
  'ID Línea', 'Número (SO)', 'Fecha creación', 'Cliente', 'Vendedor',
  'Estado SO', 'SKU', 'Producto', 'Cantidad', 'Precio unitario',
  'Importe línea', 'Total orden'
];

/**
 * WALMART: A–L ventas + M "Precio referencia", igual que el código anterior.
 * NO se agregan columnas. M = el mínimo que aplicó al momento de la venta.
 */
var ENC_WALMART = ENC_VENTAS.concat(['Precio referencia']);
var N_COLS_WALMART = 13;

/*
 * Resultado interno de evaluarVentaWalmart_ (NO se escribe en la hoja, solo
 * decide si va al histórico): A–L + [ref, base, pub, origen, refUsada, dif,
 * pct, semáforo, notas]. Índices 0-based.
 */
var W = { REF: 12, BASE: 13, PUB: 14, ORIGEN: 15, REFUSADA: 16,
          DIF: 17, PCT: 18, SEM: 19, NOTAS: 20 };

/** Histórico de alertas: A–I tal cual está la hoja. NO se agregan columnas. */
var ENC_ALERTAS = ['VEnta diaria Odoo', 'SO', 'Cliente', 'Vendedor', 'SKU',
                   'Cantidad', 'VENTA', 'ERIK', 'DIFERENCIA'];

var ENC_LOG = ['Hora', 'Emoji', 'Nivel', 'Etapa', 'Mensaje', 'Detalles (JSON)'];

/** SKU ASIGNADOS: A = SKU principal (el publicado, con su precio y killer);
 *  B en adelante = los SKUs de Odoo vinculados a él. Puedes agregar columnas. */
var ENC_ASIGNADOS = ['SKU PRINCIPAL', 'ASIGNADO 1', 'ASIGNADO 2', 'ASIGNADO 3',
                     'ASIGNADO 4', 'ASIGNADO 5'];


/** Lee una propiedad del script. */
function prop_(k, def) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return (v === null || v === '') ? (def === undefined ? '' : def) : v;
}

function setProp_(k, v) {
  PropertiesService.getScriptProperties().setProperty(k, String(v));
}

/** Contadores de cuota en UserProperties: Google la cobra por usuario. */
function uprop_(k, def) {
  var v = PropertiesService.getUserProperties().getProperty(k);
  return (v === null || v === '') ? (def === undefined ? '' : def) : v;
}

function setUprop_(k, v) {
  PropertiesService.getUserProperties().setProperty(k, String(v));
}
