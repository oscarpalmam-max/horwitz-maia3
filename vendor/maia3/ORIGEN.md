# Maia3-5M: archivos publicados

Fuente: código https://github.com/CSSLab/maia3 (commit `1e13597c42d4858b7cfd7cfdae01e297263364b2`, 25-05-2026) y
pesos https://huggingface.co/UofTCSSLab/Maia3-5M (revisión `b6559de2398d7140b985f28fd2c19fb5e47ddabe`).
Artículo: «Chessformer: A Unified Architecture for Chess Modeling» (ICLR 2026), de Monroe, Eilender, Chalmers, Tang y
Anderson (CSSLab, Universidad de Toronto).

## Licencia

- **Código:** GNU Affero General Public License v3.0 (`LICENSE`, copia exacta del repositorio oficial).
- **Pesos:** la ficha de Hugging Face no declara una licencia propia («License: CC BY 4.0 (paper); see repo for
  code/weights license»), así que rige la del repositorio: **AGPL-3.0**.
- La AGPL permite usar, modificar y publicar el modelo, también en un sitio web, con estas condiciones:
  1. Quien recibe el modelo (aquí, quienes abren la página) debe poder obtener el «código fuente correspondiente»
     con la misma licencia: el checkpoint original y el código oficial (enlaces de arriba), el exportador
     (`herramientas/maia3-exportar.py`) y el código que lo ejecuta (`maia3-encoding.js`, `maia3-client.js` y la parte
     Maia3 de `maia-worker.js`, publicados sin minificar junto a la página). Esos archivos se rigen por la AGPL-3.0.
  2. Mantener este aviso y `LICENSE` junto al modelo, y no presentar el modelo convertido como si fuera el original:
     es una conversión a ONNX con los pesos en float16 (ver abajo).
  3. La AGPL no obliga a hacer público el repositorio: obliga a ofrecer el código a quienes usan la página. Si el
     resto de la página se considerara una obra combinada con Maia3, también tendría que ofrecerse con AGPL a esas
     personas. Por eso Maia3 queda en archivos propios, aparte de Maia-2 (MIT) y del resto, y detrás de una opción.

## Dónde se ofrece el código

Repositorio público con el código fuente correspondiente: https://github.com/oscarpalmam-max/horwitz-maia3
(enlazado desde la ayuda de «Jugar contra el rival» cuando el modelo activo es Maia3).

## Archivos

- Checkpoint `maia3-5m.pt` (no se publica): 20.968.049 bytes, SHA-256
  `ba14208b2992d85502f5fb501934abf6aaaeb355e9f3fdf90e326911f562524f`.
- **Modelo publicado:** `maia3_5m_fp16.onnx` (opset 17; pesos en float16 y cálculo en float32: cada peso pasa por un
  `Cast` al cargar; sin el cabezal de tiempo de reflexión), 10.867.453 bytes, SHA-256
  `49a0d9a8bfc5078b3e09aba35da5d72873c97019a99ea8b4a8136f7ae2d191b1`, dividido en 2 partes de hasta 8 MiB
  (`maia3_5m_fp16.parteN.bin`). `maia3-partes.json` trae tamaños y SHA-256; la página une y verifica como con Maia-2.
- Entradas: `tokens` float32 `[B,64,96]` (por casilla, 8 posiciones × 12 piezas, de la más antigua a la actual;
  con negras al turno el tablero va dado vuelta y con los colores cambiados), `elo_self` y `elo_oppo` float32 `[B]`
  (Elo de Lichess; el modelo lo limita a 0-5000, sin cubos). Salidas: `logits_move` `[B,4352]` (64×64 origen-destino
  y 256 coronaciones, mismo orden que `get_all_possible_moves()`) y `logits_value` `[B,3]` (derrota, tablas, victoria
  de quien mueve). El vocabulario se genera en `maia3-encoding.js` (SHA-256 de su JSON:
  `ca21429fb15d915ee05e6576f5f0023c2b8eeba5d1a5664e29f0c1ff20c08f18`, el mismo que el oficial).
- Sin historia (como la página hoy) se repite la posición actual, igual que el motor UCI oficial sin
  `--use-uci-history`.

## Por qué FP16 solo en los pesos

La conversión completa de `onnxconverter-common` deja tipos incompatibles en la atención y no carga. Guardar los pesos
en float16 y calcular en float32 deja el archivo en la mitad (FP32: 21.135.857 bytes) con la misma jugada más probable
que el código oficial en los 76 casos de `pruebas-web/fixtures/maia3-casos.json` y una diferencia máxima de
probabilidad de 0,0005. La medición completa está en `docs/medicion-maia3.md`.

## Reproducción

Python 3.12 o más nuevo, `torch` (CPU), `onnx==1.23.2`, `onnxruntime==1.31.1`, `numpy` y `python-chess`, en un
directorio fuera del repositorio:

```sh
git clone https://github.com/CSSLab/maia3 /tmp/maia3 && git -C /tmp/maia3 checkout 1e13597c42d4858b7cfd7cfdae01e297263364b2
curl -L -o /tmp/maia3-5m.pt https://huggingface.co/UofTCSSLab/Maia3-5M/resolve/main/maia3-5m.pt
python herramientas/maia3-exportar.py --codigo /tmp/maia3 --pesos /tmp/maia3-5m.pt --trabajo /tmp/maia3-onnx
python herramientas/maia3-referencia.py --codigo /tmp/maia3 --pesos /tmp/maia3-5m.pt --tokens 80 entrada.json salida.json
python herramientas/maia3-dividir.py /tmp/maia3-onnx/maia3_5m_fp16.onnx
```
