"""Probabilidades de referencia de Maia3-5M con el código oficial (PyTorch), para comparar la página.

Entrada: JSON {"casos": [{"fen", "eloSelf", "eloOppo", "historia": [FEN anteriores, opcional]}]}.
Salida: el mismo JSON con "top" (hasta 20 [jugada, probabilidad] de Maia3UCIEngine.score_moves, temperatura 0),
"mejor" (la jugada elegida por el motor oficial) y, con --tokens, el tensor de entrada empaquetado en bits
(base64) para comparar maia3-encoding.js. Sin "historia" se usa el modo por defecto del motor oficial (la
posición actual repetida); con "historia" se usa el modo --use-uci-history.

Uso: python herramientas/maia3-referencia.py --codigo /tmp/maia3 --pesos /tmp/maia3-5m.pt entrada.json salida.json
Dependencias y licencia: herramientas/maia3-exportar.py y vendor/maia3/ORIGEN.md.
"""

import argparse
import base64
import importlib.util
import json
from collections import deque
from pathlib import Path


def exporter():
    spec = importlib.util.spec_from_file_location("exportar", Path(__file__).with_name("maia3-exportar.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--codigo", type=Path, required=True)
    parser.add_argument("--pesos", type=Path, required=True)
    parser.add_argument("--tokens", type=int, default=0, help="Incluye el tensor de entrada de los primeros N casos.")
    parser.add_argument("entrada", type=Path)
    parser.add_argument("salida", type=Path)
    args = parser.parse_args()
    ex = exporter()
    if ex.sha256(args.pesos) != ex.MAIA3_SHA256:
        parser.error("maia3-5m.pt no coincide con el SHA-256 publicado en Hugging Face.")
    import chess
    import numpy as np
    import torch

    torch.set_num_threads(1)
    uci, _model, _moves = ex.official(args.codigo)
    from maia3.dataset import tokenize_board

    cfg = uci.parse_args(["--model", "maia3-5m", "--device", "cpu", "--no-use-amp", "--checkpoint-path",
                          str(args.pesos), "--temperature", "0", "--multipv", "20"])
    engine = uci.Maia3UCIEngine(cfg)
    engine.ensure_model_loaded()
    data = json.loads(args.entrada.read_text())
    for i, case in enumerate(data["casos"]):
        engine.board = chess.Board(case["fen"])
        engine.self_elo, engine.oppo_elo = int(case["eloSelf"]), int(case["eloOppo"])
        history = case.get("historia") or []
        engine.cfg.use_uci_history = bool(history)
        engine.history = deque([tokenize_board(chess.Board(f)) for f in history] + [tokenize_board(engine.board)],
                               maxlen=cfg.history)
        with torch.no_grad():
            move, top = engine.score_moves()
        case["mejor"] = move.uci() if move else None
        case["top"] = [[item["move"].uci(), round(float(item["policy"]), 6)] for item in top]
        if i < args.tokens:
            tokens = engine._tokens_from_history(engine.history)[:, :12 * cfg.history].numpy()
            case["tokens"] = base64.b64encode(np.packbits(tokens.astype(np.uint8).reshape(-1))).decode()
    data["fuente"] = "CSSLab/maia3 " + ex.MAIA3_COMMIT + ", Maia3UCIEngine.score_moves, maia3-5m.pt"
    args.salida.write_text(json.dumps(data, ensure_ascii=False) + "\n")
    print(f"{len(data['casos'])} casos → {args.salida}")


if __name__ == "__main__":
    main()
