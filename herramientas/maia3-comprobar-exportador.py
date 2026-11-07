"""Prueba del exportador de Maia3 con la arquitectura oficial y pesos ALEATORIOS.

No descarga pesos ni produce un modelo publicable. Necesita un clon de CSSLab/maia3 en el commit de
herramientas/maia3-exportar.py (MAIA3_COMMIT) y las dependencias de vendor/maia3/ORIGEN.md.
Uso: python herramientas/maia3-comprobar-exportador.py /ruta/al/clon/maia3
"""
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

import torch


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    spec = importlib.util.spec_from_file_location("exportar", Path(__file__).with_name("maia3-exportar.py"))
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    code = Path(sys.argv[1]).resolve()
    commit = subprocess.run(["git", "-C", str(code), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    if commit != exporter.MAIA3_COMMIT:
        sys.exit(f"El clon de maia3 está en {commit}; el exportador espera {exporter.MAIA3_COMMIT}.")
    torch.set_num_threads(1)
    torch.manual_seed(15)
    uci, model_class, get_all_possible_moves = exporter.official(code)
    moves = get_all_possible_moves()
    assert len(moves) == 4352 and moves[12 * 64 + 28] == "e2e4" and moves[4096] == "a7a8q"
    cfg = exporter.config(uci)
    model = model_class(cfg).eval()
    # Los parámetros nuevos valen cero (gab, normas): se llenan al azar para que la prueba compare algo.
    with torch.no_grad():
        for parameter in model.parameters():
            parameter.normal_(0, 0.05)
    with tempfile.TemporaryDirectory(prefix="maia3-arquitectura-") as work:
        result = exporter.export_model(model, work, cfg.history)
        for name, info in result.items():
            print(f"{name}: {info['bytes']} bytes (pesos aleatorios, NO oficiales)")
    print("Correcto: arquitectura oficial, RMSNorm en opset 17, batch 1/2/32, FP32 y FP16 (pesos) coinciden con PyTorch.")


if __name__ == "__main__":
    main()
