"""ONNX ficticio diminuto con el contrato de Maia3 (maia-worker.js ?modelo=maia3); nunca se usa en la página.

Como maia2-diminuto.onnx: favorece e2e4 y su valor (victoria + tablas/2 de quien mueve) es 0,58.
Uso: python herramientas/maia3-modelo-prueba.py  (onnx==1.23.2)
"""
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import onnx
from onnx import TensorProto as T, helper as h, numpy_helper as n

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "pruebas-web/fixtures"
# Mismo orden que get_all_possible_moves() de Maia3 (y maia3-encoding.js): e2 = 12, e4 = 28.
logits = np.zeros((1, 4352), dtype=np.float32)
logits[0, 12 * 64 + 28] = 4
value = np.array([[math.log(0.42), -30.0, math.log(0.58)]], dtype=np.float32)
nodes = [h.make_node("ReduceMean", ["tokens"], ["mean"], axes=[1, 2], keepdims=0),
         h.make_node("Add", ["elo_self", "elo_oppo"], ["elos"]),
         h.make_node("Mul", ["elos", "zero"], ["zeros"]),
         h.make_node("Unsqueeze", ["zeros", "axes"], ["column"]),
         h.make_node("Add", ["column", "policy"], ["logits_move"]),
         h.make_node("Add", ["column", "value"], ["logits_value"])]
graph = h.make_graph(nodes, "Maia3 FICTICIA para pruebas",
    [h.make_tensor_value_info("tokens", T.FLOAT, ["B", 64, 96]), h.make_tensor_value_info("elo_self", T.FLOAT, ["B"]), h.make_tensor_value_info("elo_oppo", T.FLOAT, ["B"])],
    [h.make_tensor_value_info("logits_move", T.FLOAT, ["B", 4352]), h.make_tensor_value_info("logits_value", T.FLOAT, ["B", 3])],
    [n.from_array(logits, "policy"), n.from_array(np.array(0, np.float32), "zero"), n.from_array(value, "value"), n.from_array(np.array([1], np.int64), "axes")])
model = h.make_model(graph, opset_imports=[h.make_opsetid("", 17)], ir_version=8)
onnx.checker.check_model(model)
raw = model.SerializeToString()
(DEST / "maia3-diminuto.onnx").write_bytes(raw)
sha = hashlib.sha256(raw).hexdigest()
manifest = {"formato": 1, "modelo": "maia3-diminuto.onnx", "bytes": len(raw), "sha256": sha,
            "partes": [{"archivo": "maia3-diminuto.onnx", "bytes": len(raw), "sha256": sha}]}
(DEST / "maia3-diminuto.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Modelo ficticio: {len(raw)} bytes, {sha}.")
