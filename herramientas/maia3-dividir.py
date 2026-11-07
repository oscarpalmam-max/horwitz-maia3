"""Divide maia3_5m_fp16.onnx en partes de 8 MiB para Cloudflare Pages (25 MiB por archivo).

Uso: python herramientas/maia3-dividir.py /ruta/fuera/del/repo/maia3_5m_fp16.onnx
Escribe vendor/maia3/maia3_5m_fp16.parteN.bin y vendor/maia3/maia3-partes.json con tamaños
y SHA-256 (de cada parte y del archivo completo); borra las partes anteriores. Igual que la base
publicada (herramientas/dividir-base.py, que no se toca).
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "vendor" / "maia3"
PART = 8 * 1024 * 1024
NAME = "maia3_5m_fp16"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1]).resolve()
    data = source.read_bytes()
    for old in DEST.glob(NAME + ".parte*.bin"):
        old.unlink()
    parts = []
    for i in range(0, len(data), PART):
        chunk = data[i:i + PART]
        name = f"{NAME}.parte{len(parts) + 1}.bin"
        (DEST / name).write_bytes(chunk)
        parts.append({"archivo": name, "bytes": len(chunk), "sha256": hashlib.sha256(chunk).hexdigest()})
    manifest = {"formato": 1, "modelo": NAME + ".onnx", "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(), "partes": parts}
    (DEST / "maia3-partes.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(json.dumps({k: v for k, v in manifest.items() if k != "partes"} | {"partes": len(parts)}))


if __name__ == "__main__":
    main()
