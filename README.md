# COSECHA App

Una sola app, cuatro pestañas, un perfil y una meta compartidos:

- **Hoy** — tu día de un vistazo: consumido vs meta y las tres acciones.
- **Pedir** — arma un plato del restaurante a tu medida (macros exactos, precio y QR para cocina). En esta copia el envío a cocina está en **modo demo**: no se registra ningún pedido real.
- **Diario** — registra lo que comes en casa; el plato de Pedir entra con un toque.
- **Entrenar** — registra tus pesas con descanso automático al marcar cada serie.

**App publicada:** https://robertoer215.github.io/cosecha-app-v4/

Tus datos (comidas, entrenamientos, perfil) viven solo en tu dispositivo; puedes exportarlos e importarlos como JSON desde el Diario.

## Correr en local

```bash
npm run dev    # sirve la raíz en http://localhost:3000
npm test       # node --test tests/*.test.mjs
```

Sin build y sin dependencias: HTML + CSS + módulos ES. GitHub Pages sirve la raíz de `main`.

## Actualizar la base de alimentos

La fuente maestra es **`COSECHA_Base_Alimentos.xlsx` en el Drive de Roberto** (hojas `Alimentos`, `Porciones`, `Fuentes`, `Leeme`). Flujo:

1. Edita el Excel en Drive (añade filas con su `fuente`, `id_fuente` y `licencia`; sin esos tres campos la fila no entra).
2. Descárgalo y regenera el JSON que carga la app:
   ```bash
   python3 scripts/excel_a_json.py ruta/al/COSECHA_Base_Alimentos.xlsx
   ```
   El script valida el esquema y escribe `data/alimentos.json`.
3. Commit y push a `main`: Pages publica el cambio.

Mientras la base grande (USDA, ≥1.500 alimentos) termina de generarse, `data/alimentos.json` contiene la base mínima de la carta COSECHA (37 alimentos, `scripts/base_minima_carta.mjs`). El generador completo vive en `scripts/generar_base.py`; las descargas crudas de USDA no se versionan.

## Datos de entrenamiento

- `data/ejercicios.json` — free-exercise-db traducido al español de México (dominio público, Unlicense). Las imágenes se cargan bajo demanda desde su CDN; no viven en el repo. Regenerar: `node scripts/fusionar_ejercicios.mjs <dir de chunks>`.
- `data/rutinas.json` — rutinas de autor (nivel × objetivo × equipo), editables al usarlas.

## Licencias y fuentes

Ver `docs/licencias.md`: USDA FoodData Central (CC0 1.0), free-exercise-db (Unlicense), carta COSECHA (propia). Ningún dato nutricional se inventa: cada alimento lleva fuente, id y licencia, y los valores que se desvían de 4P+4C+9G en más de 15 % van marcados, no corregidos.

## Para desarrolladores

- Contexto, arquitectura y reglas de negocio: `CLAUDE.md` (la sección "NO cambiar sin avisar" es ley).
- Estado de la entrega, decisiones y pendientes: `ENTREGA.md`.
- Diseño de los módulos Diario/Entrenar: `docs/diseno-modulos.md`.
- El flujo de n8n del modo IA (solo en producción, no en esta copia): `n8n/README.md`.
