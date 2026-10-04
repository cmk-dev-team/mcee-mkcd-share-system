"""子どものプログラムを、ブロックの見た目で出すための JSON UI とテクスチャを作る。

出力（--out にリソースパックのフォルダを渡す。省略時は cmk/rp/）:
  ui/server_form.json          タイトルが "cmk_code:" で始まるフォームだけ、見た目を差しかえる
  textures/cmk_code/<色>.png   角丸の帯（9スライス）。<色>.json に nineslice_size

行の指定は、ActionFormData のボタン1つ＝1行。
  ボタンの文字   … 行に出す文言
  ボタンのアイコン … "cmk_code:<種類>:<色>:<左の帯>"
     種類  body（ブロック）/ bot（くりかえし・チャットコマンドの下の帯）/ note（小さい文字）/ gap（すきま）
     色    p 青（プレイヤー）a 橙（エージェント）g 緑（くりかえし）k 黄緑（ブロック）m 紫（いきもの）b 茶（標準版）
     左の帯 "|1p|2g" のように、深さ番号と色をならべる（深さ4まで）
もとは たくのろじぃ先生の beta-2.0.0（resource-pack/ui/server_form.json）。
"""
import json, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(HERE, 'rp')

COLORS = {'p': '#0078D7', 'a': '#D83B01', 'g': '#569138', 'k': '#7ABB55', 'm': '#764BCC', 'b': '#A05A2C'}
RAIL_W = 8
ROW_H = 18
BOT_H = 7
MAX_DEPTH = 4
PREFIX = 'cmk_code:'


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def textures():
    d = os.path.join(OUT, 'textures', 'cmk_code')
    os.makedirs(d, exist_ok=True)
    for k, h in COLORS.items():
        c = hexrgb(h)
        dark = tuple(int(v * 0.75) for v in c)
        im = Image.new('RGBA', (12, 12), (0, 0, 0, 0))
        dr = ImageDraw.Draw(im)
        dr.rounded_rectangle([0, 0, 11, 11], radius=3, fill=c + (255,), outline=dark + (255,))
        im.save(os.path.join(d, f'{k}.png'))
        json.dump({'nineslice_size': 3, 'base_size': [12, 12]}, open(os.path.join(d, f'{k}.json'), 'w'))
        # 左の帯（くりかえし・チャットコマンドの内側）は角を丸めない
        im2 = Image.new('RGBA', (4, 4), c + (255,))
        im2.save(os.path.join(d, f'{k}_rail.png'))


def has(token):
    """ボタンのアイコン文字列に token が入っているか"""
    return f"(not ((#cmk_tex - '{token}') = #cmk_tex))"


TEX_BIND = {
    'binding_name': '#form_button_texture',
    'binding_name_override': '#cmk_tex',
    'binding_type': 'collection',
    'binding_collection_name': 'form_buttons',
}


def visible_if(expr):
    return [dict(TEX_BIND), {'binding_type': 'view', 'source_property_name': expr, 'target_property_name': '#visible'}]


def rails(height):
    """深さ1〜4の左の帯。深さ k・色 c の帯は、アイコンに "|kc" があるときだけ出る"""
    out = []
    for k in range(1, MAX_DEPTH + 1):
        for c in COLORS:
            out.append({f'rail_{k}{c}': {
                'type': 'image',
                'texture': f'textures/cmk_code/{c}_rail',
                'size': [RAIL_W, height],
                'bindings': visible_if(has(f'|{k}{c}')),
            }})
    return out


