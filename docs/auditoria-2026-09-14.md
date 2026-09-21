# Auditoría del libro Venta Diaria Odoo 2026 — 14/09/2026

Revisión completa del libro `17S65PqXK1DfJeHloJ4IFt-3K-MnQKOQaN_BiE9RUYaw`
antes de la reescritura del Apps Script.

---

## 1 · El error que estaba tirando la importación

Última entrada del log del libro, 14/09/2026 08:08:49:

```
✖ ERROR | AUTO
Exception: Esta acción aumentará el número de celdas del libro de trabajo
por encima del límite de 10000000 celdas.
  at escribirEnHoja_  (Código:723:48)
  at importarVentas_  (Código:457:3)
  at importarVentasAuto (Código:337:19)
```

En esa corrida detectó `{"total_odoo":40,"existentes":3352,"nuevos":40}`:
**bajó 40 órdenes nuevas de Odoo y no pudo escribir ninguna.**

No era un error de lógica ni de Odoo. El libro llegó al tope duro de
**10,000,000 de celdas** de Google Sheets, que cuenta filas × columnas de
*cada* hoja tenga datos o no.

---

## 2 · Por qué se topó: 76 hojas

| Bloque | Hojas | Estado |
|---|---|---|
| Hojas por canal (una por marketplace) | 15 | de todas, solo interesa `WALMART` |
| Hojas por cliente / vendedor | ~40 | **14 son duplicados** |
| Hojas vacías reservando cuadrícula completa | 2 | `PRECIOS ERIK` y un canal sin datos |
| Hojas de análisis / histórico | 4 | dos muertas desde 2025 |
| Log | 1 | vivo |

### Los 14 duplicados por cliente

Cada uno existe dos veces: una hoja vieja de 12 columnas (sin fila de
encabezado) y otra nueva de 13 columnas.

| Formato viejo (12 col, sin header) | Formato nuevo (13 col) |
|---|---|
| Josué Flores Ortega | JOSUE FLORES |
| Eric Suaents Álvarez | ERICK  SUAENTS |
| Moyao García Dante | DANTE MOYAO |
| José Luis Jasso Lara | José Luis Jasso |
| Jairo Kayam Nava Mejía | JAIRO NAVA |
| Ximena Barranco | Ximena Barranco Maya |
| Pablo Mercado Tinajero | Pablo Mercado |
| Dennis Alexander Ramírez G. | DENNIS RAMIREZ |
| Fabián Briones Cervantes | Fabian Briones |
| Armando Flores Ortega | ARMANDO FLORES |
| Walter Miguel González Ortega | Walter Ortega |
| Yanuar Ariel Archundia J. | ARIEL ARCHUNDIA |
| INSUMOS INTERNOS | INSUMOS |
| HECTOR OCHOA | (también como vendedor en otra hoja) |

---

## 3 · Desfases y datos corruptos encontrados

### `PRECIOS ERIK` — vacía y rota
- 26 columnas, encabezado presente, **94 filas sin un solo dato**.
- **`O1:Z1` son 12 `#N/A` seguidos**: una búsqueda horizontal (`BUSCARV` /
  `QUERY` / `IMPORTRANGE`) que tronó y arrastró las 12 columnas de análisis.
- Son los **únicos errores de fórmula de todo el libro** (0 `#REF!`,
  0 `#VALUE!`, 0 `#DIV/0!`, 0 `#NAME?`).
- Los encabezados están **sin acentos** ("ID Linea", "Numero", "Fecha
  creacion"), distinto al resto del libro: hoja de otra generación.

### `ALERTAS` — muerta y con columnas cruzadas
- Última alerta: **26/03/2026**. Lleva ~6 meses sin alimentarse.
- **Columnas B y C intercambiadas en varias filas**: hay renglones con
  `"Walter Ortega"` en la columna *SO* y `"VENTAS INTERNAS EM"` en *Cliente*.
- Números sin formato de moneda (`8279` en vez de `$8,279.00`), distinto de la
  hoja de comparación.

### `Venta diaria Odoo vs ERIK` — muerta desde 2025
- Última fila: **13/11/2025**, aunque el libro se llama "2026".
- Usa **filas-separadoras de mes** (`OCTUBRE`, `NOVIEMBRE`) en medio de los
  datos: cualquier fórmula de rango se rompe ahí.
- `DIFERENCIA = ERIK − VENTA` (verificado).

### Hoja de precios / Walmart
- Encabezado en **dos filas**.
- **Columnas E–M completamente vacías**: 13 columnas muertas en medio de dos
  bloques independientes pegados (A–D precios Clásica/Premium, N–Q killers).

### Datos que contaminan cualquier análisis de precios
- Líneas a **$0.00 y $1.00** con 50–100 piezas en `INSUMOS`, `INSUMOS INTERNOS`
  y `VENTAS INTERNAS EM` → movimientos internos, no ventas.
- Órdenes de prueba `PRUEBACVA` y `NuevaPruebaCVA` a `$1.00`.
- En `TiendaNube` y `TIKTOK SHOP` la columna M "Precio referencia" trae
  **texto (el nombre del producto)** en vez de un número.

### `HISTORICO` de precios
- 424 filas, **completa y sana**, sin fila de encabezado.
- `SKU | Precio | Fecha inicio | Fecha fin`, del 17/07/2026 al 06/09/2026.

---

## 4 · Qué se hizo

| Problema | Arreglo |
|---|---|
| Tope de 10M celdas | Botón 🧹 con borrado selectivo + 📐 compactar, y retención automática por hoja |
| 76 hojas | El proyecto solo usa 6; el resto se propone para borrar |
| `PRECIOS ERIK` con `#N/A` | Se eliminaron las fórmulas: el script escribe valores en `N` y `O–Z` |
| Precio de referencia poco confiable | Se toma del `Precios EM Minimo` de Site Sheet, ubicando columnas por texto de encabezado |
| Columnas B/C cruzadas en ALERTAS | Histórico nuevo con encabezado fijo y escritura por posición desde el script |
| Filas-separadoras de mes | No existen: la hoja es una tabla plana |
| Ventas internas contaminando | `esVentaComercial_()` las excluye de las alertas, pero siguen en `LOG VENTAS` |
| Alertas por correo a varias personas | Eliminadas. Único correo: ventas CVA a `victor.walmart.04@gmail.com` |
| Vendedores incorrectos | Regla eliminada del código |
| Riesgo de volver al tope | `CFG.RETENCION` recorta `LOG VENTAS` (365 d), `PRECIOS ERICK` (400 d) y `LOG` (2,000 filas) |

---

## 5 · Lo que no se pudo revisar

- **Los nombres literales de las pestañas** y **el texto de las fórmulas**: la
  API de Drive exporta valores, no fórmulas, y el libro es demasiado grande
  para exportarlo como `.xlsx` (`File too large for export`).
- **El código anterior**: la carpeta local estaba vacía y no había `.clasp.json`.
  Por eso el proyecto se reescribió completo en vez de parcharse.
