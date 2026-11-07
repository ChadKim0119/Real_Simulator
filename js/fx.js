/* GSAP choreography shared by the wall and the Final screens (pilot: the task-complete
 * ceremony). GSAP 3.15.0 and its plugins are vendored in assets/vendor/gsap (standard
 * no-charge license, https://gsap.com/standard-license), so the demo also runs offline.
 * Without GSAP the pages fall back to their CSS animations. */
(function () {
  'use strict';
  const G = window.gsap;
  if (G && window.MotionPathPlugin) G.registerPlugin(window.MotionPathPlugin);
  if (G && window.DrawSVGPlugin) G.registerPlugin(window.DrawSVGPlugin);

  /* "e-Care 과업 종료": the wall dims, a ring closes and a check is drawn with a soft burst,
   * the title rises letter by letter, the six steps follow, then it all fades. One
   * timeline, so a scene change or a new ceremony can stop it cleanly. */
  let finTl = null;
  function ceremony(el, html) {
    if (!G) return false;
    if (finTl) finTl.kill();
    el.innerHTML = html.replace('<div class="fx">', '<div class="fx"><i class="burst" aria-hidden="true"></i>');
    el.classList.add('on', 'gs');
    const q = (s) => el.querySelector(s), qa = (s) => el.querySelectorAll(s);
    const title = q('b');
    // the title in letters (spaces kept), so they can rise one after another
    title.innerHTML = [...title.textContent].map((ch) => (ch === ' ' ? ' ' : `<span class="ch">${ch}</span>`)).join('');
    const ring = q('.ring'), fg = q('.ring .fg'), ck = q('.ring .ck'), burst = q('.burst');
    G.set(el, { autoAlpha: 0 });
    finTl = G.timeline({ onComplete: () => { el.classList.remove('on', 'gs'); finTl = null; } })
      .to(el, { autoAlpha: 1, duration: 1.0, ease: 'power2.out' }, 0)
      .fromTo(q('.fx'), { scale: 0.95 }, { scale: 1, duration: 2.6, ease: 'expo.out' }, 0)
      .fromTo(ring, { scale: 0.55, rotation: -40, transformOrigin: '50% 50%' }, { scale: 1, rotation: 0, duration: 1.5, ease: 'back.out(1.5)' }, 0.25)
      .fromTo(fg, { strokeDashoffset: 541 }, { strokeDashoffset: 0, duration: 1.7, ease: 'power3.inOut' }, 0.35)
      .fromTo(ck, { strokeDashoffset: 120 }, { strokeDashoffset: 0, duration: 0.55, ease: 'power2.out' }, 1.95)
      .fromTo(burst, { scale: 0.2, autoAlpha: 0.9 }, { scale: 2.6, autoAlpha: 0, duration: 1.3, ease: 'expo.out' }, 2.05)
      .to(ring, { scale: 1.08, duration: 0.22, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 2.1)
      .fromTo(qa('b .ch'), { autoAlpha: 0, y: 46, filter: 'blur(10px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.95, stagger: 0.045, ease: 'power3.out' }, 0.95)
      .fromTo(qa('.fx > span > *'), { autoAlpha: 0, y: 18, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.55, stagger: 0.06, ease: 'back.out(2.2)' }, 2.25)
      .fromTo(q('.fx > small'), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power2.out' }, 2.9)
      .to(el, { autoAlpha: 0, duration: 1.2, ease: 'power2.inOut' }, 7.4);
    return true;
  }
  function stopCeremony(el) {
    if (!finTl) { el.classList.remove('on'); return; }
    const t = finTl; finTl = null;
    t.kill();
    G.to(el, { autoAlpha: 0, duration: 0.45, ease: 'power2.in', onComplete: () => el.classList.remove('on', 'gs') });
  }
  window.FX = { gsap: !!G, ceremony, stopCeremony };
})();
