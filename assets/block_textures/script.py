from pathlib import Path
import shutil

import numpy as np
from PIL import Image

PBR_DIR = Path(".")
BACKUP_DIR = PBR_DIR / "originals"

GRASS_TINT = 0x7CBD6B
LEAVES_TINT = 0x619961

# Si el lateral de hierba no trae el flequillo verde ya pintado,
# pon aquí la ruta del overlay (o déjalo en None)
GRASS_SIDE_OVERLAY = None  # p. ej. PBR_DIR / "grass_block_side_overlay.png"


def hex_to_rgb(color):
    return ((color >> 16) & 255, (color >> 8) & 255, color & 255)


def tint(img, color):
    """Multiplica el RGB por el color y conserva el alfa original."""
    arr = np.asarray(img.convert("RGBA"), dtype=np.float32)
    factor = np.array(hex_to_rgb(color), dtype=np.float32) / 255.0
    arr[..., :3] *= factor
    return Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), "RGBA")


def load_original(name):
    """Lee siempre del backup, así el script se puede repetir sin tintar dos veces."""
    BACKUP_DIR.mkdir(exist_ok=True)
    src = PBR_DIR / f"{name}.png"
    backup = BACKUP_DIR / f"{name}.png"
    if not backup.exists():
        shutil.copy2(src, backup)
    return Image.open(backup).convert("RGBA")


def main():

    # Hojas de abeto
    tint(load_original("spruce_leaves"), LEAVES_TINT).save(PBR_DIR / "spruce_leaves.png")

    print("Texturas tintadas. Originales en", BACKUP_DIR)


if __name__ == "__main__":
    main()
