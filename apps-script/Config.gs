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

  // Empresa de Odoo (la instancia es multiempresa)
  COMPANY_NAME: 'ElectronicsMexico',

  // ── Las hojas que este proyecto usa (mismos nombres que antes) ──────────
  H: {
    WALMART:  'WALMART',                        // ventas Walmart + análisis de precio
    VENTAS:   'Órdenes de venta (acumulado)',   // TODAS las plataformas, sin análisis
    PRECIOS:  'PRECIOS ERIK',                   // tabla de precios mínimos + cupones
    ALERTAS:  'Histórico de alertas',           // ventas Walmart bajo mínimo
    CVA:      'PEDIDOS CVA',                    // SKUs -CVA de cualquier plataforma
    CUPONES:  'CUPONES WALMART HIST',           // memoria de cupones (oculta)
    LOG:      'LOG Ventas'                      // bitácora del script
  },

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
  CANAL_WALMART: 'WALMART',   // se detecta con "contiene" sobre Cliente, como antes
  SUFIJO_CVA:    '-CVA',

  // Prefijos que NO se toman en cuenta nunca (publicaciones viejas)
  PREFIJOS_IGNORADOS: ['RES-', 'WL-', 'OB-'],

  // Ventas internas / insumos / pruebas: jamás generan alerta.
  CLIENTES_NO_COMERCIALES: ['VENTAS INTERNAS EM', 'INSUMOS', 'INSUMOS INTERNOS'],
  PRECIO_MINIMO_COMERCIAL: 50,

  // Alerta cuando J (precio unitario) < mínimo − tolerancia. Igual que antes.
  TOLERANCIA_PRECIO: 0.01,
  // Un cupón visto en P/Q se sigue aceptando estos días (cupones que rotan
  // o IMPORTRANGE sirviendo caché viejo). Igual que antes.
  CUPON_DIAS_VIGENCIA: 15,

  // ── Correo ──────────────────────────────────────────────────────────────
  // ÚNICO destinatario del proyecto. Solo avisa ventas CVA. No agregar más.
  CORREO_CVA: 'victor.walmart.04@gmail.com',

  // ── Importación desde Odoo ──────────────────────────────────────────────
  DIAS_VENTANA: 7,
  MAX_LINEAS_CORRIDA: 1000,
  ESTADOS_SO: ['sale', 'done'],

  // ── Retención (lo que evita volver al tope de 10M celdas) ───────────────
  RETENCION: {
    VENTAS: 365,   // días en Órdenes de venta (acumulado)
    LOG:    2000   // filas en LOG Ventas
  },

  LIMITE_CELDAS: 10000000,
  AVISO_CELDAS:  9000000,

  TZ: 'America/Mexico_City'
};

/** Ventas: A–L, igual que el código anterior. */
var ENC_VENTAS = [
  'ID Línea', 'Número (SO)', 'Fecha creación', 'Cliente', 'Vendedor',
  'Estado SO', 'SKU', 'Producto', 'Cantidad', 'Precio unitario',
  'Importe línea', 'Total orden'
];

/**
 * WALMART: A–L ventas · M Precio referencia (como antes) · N–U análisis.
 * M ahora es un VALOR (el mínimo al momento de la venta), no una fórmula.
 */
var ENC_WALMART = ENC_VENTAS.concat([
  'Precio referencia',   // M  mínimo EM que aplicó
  'SKU base',            // N
  'Publicación',         // O  CLASICA / PREMIUM / OPEN BOX
  'Origen',              // P  EM / CVA
  'Referencia usada',    // Q  MINIMO / CUPON / —
  'Diferencia $',        // R  J − M
  'Diferencia %',        // S
  'Semáforo',            // T  OK / BAJO MINIMO / CUPON / PENDIENTE / SIN REFERENCIA / CVA / IGNORADO / INTERNA
  'Notas'                // U
]);
var W = { REF: 12, BASE: 13, PUB: 14, ORIGEN: 15, REFUSADA: 16,
          DIF: 17, PCT: 18, SEM: 19, NOTAS: 20 };   // índices 0-based
var N_COLS_WALMART = 21;

/* El histórico de alertas se escribe por encabezado: ver CAMPOS_ALERTA en Alertas.gs */

var ENC_LOG = ['Hora', 'Emoji', 'Nivel', 'Etapa', 'Mensaje', 'Detalles (JSON)'];

var ENC_CUPONES = ['SKU', 'Precio', 'Primera vez visto', 'Última vez visto'];

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
