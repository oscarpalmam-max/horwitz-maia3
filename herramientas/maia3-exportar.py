"""Exporta Maia3-5M oficial a ONNX FP32 y FP16, fuera del repositorio.

Usa el código oficial (CSSLab/maia3, commit MAIA3_COMMIT) y el checkpoint oficial
(UofTCSSLab/Maia3-5M, maia3-5m.pt, MAIA3_SHA256). El grafo conserva el forward oficial
y entrega solo la política y el valor: el cabezal de «tiempo de reflexión» no se usa.

Entradas: tokens float32 [B,64,96] (8 posiciones × 12 piezas por casilla, de la más antigua a la
actual, ver maia3-encoding.js), elo_self y elo_oppo float32 [B] (Elo de Lichess, 0-5000).
Salidas: logits_move [B,4352] (64×64 origen-destino + 256 coronaciones) y logits_value [B,3]
(derrota, tablas, victoria de quien mueve).

Uso (Python 3.12+, torch CPU, onnx==1.23.2, onnxruntime==1.31.1, onnxconverter-common==1.16.0,
python-chess):
  git clone https://github.com/CSSLab/maia3 /tmp/maia3 && git -C /tmp/maia3 checkout MAIA3_COMMIT
  curl -L -o /tmp/maia3-5m.pt https://huggingface.co/UofTCSSLab/Maia3-5M/resolve/main/maia3-5m.pt
  python herramientas/maia3-exportar.py --codigo /tmp/maia3 --pesos /tmp/maia3-5m.pt --trabajo /tmp/maia3-onnx
Luego: herramientas/maia3-referencia.py (comparación con el código oficial) y herramientas/maia3-dividir.py.
Licencia: el código y los pesos de Maia3 son AGPL-3.0 (vendor/maia3/ORIGEN.md).
"""

import argparse
import hashlib
import importlib.metadata
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIA3_COMMIT = "1e13597c42d4858b7cfd7cfdae01e297263364b2"
MAIA3_SHA256 = "ba14208b2992d85502f5fb501934abf6aaaeb355e9f3fdf90e326911f562524f"
NAMES = ["tokens", "elo_self", "elo_oppo", "logits_move", "logits_value"]


