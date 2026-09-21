# Venta Diaria Odoo 2026

Apps Script del libro **Venta Diaria Odoo 2026**
(`17S65PqXK1DfJeHloJ4IFt-3K-MnQKOQaN_BiE9RUYaw`), cuenta `victor.walmart.04@gmail.com`.

Reescrito desde cero el **14/09/2026**. El proyecto anterior estaba tirado por el
tope de 10,000,000 de celdas del libro y arrastraba 76 hojas, 14 duplicados por
cliente, una hoja `PRECIOS ERIK` con 12 `#N/A` y dos hojas muertas desde 2025.

---

## Para qué sirve ahora

Solo dos cosas importan: **Walmart** y **CVA**.

| Necesidad | Cómo se resuelve |
|---|---|
| Ventas de Walmart, con su precio mínimo al lado | hoja `PRECIOS ERICK` |
| Saber cuándo se vendió por debajo del mínimo | hoja `HISTORICO ALERTAS`, solo consulta |
| Ventas de producto CVA (`-CVA`), de cualquier plataforma | hoja `PEDIDOS CVA` + correo |
| Registro de ventas de todas las plataformas, sin análisis | hoja `LOG VENTAS` |

**No manda alertas por correo a nadie.** El único correo del proyecto es el aviso
de ventas CVA, y va exclusivamente a `victor.walmart.04@gmail.com`.

---

## Las 6 hojas (y ninguna más)

| Hoja | Qué trae | Se borra |
|---|---|---|
| `WALMART` | ventas del canal WALMART, 13 columnas de Odoo | nunca |
| `LOG VENTAS` | TODAS las plataformas, crudo, sin análisis | > 365 días |
| `PRECIOS ERICK` | ventas de Walmart + precio mínimo EM + análisis (26 cols) | > 400 días |
| `HISTORICO ALERTAS` | ventas por debajo del mínimo | nunca |
| `PEDIDOS CVA` | ventas de SKUs `-CVA` | nunca |
| `LOG` | bitácora del script (la lee Monitor EM) | > 2,000 filas |

La retención es lo que evita volver al tope de celdas. Está en `CFG.RETENCION`.

### Columnas de ventas (A–M)

```
A ID Línea | B Número (SO) | C Fecha creación | D Cliente | E Vendedor
F Estado SO | G SKU | H Producto | I Cantidad | J Precio unitario
K Importe línea | L Total orden | M Precio referencia
```

`D Cliente` es el canal: `WALMART`, `ML ELECTRONICS`, `LIV`, `COPPEL`, etc.

### PRECIOS ERICK (26 columnas)

`A–L` son las mismas de arriba. `M` queda vacía a propósito (así estaba).
`N` es el precio mínimo. `O–Z` eran 12 fórmulas rotas; **ahora las escribe el
script con valores, no con fórmulas**:

```
N PRECIOS ERIK (mínimo EM)   O SKU base        P Publicación   Q Origen
R Mínimo aplicado            S Diferencia $    T Diferencia %  U Semáforo
V Precio normal              W Precio máximo   X Actualizado
Y Alertado                   Z Notas
```

Valores de `U Semáforo`: `OK` · `BAJO MINIMO` · `SIN REFERENCIA` · `CVA` · `IGNORADO`.

---

## De dónde salen los precios

Del libro **Site Sheet** (`1Yjwyyv7EF5CJ3tJ2DgGzXO7QHxyrC0aCCSj1MHL5AKY`),
hojas `Precios EM Minimo` / `Normal` / `Maximo`.

Las columnas se ubican **por el texto del encabezado** — `"Walmart Clásica"` y
`"Walmart Premium"` — nunca por letra. Si no aparecen, el script aborta en vez
de adivinar: eso es lo que rompió la hoja anterior.

Solo master **EM**. Los SKUs `-CVA` no se comparan contra el mínimo de EM: se
marcan `Origen = CVA` y se dejan pasar sin alerta.

### Cuándo se refresca

`revisarPreciosAuto` corre cada 15 min y mira el `Log` de Site Sheet. Si la
última etapa de precios trae la misma hora que la vez pasada, no hace nada. Si
cambió, vuelve a bajar los precios y **re-evalúa toda la hoja PRECIOS ERICK**.

> **Esto no gasta cuota de UrlFetch.** Leer otro Google Sheet va por la API de
> Sheets, que tiene su propia bolsa (300 lecturas/minuto), no por los
> 20,000 UrlFetch/día de la cuenta. Por eso se puede correr cada 15 minutos sin
> cargarle absolutamente nada a `soporte.electronics.inventario`.

