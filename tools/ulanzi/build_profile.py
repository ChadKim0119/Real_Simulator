#!/usr/bin/env python3
"""Ulanzi Studio 프리셋(.ulanziDeckProfile) 생성기 — Real Simulator 시연용 D200X 키 배치.

형식은 사용자 PC의 Ulanzi Studio(macOS)가 내보낸 실물 프리셋 파일을 기준으로 맞췄다.
  "#Version: 2\n" + ZIP (폴더 항목 포함)
  <프리셋 uuid>.ulanziProfile/
    manifest.json        {Device{Model:"D200X", UUID:기기}, Icon:"<이름>.png", Name, Pages{Current, Pages[]}, Version:"2.0"}
    <이름>.png           프리셋 아이콘 48×48
    Profiles/<페이지 uuid>/
      manifest.json      {Controllers:[{Type:"Encoder", Actions{…}}, {Type:"Keypad", Actions{…}}], Icon:"", Name}
      Files/             (비어 있음)
      Images/*.png       키 아이콘 196×196
  키 칸 "열_행": 행 0~2 = LCD 키(3_2는 2칸 너비 창), 행 3 = 아래 줄(0_3 · 1_3 버튼, 2_3~4_3 노브)
  키 동작:  Action "com.ulanzi.ulanzideck.system.hotkey", ActionParam{Hotkey:"⇧ R" | "→" | "A"},
            Plugin{Name:"System", UUID:"com.ulanzi.deck.system", Version:"1.0"}, ActionID(uuid)
  노브 동작: 같은 hotkey 동작, ActionParam{knob_rotate_left{Hotkey}, knob_rotate_right{…}, knob_press{…},
            knob_hold_left{}, knob_hold_right{}}
  단축키 표기는 macOS Ulanzi Studio 기준(⇧ ⌃ ⌥ ⌘, 화살표 ← → ↑ ↓).

사용:
  python3 tools/ulanzi/build_profile.py --device <기기 UUID> [--out 파일]
  기기 UUID는 Ulanzi Studio가 내보낸 프리셋의 manifest.json(Device.UUID)에 있다. 공개 저장소에는 넣지 않는다.
"""
import argparse
import io
import json
import os
import uuid
import zipfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(HERE, 'icons')
NAME = 'Real Simulator'

# 고정 uuid: 다시 만들어 가져와도 같은 프리셋 · 같은 키로 인식되도록
NS = uuid.UUID('6f1d7c2e-6a43-4c55-9d0e-52c0a1e0d201')
uid = lambda s: str(uuid.uuid5(NS, s))

# (칸, 아이콘, 단축키)
PAGES = [
    ('시연 진행', [
        ('0_0', 'p1-01', '←'), ('1_0', 'p1-02', '→'), ('2_0', 'p1-03', 'A'), ('3_0', 'p1-04', 'O'), ('4_0', 'p1-05', '⇧ R'),
        ('0_1', 'p1-06', '1'), ('1_1', 'p1-07', '2'), ('2_1', 'p1-08', '3'), ('3_1', 'p1-09', 'F'), ('4_1', 'p1-10', 'H'),
        ('0_2', 'p1-11', '4'), ('1_2', 'p1-13', '6'), ('2_2', 'p1-14', '7'),
    ]),
    ('장면 · Q&A', [
        ('0_0', 'p2-01', 'L'), ('1_0', 'p2-02', 'C'), ('2_0', 'p2-03', 'E'), ('3_0', 'p2-04', 'B'), ('4_0', 'p2-05', 'O'),
        ('0_1', 'p2-06', 'D'), ('1_1', 'p2-07', 'T'), ('2_1', 'p2-08', '8'), ('3_1', 'p2-09', '9'), ('4_1', 'p2-10', '0'),
        ('0_2', 'p2-11', '⇧ 1'), ('1_2', 'p2-12', '⇧ 2'), ('2_2', 'p2-13', '⇧ 3'),
    ]),
]
# 노브 (칸, 왼쪽, 오른쪽, 누르기): 노브 1 = 차량 시점, 노브 3 = 단계 이동. 노브 2(볼륨)는 Ulanzi Studio에서 직접.
KNOBS = [('2_3', '[', ']', '4'), ('4_3', '←', '→', 'A')]

SYSTEM = {'Name': 'System', 'UUID': 'com.ulanzi.deck.system', 'Version': '1.0'}
PAGES_PLUGIN = {'Name': 'Pages', 'UUID': 'com.ulanzi.deck.page', 'Version': '1.0'}


