/**
 * VENTA DIARIA ODOO 2026 — Menú
 * Apps Script solo admite UN onOpen por proyecto: todo el menú va aquí.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ Venta Diaria')
      .addItem('🔄 Importar ventas de Odoo ahora', 'importarVentasAhora')
      .addItem('💲 Actualizar PRECIOS ERIK desde Site Sheet', 'actualizarPreciosMinimos')
      .addItem('🔍 Revisar precios de Walmart pendientes', 'revisarPreciosWalmart')
      .addSeparator()
      .addItem('📊 Resumen de Walmart', 'resumenWalmart')
      .addItem('🩺 Diagnóstico', 'diagnostico')
      .addSeparator()
      .addItem('🧹 Limpiar hojas que no uso…', 'limpiarHojas')
      .addSeparator()
      .addItem('🟣 Mandar correo CVA pendiente', 'enviarCorreoCVAPendiente')
      .addSeparator()
      .addSubMenu(ui.createMenu('Configuración')
        .addItem('🔌 Configurar Odoo…', 'configurarOdoo')
        .addItem('🧪 Probar conexión a Odoo', 'probarOdoo')
        .addItem('🧪 Probar lectura de Site Sheet', 'probarPrecios')
        .addSeparator()
        .addItem('⏱️ Instalar / reinstalar triggers', 'instalarTriggers')
        .addItem('🗑️ Quitar todos los triggers', 'quitarTriggers')
        .addItem('📄 Crear hojas que falten', 'crearHojas'))
    .addToUi();
}
