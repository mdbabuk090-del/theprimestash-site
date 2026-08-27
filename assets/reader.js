/*!
 * reader.js — bo doc truyen cua Dramora.
 *
 * chi Huong chot 2026-08-27. Bon viec:
 *   1. Thanh cai dat doc  — co chu / gian dong / font / nen. Nho bang localStorage.
 *   2. Nho vi tri doc      — moi truyen mot ban ghi: dang o chuong may, bao nhieu %.
 *   3. Thanh dieu huong dinh day — Truoc · Chuong · Sau.
 *   4. Trang chu           — dung khoi "Continue reading" + "Recently viewed" tu so tay tren may.
 *
 * KHONG can dang nhap, KHONG can may chu. Tat ca nam trong localStorage cua nguoi doc.
 *
 * Luu y ve thanh dinh day: khi bo chan noi dung dang KHOA thi GIAU thanh nay di.
 * Neu khong, nguoi doc bam Next o thanh la nhay chuong, bo chan thanh vo nghia.
 * Mo khoa xong (su kien 'contentgate:unlock') thi thanh hien ra.
 */
(function (w, d) {
  'use strict';

  var CFG = w.DRAMORA_READER || {};
  var PAGE = w.DRAMORA_PAGE || null;   // thong tin trang chuong, build.cjs nhet vao
  var KEY_PREFS = 'dramora:prefs';
  var KEY_PROG = 'dramora:progress';
  var KEY_SAVED = 'dramora:saved';
  var MAX_PROGRESS = 24;

  /* ------------------------------------------------------------ so tay tren may */

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* het cho / che do rieng tu */ }
  }

  /* -------------------------------------------------------------- thiet lap doc */

  var prefs = Object.assign({
    size: CFG.defaultSize || 18,
    lh: CFG.defaultLineHeight || 'comfortable',
    font: CFG.defaultFont || 'serif',
    theme: CFG.defaultTheme || 'ivory'
  }, readJson(KEY_PREFS, {}));

  function fontStack(id) {
    var f = (CFG.fonts || []).filter(function (x) { return x.id === id; })[0];
    return f ? f.stack : '';
  }

  function applyPrefs() {
    var r = d.documentElement;
    r.setAttribute('data-theme', prefs.theme);
    r.style.setProperty('--rd-size', prefs.size + 'px');
    r.style.setProperty('--rd-lh', String((CFG.lineHeights || {})[prefs.lh] || 1.75));
    var st = fontStack(prefs.font);
    if (st) r.style.setProperty('--rd-font', st);
  }

  function savePrefs() { writeJson(KEY_PREFS, prefs); applyPrefs(); syncPanel(); }

  applyPrefs();   // chay NGAY, truoc khi ve, de khong bi nhay mau

  /* ---------------------------------------------------------- bang cai dat (UI) */

  var panel = null;

  function chipRow(label, opts, current, onPick) {
    var wrapEl = d.createElement('div');
    wrapEl.className = 'rs-row';
    var h = d.createElement('span');
    h.className = 'rs-lbl';
    h.textContent = label;
    var box = d.createElement('div');
    box.className = 'rs-chips';
    opts.forEach(function (o) {
      var b = d.createElement('button');
      b.type = 'button';
      b.className = 'rs-chip' + (String(o.value) === String(current) ? ' on' : '');
      b.dataset.value = o.value;
      b.textContent = o.label;
      if (o.style) b.setAttribute('style', o.style);
      b.addEventListener('click', function () { onPick(o.value); });
      box.appendChild(b);
    });
    wrapEl.appendChild(h);
    wrapEl.appendChild(box);
    return wrapEl;
  }

  function buildPanel() {
    panel = d.createElement('div');
    panel.className = 'rs-sheet';
    panel.hidden = true;
    panel.innerHTML = '<div class="rs-grab"></div>';

    var sizes = (CFG.sizes || [16, 18, 20, 22]).map(function (s, i) {
      return { value: s, label: ['S', 'M', 'L', 'XL'][i] || String(s) };
    });
    panel.appendChild(chipRow('Text size', sizes, prefs.size, function (v) { prefs.size = +v; savePrefs(); }));

    var lhs = Object.keys(CFG.lineHeights || { comfortable: 1.75 }).map(function (k) {
      return { value: k, label: k.charAt(0).toUpperCase() + k.slice(1) };
    });
    panel.appendChild(chipRow('Line spacing', lhs, prefs.lh, function (v) { prefs.lh = v; savePrefs(); }));

    var fonts = (CFG.fonts || []).map(function (f) {
      return { value: f.id, label: f.label, style: 'font-family:' + f.stack };
    });
    panel.appendChild(chipRow('Typeface', fonts, prefs.font, function (v) { prefs.font = v; savePrefs(); }));

    var themes = (CFG.themes || []).map(function (t) {
      return { value: t.id, label: t.label };
    });
    panel.appendChild(chipRow('Background', themes, prefs.theme, function (v) { prefs.theme = v; savePrefs(); }));

    d.body.appendChild(panel);

    d.addEventListener('click', function (ev) {
      if (panel.hidden) return;
      if (panel.contains(ev.target) || ev.target.closest('.rs-open')) return;
      togglePanel(false);
    });
    d.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') togglePanel(false); });
  }

  function syncPanel() {
    if (!panel) return;
    panel.querySelectorAll('.rs-row').forEach(function (row) {
      var lbl = row.querySelector('.rs-lbl').textContent;
      var cur = lbl === 'Text size' ? prefs.size
        : lbl === 'Line spacing' ? prefs.lh
          : lbl === 'Typeface' ? prefs.font : prefs.theme;
      row.querySelectorAll('.rs-chip').forEach(function (c) {
        c.classList.toggle('on', String(c.dataset.value) === String(cur));
      });
    });
  }

  function togglePanel(force) {
    if (!panel) buildPanel();
    var show = force === undefined ? panel.hidden : force;
    panel.hidden = !show;
    var btn = d.querySelector('.rs-open');
    if (btn) btn.setAttribute('aria-expanded', String(show));
  }

  function mountOpenButton() {
    var host = d.querySelector('.site-head .wrap');
    if (!host || d.querySelector('.rs-open')) return;
    var b = d.createElement('button');
    b.type = 'button';
    b.className = 'rs-open ui';
    b.setAttribute('aria-label', 'Reading settings');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<span>A</span><span class="big">A</span>';
    b.addEventListener('click', function () { togglePanel(); });
    host.appendChild(b);
  }

  /* -------------------------------------------------------------- nho vi tri doc */

  function loadProgress() {
    var p = readJson(KEY_PROG, {});
    return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
  }

  function saveProgress(pct) {
    if (!PAGE || !PAGE.slug) return;
    var all = loadProgress();
    all[PAGE.slug] = {
      slug: PAGE.slug,
      story: PAGE.story,
      cover: PAGE.cover,
      url: PAGE.url,
      storyUrl: PAGE.storyUrl,
      chapter: PAGE.chapter,
      chapterTitle: PAGE.chapterTitle,
      total: PAGE.total,
      pct: Math.max(0, Math.min(100, Math.round(pct))),
      at: new Date().toISOString()
    };
    // giu 24 truyen gan nhat, cu hon thi bo
    var keys = Object.keys(all).sort(function (a, b) {
      return String(all[b].at || '').localeCompare(String(all[a].at || ''));
    });
    if (keys.length > MAX_PROGRESS) {
      keys.slice(MAX_PROGRESS).forEach(function (k) { delete all[k]; });
    }
    writeJson(KEY_PROG, all);
  }

  function trackProgress() {
    if (!PAGE) return;
    var last = -1, timer = null;

    function pctNow() {
      var h = d.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var within = max > 0 ? (h.scrollTop || d.body.scrollTop) / max : 1;
      // % ca truyen = (chuong da xong + phan dang doc) / tong so chuong
      return ((PAGE.chapter - 1 + Math.min(1, within)) / PAGE.total) * 100;
    }

    function flush() {
      var p = pctNow();
      if (Math.abs(p - last) < 0.6) return;
      last = p;
      saveProgress(p);
    }

    flush();
    addEventListener('scroll', function () {
      clearTimeout(timer);
      timer = setTimeout(flush, 260);
    }, { passive: true });
    addEventListener('beforeunload', flush);
  }

  /* --------------------------------------------------- thanh dieu huong dinh day */

  function mountStickyNav() {
    if (!PAGE) return;
    var bar = d.createElement('nav');
    bar.className = 'sticky-nav ui';
    bar.hidden = true;

    function link(cls, href, label) {
      if (!href) return '<span class="' + cls + ' off">' + label + '</span>';
      return '<a class="' + cls + '" href="' + href + '">' + label + '</a>';
    }

    bar.innerHTML =
      link('sn-prev', PAGE.prev, '&#8592; Previous')
      + '<button class="sn-list" type="button">Chapter ' + PAGE.chapter + ' / ' + PAGE.total + '</button>'
      + link('sn-next', PAGE.next, 'Next &#8594;');

    d.body.appendChild(bar);
    d.body.classList.add('has-sticky-nav');

    bar.querySelector('.sn-list').addEventListener('click', function () {
      var rail = d.querySelector('.col-side');
      if (rail) rail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Bo chan dang khoa thi CHUA cho hien — khong de nguoi doc nhay chuong bo qua no.
    var gated = !!d.querySelector('script[src*="content-gate"]');
    if (!gated) { bar.hidden = false; return; }
    addEventListener('contentgate:unlock', function () { bar.hidden = false; });
    // bo chan khong dung duoc (tat/loi) thi sau 12s van phai co thanh cho nguoi ta di tiep
    setTimeout(function () { if (!d.querySelector('.cg-veil')) bar.hidden = false; }, 12000);
  }

  /* ------------------------------------------------------------- phim mui ten */

  function mountKeys() {
    if (!PAGE) return;
    d.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var t = ev.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (ev.key === 'ArrowRight' && PAGE.next) location.href = PAGE.next;
      if (ev.key === 'ArrowLeft' && PAGE.prev) location.href = PAGE.prev;
    });
  }

  /* ------------------------------------------------------- danh dau de doc sau */

  function loadSaved() { return readJson(KEY_SAVED, {}) || {}; }

  function mountSaveButton() {
    if (!PAGE) return;
    // uu tien hang nut trong hero toi; khong co thi bam tam vao dau chuong
    var head = d.querySelector('.chapter-head .hero-act') || d.querySelector('.chapter-head');
    if (!head) return;

    var btn = d.createElement('button');
    btn.type = 'button';
    btn.className = 'save-btn ui';
    head.appendChild(btn);

    function paint() {
      var on = !!loadSaved()[PAGE.slug];
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.innerHTML = (on ? '&#9829;' : '&#9825;') + '<span>' + (on ? 'Saved' : 'Save') + '</span>';
    }

    btn.addEventListener('click', function () {
      var all = loadSaved();
      if (all[PAGE.slug]) delete all[PAGE.slug];
      else all[PAGE.slug] = {
        slug: PAGE.slug, title: PAGE.story, cover: PAGE.cover,
        url: PAGE.storyUrl, total: PAGE.total, at: new Date().toISOString()
      };
      writeJson(KEY_SAVED, all);
      paint();
    });

    paint();
  }

  /* ------------------------------------------- trang chu: dang doc do / vua xem */

  function renderHomeShelves() {
    var host = d.getElementById('continue-slot');
    if (!host) return;

    var all = loadProgress();
    var items = Object.keys(all).map(function (k) { return all[k]; })
      .filter(function (x) { return x && x.url && x.pct < 99; })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

    var saved = loadSaved();
    var savedItems = Object.keys(saved).map(function (k) { return saved[k]; })
      .filter(function (x) { return x && x.url; })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

    if (!items.length && !savedItems.length) return;   // chua doc gi thi khong hien khoi rong

    var cards = items.slice(0, 12).map(function (x) {
      return '<a class="bk bk-cont" href="' + x.url + '">'
        + '<div class="bk-art">'
        + (x.cover ? '<img src="' + x.cover + '" alt="" width="800" height="1200" loading="lazy" />' : '')
        + '<span class="bk-bar"><i style="width:' + x.pct + '%"></i></span>'
        + '</div>'
        + '<span class="bk-tag">Chapter ' + x.chapter + ' / ' + x.total + '</span>'
        + '<span class="bk-meta">' + x.pct + '% &middot; continue</span>'
        + '</a>';
    }).join('');

    var savedCards = savedItems.slice(0, 12).map(function (x) {
      return '<a class="bk" href="' + x.url + '">'
        + '<div class="bk-art">'
        + (x.cover ? '<img src="' + x.cover + '" alt="" width="800" height="1200" loading="lazy" />' : '')
        + '</div>'
        + '<span class="bk-tag">Saved</span>'
        + '<span class="bk-meta">' + (x.total ? x.total + ' chapters' : '') + '</span>'
        + '</a>';
    }).join('');

    var html = '';
    if (cards) {
      html += '<section class="shelf">'
        + '<h2 class="shelf-h ui">Continue reading</h2>'
        + '<div class="shelf-wrap"><div class="shelf-row">' + cards + '</div></div>'
        + '</section>';
    }
    if (savedCards) {
      html += '<section class="shelf">'
        + '<h2 class="shelf-h ui">Saved for later</h2>'
        + '<div class="shelf-wrap"><div class="shelf-row">' + savedCards + '</div></div>'
        + '</section>';
    }
    host.innerHTML = html;
  }

  /* ----------------------------------------------------------------------- chay */

  function start() {
    mountOpenButton();
    renderHomeShelves();
    if (PAGE) { trackProgress(); mountStickyNav(); mountKeys(); mountSaveButton(); }
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start);
  else start();

  w.DramoraReader = { prefs: prefs, progress: loadProgress };
})(window, document);