---

## Consumo de cuota

```
importarVentasAuto   cada 10 min → 144 corridas × 3-5 llamadas ≈ 600/día
revisarPreciosAuto   cada 15 min →  96 corridas × 0 llamadas   =   0/día
                                                       TOTAL  ≈ 600/día
```

Contra los 20,000 de la cuenta: **3%**. La regla es quedar por debajo del 60%.

⚠️ Google **no publica** cuántas llamadas llevas. El contador del menú
(`🩺 Diagnóstico`) solo ve lo de este proyecto; los 20,000 son una sola bolsa
compartida con Cotizador, Cambio de Precios, MELI-ODOO, Site Sheet y WM_Inv de
esa misma cuenta. La única señal confiable es el error de Google.

El contador vive en `UserProperties`, nunca en `ScriptProperties`: ahí una
cuenta agotada bloquearía a todas las demás sin motivo.

---

## Menú

```
⚙️ Venta Diaria
  🔄 Importar ventas de Odoo ahora
  💲 Actualizar precios mínimos (Site Sheet)
  🔍 Revisar precios de Walmart
  ─────
  📊 Resumen de Walmart
  🩺 Diagnóstico
  ─────
  🧹 Limpiar hojas que no uso…
  ─────
  🟣 Mandar correo CVA pendiente
  ─────
  Configuración ▸ 🔌 Configurar Odoo…
                 ⏱️ Instalar / reinstalar triggers
                 🗑️ Quitar todos los triggers
                 🧪 Probar conexión a Odoo
                 📄 Crear hojas que falten
```

### 🧹 El botón de limpieza

Es también **el arreglo del error de las 10M celdas**. Abre un panel con todas
las hojas, sus celdas y por qué sobra cada una. Las 6 del sistema salen con
candado y no se pueden borrar. Dos herramientas:

- **Borrar seleccionadas** — con respaldo automático del libro antes.
- **📐 Compactar** — no borra ningún dato: recorta las filas y columnas vacías
  que cada hoja tiene reservadas de más. Suele liberar millones de celdas solo
  con eso.

---

## Puesta en marcha

1. `clasp login` con `victor.walmart.04@gmail.com`
2. Pegar el `scriptId` en `.clasp.json` (Apps Script → Configuración del proyecto)
3. `clasp push`
4. Recargar el libro → menú **⚙️ Venta Diaria**
5. `Configuración → 🔌 Configurar Odoo…` (URL, base, usuario, API key)
6. `Configuración → 🧪 Probar conexión a Odoo`
7. `🧹 Limpiar hojas que no uso…` → **📐 Compactar** primero, luego borrar
8. `Configuración → ⏱️ Instalar / reinstalar triggers`

### Credenciales

Nada de credenciales en el repo. Las 4 propiedades viven en Script Properties:

```
ODOO_URL   https://electronicsmexico.odoo.com
ODOO_DB    <base>
ODOO_USER  <usuario>
ODOO_PASS  <api key>
```

---

## Archivos

```
apps-script/
  appsscript.json
  Config.gs       constantes, hojas, reglas de negocio, retención
  Utils.gs        SKU base, tipo de publicación, celdas del libro, candados
  Log.gs          bitácora compatible con Monitor EM
  Odoo.gs         XML-RPC (ojo: <name>, nunca <n>), uid cacheado, contador
  Precios.gs      lee Site Sheet, tabla de precios, análisis de cada fila
  Importar.gs     baja las ventas y las reparte a las 4 hojas
  Alertas.gs      precios de Walmart e histórico (sin correo)
  CorreoCVA.gs    único correo del proyecto, único destinatario
  Limpieza.gs     borrar/compactar hojas + diagnóstico
  Limpieza.html   el panel del botón de limpieza
  Menu.gs         onOpen (Apps Script solo admite uno)
  Instalar.gs     triggers, configuración, pruebas
```

---

## Reglas de negocio que el código respeta

- SKU **premium** = termina en `-MSI` o `-MSI-2` … `-MSI-9`
- SKU **CVA** = contiene `-CVA`
- SKU **open box** = termina en `-OB` (el prefijo `OB-` es otra cosa: publicación vieja)
- Prefijos `RES-`, `WL-`, `OB-` → se ignoran siempre
- Las variantes `-2` … `-9` heredan el precio del SKU padre
- Ventas internas, insumos y pruebas (`$0`, `$1`) entran a `LOG VENTAS` pero
  **nunca** generan alerta
