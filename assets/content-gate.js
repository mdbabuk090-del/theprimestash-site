/*!
 * content-gate.js — bo chan noi dung cua nha minh (viet lai, KHONG dung nho CDN nguoi khac).
 *
 * Doc toi X% chieu cao trang -> dung man mo che phan con lai -> nguoi doc bam nut
 * -> chay quang cao co thuong (GAM rewarded) -> xem xong thi mo khoa.
 *
 * Vi sao tu viet: trang mau nap file tu cdn.jsdelivr.net cua repo NGUOI KHAC.
 * Ho doi file hoac xoa repo la web minh dung hinh, va ho thay duoc traffic cua minh.
 *
 * An toan da tinh san (khong duoc de nguoi doc bi ket):
 *   - quang cao khong co hang (no-fill)  -> tu mo khoa
 *   - cho qua loadTimeoutMs              -> tu mo khoa
 *   - khong co GPT (dang o che do o trong) -> chay quang cao gia roi mo khoa
 *   - JS loi bat ky cho nao             -> mo khoa, KHONG bao gio khoa vinh vien
 *
 * Dung:
 *   ContentGate.init({ adUnitPath: '/12345678/reward', unlockAtPercent: 40 });
 */
(function (w, d) {
  'use strict';

  var CFG = {
    adUnitPath: '',
    unlockAtPercent: 40,
    minPageHeight: 0,          // 0 = chan moi trang; dat 1400 de bo qua trang ngan
    rememberUnlock: false,
    storageKey: 'cg_unlocked',
    onNoFill: 'unlock',        // 'unlock' | 'keep-locked'
    simulate: true,            // khong co GPT thi dien quang cao gia (che do o trong)
    simulateSeconds: 5,
    loadTimeoutMs: 8000,
    texts: {
      title: 'The rest of this chapter is locked',
      sub: 'Watch one short ad to keep reading.',
      btn: 'Unlock and continue',
      loading: 'Loading ad…',
      toast: 'Unlocked — enjoy the rest'
    }
  };

  var slot = null;         // GPT rewarded slot
  var state = 'idle';      // idle | loading | ready | shown
  var makeVisible = null;  // ham GPT dua cho de bat quang cao len
  var pendingShow = false;
  var unlocked = false;
  var loadTimer = null;
  var els = {};
  var gateTopPx = 0;

  /* ------------------------------------------------------------------ css */

  function injectStyles() {
    if (d.getElementById('cg-styles')) return;
    var css = [
      '.cg-veil{position:absolute;left:0;right:0;z-index:9000;pointer-events:auto;',
      'background:rgba(250,250,250,.35);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);',
      '-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 90px);',
      'mask-image:linear-gradient(180deg,transparent 0,#000 90px)}',
      // may khong ho tro backdrop-filter -> phu gan nhu dac de khong doc trom duoc
      '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){',
      '.cg-veil{background:rgba(250,250,250,.985)}}',

      '.cg-box{position:absolute;left:50%;transform:translateX(-50%);z-index:9001;',
      'width:min(560px,calc(100% - 32px));box-sizing:border-box;',
      'background:var(--cg-card,#fff);border:1px solid var(--cg-border,#e5e5ea);border-radius:16px;',
      'box-shadow:0 12px 40px rgba(0,0,0,.10);padding:24px 20px;text-align:center}',
      '.cg-box h3{margin:0 0 8px;font-size:19px;line-height:1.35;font-weight:700;color:var(--cg-text,#111)}',
      '.cg-box p{margin:0 0 18px;font-size:14.5px;line-height:1.5;color:var(--cg-muted,#5a5a66)}',
      '.cg-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;',
      'min-height:48px;padding:0 26px;border:0;border-radius:999px;cursor:pointer;',
      'font-size:15.5px;font-weight:700;color:#fff;background:var(--cg-accent,#c2185b);',
      'transition:opacity .15s,transform .15s;-webkit-tap-highlight-color:transparent}',
      '.cg-btn:hover{opacity:.9}.cg-btn:active{transform:scale(.98)}',
      '.cg-btn[disabled]{opacity:.6;cursor:default;transform:none}',
      '.cg-spin{width:15px;height:15px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;',
      'border-radius:50%;animation:cg-rot .7s linear infinite}',
      '@keyframes cg-rot{to{transform:rotate(360deg)}}',

      '.cg-sim{position:fixed;inset:0;z-index:2147483000;background:#0b0b0e;color:#fff;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;',
      'font:600 15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:24px}',
      '.cg-sim small{opacity:.55;font-weight:500;font-size:12.5px;letter-spacing:.04em}',

      '.cg-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483001;',
      'background:#111114;color:#fff;padding:11px 18px;border-radius:999px;font:600 13.5px/1 system-ui,sans-serif;',
      'box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .25s}',
      '.cg-toast.on{opacity:1}'
    ].join('');
    var s = d.createElement('style');
    s.id = 'cg-styles';
    s.textContent = css;
    d.head.appendChild(s);
  }

  /* --------------------------------------------------------------- do dac */

  function docHeight() {
    var b = d.body, e = d.documentElement;
    return Math.max(b.scrollHeight, b.offsetHeight, e.scrollHeight, e.offsetHeight);
  }

  function layout() {
    if (unlocked || !els.veil) return;
    var h = docHeight();
    gateTopPx = Math.round(h * (CFG.unlockAtPercent / 100));
    els.veil.style.top = gateTopPx + 'px';
    els.veil.style.height = Math.max(0, h - gateTopPx) + 'px';
    els.box.style.top = (gateTopPx + 56) + 'px';
    // chan khong cho cuon qua vung khoa
    d.documentElement.style.setProperty('--cg-max', gateTopPx + 'px');
  }

  function buildGate() {
    injectStyles();

    var veil = d.createElement('div');
    veil.className = 'cg-veil';

    var box = d.createElement('div');
    box.className = 'cg-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-live', 'polite');

    var h3 = d.createElement('h3'); h3.textContent = CFG.texts.title;
    var p = d.createElement('p');  p.textContent = CFG.texts.sub;
    var btn = d.createElement('button');
    btn.className = 'cg-btn'; btn.type = 'button'; btn.textContent = CFG.texts.btn;
    btn.addEventListener('click', onUnlockClick);

    box.appendChild(h3); box.appendChild(p); box.appendChild(btn);
    d.body.appendChild(veil); d.body.appendChild(box);

    els = { veil: veil, box: box, btn: btn };
    layout();

    w.addEventListener('resize', layout);
    // anh/font tai xong lam trang cao len -> do lai
    if (w.ResizeObserver) { try { new ResizeObserver(layout).observe(d.body); } catch (e) {} }
    w.addEventListener('load', layout);
    setTimeout(layout, 800);
    setTimeout(layout, 2500);
  }

  function setBtnLoading(on) {
    if (!els.btn) return;
    els.btn.disabled = !!on;
    els.btn.textContent = '';
    if (on) {
      var sp = d.createElement('span'); sp.className = 'cg-spin';
      els.btn.appendChild(sp);
      els.btn.appendChild(d.createTextNode(' ' + CFG.texts.loading));
    } else {
      els.btn.textContent = CFG.texts.btn;
    }
  }

  /* ------------------------------------------------------------- mo khoa */

  function unlock(reason) {
    if (unlocked) return;
    unlocked = true;
    clearTimeout(loadTimer);
    if (els.veil && els.veil.parentNode) els.veil.parentNode.removeChild(els.veil);
    if (els.box && els.box.parentNode) els.box.parentNode.removeChild(els.box);
    d.documentElement.style.removeProperty('--cg-max');
    if (CFG.rememberUnlock) { try { sessionStorage.setItem(CFG.storageKey, '1'); } catch (e) {} }
    toast(CFG.texts.toast);
    try { w.dispatchEvent(new CustomEvent('contentgate:unlock', { detail: { reason: reason } })); } catch (e) {}
    if (w.gtag) { try { w.gtag('event', 'gate_unlock', { reason: reason }); } catch (e) {} }
  }

  function toast(msg) {
    var t = d.createElement('div');
    t.className = 'cg-toast'; t.textContent = msg;
    d.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('on'); });
    setTimeout(function () {
      t.classList.remove('on');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 2400);
  }

  function noFill() {
    state = 'idle';
    pendingShow = false;
    clearTimeout(loadTimer);
    setBtnLoading(false);
    if (CFG.onNoFill === 'keep-locked') return;
    unlock('no-fill');
  }

  /* ----------------------------------------------------------------- GPT */

  function hasGpt() {
    return !!(w.googletag && w.googletag.cmd);
  }

  function requestRewarded() {
    if (!hasGpt() || !CFG.adUnitPath) return false;
    state = 'loading';
    try {
      w.googletag.cmd.push(function () {
        var gt = w.googletag;
        var s = gt.defineOutOfPageSlot(CFG.adUnitPath, gt.enums.OutOfPageFormat.REWARDED);
        if (!s) { noFill(); return; }
        s.addService(gt.pubads());
        slot = s;

        gt.pubads().addEventListener('rewardedSlotReady', function (ev) {
          if (ev.slot !== slot) return;
          state = 'ready';
          makeVisible = ev.makeRewardedVisible;
          if (pendingShow) showRewarded();
        });
        gt.pubads().addEventListener('rewardedSlotGranted', function (ev) {
          if (ev.slot !== slot) return;
          unlock('reward');
        });
        gt.pubads().addEventListener('rewardedSlotClosed', function (ev) {
          if (ev.slot !== slot) return;
          // dong ma chua nhan thuong -> van mo, khong lam kho nguoi doc
          setBtnLoading(false);
          unlock('closed');
          destroySlot();
        });
        gt.pubads().addEventListener('slotRenderEnded', function (ev) {
          if (ev.slot === slot && ev.isEmpty) noFill();
        });

        gt.enableServices();
        gt.display(slot);
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function destroySlot() {
    try {
      if (slot && w.googletag && w.googletag.destroySlots) w.googletag.destroySlots([slot]);
    } catch (e) {}
    slot = null; makeVisible = null; state = 'idle';
  }

  function showRewarded() {
    pendingShow = false;
    clearTimeout(loadTimer);
    setBtnLoading(false);
    state = 'shown';
    try { makeVisible(); } catch (e) { unlock('show-error'); }
  }

  /* ------------------------------------------------- quang cao gia (test) */

  function simulateAd() {
    var n = CFG.simulateSeconds;
    var ov = d.createElement('div');
    ov.className = 'cg-sim';
    var line = d.createElement('div');
    var note = d.createElement('small');
    note.textContent = 'CHE DO MO PHONG — chua gan mang quang cao';
    ov.appendChild(line); ov.appendChild(note);
    d.body.appendChild(ov);

    (function tick() {
      line.textContent = 'Your ad will finish in ' + n + 's';
      if (n-- <= 0) {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        setBtnLoading(false);
        unlock('simulated');
        return;
      }
      setTimeout(tick, 1000);
    })();
  }

  /* --------------------------------------------------------------- click */

  function onUnlockClick() {
    if (unlocked) return;

    if (!hasGpt() || !CFG.adUnitPath) {
      if (CFG.simulate) { setBtnLoading(true); simulateAd(); }
      else unlock('no-gpt');
      return;
    }

    setBtnLoading(true);
    loadTimer = setTimeout(noFill, CFG.loadTimeoutMs);

    if (state === 'ready') { showRewarded(); return; }
    if (state === 'loading') { pendingShow = true; return; }

    pendingShow = true;
    if (!requestRewarded()) noFill();
  }

  /* ---------------------------------------------------------------- init */

  function init(opts) {
    try {
      opts = opts || {};
      for (var k in opts) {
        if (k === 'texts' && opts.texts) {
          for (var t in opts.texts) CFG.texts[t] = opts.texts[t];
        } else if (Object.prototype.hasOwnProperty.call(CFG, k)) {
          CFG[k] = opts[k];
        }
      }

      if (CFG.rememberUnlock) {
        try { if (sessionStorage.getItem(CFG.storageKey) === '1') return; } catch (e) {}
      }

      var start = function () {
        if (CFG.minPageHeight && docHeight() < CFG.minPageHeight) return; // trang ngan thi tha
        buildGate();
        // nap truoc quang cao de bam nut la hien ngay
        if (hasGpt() && CFG.adUnitPath) requestRewarded();
      };

      if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start);
      else start();
    } catch (e) {
      // hong o dau cung KHONG duoc khoa nguoi doc lai
      unlock('init-error');
    }
  }

  return (w.ContentGate = { init: init, unlock: function () { unlock('manual'); } });
})(window, document);
