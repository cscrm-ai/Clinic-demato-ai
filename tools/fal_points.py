"""Detecção de pontos X,Y em imagens via FAL AI (Moondream3).

Utilizada pelo agente Dra. Sync para localizar achados clínicos
em fotografias de pele.
"""

import base64
import os
from pathlib import Path

import fal_client

# Garante que a FAL_KEY não tenha whitespace/newline no valor
_fal_key = os.environ.get("FAL_KEY", "").strip()
if _fal_key:
    os.environ["FAL_KEY"] = _fal_key


def _image_to_data_uri(path: str) -> str:
    """Converte um arquivo local de imagem para data URI (base64)."""
    p = Path(path)
    ext = p.suffix.lower()
    mime_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }
    mime = mime_map.get(ext, "image/jpeg")
    data = p.read_bytes()
    b64 = base64.b64encode(data).decode()
    return f"data:{mime};base64,{b64}"


def get_moondream_points(img_path: str, query: str) -> dict:
    """Chama Moondream3 via FAL AI para obter coordenadas X,Y de um achado."""
    if img_path.startswith(("http://", "https://")):
        image_url = img_path
    else:
        image_url = _image_to_data_uri(img_path)

    print(f"[MOONDREAM3] Query: '{query}'")

    result = fal_client.subscribe(
        "fal-ai/moondream3-preview/point",
        arguments={"image_url": image_url, "prompt": query},
    )

    points = result.get("points", [])
    if points:
        pt = points[0]
        print(f"[MOONDREAM3] Ponto: x={pt['x']:.4f}, y={pt['y']:.4f}")
        return {"x": pt["x"], "y": pt["y"]}

    print("[MOONDREAM3] Nenhum ponto detectado")
    return {"x": 0, "y": 0}
