"""ブロック・いきものを、MakeCode と同じアイコンと日本語名で出すための表を作る。

MakeCode for Minecraft の配布データ（target.json）から
  - enum Block / AnimalMob / MonsterMob など：番号 → 名前
  - *.jres：名前 → アイコン（PNG）
を取り、翻訳（minecraft/core-strings.json の ja）で日本語名にする。

アイコンは Minecraft の「グリフ」（font/glyph_XX.png。16x16 マスに並べた絵を、私用領域の文字 U+XX00〜 で出す）に詰める。
文字の中に絵が入るので、ブロックの帯の文言の中にそのまま並べられる。

出力:
  <rp>/font/glyph_E5.png 〜     グリフ（1枚 256 個、1マス 32px）
  cmk/codeIcons.js               番号 → "（グリフ）名前" の表。codeShare.js が読む
使い方:  python build_icons.py [--out <リソースパック>]
"""
import base64, io, json, os, re, sys, urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(HERE, 'rp')
CACHE = os.path.join(HERE, '.cache')
TARGET = 'https://cdn.makecode.com/commit/2fe2b363d368587a28e7167eedc3418bd102d197/target.json'  # v2.1.27（pxt 12.1.17）
JA = 'https://makecode.com/api/translations?lang=ja&filename=minecraft%2Fcore-strings.json&approved=true'
FIRST_PAGE = 0xE5  # glyph_E5 から使う（E0〜E4 はゲーム本体や他のパックが使うことがあるため避ける）
CELL = 32

ENUMS = ['Block', 'AnimalMob', 'MonsterMob', 'CreatureMob']


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        urllib.request.urlretrieve(url, p)
    return json.load(open(p, encoding='utf-8'))


def enum_members(src, enum):
    i = src.find(f'enum {enum} ' + '{')
    if i < 0:
        return []
    body = src[i:src.index('\n}', i)]
    return [(m.group(1), int(m.group(2))) for m in re.finditer(r'^\s*(\w+)\s*=\s*(-?\d+),?', body, re.M)]


def main():
    target = fetch(TARGET, 'target.json')
    ja = fetch(JA, 'ja.json')
    src, jres = '', {}
    for pkg in target['bundledpkgs'].values():
        for f, v in pkg.items():
            if f.endswith('.d.ts') or f.endswith('.ts'):
                src += '\n' + v
            elif f.endswith('.jres'):
                jres.update({k: v for k, v in json.loads(v).items() if k != '*'})

    entries = []  # (enum, member, value, ja, icon)
    for enum in ENUMS:
        for member, value in enum_members(src, enum):
            name = ja.get(f'{enum}.{member}|block') or member
            icon = jres.get(member, {}).get('icon') if isinstance(jres.get(member), dict) else None
            entries.append((enum, member, value, name, icon))

    pages = {}
    table = {'block': {}, 'mob': {}}
    n = 0
    for enum, member, value, name, icon in entries:
        glyph = ''
        if icon and icon.startswith('data:image/png;base64,'):
            im = Image.open(io.BytesIO(base64.b64decode(icon.split(',', 1)[1]))).convert('RGBA')
            im = im.resize((CELL, CELL), Image.LANCZOS if im.width > CELL else Image.NEAREST)
            page, cell = FIRST_PAGE + n // 256, n % 256
            sheet = pages.setdefault(page, Image.new('RGBA', (CELL * 16, CELL * 16), (0, 0, 0, 0)))
            sheet.paste(im, ((cell % 16) * CELL, (cell // 16) * CELL))
            glyph = chr(page * 256 + cell)
            n += 1
        kind = 'block' if enum == 'Block' else 'mob'
        if str(value) not in table[kind]:
            table[kind][str(value)] = [glyph, name]

    os.makedirs(os.path.join(OUT, 'font'), exist_ok=True)
    for page, sheet in pages.items():
        sheet.save(os.path.join(OUT, 'font', f'glyph_{page:02X}.png'))

    js = ('// build_icons.py が作る。手で直さない。\n'
          '// 番号 → [グリフ（アイコン）, 日本語名]。MakeCode for Minecraft v2.1.27 の表とアイコン\n'
          f'export const BLOCKS = {json.dumps(table["block"], ensure_ascii=False)};\n'
          f'export const MOBS = {json.dumps(table["mob"], ensure_ascii=False)};\n')
    open(os.path.join(HERE, 'codeIcons.js'), 'w', encoding='utf-8', newline='\n').write(js)
    print(f'blocks {len(table["block"])} / mobs {len(table["mob"])} / glyphs {n} / pages {[hex(p) for p in pages]}')


if __name__ == '__main__':
    main()