def sha256(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def outside_repository(path):
    path = Path(path).resolve()
    if path == ROOT or ROOT in path.parents:
        raise ValueError("Los pesos y los ONNX locales deben quedar fuera del repositorio.")
    return path


def official(code):
    """Importa el paquete oficial desde su carpeta clonada (no se copia código al repositorio)."""
    code = outside_repository(code)
    if str(code) not in sys.path:
        sys.path.insert(0, str(code))
    import maia3.uci as uci
    from maia3.models import MAIA3Model
    from maia3.utils import get_all_possible_moves
    return uci, MAIA3Model, get_all_possible_moves


def config(uci, checkpoint=None):
    args = ["--model", "maia3-5m", "--device", "cpu", "--no-use-amp"]
    if checkpoint:
        args += ["--checkpoint-path", str(checkpoint)]
    return uci.parse_args(args)


def weights_fp16(graph, minimum=1024):
    """Pesos guardados en float16 y cálculo en float32: cada peso grande pasa por un Cast al cargar.

    La conversión completa de onnxconverter-common deja tipos incompatibles en la atención de PyTorch;
    así el archivo pesa la mitad y las operaciones (normas, softmax, sesgos de atención) no pierden precisión.
    """
    import copy
    import numpy as np
    import onnx
    from onnx import helper, numpy_helper

    out = copy.deepcopy(graph)
    kept, casts = [], []
    for item in out.graph.initializer:
        if item.data_type == onnx.TensorProto.FLOAT and int(np.prod(item.dims)) >= minimum:
            half = numpy_helper.from_array(numpy_helper.to_array(item).astype(np.float16), item.name + "_fp16")
            kept.append(half)
            casts.append(helper.make_node("Cast", [half.name], [item.name], to=onnx.TensorProto.FLOAT,
                                          name="cast_" + item.name))
        else:
            kept.append(item)
    del out.graph.initializer[:]
    out.graph.initializer.extend(kept)
    nodes = list(out.graph.node)
    del out.graph.node[:]
    out.graph.node.extend(casts + nodes)
    return out


def export_model(model, output, history=8):
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch

    class RMS(torch.nn.Module):
        """torch.nn.RMSNorm escrito con operaciones de opset 17 (mismo épsilon y peso)."""

        def __init__(self, norm):
            super().__init__()
            self.weight = norm.weight
            self.eps = norm.eps

        def forward(self, x):
            eps = self.eps if self.eps is not None else torch.finfo(x.dtype).eps
            return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + eps) * self.weight

    def opset17(module):
        for name, child in module.named_children():
            if isinstance(child, torch.nn.RMSNorm):
                setattr(module, name, RMS(child))
            else:
                opset17(child)

    class PolicyValue(torch.nn.Module):
        def __init__(self, original):
            super().__init__()
            self.model = original.eval().cpu()

        def forward(self, tokens, elo_self, elo_oppo):
            move, value, _ponder = self.model(tokens, elo_self, elo_oppo)
            return move, value

    output = outside_repository(output)
    output.mkdir(parents=True, exist_ok=True)
    fp32 = output / "maia3_5m_fp32.onnx"
    fp16 = output / "maia3_5m_fp16.onnx"
    import copy

    baseline = PolicyValue(model).eval()
    wrapper = PolicyValue(copy.deepcopy(model)).eval()
    opset17(wrapper)
    width = 12 * history
    inputs = (torch.zeros(1, 64, width), torch.tensor([1900.0]), torch.tensor([2000.0]))
    with torch.inference_mode():
        torch.onnx.export(
            wrapper, inputs, str(fp32), opset_version=17, dynamo=False,
            input_names=NAMES[:3], output_names=NAMES[3:],
            dynamic_axes={name: {0: "B"} for name in NAMES},
        )
    graph = onnx.load(fp32)
    onnx.checker.check_model(graph)
    if any("ponder" in item.name for item in graph.graph.initializer):
        raise ValueError("El grafo conserva pesos del cabezal de tiempo.")
    onnx.save(weights_fp16(graph), str(fp16))
    onnx.checker.check_model(onnx.load(fp16))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    generator = torch.Generator().manual_seed(3)
    # Batch dinámico y paridad con PyTorch (tableros 0/1 al azar; la comparación con posiciones reales
    # está en maia3-referencia.py).
    for path in (fp32, fp16):
        session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
        if [item.name for item in session.get_inputs()] != NAMES[:3]:
            raise ValueError("Entradas ONNX inesperadas.")
        if [item.name for item in session.get_outputs()] != NAMES[3:]:
            raise ValueError("Salidas ONNX inesperadas.")
        for batch in (1, 2, 32):
            tokens = (torch.rand(batch, 64, width, generator=generator) > 0.93).float()
            own = 1100 + torch.arange(batch, dtype=torch.float32) * 37 % 1200
            opponent = 2400 - own
            actual = session.run(None, dict(zip(NAMES, [tokens.numpy(), own.numpy(), opponent.numpy()])))
            if actual[0].shape != (batch, 4352) or actual[1].shape != (batch, 3):
                raise ValueError(f"Dimensiones ONNX incorrectas para B={batch}.")
            if not all(np.isfinite(item).all() for item in actual):
                raise ValueError("El ONNX produjo valores no finitos.")
            with torch.inference_mode():
                expected = baseline(tokens, own.long(), opponent.long())
            tolerance = 1e-3 if path == fp32 else 5e-2
            for reference, result in zip(expected, actual):
                np.testing.assert_allclose(reference.numpy(), result, atol=tolerance, rtol=tolerance)
        del session
    return {path.name: {"bytes": path.stat().st_size, "sha256": sha256(path)} for path in (fp32, fp16)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--codigo", type=Path, required=True, help="Clon de CSSLab/maia3 fuera del repositorio.")
    parser.add_argument("--pesos", type=Path, required=True, help="maia3-5m.pt oficial, fuera del repositorio.")
    parser.add_argument("--trabajo", type=Path, required=True, help="Directorio local fuera del repositorio.")
    args = parser.parse_args()
    import torch

    torch.set_num_threads(1)
    if sha256(outside_repository(args.pesos)) != MAIA3_SHA256:
        parser.error("maia3-5m.pt no coincide con el SHA-256 publicado en Hugging Face.")
    uci, _model, get_all_possible_moves = official(args.codigo)
    moves = get_all_possible_moves()
    if len(moves) != 4352 or len(set(moves)) != 4352:
        raise ValueError("El vocabulario oficial de Maia3 cambió (se esperaban 4352 jugadas).")
    cfg = config(uci, args.pesos)
    model = uci.load_model(cfg)
    artifacts = export_model(model, outside_repository(args.trabajo), cfg.history)
    manifest = {
        "maia3": MAIA3_COMMIT, "opset": 17,
        "versions": {name: importlib.metadata.version(name) for name in ("torch", "onnx", "onnxruntime", "onnxconverter-common")},
        "maia3-5m.pt": {"sha256": MAIA3_SHA256, "bytes": args.pesos.stat().st_size},
        "vocabulario": hashlib.sha256(json.dumps(moves, separators=(",", ":")).encode()).hexdigest(),
        "artifacts": artifacts,
    }
    (outside_repository(args.trabajo) / "SHA256.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    print("Siguiente: herramientas/maia3-referencia.py y herramientas/maia3-dividir.py.")


if __name__ == "__main__":
    main()
