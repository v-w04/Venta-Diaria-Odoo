/**
 * VENTA DIARIA ODOO 2026 — Menú
 * Apps Script solo admite UN onOpen por proyecto: todo el menú va aquí.
 *
 * Solo lo que se usa. Lo demás corre solo con los triggers:
 *   · ventas pendientes de Walmart → se revisan en cada importación
 *   · correo de ventas CVA          → sale solo, agrupado cada 20 min
 *   · hojas del sistema             → se crean solas si faltan
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ Venta Diaria')
      .addItem('🔄 Importar ventas de Odoo ahora', 'importarVentasAhora')
      .addItem('💲 Actualizar PRECIOS ERIK desde Site Sheet', 'actualizarPreciosMinimos')
      .addSeparator()
      .addItem('📊 Resumen de Walmart', 'resumenWalmart')
      .addItem('🩺 Diagnóstico', 'diagnostico')
      .addItem('🧹 Limpiar hojas que no uso…', 'limpiarHojas')
      .addSeparator()
      .addSubMenu(ui.createMenu('Configuración')
        .addItem('🔌 Configurar Odoo…', 'configurarOdoo')
        .addItem('🧪 Probar conexión a Odoo', 'probarOdoo')
        .addItem('⏱️ Instalar / reinstalar triggers', 'instalarTriggers'))
    .addToUi();
}
