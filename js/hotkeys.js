/* Shortcut keys for the presenter, the same on the control panel and on the two Final
 * screens: whichever of the three windows has the focus, a key does the same thing.
 * Made for a key deck (Ulanzi D200X, Stream Deck …) that sends plain key strokes; see
 * docs/HOTKEYS.md for the deck layout.
 *
 * On a Final screen the key is passed to the control panel of the same computer (Link
 * message 'ctl-key' with this browser's id), so a panel open on another computer is never
 * driven twice. Keys a screen already has for itself stay its own: F (full screen) on the
 * Final screens, D and the arrows of the detail view on Final_Dataflow, T on
 * Final_Instrument. Keys with Ctrl / Alt / ⌘ are left to the browser. */
(function () {
  'use strict';
  if (window.top !== window) return;               // a panel inside a screen: its keys go up to the screen
  const page = /final_instrument/.test(location.pathname) ? 'instrument' : /final_dataflow/.test(location.pathname) ? 'dataflow' : 'control';

  // this browser on this computer (shared by its windows)
  let dev = '';
  try { dev = localStorage.getItem('hotkey-dev') || ''; if (!dev) { dev = Math.random().toString(36).slice(2, 10); localStorage.setItem('hotkey-dev', dev); } } catch (e) { dev = 'local'; }

  /* key → action. 'win' opens (or brings forward) a screen; the rest are control actions. */
  const PLAIN = {
    ArrowRight: ['next'], ArrowDown: ['next'], Space: ['next'], PageDown: ['next'],
    ArrowLeft: ['prev'], ArrowUp: ['prev'], PageUp: ['prev'],
    Digit1: ['win', 'control'], Digit2: ['win', 'instrument'], Digit3: ['win', 'dataflow'],
    Numpad1: ['win', 'control'], Numpad2: ['win', 'instrument'], Numpad3: ['win', 'dataflow'],
    KeyA: ['auto'], KeyO: ['opening'],
    KeyL: ['scene', 'live'], KeyC: ['scene', 'closing'], KeyE: ['scene', 'end'], KeyB: ['scene', 'black'],
    Digit4: ['cam', 'auto'], Digit5: ['cam', 'full'], Digit6: ['cam', 'cluster'], Digit7: ['cam', 'hu'],
    BracketLeft: ['camStep', -1], BracketRight: ['camStep', 1],
    Digit8: ['ccwcam', 'auto'], Digit9: ['ccwcam', 'screen'], Digit0: ['ccwcam', 'office'],
    KeyH: ['hazard'], KeyD: ['df'], KeyT: ['talk'], KeyF: ['full'],
  };
  const SHIFT = {
    KeyR: ['reset'],
    Digit1: ['scenario', 0], Digit2: ['scenario', 1], Digit3: ['scenario', 2], Digit4: ['scenario', 3], Digit5: ['scenario', 4], Digit6: ['scenario', 5],
    Slash: ['help'],
  };
  // what each screen keeps for itself
  function own(code) {
    if (page !== 'control' && code === 'KeyF') return true;                              // final-common.js
    if (page === 'instrument' && code === 'KeyT') return true;                            // the conversation panel
    if (page === 'dataflow') {
      if (code === 'KeyD') return true;                                                   // detail view on / off
      if (document.body.classList.contains('detail-on') && /^(Arrow|Space|Home)/.test(code)) return true;   // its own steps
    }
    return false;
  }

  function run(name, arg) {
    if (name === 'win') return win(arg);
    if (name === 'full') return full();
    if (name === 'help') return help();
    if (page === 'control') { if (window.ControlHot) window.ControlHot(name, arg); }
    else if (window.Link) Link.send('ctl-key', { name, arg, dev });
  }
  function full() {
    const d = document;
    (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen({ navigationUI: 'hide' })).catch(() => {});
  }
  // a screen: its own window goes full screen, another one opens or comes forward (js/launch.js)
  function win(k) {
    if (k === page) { if (!document.fullscreenElement) full(); else window.focus(); return; }
    if (window.Launch) window.Launch.open(k);
  }

  addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea, select, [contenteditable]')) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const map = e.shiftKey ? SHIFT : PLAIN;
    const a = map[e.code];
    if (!a || own(e.code)) return;
    if (e.repeat && a[0] !== 'camStep') return;
    e.preventDefault();
    run(a[0], a[1]);
  });

  /* ? on the control panel: the key list */
  let box = null;
  function help() {
    if (page !== 'control') return;
    if (box) { box.remove(); box = null; return; }
    const rows = [
      ['→ ↓ Space PageDown', '다음 단계'], ['← ↑ PageUp', '이전 단계'], ['A', '자동 진행 켜기 · 끄기'], ['Shift + R', '초기화 (확인 없이 바로)'],
      ['1 · 2 · 3', '창 열기: 컨트롤 · 계기판 HU · 데이터 흐름'], ['F', '지금 창 전체화면'],
      ['O', '오프닝 켜기 · 끄기'], ['L · C · E · B', '라이브 · 클로징 · 종료 · 암전'],
      ['4 · 5 · 6 · 7', '차량 시점: 자동 · 전체 · 계기판 · HU'], ['[ · ]', '차량 시점 이전 · 다음'],
      ['8 · 9 · 0', '상담실: 자동 · 화면만 · 사무실'], ['H', '비상등'], ['D', '데이터 흐름 상세 (Q&A)'], ['T', '상담 대화 패널'],
      ['Shift + 1~6', '시나리오 선택'], ['?', '이 목록 닫기'],
    ];
    box = document.createElement('div');
    box.id = 'hotHelp';
    box.innerHTML = `<style>#hotHelp{position:fixed;inset:0;z-index:2147483002;display:grid;place-items:center;background:rgba(4,7,12,.55)}
      #hotHelp .in{min-width:460px;padding:22px 26px;border-radius:16px;background:#0e1626;border:1px solid rgba(160,190,255,.3);color:#e6efff;font:500 14px/1.5 "Pretendard",system-ui,sans-serif}
      #hotHelp h2{margin:0 0 12px;font-size:17px}#hotHelp td{padding:4px 18px 4px 0}#hotHelp td:first-child{color:#9fc0ff;font-weight:700;white-space:nowrap}
      #hotHelp p{margin:12px 0 0;color:#8aa0c4;font-size:12px}</style>
      <div class="in"><h2>단축키 · 키 데크</h2><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <p>컨트롤 패널 · Final 두 화면 어느 창에 포커스가 있어도 같게 동작합니다.</p></div>`;
    box.addEventListener('click', () => { box.remove(); box = null; });
    document.body.appendChild(box);
  }

  window.Hotkeys = { dev, page };
})();
