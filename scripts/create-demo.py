"""Rebuild the neutral bundled demo using only Python's standard library."""
from pathlib import Path
import json
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
SIZE = 320
COLORS = [('blue', 'Blue', '#507DB5'), ('green', 'Green', '#638272'), ('amber', 'Amber', '#BE8B48')]
SHAPES = [('circle', 'Circle'), ('square', 'Square'), ('triangle', 'Triangle')]


def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)


def make_image(shape, hex_color, target):
    color = tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    background = (246, 244, 238)
    pixels = bytearray()
    for y in range(SIZE):
        pixels.append(0)
        for x in range(SIZE):
            dx, dy = x - 160, y - 160
            if shape == 'circle':
                inside = dx * dx + dy * dy <= 96 * 96
            elif shape == 'square':
                inside = abs(dx) <= 88 and abs(dy) <= 88
            else:
                inside = 62 <= y <= 246 and abs(dx) <= (y - 62) * 0.58
            pixels.extend(color if inside else background)
    encoded = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', SIZE, SIZE, 8, 2, 0, 0, 0))
    encoded += chunk(b'IDAT', zlib.compress(bytes(pixels), 9)) + chunk(b'IEND', b'')
    target.write_bytes(encoded)


def main():
    assets = ROOT / 'assets' / 'demo'
    assets.mkdir(parents=True, exist_ok=True)
    data = {
        'meta': {'id': 'color-form-demo', 'title': 'Color and form',
                 'goal': 'Explore the demo, then load your own dataset to compare any visual alternatives.',
                 'rowsLabel': 'Forms', 'columnsLabel': 'Colors'},
        'rows': [{'id': key, 'name': name} for key, name in SHAPES],
        'columns': [{'id': key, 'name': name, 'attributes': {'hex': color}} for key, name, color in COLORS],
        'cells': []
    }
    for shape, _ in SHAPES:
        for key, _, color in COLORS:
            cell_id = f'{shape}--{key}'
            filename = f'{cell_id}.png'
            make_image(shape, color, assets / filename)
            data['cells'].append({'id': cell_id, 'row': shape, 'column': key, 'status': 'ready', 'src': f'assets/demo/{filename}'})
    serialized = json.dumps(data, indent=2)
    (ROOT / 'data.js').write_text('window.MATRIX_DATA = ' + serialized + ';\n')
    (ROOT / 'examples' / 'color-form.json').write_text(serialized + '\n')
    print('Rebuilt 9 neutral previews and their canonical dataset.')


if __name__ == '__main__':
    main()
