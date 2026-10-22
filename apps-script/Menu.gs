/**
 * VENTA DIARIA ODOO 2026 — Menú
 * Apps Script solo admite UN onOpen por proyecto: todo el menú va aquí.
 *
 * Solo lo que se usa. Lo demás corre solo con los triggers:
 *   · ventas pendientes de Walmart → se revisan en cada importación
 *   · correo de ventas CVA          → sale solo, una vez al día (8 am)
 *   · hojas del sistema             → se crean solas si faltan
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ Venta Diaria')
      .addItem('🔄 Importar ventas de Odoo ahora', 'importarVentasAhora')
      .addItem('🔄 Traer killers de Site Sheet y actualizar KILLERS ACTIVOS', 'actualizarActivos')
      .addItem('✅ Comparar KILLERS ACTIVOS contra Walmart', 'compararConWalmart')
      .addItem('📤 Actualizar EXPORTAR, MINIMO y MAXIMO', 'exportarPreciosWalmart')
      .addSeparator()
      .addSubMenu(ui.createMenu('🔥 Killers')
        .addItem('🎯 Procesar killers pegados (respaldo manual)', 'procesarKillers')
        .addItem('📅 Reporte de killers del mes', 'reporteKillersMes'))
      .addSubMenu(ui.createMenu('💲 Precios')
        .addItem('💲 Actualizar PRECIOS ERIK desde Site Sheet', 'actualizarPreciosMinimos'))
      .addSubMenu(ui.createMenu('🏬 Ventas y Walmart')
        .addItem('🔎 Buscar ventas (pegadas en BUSCAR VENTAS)', 'buscarVentas')
        .addItem('📦 Revisar sobreventa (Walmart)', 'revisarSobreventa')
        .addItem('📊 Resumen de Walmart', 'resumenWalmart'))
      .addSubMenu(ui.createMenu('🛠️ Mantenimiento')
        .addItem('🩺 Diagnóstico', 'diagnostico')
        .addItem('🗂️ Ordenar hojas e índice', 'orgOrdenar')
        .addItem('🧹 Limpiar hojas que no uso…', 'limpiarHojas'))
      .addSubMenu(ui.createMenu('Configuración')
        .addItem('🔌 Configurar Odoo…', 'configurarOdoo')
        .addItem('🧪 Probar conexión a Odoo', 'probarOdoo')
        .addItem('⚙️ Configurar bandas de alerta de precios…', 'configurarBandasAlerta')
        .addItem('🔑 Configurar API de Walmart…', 'configurarWalmart')
        .addItem('🧪 Probar un pedido en la API de Walmart', 'probarPedidoWalmart')
        .addItem('⏱️ Instalar / reinstalar triggers', 'instalarTriggers'))
    .addToUi();
}
