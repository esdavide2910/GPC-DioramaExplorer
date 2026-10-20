#!/usr/bin/env python3
"""
Convierte "voxel_blocks" entre dos formas:

  unfold  JSON (una capa por string)  ->  TXT desplegado (una fila por línea)
  fold    TXT desplegado              ->  JSON replegado (una capa por string)

Cada string del JSON es una capa (y); cada grupo separado por espacios es una fila (z).
En el TXT las capas se separan con una línea vacía (o con solo "//").

Uso:
    python voxel_layers.py unfold level1.json -o capas.txt
    python voxel_layers.py fold capas.txt -o capas.json
    python voxel_layers.py fold capas.txt --full        # con voxel_width/depth/height
    cat capas.txt | python voxel_layers.py fold          # lee de stdin, escribe en stdout
"""

import argparse
import json
import re
import sys


# ---------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------

def extract_layers(text):
    """JSON completo, fragmento con comillas, o una capa por línea -> lista de strings."""
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "voxel_blocks" in data:
            blocks = data["voxel_blocks"]
            return blocks if isinstance(blocks, list) else [blocks]
    except json.JSONDecodeError:
        pass

    layers = re.findall(r'"([^"]*)"', text)
    if layers:
        return layers

    return [line.strip().rstrip(",") for line in text.splitlines() if line.strip()]


def parse_txt(text):
    """TXT desplegado -> lista de capas, cada una con su lista de filas."""
    layers, rows = [], []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("//"):
            line = line[2:].strip()
        if line:
            rows.append(line.replace(" ", ""))
        elif rows:                      # línea vacía: cierra la capa
            layers.append(rows)
            rows = []
    if rows:
        layers.append(rows)
    return layers


# ---------------------------------------------------------------------------
# Conversión
# ---------------------------------------------------------------------------

def unfold(layers, prefix="// "):
    """Una fila por línea; capas separadas por una línea vacía (o solo el prefijo)."""
    lines = []
    for i, layer in enumerate(layers):
        if i > 0:
            lines.append(prefix.rstrip())
        lines.extend(prefix + row for row in layer.split())
    return "\n".join(lines)


def fold(layers, indent=4, full=False):
    """Capas (listas de filas) -> texto JSON con un string por capa."""
    strings = [" ".join(rows) for rows in layers]
    pad = " " * indent
    body = ",\n".join(f'{pad}"{s}"' for s in strings)

    if not full:
        return body

    w, d, h = dimensions(layers)
    return (
        f'"voxel_width": {w},\n'
        f'"voxel_depth": {d},\n'
        f'"voxel_height": {h},\n'
        f'"voxel_blocks": [\n{body}\n]'
    )


def dimensions(layers):
    """(ancho, fondo, alto) = (columnas x, filas z, capas y)."""
    width = max((len(row) for rows in layers for row in rows), default=0)
    depth = max((len(rows) for rows in layers), default=0)
    return width, depth, len(layers)


def check(layers):
    """Avisa por stderr si el nivel no es rectangular."""
    w, d, h = dimensions(layers)
    print(f"Dimensiones: voxel_width={w}, voxel_depth={d}, voxel_height={h}", file=sys.stderr)
    for y, rows in enumerate(layers):
        if len(rows) != d:
            print(f"  Aviso: la capa {y} tiene {len(rows)} filas (se esperaban {d})", file=sys.stderr)
        for z, row in enumerate(rows):
            if len(row) != w:
                print(f"  Aviso: capa {y}, fila {z} tiene {len(row)} celdas (se esperaban {w})", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def read_input(path):
    if path:
        with open(path, encoding="utf-8") as f:
            return f.read()
    return sys.stdin.read()


def write_output(text, path):
    if path:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"Guardado en {path}", file=sys.stderr)
    else:
        print(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_unfold = sub.add_parser("unfold", help="JSON -> TXT desplegado")
    p_unfold.add_argument("file", nargs="?", help="entrada (por defecto, stdin)")
    p_unfold.add_argument("-o", "--output", help="fichero de salida (por defecto, stdout)")
    p_unfold.add_argument("--prefix", default="// ", help='prefijo de cada línea (por defecto "// ")')

    p_fold = sub.add_parser("fold", help="TXT desplegado -> JSON replegado")
    p_fold.add_argument("file", nargs="?", help="entrada (por defecto, stdin)")
    p_fold.add_argument("-o", "--output", help="fichero de salida (por defecto, stdout)")
    p_fold.add_argument("--indent", type=int, default=4, help="espacios de sangría (por defecto 4)")
    p_fold.add_argument("--full", action="store_true",
                        help="incluye voxel_width, voxel_depth, voxel_height y los corchetes")

    args = parser.parse_args()
    text = read_input(args.file)

    if args.command == "unfold":
        write_output(unfold(extract_layers(text), args.prefix), args.output)
    else:
        layers = parse_txt(text)
        check(layers)
        write_output(fold(layers, args.indent, args.full), args.output)


if __name__ == "__main__":
    main()
