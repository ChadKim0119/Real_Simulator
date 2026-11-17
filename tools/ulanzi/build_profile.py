#!/usr/bin/env python3
"""Ulanzi Studio 프로필(.ulanziDeckProfile) 생성기 — Real Simulator 시연용 D200X 키 배치.

파일 구조 (Ulanzi Studio 3.x 내보내기 파일, 공개 분석 자료 기준):
  "#Version: 2\n" (12바이트) + ZIP
  ZIP 안:
    <프로필 UUID>.ulanziProfile/
      manifest.json                      {Name, Device{Model}, Pages{Current, Pages[페이지 UUID…]}}
      Profiles/<페이지 UUID>/manifest.json {Name, Controllers[{Type:"Keypad", Actions{"열_행": 키}}]}
      Profiles/<페이지 UUID>/Images/*.png 키 아이콘 196×196
  키 칸: "열_행", 열 0~4 왼→오, 행 0~2 위→아래. 3_2는 2칸 너비 키(시계 창)이고 4_2는 없음.
  단축키 동작: Action "com.ulanzi.ulanzideck.system.hotkey", ActionParam.Hotkey = 표시 문자열
    (macOS: "⇧ R" 처럼 기호 + 공백, Windows: "Shift+R" — Windows 표기는 실물 파일로 확인 전).
노브(Encoder)는 형식을 확인할 자료가 없어 넣지 않았다. Ulanzi Studio에서 직접 지정한다.

사용: python3 tools/ulanzi/build_profile.py   → tools/ulanzi/RealSimulator_D200X_{mac,win}.ulanziDeckProfile
"""
import io
import json
import os
import uuid
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(HERE, 'icons')

# 고정 UUID: 다시 만들어도 같은 프로필로 들어가도록
NS = uuid.UUID('6f1d7c2e-6a43-4c55-9d0e-52c0a1e0d200')
PROFILE_ID = str(uuid.uuid5(NS, 'profile')).upper()
PAGE_IDS = [str(uuid.uuid5(NS, f'page{i}')).upper() for i in (1, 2)]

# (칸, 아이콘 파일, 이름, 키) — 키는 js/hotkeys.js와 같다. mod는 'shift' 또는 None
PAGES = [
    ('시연 진행', [
        ('0_0', 'p1-01', '이전', None, 'Left'), ('1_0', 'p1-02', '다음', None, 'Right'), ('2_0', 'p1-03', '자동 진행', None, 'A'),
        ('3_0', 'p1-04', '오프닝', None, 'O'), ('4_0', 'p1-05', '초기화', 'shift', 'R'),
        ('0_1', 'p1-06', '컨트롤 창', None, '1'), ('1_1', 'p1-07', '계기판 HU 창', None, '2'), ('2_1', 'p1-08', '데이터 흐름 창', None, '3'),
        ('3_1', 'p1-09', '전체화면', None, 'F'), ('4_1', 'p1-10', '비상등', None, 'H'),
        ('0_2', 'p1-11', '시점 자동', None, '4'), ('1_2', 'p1-13', '계기판 확대', None, '6'), ('2_2', 'p1-14', 'HU 확대', None, '7'),
    ]),
    ('장면 · Q&A', [
        ('0_0', 'p2-01', '라이브', None, 'L'), ('1_0', 'p2-02', '클로징', None, 'C'), ('2_0', 'p2-03', '종료', None, 'E'),
        ('3_0', 'p2-04', '암전', None, 'B'), ('4_0', 'p2-05', '오프닝', None, 'O'),
        ('0_1', 'p2-06', '상세 흐름 Q&A', None, 'D'), ('1_1', 'p2-07', '상담 대화', None, 'T'), ('2_1', 'p2-08', '상담실 자동', None, '8'),
        ('3_1', 'p2-09', '상담실 화면만', None, '9'), ('4_1', 'p2-10', '상담실 사무실', None, '0'),
        ('0_2', 'p2-11', '전체 발표', 'shift', '1'), ('1_2', 'p2-12', '고객 전화', 'shift', '2'), ('2_2', 'p2-13', '상담원 발신', 'shift', '3'),
    ]),
]


def hotkey(mod, key, os_name):
    if os_name == 'mac':
        return f'⇧ {key}' if mod == 'shift' else key
    return f'Shift+{key}' if mod == 'shift' else key


FONT = {'Align': 'bottom', 'Color': 16777215, 'FontName': 'Source Han Sans SC', 'ShowTitle': False, 'Size': 10, 'Weight': 80}


def build(os_name):
    root = f'{PROFILE_ID}.ulanziProfile'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(f'{root}/manifest.json', json.dumps({
            'Name': 'Real Simulator 시연',
            'Device': {'Model': 'D200X'},
            'Pages': {'Current': PAGE_IDS[0], 'Pages': PAGE_IDS},
            'Version': '2.0',
        }, ensure_ascii=False, indent=2))
        for pid, (pname, keys) in zip(PAGE_IDS, PAGES):
            actions = {}
            for slot, icon, name, mod, key in keys:
                img = f'Images/{icon}.png'
                z.write(os.path.join(ICONS, f'{icon}.png'), f'{root}/Profiles/{pid}/{img}')
                actions[slot] = {
                    'Name': name,
                    'Action': 'com.ulanzi.ulanzideck.system.hotkey',
                    'ActionParam': {'Hotkey': hotkey(mod, key, os_name)},
                    'State': 0,
                    'ViewParam': [{'Text': '', 'Icon': img, 'IconRel': img, 'Font': FONT}],
                }
            # 2칸 너비 키: 기본 시계 창 그대로
            actions['3_2'] = {'Name': '시계', 'Action': 'com.ulanzi.smallwindow.window', 'ActionParam': {'SmallViewMode': 1}, 'State': 0}
            z.writestr(f'{root}/Profiles/{pid}/manifest.json', json.dumps({
                'Name': pname,
                'Controllers': [{'Type': 'Keypad', 'Actions': actions}],
            }, ensure_ascii=False, indent=2))
    out = os.path.join(HERE, f'RealSimulator_D200X_{os_name}.ulanziDeckProfile')
    with open(out, 'wb') as f:
        f.write(b'#Version: 2\n' + buf.getvalue())
    return out


if __name__ == '__main__':
    for o in ('mac', 'win'):
        print(build(o))