def key(pid, slot, img, hk):
    return {
        'Action': 'com.ulanzi.ulanzideck.system.hotkey',
        'ActionID': uid(f'{pid}/{slot}'),
        'ActionParam': {'Hotkey': hk},
        'LinkedTitle': False,
        'Name': 'Hotkey',
        'Plugin': SYSTEM,
        # 아이콘에 글자가 들어 있어 제목은 비운다
        'ViewParam': [{'Icon': img, 'IconRel': img, 'Text': ''}],
    }


def knob(pid, slot, left, right, press):
    return {
        'Action': 'com.ulanzi.ulanzideck.system.hotkey',
        'ActionID': uid(f'{pid}/{slot}'),
        'ActionParam': {'knob_hold_left': {}, 'knob_hold_right': {}, 'knob_press': {'Hotkey': press},
                        'knob_rotate_left': {'Hotkey': left}, 'knob_rotate_right': {'Hotkey': right}},
        'LinkedTitle': False,
        'Name': 'Hotkey',
        'Plugin': SYSTEM,
        'ViewParam': [{'IconRel': '', 'Text': f'{left} {right}'}],
    }


def build(device, out):
    pid0 = uid('profile')
    root = f'{pid0}.ulanziProfile'
    page_ids = [uid(f'page{i}') for i in range(len(PAGES))]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        def d(path):                                   # folder entries, as Ulanzi Studio writes them
            zi = zipfile.ZipInfo(path + '/')
            zi.external_attr = 0o40755 << 16
            z.writestr(zi, b'')
        def f(path, data):
            zi = zipfile.ZipInfo(path)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o100644 << 16
            z.writestr(zi, data)
        d(root); d(f'{root}/Profiles')
        for pid, (pname, keys) in zip(page_ids, PAGES):
            base = f'{root}/Profiles/{pid}'
            d(base); d(f'{base}/Files'); d(f'{base}/Images')
            pad = {}
            for slot, icon, hk in keys:
                img = f'Images/{icon}.png'
                f(f'{base}/{img}', open(os.path.join(ICONS, f'{icon}.png'), 'rb').read())
                pad[slot] = key(pid, slot, img, hk)
            # 아래 줄 버튼: 이전 · 다음 페이지
            pad['0_3'] = {'Action': 'com.ulanzi.ulanzideck.page.prev', 'ActionID': uid(f'{pid}/0_3'), 'ActionParam': {},
                          'LinkedTitle': True, 'Name': 'Previous page', 'Plugin': PAGES_PLUGIN, 'ViewParam': [{'IconRel': ''}]}
            pad['1_3'] = {'Action': 'com.ulanzi.ulanzideck.page.next', 'ActionID': uid(f'{pid}/1_3'), 'ActionParam': {},
                          'LinkedTitle': True, 'Name': 'Next page', 'Plugin': PAGES_PLUGIN, 'ViewParam': [{'IconRel': ''}]}
            # 2칸 너비 창: 견본과 같은 배경 모드 (Ulanzi Studio에서 시계로 바꿀 수 있다)
            pad['3_2'] = {'Action': 'com.ulanzi.ulanzideck.smallwindow.window', 'ActionID': uid(f'{pid}/3_2'),
                          'ActionParam': {'SmallViewMode': 100}, 'LinkedTitle': True, 'Name': 'Background setting',
                          'Plugin': {}, 'ViewParam': [{'Icon': ''}]}
            enc = {slot: knob(pid, slot, l, r, p) for slot, l, r, p in KNOBS}
            f(f'{base}/manifest.json', json.dumps({
                'Controllers': [{'Actions': enc, 'Type': 'Encoder'}, {'Actions': pad, 'Type': 'Keypad'}],
                'Icon': '', 'Name': pname,
            }, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        # 프리셋 아이콘 48×48 (다음 키 아이콘을 줄여서)
        ic = io.BytesIO()
        Image.open(os.path.join(ICONS, 'p1-02.png')).convert('RGBA').resize((48, 48), Image.LANCZOS).save(ic, 'PNG')
        f(f'{root}/{NAME}.png', ic.getvalue())
        f(f'{root}/manifest.json', json.dumps({
            'Device': {'Model': 'D200X', 'UUID': device},
            'Icon': f'{NAME}.png', 'Name': NAME,
            'Pages': {'Current': page_ids[0], 'Pages': page_ids},
            'Version': '2.0',
        }, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    with open(out, 'wb') as fh:
        fh.write(b'#Version: 2\n' + buf.getvalue())
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--device', default='', help='D200X 기기 UUID (내보낸 프리셋의 Device.UUID)')
    ap.add_argument('--out', default=os.path.join(HERE, 'RealSimulator_D200X.ulanziDeckProfile'))
    a = ap.parse_args()
    print(build(a.device, a.out))
