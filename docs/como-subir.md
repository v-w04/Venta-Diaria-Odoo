# Cómo subir el código al libro

## Camino A — clasp (recomendado, 3 minutos)

1. Doble clic en **`0-CONFIGURAR.bat`**
   Instala clasp si falta, te pide el **Script ID**, te loguea y crea el repo git.

   El Script ID lo sacas así:
   `Libro → Extensiones → Apps Script → ⚙️ Configuración del proyecto → ID de la secuencia de comandos`

2. Doble clic en **`ACTUALIZAR TODO.bat`**
   Sube los 12 archivos a Apps Script y hace el commit.

3. Recarga el libro con **F5** → aparece el menú **⚙️ Venta Diaria**

De ahí en adelante, cada vez que cambie algo: solo `ACTUALIZAR TODO.bat`.

---

### Si clasp te sigue dando "argumento inválido"

Casi siempre es una de estas tres:

| Síntoma | Causa | Arreglo |
|---|---|---|
| `invalid argument` / `argumento inválido` en push | clasp **v3** ya no acepta `-f` | los `.bat` nuevos usan `--force` y reintentan sin flag |
| `Could not read API credentials` | no hay sesión | `1-clasp-login.bat` |
| `scriptId` inválido | `.clasp.json` trae el texto de relleno | `0-CONFIGURAR.bat` |

Para ver qué versión tienes: abre CMD y escribe `clasp --version`.
Si es 3.x y sigue peleando, baja a la estable:

```
npm install -g @google/clasp@2.4.2
```

---

## Camino B — copiar y pegar (sin clasp, ~10 minutos)

Si clasp no coopera, funciona igual de bien:

1. `Libro → Extensiones → Apps Script`
2. Borra los archivos que haya (o déjalos, van a quedar sin uso)
3. Por cada archivo de la carpeta `apps-script\`: **➕ → Secuencia de comandos**,
   ponle el nombre **sin la extensión** y pega el contenido.

   `Limpieza.html` es distinto: **➕ → HTML**, nómbralo `Limpieza`.

4. `appsscript.json`: activa
   `⚙️ Configuración → Mostrar el archivo de manifiesto appsscript.json en el editor`
   y pega el contenido.

Orden de captura (da igual, pero así es más fácil no perderse):

```
Config      Utils       Log        Odoo
Precios     Importar    Alertas    CorreoCVA
Limpieza    Limpieza.html (archivo HTML)
Menu        Instalar
appsscript.json (manifiesto)
```

5. Guarda, recarga el libro con F5 → menú **⚙️ Venta Diaria**

---

## Y después, en los dos casos

```
⚙️ Venta Diaria → Configuración → 🔌 Configurar Odoo…
⚙️ Venta Diaria → Configuración → 🧪 Probar conexión a Odoo
⚙️ Venta Diaria → 🧹 Limpiar hojas que no uso…   ← primero 📐 Compactar
⚙️ Venta Diaria → Configuración → ⏱️ Instalar triggers
```

La primera vez Google te va a pedir permisos: "Configuración avanzada →
Ir a Venta Diaria (no seguro)". Es normal, es tu propio script.
