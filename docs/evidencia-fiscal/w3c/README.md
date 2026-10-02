# Evidencia fiscal · W3-C C2 — conciliación histórica de precios

Artefactos de **evidencia**, no de ejecución. Nada de esta carpeta se importa
automáticamente ni forma parte del paquete de la aplicación: el frontend no la
referencia y ninguna migración la lee.

| archivo | qué es |
|---|---|
| `renovacell_conciliacion_precios_w3c.xlsx` | fuente original entregada por el dueño. 190 filas. No se modifica |
| `C2-MAP.csv` | resultado de C2-MAP: las 190 filas con su `product_id` canónico, el método determinista usado y la evidencia del match |
| `payload-evidencia-190.json` | payload normalizado que acepta `importar_evidencia_precios(op_id, filas)`, con **`product_id` de PRODUCCIÓN** |

## Qué dice y qué NO dice esta evidencia

Las clasificaciones son de **PRECIO**, nunca de impuesto:

- `HISTORICAL_BASE_PLUS_16` (159) — el precio del Excel × 1.16 ≈ el publicado.
  **No** autoriza tratar el producto como gravado al 16%.
- `HISTORICAL_EQUALS_FINAL` (20) — coinciden. **No** significa exento, tasa cero
  ni no objeto: la aritmética no distingue "el Excel ya traía el final" de "no es
  gravado al 16%". Eso lo resuelve el contador.
- `HISTORICAL_MISMATCH` (3) — ninguna relación reconcilia. Su identidad canónica
  sí se determinó: un desacuerdo de precio no invalida la identidad del producto.
- `NO_PUBLIC_REFERENCE` (8) — sin referencia en el listado público.

## Cómo se determinó el `product_id` (C2-MAP)

Probado con evidencia contra los 192 productos de producción:

- `Referencia interna` **no** corresponde a `products.sku`: 0 coincidencias de 190.
  Contiene presentaciones (`3% 5X2 ml Ampolletas`, `HUESO`, `100 UI`).
- La llave principal es la **igualdad exacta de una concatenación**:
  `products.name == "Nombre Excel" + " " + "Referencia interna"` → 123 filas.
  Es lo que distingue `HIDROLIZADO COSMETICO vial 8 ml HUESO` de
  `IMPLANTE COSMETICO 4.5 ML Hueso`, que `odoo_reference` solo no puede hacer
  porque ambos guardan `HUESO`.

Cascada completa, solo igualdades exactas, sin emparejamiento difuso:

| método | filas |
|---|---|
| `NOMBRE+REFERENCIA` | 123 |
| `NOMBRE_NORMALIZADO` | 29 |
| `REFERENCIA_ODOO` (única y corroborada por nombre/familia) | 18 |
| `AGRUPACION_PUBLICADA` (igual al nombre canónico y no repetida entre filas) | 8 |
| **sin mapear** | **12** |

Resultado: **178 mapeadas · 12 sin mapear · 0 colisiones · 0 `product_id` inventados.**

## Las 12 filas sin `product_id`

- **1 ambigua** — fila 191, `[GOLDEN PLACENTA] ULTRAFILTRADOS VIAL 2.5 ML`: el
  nombre histórico menciona dos familias distintas y la referencia es un empaque.
  `PEP-001` queda como candidato **solo como evidencia**.
- **5 con identidad histórica insuficiente** — filas 6, 21, 114, 115, 119
  (`BOTOX`, `HIDRLIZADO`, `Implante`, `Inno`, `Linurase`). En el archivo origen
  las columnas de estas filas están **desplazadas** y el nombre quedó truncado a
  la familia, sin presentación. Cuatro traen precio 0.
- **6 sin producto canónico** — `MOUNJARO PLUMA PRECARGADA` en sus cuatro dosis
  (123–126), `XELAJU N FILLER 2/2 ml` (186) y `XEOMEEN CORTESIA 100 u` a $0.01 (190).

Decisión del dueño: **no se crean productos para forzar un 190/190**. Si Renovacell
determina que alguno es vendible, se da de alta por el flujo normal del catálogo y
la evidencia se asocia después con una **corrección auditada** — una observación
nueva con el mismo `source_ref`, que conserva la original intacta.