def ui():
    d = {'namespace': 'server_form'}

    # 元の long_form（バニラと同じ大きさ）。cmk_code: のフォームのときだけ隠す
    d['long_form@common_dialogs.main_panel_no_buttons'] = {
        '$title_panel': 'common_dialogs.standard_title_label',
        '$title_size': ['100% - 14px', 10],
        'size': [225, 200],
        '$text_name': '#title_text',
        '$title_text_binding_type': 'none',
        '$child_control': 'server_form.long_form_panel',
        'layer': 2,
        'bindings': [
            {'binding_name': '#title_text'},
            {'binding_type': 'view', 'source_property_name': f"((#title_text - '{PREFIX}') = #title_text)",
             'target_property_name': '#visible'},
        ],
    }

    d['main_screen_content'] = {'modifications': [{
        'array_name': 'controls',
        'operation': 'insert_back',
        'value': [{'cmk_code_factory': {
            'type': 'panel',
            'factory': {'name': 'server_form_factory', 'control_ids': {'long_form': '@server_form.cmk_code_form'}},
        }}],
    }]}

    d['cmk_code_title'] = {
        'type': 'label',
        'anchor_from': 'top_middle', 'anchor_to': 'top_middle',
        'size': ['100% - 14px', 10],
        'color': [0.3, 0.3, 0.3],
        'text': '#cmk_title',
        'bindings': [
            {'binding_name': '#title_text'},
            {'binding_type': 'view', 'source_property_name': f"(#title_text - '{PREFIX}')",
             'target_property_name': '#cmk_title'},
        ],
    }

    d['cmk_code_form@common_dialogs.main_panel_no_buttons'] = {
        '$title_panel': 'server_form.cmk_code_title',
        '$title_size': ['100% - 14px', 10],
        'size': [440, 260],
        '$text_name': '#title_text',
        '$title_text_binding_type': 'none',
        '$child_control': 'server_form.cmk_code_scroll',
        'layer': 3,
        'bindings': [
            {'binding_name': '#title_text'},
            {'binding_type': 'view', 'source_property_name': f"(not ((#title_text - '{PREFIX}') = #title_text))",
             'target_property_name': '#visible'},
        ],
    }

    d['cmk_code_scroll@common.scrolling_panel'] = {
        'anchor_to': 'top_left', 'anchor_from': 'top_left',
        '$show_background': False,
        'size': ['100%', '100%'],
        '$scrolling_content': 'server_form.cmk_code_rows',
        '$scroll_size': [5, '100% - 4px'],
        '$scrolling_pane_size': ['100% - 4px', '100% - 2px'],
        '$scrolling_pane_offset': [2, 0],
        '$scroll_bar_right_padding_size': [0, 0],
    }

    d['cmk_code_rows'] = {
        'type': 'stack_panel',
        'orientation': 'vertical',
        'size': ['100% - 12px', '100%c'],
        'anchor_from': 'top_left', 'anchor_to': 'top_left',
        'offset': [6, 6],
        'factory': {'name': 'buttons', 'control_ids': {
            'button': '@server_form.cmk_code_row', 'label': '@server_form.cmk_code_row',
            'header': '@server_form.cmk_code_row', 'divider': '@server_form.cmk_code_row'}},
        'collection_name': 'form_buttons',
        'bindings': [{'binding_name': '#form_button_contents', 'binding_name_override': '#collection_length'}],
    }

    text_bind = {'binding_name': '#form_button_text', 'binding_type': 'collection',
                 'binding_collection_name': 'form_buttons'}

    # ブロック（色ごと）
    bodies = []
    for c in COLORS:
        bodies.append({f'body_{c}': {
            'type': 'panel',
            'size': ['100%c', ROW_H],
            'bindings': visible_if(has(f':body:{c}:')),
            'controls': [
                {'text_box': {
                    'type': 'panel',
                    'size': ['100%c + 12px', ROW_H],
                    'layer': 2,
                    'controls': [{'text': {
                        'type': 'label',
                        'anchor_from': 'left_middle', 'anchor_to': 'left_middle',
                        'offset': [6, 0],
                        'size': ['default', 10],
                        'color': [1, 1, 1],
                        'shadow': False,
                        'text': '#form_button_text',
                        'bindings': [dict(text_bind)],
                    }}],
                }},
                {'bg': {
                    'type': 'image',
                    'texture': f'textures/cmk_code/{c}',
                    'size': ['100%sm', '100%sm'],
                    'layer': 1,
                }},
            ],
        }})

    bots = []
    for c in COLORS:
        bots.append({f'bot_{c}': {
            'type': 'image',
            'texture': f'textures/cmk_code/{c}',
            'size': [56, BOT_H],
            'bindings': visible_if(has(f':bot:{c}:')),
        }})

    d['cmk_code_row'] = {
        'type': 'stack_panel',
        'orientation': 'vertical',
        'size': ['100%', '100%c'],
        'bindings': [{'binding_type': 'collection_details', 'binding_collection_name': 'form_buttons'}],
        'controls': [
            {'row_body': {
                'type': 'stack_panel', 'orientation': 'horizontal',
                'size': ['100%', ROW_H],
                'bindings': visible_if(has(':body:')),
                'controls': rails(ROW_H) + bodies,
            }},
            {'row_bot': {
                'type': 'stack_panel', 'orientation': 'horizontal',
                'size': ['100%', BOT_H],
                'bindings': visible_if(has(':bot:')),
                'controls': rails(BOT_H) + bots,
            }},
            {'row_note': {
                'type': 'label',
                'size': ['100%', 12],
                'color': [0.35, 0.35, 0.35],
                'font_scale_factor': 0.8,
                'text': '#form_button_text',
                'bindings': [dict(text_bind)] + visible_if(has(':note:')),
            }},
            {'row_gap': {
                'type': 'panel',
                'size': ['100%', 10],
                'bindings': visible_if(has(':gap:')),
            }},
        ],
    }
    os.makedirs(os.path.join(OUT, 'ui'), exist_ok=True)
    json.dump(d, open(os.path.join(OUT, 'ui', 'server_form.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


if __name__ == '__main__':
    textures()
    ui()
    print('wrote', OUT)
