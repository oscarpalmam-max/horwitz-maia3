# Horwitz Lab · Maia3-5M en el navegador

Código fuente correspondiente de la parte **Maia3-5M** que usa la página Horwitz Lab, publicado para cumplir la
licencia **GNU AGPL-3.0** de Maia3 (ver `LICENSE`).

- Modelo original: [CSSLab/maia3](https://github.com/CSSLab/maia3) (commit `1e13597c42d4858b7cfd7cfdae01e297263364b2`)
  y pesos [UofTCSSLab/Maia3-5M](https://huggingface.co/UofTCSSLab/Maia3-5M) (revisión `b6559de2398d7140b985f28fd2c19fb5e47ddabe`).
  Artículo: «Chessformer: A Unified Architecture for Chess Modeling» (ICLR 2026), CSSLab, Universidad de Toronto.
- **Este repositorio no es el proyecto oficial.** El modelo que sirve la página es una conversión a ONNX (pesos en
  float16, cálculo en float32) hecha con `herramientas/maia3-exportar.py`; detalle y SHA-256 en `vendor/maia3/ORIGEN.md`.

## Archivos

| Archivo | Qué hace |
|---|---|
| `maia3-encoding.js` | Codifica posición, historia y Elo igual que el código oficial; vocabulario de 4.352 jugadas. |
| `maia3-client.js` | Cliente Maia3 en la página (misma interfaz que Maia-2). |
| `maia2-client.js` | Clase base del cliente, compartida con Maia-2 (incluida porque `maia3-client.js` la usa). |
| `maia-worker.js` | Worker que ejecuta el modelo con onnxruntime-web (Maia-2 y Maia3). |
| `herramientas/maia3-exportar.py` | Exporta el checkpoint oficial a ONNX. |
| `herramientas/maia3-dividir.py` | Divide el modelo en partes para servirlo. |
| `herramientas/maia3-referencia.py` | Probabilidades de referencia con el motor oficial. |
| `herramientas/maia3-comprobar-exportador.py`, `herramientas/maia3-modelo-prueba.py` | Pruebas del exportador. |
| `vendor/maia3/` | Origen, licencia y partes del modelo publicado. |

Estos archivos se distribuyen bajo AGPL-3.0. Cambios respecto del original: reimplementación en JavaScript de la
codificación y de la inferencia; exportación a ONNX opset 17 con RMSNorm en operaciones básicas; sin el cabezal de
tiempo de reflexión.
