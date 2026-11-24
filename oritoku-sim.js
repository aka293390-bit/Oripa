/* oritoku-sim.js — /oritoku/simulator/ オリパシミュレーター
   ファーストビューの「自分で作る」（入力 → その場で計算 → 端末の中の箱で引く）、
   一覧（サーバー描画のカード）の絞り込み・並び替え、箱の表示、引く操作、演出、結果、みんなの結果の更新。
   並んでいる箱の変わる数字（残り口数・結果・ランキング）はすべて POST の API から取る（ページは共有キャッシュに載るため）。
   自作の箱は送信しない。抽選もブラウザの乱数（current.local = true）。 */
(function () {
  'use strict';
  var root = document.querySelector('[data-sim]');
  var cfgEl = document.getElementById('sim-config');
  if (!root || !cfgEl) return;
  var cfg = JSON.parse(cfgEl.textContent || '{}');

  // ---- 匿名 ID（端末ごと。名前はサーバー側に保存） ----
  var client = (function () {
    var key = 'ot_sim_client';
    try {
      var v = localStorage.getItem(key);
      if (!v) {
        v = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14)).replace(/-/g, '');
        localStorage.setItem(key, v);
      }
      return v;
    } catch (e) { return 'anon' + Math.random().toString(36).slice(2, 16) + Date.now().toString(36); }
  }());

  // GA4 のゲーム内イベント（2026-11-24 岸田「GA4で遊ばれ方を見たい」）。gtag が無い環境（staging 等）では何もしない
  function ga(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, Object.assign({ page_type: 'oritoku_sim' }, params || {})); } catch (e) {} }
  var GA_ACTIONS = {
    roll: function () { return ['sim_roulette', {}]; },
    revive: function () { return ['sim_revive', {}]; },
    ship: function (d, j) { return ['sim_ship', { value_pt: +(j && j.value) || 0 }]; },
    trade: function (d, j) { return ['sim_trade', { value_pt: +(j && j.pt) || 0 }]; },
    finish: function () { return ['sim_finish', {}]; },
    mission: function (d) { return ['sim_mission', { mission: String(d.m || '') }]; },
    name: function () { return ['sim_name_set', {}]; },
    entry: function () { return ['sim_entry', {}]; }
  };
  function api(action, data) {
    var body = new URLSearchParams(Object.assign({ action: action, token: cfg.token, client: client }, data || {}));
    return fetch(cfg.api, { method: 'POST', body: body, credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) { var e = new Error((j && j.error) || ('http_' + r.status)); e.code = (j && j.error) || ('http_' + r.status); throw e; }
        if (GA_ACTIONS[action]) { var ev = GA_ACTIONS[action](data || {}, j); ga(ev[0], ev[1]); }
        return j;
      }); });
  }

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return n == null ? '—' : Number(n).toLocaleString('ja-JP'); };
  // 有名なカード（相場があるもの）は、トレカプロの相場ページへ飛ばす。値段そのものはここでは見せない
  // ---- 手触りの調整値（2026-11-14）。数字はここに集めて、直せば全体に効くようにする ----
  var TUNE = {
    hitStop: { lose: 60, low: 80, mid: 120, high: 190, top: 280 }, // 【結果が出た瞬間に止める時間】ミリ秒。大きい当たりほど長く止めて震わせる
    ptTween: 450,   // 【持ちポイントの数字が動く時間】ミリ秒
    tutFirst: false // 【最初に説明5枚を出すか】false＝すぐルーレットへ（説明は「遊び方を先に見る」から開ける）
  };
  var reduceMotion = function () { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); };
  // 抽選中の演出のタイマーを覚えておき、スキップでまとめて止める。fn の中（入れ子の中も）で作った setTimeout / setInterval が対象
  var nativeST = window.setTimeout, nativeSI = window.setInterval;
  function withTimers(T, fn) {
    var st = window.setTimeout, si = window.setInterval;
    window.setTimeout = function (cb, ms) { var id = st(function () { if (!T.dead && typeof cb === 'function') withTimers(T, cb); }, ms); T.ids.push(id); return id; };
    window.setInterval = function (cb, ms) { var id = si(function () { if (T.dead) { clearInterval(id); return; } if (typeof cb === 'function') withTimers(T, cb); }, ms); T.ivs.push(id); return id; };
    try { return fn(); } finally { window.setTimeout = st; window.setInterval = si; }
  }
  function toast(html, cls) {
    var open = document.querySelectorAll('dialog[open]'), host = open.length ? open[open.length - 1] : document.body;
    var t = document.createElement('div');
    t.className = 'sim-toast' + (cls ? ' ' + cls : ''); t.setAttribute('role', 'status'); t.innerHTML = html;
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 2800);
  }
  // 数字を from → to へ動かす（結果の差し引き・合計など）
  function countTo(el, from, to, dur, fmtFn) {
    if (!el) return;
    if (reduceMotion() || dur <= 0) { el.textContent = fmtFn(to); return; }
    var t0 = performance.now();
    var step = function (now) {
      var k = Math.min(1, (now - t0) / dur);
      el.textContent = fmtFn(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function killTimers(T) { T.dead = true; T.ids.forEach(function (id) { clearTimeout(id); }); T.ivs.forEach(function (id) { clearInterval(id); }); T.ids = []; T.ivs = []; }
  // 結果が出た瞬間の手応え: 中身を大きく出して短く止め（ヒットストップ）、止めている間に震わせ、光と火花を重ねる。
  // lv = lose / low / mid / high / top。震え方は段ごとに変える（小さい当たりは縦だけ、大きい当たりは縦横）
  function impact(stage, lv) {
    if (!stage || reduceMotion()) return;
    var inner = stage.firstChild; if (!inner || !inner.classList) return;
    ['lose', 'low', 'mid', 'high', 'top'].forEach(function (k) { inner.classList.remove('is-hit-' + k); });
    void inner.offsetWidth;
    inner.style.setProperty('--hs', (TUNE.hitStop[lv] || 0) + 'ms');
    inner.classList.add('is-hit-' + lv);
    try { if (navigator.vibrate && soundOn) navigator.vibrate(lv === 'top' ? [60, 40, 120] : lv === 'high' ? [50, 30, 60] : lv === 'lose' ? 15 : 30); } catch (e) {}
    if (lv === 'lose') return;
    var n = { low: 6, mid: 8, high: 12, top: 16 }[lv], html = '<i class="sim-hitfx__flash"></i><i class="sim-hitfx__ring"></i>' + (lv === 'low' ? '' : '<i class="sim-hitfx__ring is-2"></i>');
    for (var i = 0; i < n; i++) html += '<b style="--a:' + Math.round(360 / n * i + (Math.random() * 14 - 7)) + 'deg;--l:' + (0.75 + Math.random() * 0.5).toFixed(2) + '"></b>';
    var fx = document.createElement('div');
    fx.className = 'sim-hitfx is-' + lv; fx.innerHTML = html;
    fx.style.setProperty('--hs', (TUNE.hitStop[lv] || 0) + 'ms');
    stage.appendChild(fx);
    setTimeout(function () { if (fx.parentNode) fx.remove(); }, 1100);
  }
  // ---- 効果音（WebAudio で合成。音源ファイルは使わない）。ミュートは端末に覚える ----
  var SOUND_KEY = 'ot_sim_sound';
  var soundOn = (function () { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { return true; } }());
  var actx = null;
  function ac() {
    if (!soundOn) return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) { try { actx = new AC(); } catch (e) { return null; } }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  // 素材（効果音ラボ）は最初に音を鳴らすときにまとめて読み込む。鳴らした音は stop() で途中で止められる
  var SOUNDS = cfg.sounds || {}, bufs = {}, loading = null;
  function loadSounds() {
    var c = ac(); if (!c || loading) return loading;
    loading = Promise.all(Object.keys(SOUNDS).map(function (k) {
      return fetch(SOUNDS[k]).then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return new Promise(function (ok, ng) { c.decodeAudioData(b, ok, ng); }); })
        .then(function (buf) { bufs[k] = buf; }, function () {});
    }));
    return loading;
  }
  // name を at 秒後に鳴らす。dur を渡すとその長さでフェードアウトして止める
  // 音でエラーが出てもゲームは止めない
  function playSe(name, opt) { try { return playSeRaw(name, opt); } catch (e) { return null; } }
  function playSeRaw(name, opt) { // ※ play は「ゲーム／分析」の変数名なので別名にする
    opt = opt || {};
    var c = ac(); if (!c) return null;
    if (!bufs[name]) { loadSounds(); return null; }
    var src = c.createBufferSource(), g = c.createGain(), t0 = c.currentTime + (opt.at || 0);
    src.buffer = bufs[name];
    g.gain.setValueAtTime(opt.vol == null ? 0.7 : opt.vol, t0);
    src.connect(g); g.connect(master(c));
    src.start(t0, SOUND_LEAD[name] || 0);
    var h = { stop: function (fade) { try { var t = c.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + (fade || 0.15)); src.stop(t + (fade || 0.15) + 0.02); } catch (e) {} } };
    if (opt.dur) { g.gain.setValueAtTime(opt.vol == null ? 0.7 : opt.vol, t0 + Math.max(0, opt.dur - 0.3)); g.gain.linearRampToValueAtTime(0.0001, t0 + opt.dur); src.stop(t0 + opt.dur + 0.02); }
    return h;
  }
  // 2026-11-14 音の点検（ファイルを実測）: 当たりの音はどれも頭の無音が0.03秒以内で、結果の瞬間に合っている。
  // 例外は puchun（頭に0.16秒の無音）→ 頭を飛ばして鳴らす。pirori・puchun は他より6dBほど大きく、
  // 大当たりは3つの音が重なるので、出口に制限（コンプレッサー）をかけてスマホのスピーカーで割れないようにする
  var SOUND_LEAD = { puchun: 0.13 };
  var masterNode = null;
  function master(c) {
    if (masterNode) return masterNode;
    try {
      var comp = c.createDynamicsCompressor();
      comp.threshold.value = -9; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.2;
      comp.connect(c.destination); masterNode = comp;
    } catch (e) { masterNode = c.destination; }
    return masterNode;
  }
  var rolling = null; // 鳴っているドラムロール（結果が出たら止める）
  function stopRoll() { if (rolling) { rolling.stop(0.1); rolling = null; } }
  function stopRollNow() { if (rolling) { rolling.stop(0.005); rolling = null; } } // プチュン用: ぶつっと切る
  var sfx = {
    tick: function () { playSe('cursor1', { vol: 0.35, dur: 0.25 }); },                 // ルーレットのカチッ
    pull: function () { stopRoll(); rolling = playSe('drum-roll1', { vol: 0.6 }); },   // 引いた瞬間からドラムロール
    shake: function () { stopRoll(); rolling = playSe('tympani-roll1', { vol: 0.7 }); },
    lose: function () { stopRoll(); playSe('boyon1', { vol: 0.6 }); },
    mid: function () { stopRoll(); playSe('kira1', { vol: 0.7 }); },
    high: function () { stopRoll(); playSe('pirori', { vol: 0.85 }); playSe('shine1', { at: 1.4, vol: 0.4, dur: 1.5 }); }, // ピロリロリロリロ〜♪（自作）
    top: function () { stopRoll(); playSe('jajean1', { vol: 0.9 }); playSe('trumpet1', { at: 0.9, vol: 0.8 }); playSe('shine1', { at: 0.9, vol: 0.5, dur: 2.5 }); },
    // ルーレットが止まったとき。lv=0(5,000pt)〜7(15,000pt)
    stopLv: function (lv) {
      if (lv <= 1) playSe('jean1', { vol: 0.7 });
      else if (lv <= 3) { playSe('jean1', { vol: 0.7 }); playSe('kira1', { at: 0.3, vol: 0.6 }); }
      else if (lv <= 5) { playSe('jajean1', { vol: 0.85 }); playSe('shine1', { at: 0.4, vol: 0.4, dur: 1.8 }); }
      else if (lv === 6) { playSe('jajean1', { vol: 0.9 }); playSe('trumpet1', { at: 0.9, vol: 0.8 }); }
      else { playSe('trumpet1', { vol: 0.9 }); playSe('dondonpafupafu1', { at: 1.6, vol: 0.8 }); playSe('shine1', { at: 0.2, vol: 0.5, dur: 3 }); }
    }
  };
  // ページ内で最初に押されたときに読み込んでおく（自動再生の制限で、押す前には音を作れない）
  document.addEventListener('pointerdown', function () { loadSounds(); }, { once: true });
  function syncSound() { Array.prototype.forEach.call(document.querySelectorAll('[data-sim-sound]'), function (b) { var lb = b.querySelector('[data-sim-sound-label]') || b; lb.textContent = soundOn ? '音あり' : '音なし'; b.setAttribute('aria-pressed', soundOn ? 'true' : 'false'); }); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sim-sound]'); if (!b) return;
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (e2) {}
    syncSound(); if (soundOn) { loadSounds(); sfx.mid(); }
  });
  syncSound();
  // カード画像に札を重ねる（オリパサイトの景品表示と同じ型）: PSA10 / 発送のみ / ×枚数
  var isPsa10 = function (t) { return /PSA\s*10/i.test(t.n || ''); };
  var cardFrame = function (t, cls, cnt, lazy) {
    if (!t.img) return '';
    return '<span class="sim-cardframe">' +
      '<img class="' + cls + '" src="' + esc(t.img) + '" alt="' + esc(t.n || t.rl) + '"' + (lazy ? ' loading="lazy"' : '') + ' decoding="async">' +
      (isPsa10(t) ? '<span class="sim-psa" aria-label="PSA10"><b>10</b><small>PSA</small></span>' : '') +
      (t.pt == null ? '<span class="sim-shiponly">発送のみ</span>' : '') +
      (cnt ? '<span class="sim-cnt">×' + fmt(cnt) + '</span>' : '') +
    '</span>';
  };
  var prizeLink = function (href) { return href ? ' <a class="sim-prize__link" href="' + esc(href) + '" target="_blank" rel="noopener">相場を見る</a>' : ''; };
  var pct = function (r) { return r == null ? '—' : Math.round(r * 100) + '%'; };
  var ago = function (s) { if (s < 60) return 'いま'; if (s < 3600) return Math.floor(s / 60) + '分前'; if (s < 86400) return Math.floor(s / 3600) + '時間前'; return Math.floor(s / 86400) + '日前'; };
  var errText = function (code) {
    return { rate_limited: '引く回数が多すぎます。少し待ってからもう一度どうぞ', db: 'いまサーバーが混んでいます。少し待ってからもう一度どうぞ', bad_token: 'ページが古くなっています。再読み込みしてください', bad_origin: 'このページからだけ引けます', not_found: 'このガチャは見つかりませんでした', no_pt: 'コインが足りません', level_locked: 'このガチャはまだ解放されていません（オリ得レベルを上げると引けます）', mission_not_done: 'まだ達成していません', mission_claimed: 'もう受け取りました', bad_mission: 'ミッションが見つかりません', no_wallet: '先にルーレットを回してください', game_done: '今日のゲームは終了しました', roll_limit: 'この回線からは今日はもう回せません（ルーレットは1日1回）', share_bad_url: 'Xの投稿のURL（x.com/…/status/…）を貼ってください', share_not_found: '投稿が見つかりませんでした。公開の投稿か、URLが合っているか確かめてください（投稿してすぐは少し待ってから）', share_no_tag: '投稿にハッシュタグ（#オリ得 など）が入っていません。シェアのボタンから投稿し直してください', share_old: '24時間以内の投稿を貼ってください', share_used: 'その投稿はもう使われています', share_required: '投稿のURLを貼ってください', revived: '今日の復活はもう使いました', entry_bad_xid: 'XのIDを確かめてください（英数字と_、15文字まで）', entry_bad_name: '名前を入れてください（12文字まで）', entry_author_mismatch: '投稿したアカウントと、入れたXのIDが違います', entry_no_cash: '今日の発送（現金化）がまだありません。発送してから応募してください' }[code] || '通信に失敗しました。もう一度どうぞ';
  };

  // 演出の種類の名前と、何を見ればアツいかのひとこと（タイトルの頭に付ける）
  // 抽選中の掛け声（2026-11-02 岸田「抽選中…ではなく、切れ！割れ！当てろ！開け！とかに」）
  var FX_SHOUT = { dice: '揃えろ！', logo: '明かせ！', count: '止まれ！', pack: '光れ！', crystal: '割れ！', card: '色を変えよ！', charge: 'たまれ！', capsule: '出ろ！', slot: '揃えろ！', door: '開け！', chain: 'ちぎれ！', moon: '満ちろ！', torii: '灯れ！', sword: '切れ！', disco: '光らせろ！', roulette: '止めろ！', firework: '打ち上げろ！', chest: 'こじ開けろ！', thunder: '落とせ！' };
  var FX_NAME = { dice: 'チンチロ', logo: 'ロゴ増殖', count: 'カウントダウン', pack: 'パック発光', crystal: 'クリスタル割り', card: 'カード変色', charge: 'メカチャージ', capsule: 'カプセル', slot: 'スロット', door: '扉', chain: '鎖', moon: '月', torii: '鳥居', sword: '一刀両断', disco: 'ミラーボール', roulette: 'ルーレット', firework: '花火', chest: '宝箱', thunder: '雷' };
  // ---- 一覧 ----
  var rows = Array.prototype.slice.call(root.querySelectorAll('[data-sim-row]'));
  var rowOrder = rows.map(function (r) { return r.getAttribute('data-id'); }); // 一覧の元の並び（安い順）。演出の種類を順番に割り振るのに使う
  // サムネの背景に演出の種類のすかしを出す（2026-11-01 岸田 案A）
  rows.forEach(function (r) {
    var id = r.getAttribute('data-id'), v = r.querySelector('.sim-card__visual'), fx = fxOf({ id: id });
    if (v) v.setAttribute('data-fx', fx);
    // タイトルの頭に演出の名前（2026-11-01 岸田「タイトルで演出の意味合いが伝わるように」）
    var ti = r.querySelector('.sim-card__title'); if (ti) ti.innerHTML = fxTag(fx) + esc(ti.textContent);
    // 引くのに必要なレベルの札（ビギナーで引けるものは付けない。ゲームのときだけ見せる）
    var need = levelFor(+r.getAttribute('data-price'));
    if (v && need && need.key !== 'beginner') { var lv = document.createElement('span'); lv.className = 'sim-card__lv sim-card__lv--' + need.key; lv.textContent = lvLabel(need); v.appendChild(lv); }
  });
  var tbody = rows.length ? rows[0].parentNode : null; // カードの並ぶ <ul>
  var currentSite = 'all';
  function applyFilter() {
    rows.forEach(function (r) { r.classList.toggle('is-hidden', currentSite !== 'all' && r.getAttribute('data-site') !== currentSite); });
  }
  Array.prototype.forEach.call(root.querySelectorAll('[data-sim-site]'), function (b) {
    b.addEventListener('click', function () {
      currentSite = b.getAttribute('data-sim-site');
      Array.prototype.forEach.call(root.querySelectorAll('[data-sim-site]'), function (x) { var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      applyFilter();
    });
  });
  var sortMode = 'price-asc';
  Array.prototype.forEach.call(root.querySelectorAll('[data-sim-sortbtn]'), function (b) {
    b.addEventListener('click', function () {
      sortMode = b.getAttribute('data-sim-sortbtn');
      Array.prototype.forEach.call(root.querySelectorAll('[data-sim-sortbtn]'), function (x) { var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      applySort();
    });
  });
  function applySort() {
    if (!tbody) return;
    var mode = sortMode;
    var num = function (r, k) { return parseFloat(r.getAttribute('data-' + k)) || 0; };
    rows.sort(function (a, b) {
      switch (mode) {
        case 'hit': return num(b, 'hit') - num(a, 'hit');
        case 'price-asc': return num(a, 'price') - num(b, 'price');
        case 'price-desc': return num(b, 'price') - num(a, 'price');
        case 'left': return (num(a, 'left') / num(a, 'tot')) - (num(b, 'left') / num(b, 'tot'));
        default: return (num(b, 'rate') - num(a, 'rate')) || (num(a, 'price') - num(b, 'price'));
      }
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
  }

  rows.forEach(function (r) {
    r.addEventListener('click', function (e) { if (e.target.closest('a[href]:not([data-sim-pick])')) return; e.preventDefault(); select(r.getAttribute('data-id')); });
    r.addEventListener('keydown', function (e) { if (e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(r.getAttribute('data-id')); } });
  });

  function updateLeftCells(boxes) {
    rows.forEach(function (r) {
      var id = r.getAttribute('data-id');
      var full = parseInt(r.getAttribute('data-tot'), 10) || 0;
      setRowLeft(r, full);
    });
  }

  function setRowLeft(r, left) {
    var tot = parseInt(r.getAttribute('data-tot'), 10) || 1;
    r.setAttribute('data-left', left);
    var cell = r.querySelector('[data-sim-left]');
    var bar = r.querySelector('[data-sim-left-bar]');
    if (cell) cell.textContent = fmt(left);
    if (bar) bar.style.width = Math.max(0, Math.min(100, left / tot * 100)) + '%';
  }

  // ---- 箱 ----
  var playSec = root.querySelector('[data-sim-play]');
  var playInner = root.querySelector('[data-sim-play-inner]');
  var current = null; // { gacha, box, stats }
  var busy = false;

  function badgeClass(gacha, idx) {
    if (idx < 0 || idx >= gacha.tiers.length) return 'sim-badge--hz';
    var rl = gacha.tiers[idx].rl;
    var gi = -1;
    gacha.groups.forEach(function (g, i) { if (gi < 0 && g.rl === rl) gi = i; });
    return ['sim-badge--top', 'sim-badge--high', 'sim-badge--mid'][gi] || 'sim-badge--low';
  }
  // その景品が何番目の賞か（0=1等）。賞のまとまり（groups）の並び順で数える
  // 2026-10-31 岸田: 当たり＝1口の価格以上の pt の景品。下回ればハズレ扱い（pt が無い発送のみの景品は相場で見る）
  // 2026-11-01 岸田: 1回（10連なら10口分）で使った額より、出たカードの合計が下回ればハズレ。例: 1,500の10連で1,400ならハズレ
  function pullValue(gacha, res) {
    var v = 0, cnt = 0;
    res.hits.forEach(function (h) { var t = gacha.tiers[h[0]]; v += (t.pt != null ? t.pt : (t.m || 0)) * h[1]; cnt += h[1]; });
    if (gacha.hz && gacha.hz.pt) v += gacha.hz.pt * Math.max(0, res.n - cnt);
    return v;
  }
  function pullWin(gacha, res) { return pullValue(gacha, res) >= res.cost; }
  function rankOf(gacha, idx) {
    var t = gacha.tiers[idx]; if (!t || !gacha.groups) return -1;
    var key = t.rl !== '' ? t.rl : t.r;
    for (var i = 0; i < gacha.groups.length; i++) if (gacha.groups[i].rl === key) return i;
    return -1;
  }
  function stageClass(gacha, idx) {
    var c = badgeClass(gacha, idx);
    return c === 'sim-badge--top' ? 'sim-stage--top' : c === 'sim-badge--high' ? 'sim-stage--high' : c === 'sim-badge--mid' ? 'sim-stage--mid' : '';
  }

  function select(id) {
    if (busy) return;
    rows.forEach(function (r) { if (r.getAttribute('data-id') === id && r.classList.contains('is-unlocked')) { r.classList.remove('is-unlocked'); var nw = r.querySelector('.sim-card__new'); if (nw) nw.remove(); } });
    rows.forEach(function (r) { r.classList.toggle('is-selected', r.getAttribute('data-id') === id); });
    if (history.replaceState) history.replaceState(null, '', '#id=' + id);
    playSec.hidden = false;
    playInner.innerHTML = '<p class="sim-play__empty">箱を開けています…</p>';
    toPlayTop(true);
    api('gacha', { id: id }).then(function (j) {
      var fullCounts = (j.gacha.tiers || []).map(function (t) { return +t.q || 0; });
      fullCounts.push(j.gacha.hz ? (+j.gacha.hz.q || 0) : 0);
      current = { gacha: j.gacha, box: { round: 1, left: +j.gacha.tot || 0, pulls: 0, counts: fullCounts }, stats: j.stats, local: true };
      renderBox();
      toPlayTop(false); // 箱を描いたあと高さが変わるので、もう一度合わせる
    }).catch(function (e) {
      playInner.innerHTML = '<p class="sim-play__empty">' + esc(errText(e.code)) + '</p>';
    });
  }

  // ガチャを選んだら最上部へ（2026-10-31 岸田: ミッションの位置に止まることがあった）。
  // ゲーム中は上の帯が隠れているのでページの一番上、それ以外は「引く」の箱の頭
  function toPlayTop(smooth) {
    var y = play === 'game' && wallet.rolled ? 0 : Math.max(0, playSec.getBoundingClientRect().top + window.pageYOffset - 80);
    window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' });
  }

  function renderBox() {
    var g = current.gacha, b = current.box;
    var unit = g.unit;
    var atariLeft = 0;
    for (var i = 0; i < g.tiers.length; i++) atariLeft += b.counts[i];
    var hit = b.left > 0 ? atariLeft / b.left : 0;
    var crowd = current.stats && current.stats.cost > 0 ? current.stats : null;
    var html = '' +
      '<div class="sim-box">' +
        '<div class="sim-box__head">' + (g.thumb ? '<span class="sim-cardframe sim-box__thumbwrap"><img class="sim-box__thumb" src="' + esc(g.thumb) + '" alt="" decoding="async">' + (g.thumb_psa ? '<span class="sim-psa" aria-label="PSA10"><b>10</b><small>PSA</small></span>' : '') + '</span>' : '') + '<div class="sim-box__headtxt">' +
          '<h3 class="sim-box__title">' + (current.local ? '' : fxTag(fxOf(g))) + esc(g.t) + '</h3>' + '</div>' +
          (current.local ? '<div class="sim-box__tools"><button type="button" class="sim-btn sim-btn--ghost sim-btn--small" data-sim-copy>共有リンクをコピー</button><button type="button" class="sim-btn sim-btn--ghost sim-btn--small" data-sim-edit>入力に戻る</button><button type="button" class="sim-btn sim-btn--ghost sim-btn--small" data-sim-refill>箱を最初に戻す</button></div>' : '') +
        '</div>' +
        (current.local && shots.length ? '<div class="sim-box__shots">' + shots.map(function (x) { return '<img class="sim-box__shot" src="' + esc(x.url) + '" alt="元にしたスクショ">'; }).join('') + '</div>' : '') +
        // ゲームでは数字の欄は出さず、残り口数だけをゲージの上に1行で（還元率・当たり確率は分析モードだけ）
        (play === 'game' ? '<p class="sim-box__leftline"><span>残り口数（第' + fmt(b.round) + '回）</span> <strong class="sim-num" data-sim-box-left>' + fmt(b.left) + '<small> / ' + fmt(g.tot) + '</small></strong></p>' : '<dl class="sim-box__kv">' +
          '<div><dt>1口</dt><dd>' + fmt(g.pr) + '<small>' + esc(unit) + '</small></dd></div>' +
          '<div><dt>残り口数（第' + fmt(b.round) + '回）</dt><dd data-sim-box-left>' + fmt(b.left) + '<small> / ' + fmt(g.tot) + '</small></dd></div>' +
          '<div><dt>当たり</dt><dd data-sim-box-hit>' + (hit > 0 ? '1/' + fmt(Math.round(1 / hit)) : '—') + '<small> 残り' + fmt(atariLeft) + '枚</small></dd></div>' +
          '<div><dt>理論還元率（pt）</dt><dd>' + pct(g.rate_pt) + (g.pt_unknown > 0 ? '<small>*</small>' : '') + '</dd></div>' +
          (current.local
            ? '<div><dt>この箱であなたが引いた分</dt><dd data-sim-box-crowd>' + (crowd ? pct(crowd.pt / crowd.cost) + '<small> ' + fmt(crowd.n) + '口</small>' : '—<small> まだ引いていません</small>') + '</dd></div>'
            : '<div><dt>この箱でのみんなの実測</dt><dd data-sim-box-crowd>' + (crowd ? pct(crowd.pt / crowd.cost) + '<small> ' + fmt(crowd.n) + '口</small>' : '—<small> まだ誰も引いていません</small>') + '</dd></div>') +
        '</dl>') +
        '<div class="sim-meter"><div class="sim-meter__bar" data-sim-meter style="width:' + Math.max(0, Math.min(100, b.left / g.tot * 100)) + '%"></div></div>' +
        (play === 'game' ? '<div class="sim-box__wallet"><span class="sim-coin" aria-hidden="true">P</span>オリ得コイン <strong class="sim-num" data-sim-wallet-pt>' + fmt(wallet.pt) + '</strong>枚</div>' : '') +
        '<div class="sim-actions">' +
          cfg.allowed.map(function (n) { return '<button type="button" class="sim-btn' + (n === 1 ? ' sim-btn--yellow' : '') + '" data-sim-pull="' + n + '">' + (n === 1 ? '1回' : n + '連') + 'ガチャ <span class="sim-btn__cost">' + fmt(g.pr * n) + esc(unit) + '</span></button>'; }).join('') +
          '<p class="sim-actions__note">' + (current.local ? 'お金はかかりません。入力した数字で、この端末の中だけで引きます。' : (play === 'game' ? '<strong>10連・100連は1口の価格以上のカードが1枚確定。</strong>' : '') + 'お金はかかりません。金額は実在オリパの公開価格を使った架空の数字です。') + (g.pt_unknown > 0 ? ' *発送のみ（pt交換不可）の景品は0ptとして計算。' : '') + '</p>' +
        '</div>' +
        '<div class="sim-stage" data-sim-stage hidden aria-live="polite"><div><div class="sim-stage__text" data-sim-stage-text></div><span class="sim-stage__sub" data-sim-stage-sub></span></div></div>' +
        '<div class="sim-result" data-sim-result hidden></div>' +
        '<details class="sim-lineup"><summary>ラインナップと残り枚数</summary><div data-sim-lineup></div></details>' +
      '</div>';
    playInner.innerHTML = html;
    renderLineup();
    Array.prototype.forEach.call(playInner.querySelectorAll('[data-sim-pull]'), function (btn) {
      btn.addEventListener('click', function () { pull(parseInt(btn.getAttribute('data-sim-pull'), 10)); });
    });
    var el;
    if ((el = playInner.querySelector('[data-sim-copy]'))) el.addEventListener('click', function () { copyShare(el); });
    if ((el = playInner.querySelector('[data-sim-edit]'))) el.addEventListener('click', function () { var mk = root.querySelector('#make'); if (mk) mk.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    if ((el = playInner.querySelector('[data-sim-refill]'))) el.addEventListener('click', function () { if (busy) return; current.box = freshBox(current.gacha, 1); current.stats = null; renderBox(); });
  }

  function renderLineup() {
    var g = current.gacha, b = current.box;
    var wrap = playInner.querySelector('[data-sim-lineup]');
    if (!wrap) return;
    var html = '';
    g.groups.forEach(function (grp, gi) {
      var cls = ['sim-badge--top', 'sim-badge--high', 'sim-badge--mid'][gi] || 'sim-badge--low';
      var left = 0, items = '';
      g.tiers.forEach(function (t, i) {
        if (t.rl !== grp.rl) return;
        left += b.counts[i];
        items += '<li class="sim-prize' + (b.counts[i] <= 0 ? ' is-gone' : '') + (t.img ? ' has-img' : '') + '">' +
          cardFrame(t, 'sim-prize__img', 0, true) +
          '<span class="sim-prize__name" title="' + esc(t.n || t.rl) + '">' + esc(t.n || t.rl) + '</span>' +
          '<span class="sim-prize__pt">' + (t.pt != null ? fmt(t.pt) + esc(g.unit) : '発送のみ') + '</span>' +
          '<span class="sim-prize__left">残り ' + fmt(b.counts[i]) + '/' + fmt(t.q) + '枚' + prizeLink(t.link) + '</span>' +
        '</li>';
      });
      html += '<div class="sim-group"><h4 class="sim-group__h"><span class="sim-badge ' + cls + '">' + esc(grp.rl) + '</span><span class="sim-group__meta">' + fmt(grp.kinds) + '種・残り ' + fmt(left) + '/' + fmt(grp.q) + '枚' + (grp.pt_min != null ? ' ・ ' + fmt(grp.pt_min) + (grp.pt_max !== grp.pt_min ? '〜' + fmt(grp.pt_max) : '') + esc(g.unit) : '') + '</span></h4><ul class="sim-prizes">' + items + '</ul></div>';
    });
    var hzLeft = b.counts[g.tiers.length];
    html += '<div class="sim-group"><h4 class="sim-group__h"><span class="sim-badge sim-badge--hz">' + esc(g.hz.n) + '</span><span class="sim-group__meta">残り ' + fmt(hzLeft) + '/' + fmt(g.hz.q) + '口' + (g.hz.pt != null ? ' ・ ' + fmt(g.hz.pt) + esc(g.unit) : ' ・ pt非公開') + '</span></h4></div>';
    wrap.innerHTML = html;
  }

  function updateBoxView() {
    var g = current.gacha, b = current.box;
    var atariLeft = 0;
    for (var i = 0; i < g.tiers.length; i++) atariLeft += b.counts[i];
    var hit = b.left > 0 ? atariLeft / b.left : 0;
    var el;
    if ((el = playInner.querySelector('[data-sim-box-left]'))) el.innerHTML = fmt(b.left) + '<small> / ' + fmt(g.tot) + '</small>';
    if ((el = playInner.querySelector('[data-sim-box-hit]'))) el.innerHTML = (hit > 0 ? '1/' + fmt(Math.round(1 / hit)) : '—') + '<small> 残り' + fmt(atariLeft) + '枚</small>';
    if ((el = playInner.querySelector('[data-sim-meter]'))) el.style.width = Math.max(0, Math.min(100, b.left / g.tot * 100)) + '%';
    var dt = playInner.querySelector('[data-sim-box-left]') && playInner.querySelector('[data-sim-box-left]').previousElementSibling;
    if (dt) dt.textContent = '残り口数（第' + fmt(b.round) + '回）';
    if ((el = playInner.querySelector('[data-sim-box-crowd]')) && current.stats && current.stats.cost > 0) el.innerHTML = pct(current.stats.pt / current.stats.cost) + '<small> ' + fmt(current.stats.n) + '口</small>';
    renderLineup();
    if (current.local) return;
    var row = root.querySelector('[data-sim-row][data-id="' + g.id + '"]');
    if (row) setRowLeft(row, b.left);
  }

  // ---- 引く ----
  function pull(n) {
    if (busy || !current) return;
    var g = current.gacha;
    var need = g.pr * n;
    if (play === 'game') {
      if (!wallet.rolled) { openRoulette(); return; }
      if (wallet.done) {
        var st1 = playInner.querySelector('[data-sim-stage]');
        st1.className = 'sim-stage'; st1.hidden = false; stageImg(null);
        playInner.querySelector('[data-sim-stage-text]').textContent = '今日のゲームは終了しました';
        playInner.querySelector('[data-sim-stage-sub]').textContent = '結果はランキングで確かめられます。明日またルーレットから遊べます。';
        return;
      }
      if (wallet.level && wallet.level.max_price && g.pr > wallet.level.max_price && !current.local) {
        var lk = levelFor(g.pr), sl = playInner.querySelector('[data-sim-stage]');
        sl.className = 'sim-stage'; sl.hidden = false; stageImg(null);
        playInner.querySelector('[data-sim-stage-text]').textContent = 'このガチャは' + (lk ? lvLabel(lk) : '上のレベル') + 'で解放';
        playInner.querySelector('[data-sim-stage-sub]').textContent = (lk ? lk.name + 'は ' + fmt(lk.min) + 'コインから。' : '') + 'コインを増やしてレベルを上げると引けます。';
        return;
      }
      if (wallet.pt < need) { // 追加チャージは無い。足りなければ今週はここまで（安いガチャか少ない連なら続けられる）
        openOver(isOver() ? 'over' : 'short', need - wallet.pt); // 目立つ画面で出して、Xシェアでの復活に誘う
        return;
      }
    }
    busy = true;
    if (play === 'game') hintDone('pick');
    sfx.pull();
    var stage = playInner.querySelector('[data-sim-stage]');
    var stText = playInner.querySelector('[data-sim-stage-text]');
    var stSub = playInner.querySelector('[data-sim-stage-sub]');
    var result = playInner.querySelector('[data-sim-result]');
    Array.prototype.forEach.call(playInner.querySelectorAll('[data-sim-pull]'), function (b) { b.disabled = true; });
    result.hidden = true;
    stage.className = 'sim-stage sim-stage--spin';
    stage.hidden = false;
    Array.prototype.forEach.call(stage.querySelectorAll('.sim-confetti, .sim-hitfx'), function (el) { el.remove(); }); // すぐ引き直したとき、前の回の紙吹雪を残さない
    if (stage.firstChild && stage.firstChild.classList) stage.firstChild.className = '';
    stageImg(null);
    stage.classList.add('is-drawing');
    stageToPop(true); // 2026-10-31 岸田: 引いた時点でポップアップを出して、その中で演出する
    var drawInfo = rpop && rpop.querySelector('[data-sim-rpop-draw]');
    if (drawInfo) drawInfo.innerHTML = (g.thumb ? '<span class="sim-cardframe sim-rpop__draw-thumb"><img src="' + esc(g.thumb) + '" alt="" decoding="async"></span>' : '') +
      '<span class="sim-rpop__draw-txt"><b>' + esc(g.t) + '</b><small>' + (n === 1 ? '1回' : n + '連') + ' ・ −' + fmt(need) + 'pt' + (play === 'game' ? '（残り <span class="sim-num">' + fmt(Math.max(0, wallet.pt - need)) + '</span>pt）' : '') + '</small></span>';
    // 抽選中の演出はガチャごとに8種類（2026-10-31 岸田・11/01にテーマ演出5種を追加）。2〜5等が出るときは途中で熱くなる（2等ほど多い）
    //   logo: オリ得のロゴが増えていく / pack: パックが震えて光が強くなる / card: カードの裏面が回って色が変わる
    var fx = fxOf(g), heat = 0;
    var logos = document.createElement('div');
    var th = THEMES[fx]; // 2026-11-01 テーマ演出（チンチロ・カウントダウン・クリスタル・メカチャージ・カプセル）
    logos.className = th ? 'sim-th sim-th--' + fx : fx === 'logo' ? 'sim-stage__logos is-secret' : 'sim-fx sim-fx--' + fx; // ロゴ増殖は黒いシークレットのまま増え、最後に解ければ当たり（2026-11-02 岸田）
    if (th) logos.innerHTML = th.html;
    else if (fx !== 'logo') logos.innerHTML = '<i class="sim-fx__obj"><img src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""></i>';
    var addLogo = function () {
      if (th) return;
      if (fx !== 'logo') { heat++; logos.setAttribute('data-heat', String(Math.min(heat, 5))); return; }
      var im = document.createElement('img'); im.src = cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp'; /* 古いキャッシュの HTML（cfg.logo 無し）でもロゴを出す */ im.alt = ''; logos.appendChild(im);
    };
    addLogo();
    stage.firstChild.insertBefore(logos, stage.firstChild.firstChild);
    stText.textContent = FX_SHOUT[fx] || '当てろ！';
    stSub.textContent = '';
    var started = Date.now();
    var ptBefore = wallet.pt; // 結果に「持ちポイント ◯→◯」を出すため
    var job = current.local ? Promise.resolve(localPull(g, current.box, n)) : api('pull', play === 'game' ? { id: g.id, n: n, game: 1 } : { id: g.id, n: n });
    job.then(function (res) {
      var T = { ids: [], ivs: [], dead: false };
      res.ptBefore = ptBefore;
      var rank = res.best_idx >= 0 ? rankOf(g, res.best_idx) : -1; // 0=1等, 1=2等…
      ga('sim_pull', { gacha_id: String(g.id), pulls: n, mode: play === 'game' ? 'game' : (current.local ? 'local' : 'analyze'), hit_rank: rank + 1, best_pt: +res.best_pt || 0 }); // hit_rank: 1=1等…、0=ハズレ
      // 予告（2026-11-01 岸田「熱い演出・激アツ演出などバリエーションを」）: 保留の玉が 白→青→緑→赤→金→虹 と変わり、
      // 赤で「熱い！」、金で「激アツ！！」、虹で「超激アツ！！！」。色は結果から重みつきで選ぶ（ハズレでもたまに赤まで上がる＝ガセ）
      var yk = yokoku(g, res, rank);
      // 2026-11-01 岸田「もっと演出ふやして」: カウントダウン・擬似連・群予告・背景変化・フリーズ・PUSHボタンを、熱さに合わせて組み合わせる
      var t0 = Math.max(0, 700 - (Date.now() - started));
      var box = document.createElement('div');
      box.className = 'sim-yk';
      box.innerHTML = '<i class="sim-yk__orb is-c0"></i><b class="sim-yk__telop"></b>';
      box.classList.add('is-noorb'); // 2026-11-02 岸田: 保留の玉はどの演出でも出さない（熱さは演出の物の色で見せる）
      stage.firstChild.appendChild(box);
      var orb = box.firstChild, telop = box.lastChild, STEP = 560, at = t0;
      var chanceUp = function (c, ms) {
        telop.textContent = yk.telop || 'チャンスアップ'; telop.className = 'sim-yk__telop is-c' + c;
        clearTimeout(telop._t); telop._t = setTimeout(function () { telop.textContent = ''; telop.className = 'sim-yk__telop'; }, ms);
      };
      var later = function (ms, fn) { withTimers(T, function () { setTimeout(fn, ms); }); };
      if (yk.cutin) { later(at, function () { cutin(stage, yk.cutin); }); at += 900; }
      if (yk.freeze) { later(at, function () { freeze(stage); }); at += 1900; }
      if (th) { box.classList.add('is-th'); stText.textContent = FX_SHOUT[fx] || th.label || '当てろ！'; }
      if (yk.count && fx !== 'count') { later(at, function () { countdown(stage); }); at += 1500; }
      for (var q = 1; q <= yk.renzoku; q++) (function (q) { later(at, function () { renzoku(stage, q + 1, Math.max(1, Math.min(yk.color, q))); }); }(q)), at += 750;
      if (yk.bg) later(at, function () { stage.classList.add('sim-yk-bg-' + yk.bg); playSe('gong-played2', { vol: 0.45, dur: 1.2 }); });
      if (yk.group) later(at, function () { group(stage, yk.group); });
      if (th) {
        // テーマ演出: 玉の代わりにテーマごとの合図（サイコロの色・カウントの色・ヒビ・メーター・カプセルの色）で熱さを出す
        var plan = th.plan(yk);
        // チャンスアップは色が上がる瞬間に出して消す（最後に出すと意味が分からない。2026-11-02 岸田）。テーマ演出は始まる前に出す
        if (yk.color >= 1) { later(at, function () { chanceUp(yk.color, 850); stage.classList.add('sim-yk-c' + yk.color); }); at += 850; }
        later(at, function () { th.run(logos, stage, yk, plan); });
        at += plan.dur + 300;
      } else {
        for (var k = 1; k <= yk.color; k++) (function (c) {
          later(at + (c - 1) * STEP, function () {
            orb.className = 'sim-yk__orb is-c' + c + ' is-up';
            if (fx !== 'logo') logos.setAttribute('data-heat', String(Math.min(c, 5)));
            else { // チャンスアップでロゴが増える。赤以上はめっちゃ増えて、画面いっぱいの演出も
              var add = c <= 2 ? c : c * 5, cap = c <= 2 ? 6 : 30;
              for (var a = 0; a < add && logos.children.length < cap; a++) (function (a) { setTimeout(addLogo, a * 45); }(a));
              logos.classList.toggle('is-many', c >= 3);
              if (c === yk.color && c >= 3) logoRush(stage, c);
            }
            logos.setAttribute('data-yk', String(c)); // パック発光は玉を出さず、パックそのものを玉の色にする（2026-11-02 岸田）
            chanceUp(c, c === yk.color ? 800 : STEP - 60); // 色が上がるたびにカットインして消える
            if (c === yk.color) stage.classList.add('sim-yk-c' + c);
            if (c >= 4) { sfx.shake(); playSe(c === 5 ? 'trumpet1' : 'jajean1', { vol: 0.8 }); }
            else if (c === 3) playSe('jean1', { vol: 0.75 });
            else playSe('kira1', { vol: 0.5 + c * 0.05 });
          });
        }(k));
        at += yk.color * STEP + (yk.color >= 3 ? 1100 + (fx === 'logo' ? 700 : 0) : 450);
        if (fx === 'card') { // カード変色: 最初はグレー。当たり（使ったpt以上）なら色が付く（青〜虹）、ハズレはグレーのまま（2026-11-02 岸田）
          later(at, function () {
            stopRollNow();
            if (thWin(yk)) { logos.setAttribute('data-win', String(Math.max(1, yk.color))); logos.classList.add('is-win'); playSe('jajean1', { vol: 0.8 }); if (yk.color >= 3) sfx.shake(); }
            else { logos.classList.add('is-lose'); playSe('cursor1', { vol: 0.5, dur: 0.3 }); }
          });
          at += 1000;
        }
        if (fx === 'logo') { // 最後にシークレットが解けたら当たり。解けなければハズレ
          later(at, function () {
            stopRollNow();
            if (thWin(yk)) { logos.classList.remove('is-secret'); logos.classList.add('is-open'); playSe('jajean1', { vol: 0.85 }); if (yk.color >= 3) sfx.shake(); }
            else { logos.classList.add('is-fail'); playSe('cursor1', { vol: 0.5, dur: 0.3 }); }
          });
          at += 1000;
        }
      }
      var wait = Math.max(Math.max(0, 2000 - (Date.now() - started)), at); // ドラムロールは2秒以上
      var clean = function () {
        if (box.parentNode) box.remove();
        for (var c = 1; c <= 5; c++) stage.classList.remove('sim-yk-c' + c);
        stage.classList.remove('sim-yk-bg-fire', 'sim-yk-bg-gold', 'sim-yk-bg-night', 'sim-th-glitch', 'sim-th-night', 'sim-th-flash');
        Array.prototype.forEach.call(stage.querySelectorAll('.sim-yk-fx'), function (el) { el.remove(); });
      };
      var gone = false;
      var go = function () {
        if (gone) return;
        gone = true; stage._skip = null;
        killTimers(T); // 残っている予告のタイマー・回りっぱなしの目を止める
        window.setTimeout = nativeST; window.setInterval = nativeSI; // ここから先（結果の表示）のタイマーは止める対象にしない
        Array.prototype.forEach.call(stage.querySelectorAll('.sim-yk-cut'), function (el) { el.remove(); });
        stage.classList.remove('is-drawing');
        // 復活があるテーマ演出は、負けた止まり方を残したまま「ハズレ…」→「復活！！」→ 同じ演出をやり直して揃うところを見せる（2026-11-01 岸田）
        if (th && yk.revive && thWin({ cat: yk.cat })) res.th = { el: logos, th: th };
        else if (logos.parentNode) logos.remove();
        clean(); res.yk = yk; reveal(res, n);
      };
      later(wait, function () { if (yk.button) pushButton(stage, yk.color, go); else go(); });
      // 抽選中でも飛ばせる（2026-11-14: 押して何も起きないボタンを作らない）。飛ばすと予告を止めて、すぐ「当たり／ハズレ」の瞬間へ
      stage._skip = function () { stopRollNow(); go(); };
      if (!(play === 'game' && !current.local)) stage.onclick = function () { if (stage._skip) stage._skip(); }; // ポップアップを使わない画面は、演出を押して飛ばす
    }).catch(function (e) {
      stage.className = 'sim-stage';
      stText.textContent = errText(e.code);
      stSub.textContent = '';
      finishPull();
    });
  }

  // ---- 予告演出 ----
  // 保留の色ごとのテロップ。同じ色でも言い回しを変える
  // 2026-11-01 岸田: 文字は「チャンスアップ」だけ。期待度は文字色で見せる（青→緑→赤→金→虹。白はテロップなし）
  var YK_TELOP = [[''], ['チャンスアップ'], ['チャンスアップ'], ['チャンスアップ'], ['チャンスアップ'], ['チャンスアップ']];
  // 結果ごとの保留の色の重み [白, 青, 緑, 赤, 金, 虹]。
  // 2026-11-01 岸田「チャンスアップのわりに当たるカードが普通。演出が派手なときは上位の等級が当たるように」:
  // 合計が使ったptの1.5倍以上で赤、3倍以上で金、10倍以上（か1等）で虹が出やすい。ハズレ・トントンは緑まで（ガセは青・緑の小さなものだけ）
  var YK_W = {
    lose: [80, 17, 3, 0, 0, 0],
    low:  [55, 35, 10, 0, 0, 0],
    r34:  [5, 20, 40, 35, 0, 0],
    r12:  [0, 0, 5, 40, 45, 10],
    r0:   [0, 0, 0, 10, 45, 45]
  };
  var YK_CUT = ['来るか…！？', 'まさか…！？', 'チャンス到来！', 'ここで来る！？', '流れが変わった…！', '何かが起きる…！'];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function pickW(w) { var sum = w.reduce(function (a, b) { return a + b; }, 0), r = Math.random() * sum; for (var i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return 0; }
  function yokoku(g, res, rank) {
    var won = pullWin(g, res);
    // 熱さは「出たカードの合計 ÷ 使ったpt」で決める（2026-11-01 岸田「総合値が高いものを出して」）。1等はいつも最上位
    var ratio = res.cost ? pullValue(g, res) / res.cost : 0;
    var cat = !won ? 'lose' : rank === 0 || ratio >= 10 ? 'r0' : ratio >= 3 ? 'r12' : ratio >= 1.5 ? 'r34' : 'low';
    // フリーズ（真っ暗で止まる）は2等以上だけ。出たら金以上が確定
    var freeze = Math.random() < ({ r0: 0.3, r12: 0.05 }[cat] || 0);
    var color = pickW(YK_W[cat]);
    if (freeze) color = Math.max(color, 4);
    if (DBG.c) color = Math.max(0, Math.min(5, +DBG.c));
    if (DBG.cat && won) cat = DBG.cat; // 結果が当たりのときだけ段を上書き（ハズレを当たりにはできない）
    var hot = color >= 3;
    return {
      cat: cat,
      color: color,
      telop: pick(YK_TELOP[color]),
      freeze: freeze,
      // カットイン: 赤以上ではよく出る。下位・ハズレではまれ（派手な演出＝上位、を崩さない）
      cutin: Math.random() < (hot ? 0.6 : color >= 2 ? 0.08 : 0.02) ? pick(YK_CUT) : '',
      count: Math.random() < (hot ? 0.4 : 0.03),                                     // 3・2・1
      renzoku: pickW(color >= 4 ? [25, 35, 40] : color === 3 ? [50, 35, 15] : [97, 3, 0]), // 擬似連 ×2・×3
      group: Math.random() < (color >= 4 ? 0.6 : color === 3 ? 0.3 : 0) ? (color >= 4 ? 'gold' : 'normal') : '', // 群予告（赤以上だけ）
      bg: color >= 4 && Math.random() < 0.7 ? 'gold' : hot && Math.random() < 0.5 ? 'fire' : !hot && Math.random() < 0.06 ? 'night' : '', // 背景変化
      button: Math.random() < (hot ? 0.5 : 0.03),                                    // 最後に PUSH ボタン
      revive: cat === 'r34' && Math.random() < 0.25                                   // 結果で一度ハズレに見せて「復活」（合計1.5〜3倍のときだけ。トントンで復活させると肩すかし）
    };
  }
  function fxEl(stage, cls, html) {
    var el = document.createElement('div');
    el.className = 'sim-yk-fx ' + cls;
    el.innerHTML = html;
    stage.appendChild(el);
    return el;
  }
  // 画面を横切る帯の文字（カットイン）
  function cutin(stage, text) {
    var el = document.createElement('div');
    el.className = 'sim-yk-cut';
    el.innerHTML = '<span>' + esc(text) + '</span>';
    stage.appendChild(el);
    playSe('shine1', { vol: 0.5, dur: 0.9 });
    setTimeout(function () { if (el.parentNode) el.remove(); }, 1000);
  }
  // 3・2・1 の大きな数字
  function countdown(stage) {
    var el = fxEl(stage, 'sim-yk-count', '<b></b>'), b = el.firstChild;
    [3, 2, 1].forEach(function (v, i) {
      setTimeout(function () { b.textContent = v; b.className = ''; void b.offsetWidth; b.className = 'is-on'; playSe('cursor1', { vol: 0.6, dur: 0.3 }); }, i * 450);
    });
    setTimeout(function () { el.remove(); }, 1450);
  }
  // 擬似連: 画面が白く光って「チャンスアップ」。回るたびに色が上がる（最後は保留の色まで。2026-11-01 岸田）
  function renzoku(stage, k, c) {
    var el = fxEl(stage, 'sim-yk-ren', '<b class="is-c' + c + '">チャンスアップ</b>');
    playSe('shakin1', { vol: 0.6 });
    setTimeout(function () { el.remove(); }, 700);
  }
  // 群予告: オリ得のロゴが画面を一気に横切る
  function group(stage, kind) {
    var src = esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp'), html = '';
    for (var i = 0; i < 14; i++) html += '<img src="' + src + '" alt="" style="top:' + (Math.random() * 80).toFixed(1) + '%;animation-delay:' + (Math.random() * 0.6).toFixed(2) + 's">';
    var el = fxEl(stage, 'sim-yk-group' + (kind === 'gold' ? ' is-gold' : ''), html);
    playSe('dondonpafupafu1', { vol: 0.5, dur: 1.3 });
    setTimeout(function () { el.remove(); }, 1500);
  }
  // ロゴ増殖の激アツ（2026-11-02 岸田「画面いっぱいにロゴがびっしり・魚群などパターンを」）: びっしり／魚群／ロゴの雨／爆発 から1つ。虹（c=5）はびっしりの虹版
  function logoRush(stage, c) {
    var src = esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp'), html = '', i;
    var kind = c >= 5 ? 'flood' : pick(['flood', 'school', 'rain', 'burst']);
    var r = function (a, b) { return (a + Math.random() * (b - a)).toFixed(1); };
    if (kind === 'flood') {
      for (var y = 0; y < 6; y++) for (var x = 0; x < 5; x++) html += '<img src="' + src + '" alt="" style="left:' + (x * 22 - 6 + (y % 2) * 11) + '%;top:' + (y * 18 - 4) + '%;--rot:' + r(-14, 14) + 'deg;animation-delay:' + ((x + y) * 0.05).toFixed(2) + 's">';
    } else if (kind === 'school') {
      for (i = 0; i < 22; i++) html += '<img src="' + src + '" alt="" style="top:' + r(5, 80) + '%;--dx:' + r(-25, 0) + '%;animation-delay:' + r(0, 0.35) + 's">';
    } else if (kind === 'rain') {
      for (i = 0; i < 24; i++) html += '<img src="' + src + '" alt="" style="left:' + r(-8, 88) + '%;--rot:' + r(-25, 25) + 'deg;animation-delay:' + r(0, 0.9) + 's">';
    } else {
      for (i = 0; i < 18; i++) { var t = i / 18 * Math.PI * 2; html += '<img src="' + src + '" alt="" style="--tx:' + (50 + Math.cos(t) * r(30, 48)).toFixed(0) + '%;--ty:' + (50 + Math.sin(t) * r(28, 46)).toFixed(0) + '%;--rot:' + r(-30, 30) + 'deg">'; }
    }
    var el = fxEl(stage, 'sim-yk-rush is-' + kind + (c >= 5 ? ' is-rainbow' : c >= 4 ? ' is-gold' : ''), html);
    if (c >= 4) sfx.shake();
    playSe(kind === 'school' ? 'dondonpafupafu1' : 'shakin1', { vol: 0.6, dur: 1.4 });
    setTimeout(function () { el.remove(); }, 1800);
  }
  // フリーズ: 音が止まって真っ暗 →「確定！？」
  function freeze(stage) {
    stopRollNow();
    var el = fxEl(stage, 'sim-yk-freeze', '<b>……</b>');
    setTimeout(function () { el.firstChild.textContent = 'PREMIUM'; el.classList.add('is-on'); playSe('jajean1', { vol: 0.9 }); sfx.shake(); }, 1100);
    setTimeout(function () { el.remove(); }, 1850);
  }
  // 最後に大きな PUSH ボタン。押すか、3秒たつと結果へ。ボタンの色は熱さ
  function pushButton(stage, color, next) {
    var done = false;
    var el = fxEl(stage, 'sim-yk-push is-c' + color, '<button type="button">PUSH!</button>');
    playSe('jean1', { vol: 0.6 });
    var fire = function (e) { if (e) e.stopPropagation(); if (done) return; done = true; el.remove(); playSe('shakin1', { vol: 0.8 }); next(); };
    el.firstChild.addEventListener('click', fire);
    setTimeout(fire, 3000);
  }

  // ---- テーマ演出（2026-11-01 岸田「日本トレカセンターの演出を参考に」） ----
  // 実在オリパのように、ガチャごとに「ここを見ればアツい」合図のある演出を持たせる。
  // 合図は結果から決める（ハズレや復活前は負け顔の止まり方）。名前・キャラクターは借りずに自前で作る
  function thWin(yk) { return yk.cat !== 'lose' && !yk.revive; }
  // 演出の箱の中だけ真っ暗にして（プチュン）→ 文字
  function miniPuchun(stage, text, cls) {
    // 2026-11-23: 箱の中だけでなく画面全体を暗転させてから、箱の中に文字を出す
    var el = fxEl(stage, 'sim-th-dark' + (cls ? ' ' + cls : ''), '<b></b>');
    screenDark(800, function () { el.classList.add('is-on'); el.firstChild.textContent = text; playSe('jajean1', { vol: 0.85 }); });
    setTimeout(function () { el.remove(); }, 1700);
  }
  var THEMES = {
    // ---- 一覧の全部の箱で違う演出にする追加の4種（2026-11-02 岸田「使い回しではなく新しい演出を」）----
    // ルーレット: 盤が回って、針が色のマスに止まれば当たり、グレーのマスはハズレ。マスの色が熱さ
    roulette: {
      label: '',
      html: '<div class="sim-rlt"><i class="sim-rlt__wheel"></i><i class="sim-rlt__pin"></i></div><small class="sim-th__note"></small>',
      plan: function (yk) { var win = thWin(yk); return { win: win, dur: 2600 }; },
      run: function (el, stage, yk, p) {
        var w = el.querySelector('.sim-rlt__wheel'), note = el.querySelector('.sim-th__note');
        if (yk.color >= 1) el.classList.add('sim-k' + yk.color);
        // 当たりのマス（偶数番）に止めるか、グレー（奇数番）に止めるか。8マス・1マス45度
        var seg = (p.win ? 0 : 1) + 2 * Math.floor(Math.random() * 4);
        w.style.setProperty('--to', (360 * 5 - seg * 45 + (Math.random() * 24 - 12)) + 'deg'); // マスの真ん中あたりに止める
        w.classList.add('is-spin'); playSe('cursor1', { vol: 0.6, dur: 0.4 });
        setTimeout(function () {
          if (p.win) { el.classList.add('is-win'); note.textContent = '当たり！'; note.classList.add('is-hot'); playSe('kira1', { vol: 0.8 }); }
          else { note.textContent = 'グレー…'; note.classList.add('is-cold'); }
        }, 2100);
      }
    },
    // 花火: 打ち上がって、大きく開けば当たり。不発ならハズレ。花火の色が熱さ
    firework: {
      label: '',
      html: '<div class="sim-hnb"><i class="sim-hnb__ball"></i><i class="sim-hnb__burst"></i><img class="sim-hnb__logo" src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""></div><small class="sim-th__note"></small>',
      plan: function (yk) { return { win: thWin(yk), dur: 2500 }; },
      run: function (el, stage, yk, p) {
        var note = el.querySelector('.sim-th__note');
        stage.classList.add('sim-th-night');
        if (yk.color >= 1) el.classList.add('sim-k' + yk.color);
        el.classList.add('is-up'); playSe('shine1', { vol: 0.5, dur: 1 });
        setTimeout(function () {
          if (p.win) { el.classList.add('is-boom'); note.textContent = 'たまや〜！'; note.classList.add('is-hot'); playSe('jajean1', { vol: 0.85 }); if (yk.color >= 3) sfx.shake(); }
          else { el.classList.add('is-dud'); note.textContent = '不発…'; note.classList.add('is-cold'); }
        }, 1200);
        setTimeout(function () { stage.classList.remove('sim-th-night'); }, 2500);
      }
    },
    // 宝箱: ガタガタ揺れて、開いて光があふれれば当たり。空っぽならハズレ。光の色が熱さ
    chest: {
      label: '',
      html: '<div class="sim-chest"><i class="sim-chest__glow"></i><img class="sim-chest__logo" src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""><i class="sim-chest__box"></i><i class="sim-chest__lid"></i></div><small class="sim-th__note"></small>',
      plan: function (yk) { return { win: thWin(yk), dur: 2400 }; },
      run: function (el, stage, yk, p) {
        var note = el.querySelector('.sim-th__note');
        if (yk.color >= 1) el.classList.add('sim-k' + yk.color);
        [300, 750, 1150].forEach(function (ms, i) { setTimeout(function () { el.classList.remove('is-rattle'); void el.offsetWidth; el.classList.add('is-rattle'); playSe('cursor1', { vol: 0.55 + i * 0.1, dur: 0.3 }); }, ms); });
        setTimeout(function () {
          el.classList.add('is-open', p.win ? 'is-win' : 'is-empty');
          if (p.win) { note.textContent = 'お宝！'; note.classList.add('is-hot'); playSe('shine1', { vol: 0.85, dur: 1 }); }
          else { note.textContent = '空っぽ…'; note.classList.add('is-cold'); }
        }, 1600);
      }
    },
    // 雷: 暗い空からオリ得のロゴに雷が落ちれば当たり。それたらハズレ。稲妻の色が熱さ
    thunder: {
      label: '',
      html: '<div class="sim-thd"><i class="sim-thd__cloud"></i><i class="sim-thd__bolt"></i><img class="sim-thd__logo" src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""></div><small class="sim-th__note"></small>',
      plan: function (yk) { return { win: thWin(yk), dur: 2400 }; },
      run: function (el, stage, yk, p) {
        var note = el.querySelector('.sim-th__note');
        stage.classList.add('sim-th-night');
        if (yk.color >= 1) el.classList.add('sim-k' + yk.color);
        [400, 800].forEach(function (ms) { setTimeout(function () { stage.classList.remove('sim-th-flash'); void stage.offsetWidth; stage.classList.add('sim-th-flash'); }, ms); });
        setTimeout(function () {
          el.classList.add(p.win ? 'is-hit' : 'is-miss'); playSe('shakin1', { vol: 0.85 });
          if (p.win) { note.textContent = '直撃！'; note.classList.add('is-hot'); sfx.shake(); }
          else { note.textContent = 'それた…'; note.classList.add('is-cold'); }
        }, 1300);
        setTimeout(function () { stage.classList.remove('sim-th-night', 'sim-th-flash'); }, 2400);
      }
    },
    // ---- 解放されるガチャの演出（2026-11-02 岸田「演出をもっとふやして・解放されると別の演出で」）----
    // 色は保留の玉と同じ段（青→緑→赤→金→虹）を、演出の物そのものの色で見せる（sim-k1〜5）
    // スロット: 3リール。7揃いが最上位。赤以上でリーチがかかりやすく、金以上は下のパネルが消える
    slot: {
      label: 'スロット',
      html: '<div class="sim-slot"><i>7</i><i>★</i><i>◆</i></div><small class="sim-th__note"></small>',
      plan: function (yk) {
        var S = ['7', '★', '◆', 'BAR', '♥'], win = thWin(yk), f, name = '';
        if (win) { var s = yk.cat === 'r0' || yk.cat === 'r12' ? '7' : yk.cat === 'r34' ? '★' : '◆'; f = [s, s, s]; name = s === '7' ? (yk.cat === 'r0' ? '777！！' : '777！') : s + s + s; }
        else {
          var a = yk.revive || yk.color >= 3 ? '7' : pick(S), rest = S.filter(function (x) { return x !== a; });
          f = yk.revive || yk.color >= 2 || Math.random() < 0.3 ? [a, a, pick(rest)] : [a, rest[0], rest[1]].sort(function () { return Math.random() - 0.5; });
        }
        var reach = f[0] === f[1];
        var off = yk.color >= 4;
        return { f: f, name: name, reach: reach, off: off, dur: 1700 + (reach ? 1000 : 0) + (off ? 1000 : 0) + 500 };
      },
      run: function (el, stage, yk, p) {
        var reels = el.querySelectorAll('.sim-slot i'), note = el.querySelector('.sim-th__note'), stopped = [false, false, false], S = ['7', '★', '◆', 'BAR', '♥'];
        if (yk.color >= 1) setTimeout(function () { el.classList.add('sim-k' + yk.color); }, 250);
        // 2026-11-23 岸田「プチュンが出るタイミングおかしい」: 回し始め（0.45秒）ではなく、2つ目のリールが止まった直後に画面全体を暗転。最後のリールは暗転が明けてから止める
        if (p.off) setTimeout(function () { el.classList.add('is-off'); screenDark(900); }, 1100 + 150);
        var spin = setInterval(function () { for (var i = 0; i < 3; i++) if (!stopped[i]) reels[i].textContent = pick(S); }, 60);
        [600, 1100, 1700 + (p.reach ? 1000 : 0) + (p.off ? 1000 : 0)].forEach(function (ms, i) {
          setTimeout(function () {
            stopped[i] = true; reels[i].textContent = p.f[i]; reels[i].classList.add('is-stop'); playSe('cursor1', { vol: 0.7, dur: 0.3 });
            if (i === 1 && p.reach) { note.textContent = 'リーチ！'; note.classList.add('is-hot'); el.classList.add('is-reach'); playSe('jean1', { vol: 0.7 }); }
            if (i === 2) { clearInterval(spin); el.classList.remove('is-reach'); note.textContent = p.name; note.className = 'sim-th__note' + (p.name ? ' is-hot' : ''); if (p.name) { el.classList.add('is-win'); playSe('kira1', { vol: 0.8 }); } }
          }, ms);
        });
      }
    },
    // 扉: 3回たたいて開けば当たり。扉の色が熱さ
    door: {
      label: '',
      html: '<div class="sim-door"><i class="sim-door__in"><img src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""></i><i class="sim-door__l"></i><i class="sim-door__r"></i></div><small class="sim-th__note"></small>',
      plan: function (yk) { return { win: thWin(yk), dur: 300 + 3 * 480 + 1000 }; },
      run: function (el, stage, yk, p) {
        var note = el.querySelector('.sim-th__note');
        if (yk.color >= 1) setTimeout(function () { el.classList.add('sim-k' + yk.color); playSe('jean1', { vol: 0.5 }); }, 250);
        for (var i = 0; i < 3; i++) (function (i) { setTimeout(function () { el.classList.remove('is-hit'); void el.offsetWidth; el.classList.add('is-hit'); playSe('cursor1', { vol: 0.6 + i * 0.1, dur: 0.3 }); if (i === 2 && yk.color >= 3) sfx.shake(); }, 300 + i * 480); }(i));
        setTimeout(function () {
          if (p.win) { el.classList.add('is-open'); note.textContent = '開門！'; note.classList.add('is-hot'); playSe('shine1', { vol: 0.8, dur: 1 }); }
          else { note.textContent = 'ビクともしない…'; note.classList.add('is-cold'); }
        }, 300 + 3 * 480 + 150);
      }
    },
    // 鎖: カードに巻きついた鎖を引きちぎれば当たり。鎖の色が熱さ
    chain: {
      label: '',
      html: '<div class="sim-chain"><i class="sim-chain__card"><img src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""></i><i class="sim-chain__x is-a"></i><i class="sim-chain__x is-b"></i><i class="sim-chain__lock"></i></div><small class="sim-th__note"></small>',
      plan: function (yk) { return { win: thWin(yk), dur: 2300 }; },
      run: function (el, stage, yk, p) {
        var note = el.querySelector('.sim-th__note');
        if (yk.color >= 1) setTimeout(function () { el.classList.add('sim-k' + yk.color); }, 300);
        [600, 1050, 1500].forEach(function (ms, i) { setTimeout(function () { el.classList.remove('is-pull'); void el.offsetWidth; el.classList.add('is-pull'); playSe('cursor1', { vol: 0.6 + i * 0.1, dur: 0.3 }); }, ms); });
        setTimeout(function () {
          if (p.win) { el.classList.add('is-cut'); note.textContent = '解放！'; note.classList.add('is-hot'); playSe('shakin1', { vol: 0.85 }); if (yk.color >= 3) sfx.shake(); }
          else { note.textContent = 'ちぎれない…'; note.classList.add('is-cold'); }
        }, 1900);
      }
    },
    // 月: 夜空に月がのぼる。満ちれば当たり、雲に隠れればハズレ。月の色が熱さ
    moon: {
      label: '',
      html: '<div class="sim-moon"><i class="sim-moon__m"></i><i class="sim-moon__cloud"></i></div><small class="sim-th__note"></small>',
      plan: function (yk) { return { win: thWin(yk), dur: 2500 }; },
      run: function (el, stage, yk, p) {
        var note = el.querySelector('.sim-th__note');
        stage.classList.add('sim-th-night');
        if (yk.color >= 1) setTimeout(function () { el.classList.add('sim-k' + yk.color); playSe('kira1', { vol: 0.6 }); }, 1000);
        setTimeout(function () {
          if (p.win) { el.classList.add('is-full'); note.textContent = '満月！'; note.classList.add('is-hot'); playSe('shine1', { vol: 0.8, dur: 1 }); }
          else { el.classList.add('is-cloud'); note.textContent = '雲に隠れた…'; note.classList.add('is-cold'); }
        }, 1700);
        setTimeout(function () { stage.classList.remove('sim-th-night'); }, 2500);
      }
    },
    // 鳥居: 灯籠が1つずつ灯る。3つ灯ればご利益（当たり）。鳥居の色が熱さ
    torii: {
      label: '',
      html: '<div class="sim-torii"><i class="sim-torii__gate"></i><span class="sim-torii__lamps"><i></i><i></i><i></i></span></div><small class="sim-th__note"></small>',
      plan: function (yk) { var win = thWin(yk); return { win: win, lit: win ? 3 : yk.color >= 2 || yk.revive ? 2 : 1, dur: 300 + 3 * 550 + 900 }; },
      run: function (el, stage, yk, p) {
        var lamps = el.querySelectorAll('.sim-torii__lamps i'), note = el.querySelector('.sim-th__note');
        if (yk.color >= 1) setTimeout(function () { el.classList.add('sim-k' + yk.color); playSe('jean1', { vol: 0.5 }); }, 250);
        for (var i = 0; i < p.lit; i++) (function (i) { setTimeout(function () { lamps[i].classList.add('is-on'); playSe('kira1', { vol: 0.5 + i * 0.15 }); }, 300 + (i + 1) * 550); }(i));
        setTimeout(function () {
          if (p.win) { el.classList.add('is-bless'); note.textContent = 'ご利益！'; note.classList.add('is-hot'); playSe('jajean1', { vol: 0.8 }); }
          else { note.textContent = 'あと一歩…'; note.classList.add('is-cold'); }
        }, 300 + 3 * 550 + 200);
      }
    },
    // 一刀両断: カードを斬る。真っ二つなら当たり、弾かれたらハズレ。斬撃の色が熱さ
    sword: {
      label: '',
      html: '<div class="sim-slash"><i class="sim-slash__h is-a"><img src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""></i><i class="sim-slash__h is-b"><img src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""></i><i class="sim-slash__line"></i></div><small class="sim-th__note"></small>',
      plan: function (yk) { return { win: thWin(yk), dur: 2100 }; },
      run: function (el, stage, yk, p) {
        var note = el.querySelector('.sim-th__note');
        if (yk.color >= 1) setTimeout(function () { el.classList.add('sim-k' + yk.color); }, 300);
        setTimeout(function () { el.classList.add('is-ready'); }, 500);
        setTimeout(function () { el.classList.add('is-slash'); playSe('shakin1', { vol: 0.85 }); }, 1000);
        setTimeout(function () {
          if (p.win) { el.classList.add('is-split'); note.textContent = '一刀両断！'; note.classList.add('is-hot'); if (yk.color >= 3) sfx.shake(); }
          else { el.classList.add('is-guard'); note.textContent = '弾かれた…'; note.classList.add('is-cold'); }
        }, 1250);
      }
    },
    // ミラーボール: 光が回って、スポットライトがロゴに当たれば当たり。光の色が熱さ
    disco: {
      label: '',
      html: '<div class="sim-disco"><i class="sim-disco__ball"></i><i class="sim-disco__beam"></i><i class="sim-disco__spot"><img src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""></i></div><small class="sim-th__note"></small>',
      plan: function (yk) { return { win: thWin(yk), dur: 2600 }; },
      run: function (el, stage, yk, p) {
        var note = el.querySelector('.sim-th__note');
        stage.classList.add('sim-th-night');
        if (yk.color >= 1) setTimeout(function () { el.classList.add('sim-k' + yk.color); playSe('kira1', { vol: 0.6 }); }, 900);
        setTimeout(function () {
          el.classList.add(p.win ? 'is-spot' : 'is-miss');
          if (p.win) { note.textContent = '光った！'; note.classList.add('is-hot'); playSe('shine1', { vol: 0.8, dur: 1 }); }
          else { note.textContent = '誰もいない…'; note.classList.add('is-cold'); }
        }, 1800);
        setTimeout(function () { stage.classList.remove('sim-th-night'); }, 2600);
      }
    },
    // チンチロ: サイコロ3つ。1・1・1 が大当たり、ゾロ目・4・5・6 が当たり、目なしはハズレ。赤・金のサイコロはアツい
    dice: {
      label: 'サイコロを振っています…',
      html: '<div class="sim-dice"><i>?</i><i>?</i><i>?</i></div><small class="sim-th__note"></small>',
      plan: function (yk) {
        var r = function (a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }, f, name;
        if (yk.revive) { f = [1, 2, 3]; name = 'ヒフミ…？'; }
        else if (yk.cat === 'r0') { f = [1, 1, 1]; name = 'ピンゾロ！！'; }
        else if (yk.cat === 'r12') { var d = r(2, 6); f = [d, d, d]; name = 'ゾロ目！'; }
        else if (yk.cat === 'r34') { f = [4, 5, 6]; name = 'シゴロ！'; }
        else if (yk.cat === 'low') { var a = r(1, 6), b = (a + r(1, 5) - 1) % 6 + 1; f = Math.random() < 0.5 ? [a, a, b] : [b, a, a]; name = '2つ揃い'; }
        else { f = pick([[2, 3, 5], [1, 3, 6], [2, 5, 6], [1, 4, 6], [3, 4, 6], [1, 2, 5], [2, 4, 5], [1, 3, 5]]).slice().sort(function () { return Math.random() - 0.5; }); name = '目なし'; } // 目なし（バラバラで 1・2・3 / 4・5・6 でない）
        var cut = yk.color >= 5 ? '鳳凰降臨！！' : yk.color === 4 ? '龍神降臨！' : yk.color === 3 ? '赤サイコロ！' : '';
        var reach = f[0] === f[1];
        return { f: f, name: name, cut: cut, reach: reach, dur: (cut ? 900 : 0) + 2100 + (reach ? 900 : 0) };
      },
      run: function (el, stage, yk, p) {
        var dice = el.querySelectorAll('.sim-dice i'), note = el.querySelector('.sim-th__note'), stopped = [false, false, false], c0 = 0;
        if (p.cut) { cutin(stage, p.cut); c0 = 900; setTimeout(function () { el.classList.add(yk.color >= 4 ? 'is-gold' : 'is-red'); }, 500); }
        var spin = setInterval(function () { for (var i = 0; i < 3; i++) if (!stopped[i]) dice[i].textContent = 1 + Math.floor(Math.random() * 6); }, 70);
        var stop = function (i, ms) {
          setTimeout(function () {
            stopped[i] = true; dice[i].textContent = p.f[i]; dice[i].classList.add('is-stop'); playSe('cursor1', { vol: 0.7, dur: 0.3 });
            if (i === 1 && p.reach) { note.textContent = 'リーチ！'; note.classList.add('is-hot'); playSe('jean1', { vol: 0.7 }); }
            if (i === 2) { clearInterval(spin); note.textContent = p.name; note.classList.add(thWin(yk) ? 'is-hot' : 'is-cold'); if (thWin(yk)) playSe('kira1', { vol: 0.7 }); }
          }, c0 + ms);
        };
        stop(0, 700); stop(1, 1200); stop(2, 1900 + (p.reach ? 900 : 0));
      }
    },
    // カウントダウン: 00:05 から減っていく。数字が赤ならチャンス。
    // 当たるときは途中で止まってオリ得のロゴに変わる（2026-11-02 岸田）。さらに暗転したら「アド確定」（合計が1.5倍以上）
    count: {
      label: 'カウントダウン',
      html: '<div class="sim-cd"><b>00:05</b></div>',
      plan: function (yk) {
        var win = thWin(yk), big = yk.cat === 'r0' || yk.cat === 'r12';
        var kaku = win && (big || (yk.cat === 'r34' && Math.random() < 0.6)); // 暗転「アド確定」は合計が1.5倍以上のときだけ
        var at = win ? 1 + Math.floor(Math.random() * 3) : 0; // この数字で止まってロゴに変わる
        return { red: yk.color >= 3, win: win, kaku: kaku, big: big, at: at, dur: win ? (5 - at) * 450 + 1700 + (kaku ? 1100 : 0) : 5 * 450 + 400 };
      },
      run: function (el, stage, yk, p) {
        var b = el.querySelector('b'), n = 5;
        if (p.red) { el.classList.add('is-red'); playSe('jean1', { vol: 0.7 }); }
        var iv = setInterval(function () {
          n--; b.textContent = '00:0' + n; playSe('cursor1', { vol: 0.6, dur: 0.25 });
          if (p.win && n === p.at) {
            clearInterval(iv);
            // 止まった瞬間に枠が光って揺れる（止まったと分かるように。2026-11-02 岸田）→ そのあとロゴに変わる
            el.classList.add('is-stop'); playSe('shakin1', { vol: 0.75 });
            setTimeout(function () {
              el.classList.remove('is-red'); el.classList.add('is-logo');
              b.innerHTML = '<img src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt="オリ得">';
              playSe('kira1', { vol: 0.8 });
              if (p.kaku) setTimeout(function () { miniPuchun(stage, p.big ? '爆アド確定！！' : 'アド確定！', p.big ? 'is-big' : ''); }, 900);
            }, 750);
          }
          else if (n <= 0) clearInterval(iv);
        }, 450);
      }
    },
    // クリスタル: ヒビが入って割れる（ここまでは毎回）。割れたあと暗転すれば当選。ノイズ・虹の稲妻はアツい
    crystal: {
      label: 'クリスタルにヒビが…',
      html: '<div class="sim-crys"><i class="sim-crys__gem"></i><i class="sim-crys__card"></i></div>',
      plan: function (yk) {
        var win = thWin(yk);
        var pch = win && (yk.cat === 'r0' || yk.cat === 'r12' || (yk.cat === 'r34' && Math.random() < 0.5)); // 暗転「当選！」は合計が1.5倍以上のときだけ
        return { glitch: yk.color >= 3, rainbow: yk.color >= 4, pch: pch, win: win, dur: 2100 + (pch ? 1700 : 0) };
      },
      run: function (el, stage, yk, p) {
        setTimeout(function () { el.classList.add('is-crack1'); playSe('cursor1', { vol: 0.7, dur: 0.3 }); }, 300);
        setTimeout(function () { el.classList.add('is-crack2'); playSe('cursor1', { vol: 0.8, dur: 0.3 }); }, 800);
        if (p.glitch) setTimeout(function () { stage.classList.add('sim-th-glitch'); cutin(stage, p.rainbow ? '虹の稲妻…！！' : 'ノイズ…！？'); if (p.rainbow) el.classList.add('is-rainbow'); }, 1000);
        setTimeout(function () { stage.classList.remove('sim-th-glitch'); el.classList.add('is-break'); playSe('shakin1', { vol: 0.8 }); if (!p.pch) el.classList.add(p.win ? 'is-silver' : 'is-empty'); }, 1700);
        if (p.pch) setTimeout(function () { miniPuchun(stage, '当選！', 'is-gold'); setTimeout(function () { el.classList.add('is-gold'); }, 850); }, 2100);
      }
    },
    // メカチャージ: メーターが3段たまれば「アド確定」。金のメーターはアツい。途中で止まるとハズレ
    charge: {
      label: 'チャージ中…',
      html: '<div class="sim-chg"><span>CHARGE</span><div class="sim-chg__bar"><i></i><i></i><i></i></div><b class="sim-chg__msg"></b></div>',
      plan: function (yk) {
        var full = thWin(yk);
        var stop = full ? 3 : yk.color >= 3 || Math.random() < 0.4 ? 2 : 1;
        return { gold: yk.color >= 4, full: full, stop: stop, dur: 650 * stop + 1100 };
      },
      run: function (el, stage, yk, p) {
        var seg = el.querySelectorAll('.sim-chg__bar i'), msg = el.querySelector('.sim-chg__msg');
        if (p.gold) { el.classList.add('is-gold'); cutin(stage, '金チャージ！'); }
        for (var i = 0; i < p.stop; i++) (function (i) { setTimeout(function () { seg[i].classList.add('is-on'); playSe('kira1', { vol: 0.45 + i * 0.15 }); }, 650 * (i + 1)); }(i));
        setTimeout(function () {
          if (p.full) { el.classList.add('is-full'); msg.textContent = 'チャージ完了！ アド確定'; playSe('jajean1', { vol: 0.85 }); }
          else { el.classList.add('is-fail'); msg.textContent = yk.revive ? '暴走…！？' : 'チャージ失敗…'; }
        }, 650 * p.stop + 350);
      }
    },
    // カプセル: レバーを回してカプセルが出る。白はハズレ、銀・金・虹の順にアツい。レバー2回転・半回転は合図
    capsule: {
      label: 'レバーを回しています…',
      html: '<div class="sim-cap"><i class="sim-cap__dome"></i><i class="sim-cap__lever"></i><i class="sim-cap__ball"></i></div>',
      plan: function (yk) {
        var turns = yk.color >= 3 ? 2 : yk.color === 2 && Math.random() < 0.6 ? 0.5 : 1;
        var ball = !thWin(yk) ? 'white' : yk.cat === 'low' ? 'silver' : yk.cat === 'r0' ? 'rainbow' : 'gold';
        var turn = turns === 0.5 ? 450 + 600 + 900 : turns * 900;
        return { turns: turns, ball: ball, turn: turn, dur: turn + 1300 };
      },
      run: function (el, stage, yk, p) {
        var lv = el.querySelector('.sim-cap__lever');
        if (p.turns === 2) cutin(stage, 'レバー2回転！');
        if (p.turns === 0.5) {
          lv.style.animation = 'sim-cap-turn .45s ease-in both';
          lv.style.setProperty('--to', '180deg');
          setTimeout(function () { cutin(stage, '止まった…！？'); }, 450);
          setTimeout(function () { lv.style.setProperty('--from', '180deg'); lv.style.setProperty('--to', '540deg'); lv.style.animation = 'none'; void lv.offsetWidth; lv.style.animation = 'sim-cap-turn .9s ease-in-out both'; }, 1050);
        } else {
          lv.style.setProperty('--to', (360 * p.turns) + 'deg');
          lv.style.animation = 'sim-cap-turn ' + (p.turn / 1000) + 's ease-in-out both';
        }
        playSe('cursor1', { vol: 0.6, dur: 0.4 });
        setTimeout(function () {
          el.classList.add('is-drop', 'is-' + p.ball);
          playSe(p.ball === 'rainbow' || p.ball === 'gold' ? 'shine1' : 'cursor1', { vol: 0.7, dur: 1 });
        }, p.turn);
      }
    }
  };

  // 抽選中の演出の種類。一覧のガチャは安い順に KINDS を順番に割り振る（安い箱だけでも全種類見られる）。
  // 一覧に無い箱は ID から決める。どちらも同じガチャはいつも同じ演出
  function fxTag(fx) { return FX_NAME[fx] ? '<span class="sim-fxtag sim-fxtag--' + fx + '">' + esc(FX_NAME[fx]) + '</span>' : ''; }
  // 手元（localhost）だけ: URL の #fx=slot&c=4&cat=r0 で演出・色・結果の段を固定して試せる（本番では効かない）
  var DBG = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? (function () { var o = {}; location.hash.replace(/[#&](fx|c|cat)=([a-z0-9]+)/g, function (_, k, v) { o[k] = v; }); return o; }()) : {};
  window.addEventListener('hashchange', function () { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { DBG = {}; location.hash.replace(/[#&](fx|c|cat)=([a-z0-9]+)/g, function (_, k, v) { DBG[k] = v; }); } });
  function fxOf(g) {
    if (DBG && DBG.fx) return DBG.fx;
    var KINDS = ['dice', 'logo', 'count', 'pack', 'crystal', 'card', 'charge', 'capsule', 'slot', 'door', 'chain', 'moon', 'torii', 'sword', 'disco', 'roulette', 'firework', 'chest', 'thunder'], at = rowOrder.indexOf(String(g && g.id || ''));
    if (at >= 0) return KINDS[at < KINDS.length ? at : 8 + (at - 8) % (KINDS.length - 8)]; // 2026-11-02: 上のレベルで解放される箱ほど新しい演出（19箱まではすべて別の演出）
    var s = String(g && g.id || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return KINDS[h % KINDS.length];
  }
  // 演出の箱（stage）をポップアップに移す / 元の場所に戻す。戻す場所は目印のコメントで覚えておく
  var stageMark = null;
  function stq(sel) { return (rpop && rpop.classList.contains('is-drawing') && rpop.querySelector(sel)) || playInner.querySelector(sel); }
  function stageToPop(on) {
    if (!rpop || current.local || play !== 'game') return;
    if (on) {
      var st = playInner.querySelector('[data-sim-stage]'); if (!st) return;
      if (stageMark && stageMark.parentNode) stageMark.remove();
      stageMark = document.createComment('sim-stage'); st.parentNode.insertBefore(stageMark, st);
      rpop.insertBefore(st, rpop.querySelector('[data-sim-rpop-sum]'));
      rpop.classList.add('is-drawing');
      window.scrollTo({ top: 0, behavior: 'auto' }); // 結果を見ている間と閉じたあとは、ページの一番上
      if (!rpop.open) { if (typeof rpop.showModal === 'function') rpop.showModal(); else rpop.setAttribute('open', ''); }
    } else {
      var ps = rpop.querySelector('[data-sim-stage]');
      rpop.classList.remove('is-drawing');
      if (!ps) return;
      if (stageMark && stageMark.parentNode) { stageMark.parentNode.insertBefore(ps, stageMark); stageMark.remove(); } else ps.remove(); // 箱を選び直して元の場所が無くなっていたら捨てる
      stageMark = null;
    }
  }

  function reveal(res, n) {
    var g = current.gacha;
    var stage = stq('[data-sim-stage]');
    var stText = stq('[data-sim-stage-text]');
    var stSub = stq('[data-sim-stage-sub]');
    var got = res.best_idx >= 0 ? g.tiers[res.best_idx] : null; // いちばん高い景品
    var won = pullWin(g, res), worth = pullValue(g, res);
    var best = won ? got : null;
    var cls = best ? stageClass(g, res.best_idx) : '';
    // 2026-11-02 岸田「ニブイチで当たっただけなのにピロピロ流すのは微妙」: 等級ではなく、使った額に対してどれだけ戻ったか（予告と同じ段）で祝い方を決める
    if (best && res.yk) cls = res.yk.cat === 'r0' ? 'sim-stage--top' : res.yk.cat === 'r12' ? 'sim-stage--high' : 'sim-stage--mid';
    var shown = false; // 演出中に押して飛ばすと、予約済みのタイマーと二重に走るのを防ぐ
    var showResult = function () {
      if (shown) return;
      shown = true;
      if (res.th && res.th.el.parentNode) res.th.el.remove(); // 復活のやり直し演出を途中で飛ばしたとき
      stopRoll();
      stage.hidden = true;
      stageToPop(false);
      current.box = { round: res.box.round, left: res.box.left, pulls: res.box.pulls, counts: res.box.counts };
      var tierPt = 0;
      res.hits.forEach(function (h) { var t = current.gacha.tiers[h[0]]; if (t.pt != null) tierPt += t.pt * h[1]; });
      if (play === 'game') {
        walletFrom(res.wallet); // 持ちポイントはサーバーが計算済み（1口×口数を引いて、ハズレの pt だけ戻る）
        var newKeys = invAdd(current.gacha, res, current.local);
        checkOver();
      }
      if (current.stats) { current.stats.n += res.n; current.stats.cost += res.cost; current.stats.pt += res.pt; current.stats.mkt += res.mkt; } else { current.stats = { n: res.n, cost: res.cost, pt: res.pt, mkt: res.mkt, players: 1 }; }
      updateBoxView();
      renderResult(res, n);
      if (play === 'game' && !current.local) { playInner.querySelector('[data-sim-result]').hidden = true; openRpop(newKeys || [], res, n); }
      if (res.me) renderMe(res.me);
      finishPull();
      if (!current.local) refreshState();
    };
    var main = function () {
    if (cls === 'sim-stage--top') {
      // 1等: プチュン（画面が一瞬で真っ暗＋無音）→ 白く光って大当たり確定
      puchun(function () {
        stage.className = 'sim-stage ' + cls;
        impact(stage, 'top');
        sfx.top();
        stText.textContent = '大当たり！';
        stSub.textContent = best ? best.rl + ' ' + best.n : '';
        stageImg(best);
        confetti(stage, 140);
        setTimeout(showResult, 2600);
      });
    } else if (cls === 'sim-stage--high') {
      stage.className = 'sim-stage sim-stage--shake';
      stText.textContent = '…';
      sfx.shake();
      setTimeout(function () {
        stage.className = 'sim-stage ' + cls;
        impact(stage, 'high');
        sfx.high();
        stText.textContent = '当たり！';
        stSub.textContent = best ? best.rl + ' ' + best.n : '';
        stageImg(best);
        confetti(stage, 60);
        setTimeout(showResult, 1600);
      }, 750);
    } else if (cls === 'sim-stage--mid') {
      stage.className = 'sim-stage ' + cls;
      impact(stage, 'mid');
      confetti(stage, 30);
      sfx.mid();
      stText.textContent = '当たり';
      stSub.textContent = best ? best.rl + ' ' + best.n : '';
      stageImg(best);
      setTimeout(showResult, 900);
    } else {
      // 下位の当たり（10等以下など）も、光って紙吹雪・キラッの音で小さく祝う。ハズレだけ静かに
      stage.className = best ? 'sim-stage sim-stage--low' : 'sim-stage';
      stText.textContent = won ? '当たり！' : 'ハズレ';
      impact(stage, won ? 'low' : 'lose');
      if (won) { stopRoll(); playSe('kira1', { vol: 0.8 }); playSe('shine1', { at: 0.15, vol: 0.35, dur: 1.2 }); } else sfx.lose();
      if (won) stSub.textContent = best ? best.rl + ' ' + best.n : '合計 ' + fmt(worth) + 'pt';
      else stSub.innerHTML = '<span class="sim-stage__minus">−' + fmt(res.cost - worth) + 'pt</span><span class="sim-stage__minus-note">使ったポイント ' + fmt(res.cost) + 'pt<br>当たったポイント ' + fmt(worth) + 'pt</span>'; // 2026-11-01 岸田: ハズレはマイナス額を見せる
      if (best) { stageImg(best); confetti(stage, 28); } // カード画像を見せて、1秒長く止める
      setTimeout(showResult, 1600); // ハズレも1秒長く見せる（2026-11-01 岸田）
    }
    };
    // 復活演出（2026-11-01）: 当たりなのに一度「ハズレ…」と見せてから「復活！」
    if (res.yk && res.yk.revive && won) {
      stage.className = 'sim-stage';
      stText.textContent = 'ハズレ…';
      stSub.textContent = '';
      sfx.lose();
      setTimeout(function () {
        if (shown) return;
        stage.className = 'sim-stage sim-yk-revive';
        stText.textContent = '復活！！';
        playSe('jajean1', { vol: 0.85 });
        var rt = res.th;
        if (!rt) { setTimeout(function () { if (!shown) main(); }, 900); return; }
        // テーマ演出をもう一度。今度は勝ち顔で止まる（サイコロなら揃う・メーターは満タン・カプセルは金など）
        var yk2 = {}; for (var kk in res.yk) yk2[kk] = res.yk[kk];
        yk2.revive = false;
        var p2 = rt.th.plan(yk2);
        setTimeout(function () {
          if (shown) return;
          rt.el.className = rt.el.className.replace(/\bis-\S+/g, '').trim();
          rt.el.innerHTML = rt.th.html;
          rt.th.run(rt.el, stage, yk2, p2);
        }, 700);
        setTimeout(function () { if (rt.el.parentNode) rt.el.remove(); if (!shown) main(); }, 700 + p2.dur + 1200); // 揃ったところを見てから結果へ
      }, 1100);
    } else main();
    stage.onclick = function () { stage.onclick = null; showResult(); };
  }

  // 当たりの紙吹雪（n 枚。結果に切り替わると箱ごと消える）
  function confetti(box, n) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    Array.prototype.forEach.call(box.querySelectorAll('.sim-confetti'), function (c) { c.remove(); });
    for (var k = 0; k < n; k++) {
      var c = document.createElement('i');
      c.className = 'sim-confetti sim-confetti--' + (k % 5);
      c.style.left = (Math.random() * 100) + '%';
      c.style.animationDelay = (Math.random() * 0.6) + 's';
      c.style.animationDuration = (1.4 + Math.random() * 1.4) + 's';
      box.appendChild(c);
    }
  }
  // プチュン: 画面全体を一瞬で暗転させ、ドラムロールも切って無音にする。間を置いて白く光ってから next()
  // 2026-11-23 岸田「プチュンが出すときは画面全体を暗転させよう」: 結果のポップアップ（モーダル）より上に出すため、
  // 暗転そのものを showModal した dialog にする（body に置いた div はモーダルの下に隠れていた）
  function screenDark(ms, next) {
    stopRollNow();
    playSe('puchun', { vol: 0.9 }); // smartomaizu「プチュン」フリーズ演出-02（CC BY 4.0）
    var ov = document.createElement('dialog');
    ov.className = 'sim-puchun';
    ov.innerHTML = '<i class="sim-puchun__line"></i><i class="sim-puchun__star"></i>'; // ブラウン管を切ったときの、横一本の光→真ん中の星→消える
    ov.addEventListener('cancel', function (e) { e.preventDefault(); });
    document.body.appendChild(ov);
    if (typeof ov.showModal === 'function') ov.showModal(); else ov.setAttribute('open', '');
    setTimeout(function () {
      ov.classList.add('is-flash');
      setTimeout(function () { if (ov.open && ov.close) ov.close(); ov.remove(); }, 500);
      if (next) next();
    }, ms);
  }
  function puchun(next) { screenDark(1400, next); }

  // 演出の当たりカード（画像がある景品だけ）。次に引くときは消す
  function stageImg(t) {
    var stage = stq('[data-sim-stage]'); if (!stage) return;
    var old = stage.querySelector('.sim-stage__frame'); if (old) old.remove();
    if (!t || !t.img) return;
    var tmp = document.createElement('div'); tmp.innerHTML = cardFrame(t, 'sim-stage__img', 0, false);
    var im = tmp.firstChild; im.classList.add('sim-stage__frame');
    stage.firstChild.insertBefore(im, stage.firstChild.firstChild);
  }

  function finishPull() {
    busy = false;
    Array.prototype.forEach.call(playInner.querySelectorAll('[data-sim-pull]'), function (b) { b.disabled = false; });
  }

  function renderResult(res, n) {
    var g = current.gacha;
    var result = playInner.querySelector('[data-sim-result]');
    var rate = res.cost > 0 ? res.pt / res.cost : 0;
    var hitCount = 0;
    var items = res.hits.slice().sort(function (a, b) { return a[0] - b[0]; }).map(function (h) {
      var t = g.tiers[h[0]]; hitCount += h[1];
      return '<li class="sim-hit' + (t.img ? ' has-img' : '') + '">' + cardFrame(t, 'sim-hit__img', h[1], false) + '<span class="sim-badge ' + badgeClass(g, h[0]) + '">' + esc(t.rl) + '</span>' + (t.n ? '<span class="sim-hit__name">' + esc(t.n) + '</span>' : '') + '<span class="sim-hit__n">' + (t.pt != null ? fmt(t.pt) + esc(g.unit) : '発送のみ') + (h[1] > 1 ? ' ×' + h[1] : '') + '</span></li>';
    }).join('');
    var hz = res.n - hitCount;
    if (hz > 0) items += '<li class="sim-hit sim-hit--hz"><span class="sim-badge sim-badge--hz">' + esc(g.hz.n) + '</span><span class="sim-hit__n">' + (g.hz.pt != null ? fmt(g.hz.pt) + esc(g.unit) : 'pt非公開') + ' ×' + fmt(hz) + '</span></li>';
    var diff = res.pt - res.cost;
    // ゲーム: 持ちポイントに入るのはハズレの pt だけ。当たりは獲得商品に入り、交換したときに pt になる（サーバーの計算と同じ内訳で見せる）
    var gameMode = play === 'game' && !current.local && res.wallet;
    var hzPt = g.hz.pt != null ? g.hz.pt * hz : 0;
    var hitPt = res.pt - hzPt;
    if (gameMode) {
      var after = res.wallet.pt, delta = after - res.ptBefore;
      var verdictG = 'オリ得コイン <strong>' + fmt(res.ptBefore) + 'pt → ' + fmt(after) + 'pt</strong>（' + (delta >= 0 ? '+' : '−') + fmt(Math.abs(delta)) + 'pt）。' +
        (hitPt > 0 ? '当たりの景品は獲得商品に入りました。ptに交換すると <strong>+' + fmt(hitPt) + 'pt</strong> です。' : '');
    }
    var verdict = gameMode ? verdictG : diff >= 0
      ? '使った <strong>' + fmt(res.cost) + esc(g.unit) + '</strong> に対して <strong>' + fmt(res.pt) + esc(g.unit) + '</strong> 戻りました（還元率 ' + pct(rate) + '）。' + esc(g.unit) + '上はプラスです。'
      : '使った <strong>' + fmt(res.cost) + esc(g.unit) + '</strong> に対して <strong>' + fmt(res.pt) + esc(g.unit) + '</strong> 戻りました（還元率 ' + pct(rate) + '）。' + esc(g.unit) + '上は <strong>' + fmt(-diff) + esc(g.unit) + '</strong> のマイナスです。';
    var shareText = '【オリパシミュレーター】' + (current.local ? '自作の' : '') + '「' + g.t + '」を' + res.n + '連（模擬） → ' + fmt(res.cost) + g.unit + '使って' + fmt(res.pt) + g.unit + '（還元率' + pct(rate) + '）' + (res.best_idx >= 0 ? '。一番の当たりは ' + (g.tiers[res.best_idx].n || g.tiers[res.best_idx].rl) : '') + '\n※乱数による模擬抽選。実際の結果ではありません。スクショや数字を入れるだけでオリパを作って無料で引けるシミュレーター #オリ得';
    var shareUrl = current.local ? myShareUrl(g) : location.origin + location.pathname + '#id=' + g.id;
    result.innerHTML = '' +
      '<h4 class="sim-result__h">' + res.n + '連の結果</h4>' +
      (res.box.sold_out ? '<p class="sim-result__soldout">この回は売り切れました。同じラインナップで第' + fmt(res.box.round) + '回を開けています。</p>' : '') +
      '<p class="sim-result__verdict">' + verdict + '</p>' +
      (gameMode
        ? '<dl class="sim-result__kv">' +
            '<div><dt>使ったpt</dt><dd>−' + fmt(res.cost) + '<small>pt</small></dd></div>' +
            '<div><dt>ハズレで戻ったpt</dt><dd>+' + fmt(hzPt) + '<small>pt</small></dd></div>' +
            '<div><dt>当たり（交換すると）</dt><dd class="is-plus">+' + fmt(hitPt) + '<small>pt</small></dd></div>' +
            '<div><dt>いまのオリ得コイン</dt><dd>' + fmt(res.wallet.pt) + '<small>pt</small></dd></div>' +
          '</dl>'
        : '<dl class="sim-result__kv">' +
            '<div><dt>使った金額</dt><dd>' + fmt(res.cost) + '<small>' + esc(g.unit) + '</small></dd></div>' +
            '<div><dt>交換すれば戻るpt</dt><dd class="' + (diff >= 0 ? 'is-plus' : 'is-minus') + '">' + fmt(res.pt) + '<small>' + esc(g.unit) + '</small></dd></div>' +
            '<div><dt>還元率</dt><dd class="' + (diff >= 0 ? 'is-plus' : 'is-minus') + '">' + pct(rate) + '</dd></div>' +
          '</dl>') +
      '<ul class="sim-hits">' + items + '</ul>' +
      '<p class="sim-result__note">' + (current.local ? 'ブラウザの乱数による模擬抽選です。実在のオリパでも同じ結果になるわけではありません。' : '当サイトの乱数による模擬抽選で、実在サイトの結果ではありません。' + esc(g.unit) + 'は各社のサイト内だけで使えるポイントで、現金には戻せません（1' + esc(g.unit) + '＝1円換算）。') + '</p>' +      (res.pt_unknown > 0 ? '<p class="sim-result__note">発送のみ（pt交換不可）の景品 ' + fmt(res.pt_unknown) + ' 枚は0ptとして数えています。</p>' : '') +
      (res.hits.length && play === 'game' ? '<p class="sim-result__toinv">当たった景品は<a href="#inv">獲得商品</a>に入りました。「ptに交換」か「発送」を選んでください。発送して現金化した額が多い人が勝ちです。</p>' : '') +
      '<div class="sim-share"><a class="sim-btn sim-btn--ghost sim-btn--small" href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(shareUrl) + '" target="_blank" rel="noopener">結果をXに投稿</a>' +
      '<button type="button" class="sim-btn sim-btn--small' + (n === 1 ? ' sim-btn--yellow' : '') + '" data-sim-again="' + n + '">もう' + (n === 1 ? '1回' : n + '連') + '</button></div>';
    result.hidden = false;
    var again = result.querySelector('[data-sim-again]');
    if (again) again.addEventListener('click', function () { pull(parseInt(again.getAttribute('data-sim-again'), 10)); });
    // ゲームは結果をポップアップで見せるので、裏のページは動かさない（2026-10-31 岸田: 勝手にスクロールされる）
    if (!(play === 'game' && !current.local)) result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- みんなの結果・自分の記録 ----
  var recentEl = root.querySelector('[data-sim-recent]');
  var rankEl = root.querySelector('[data-sim-ranking]'), rankPreEl = root.querySelector('[data-sim-ranking-pre]'), rankMonthEl = root.querySelector('[data-sim-ranking-month]');
  // FVのバナー: ゲーム中で詳しいランキングが見えていれば「月間」タブに切り替えてそこへ、なければ最初の画面のランキングへ
  var rankBn = root.querySelector('[data-sim-rankbn]');
  if (rankBn) rankBn.addEventListener('click', function (e) {
    var live = root.querySelector('#live'), pre = root.querySelector('#rank-pre');
    var to = live && !live.hidden ? live : pre && !pre.hidden ? pre : null;
    if (!to) return;
    e.preventDefault();
    if (to === live) { var mt = live.querySelector('[data-sim-rank-tab="month"]'); if (mt) mt.click(); }
    to.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // ヘッダーの「ランキング」: ゲーム前（#live が隠れている）は最初の画面のランキングへ
  Array.prototype.forEach.call(document.querySelectorAll('a[href="#live"]'), function (a) {
    a.addEventListener('click', function (e) {
      var live = root.querySelector('#live'), pre = root.querySelector('#rank-pre');
      if (live && live.hidden && pre && !pre.hidden) { e.preventDefault(); pre.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
  function renderRecent(list) {
    if (!recentEl) return;
    if (!list.length) { recentEl.innerHTML = '<li class="sim-feed__empty">まだ当たりが出ていません。最初の1人になれます。</li>'; return; }
    recentEl.innerHTML = list.map(function (r) {
      return '<li><span class="sim-feed__ago">' + esc(ago(r.ago)) + '</span><span class="sim-feed__who">' + esc(r.name) + '</span> さんが ' + r.n + '連で' +
        '<span class="sim-feed__prize"><span class="sim-badge sim-badge--top">' + esc(r.rank) + '</span> ' + esc(r.prize) + ' <span class="sim-num">' + fmt(r.best_pt) + esc(r.unit) + '</span></span>' +
        '<span class="sim-feed__gacha">「' + esc(r.gacha) + '」</span></li>';
    }).join('');
  }
  var rankData = { day: [], month: [] }, rankTab = 'day';
  Array.prototype.forEach.call(root.querySelectorAll('[data-sim-rank-tab]'), function (b) {
    b.addEventListener('click', function () {
      rankTab = b.getAttribute('data-sim-rank-tab');
      Array.prototype.forEach.call(root.querySelectorAll('[data-sim-rank-tab]'), function (x) { var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      renderRanking(rankData[rankTab]);
    });
  });
  var titleBadge = function (t) { return t ? '<span class="sim-lv sim-lv--' + esc(t) + ' sim-lv--mini">' + esc(LEVEL_NAME[t] || '') + '</span>' : ''; };
  // オリ得ランクポイント（発送した景品の相場の合計）は円ではなく王冠のアイコンで出す（2026-11-01 岸田「円ではない」。アイコンはC02の斜めスピード）
  var RANKPT_ICON = '<img class="sim-rankpt" src="' + esc(cfg.rankIcon || '/public/images/oritoku/rank-point.webp') + '" alt="オリ得ランクポイント" width="128" height="128">';
  // 「登録ずみ」のバッジ（2026-11-14 岸田「もっとカッコいいバッジに」）: 黒地にXのマークと金の文字。景品の対象だと一目で分かる
  var ENT_BADGE = '<span class="sim-rank__ent" title="XのIDを登録ずみ（景品の対象）"><svg class="sim-xicon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><b>登録ずみ</b><i aria-hidden="true">✓</i></span>';
  function renderRanking(list, el) {
    el = el || rankEl;
    if (!el) return;
    if (!list.length) { el.innerHTML = '<li class="sim-feed__empty">まだ誰も発送していません。最初に現金化した人が1位です。</li>'; return; }
    // 2026-11-17 岸田「ゲーセンのスコアっぽく」: 順位は 1ST/2ND…、1段目に名前とスコア、2段目に称号と内訳。スコアの欄は幅を取りきり、名前のほうを省略する
    var ord = function (n) { var v = n % 100; return n + (v >= 11 && v <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH'); };
    el.innerHTML = list.map(function (r) {
      return '<li class="' + (r.me ? 'is-me' : '') + (r.entered ? ' has-ent' : '') + '"><span class="sim-rank__pos is-' + r.pos + '">' + ord(r.pos) + '</span><span class="sim-rank__name">' + esc(r.name) + (r.me ? '（あなた）' : '') + '</span><span class="sim-rank__rate">' + RANKPT_ICON + fmt(r.cash) + '</span><span class="sim-rank__sub">' + titleBadge(r.title) + '<span class="sim-rank__meta">' + (r.me ? (r.entered ? 'XのID登録ずみ ・ ' : 'XのID未登録 ・ ') : '') + fmt(r.ships) + '枚発送 ・ ' + fmt(r.n) + '口 ・ ' + fmt(r.cost) + 'pt使用</span></span>' + (r.entered ? ENT_BADGE : '') + '</li>'; // 登録ずみのバッジは行の右下に重ねて置く
    }).join('');
  }
  // 今日の自分の順位と、1つ上までの差（2026-11-14: 目標を目の前に見せる）。順位が上がったら知らせる
  var rankPrev = null, rankKnown = false;
  // 順位の帯に流す文（2026-11-14 岸田「同じ内容を流さない。流すなら別の内容」）: 自分の順位 → 景品 → いまの今日の1位 → 登録の締切 → 次のレベル。
  // 中身が変わったときだけ作り直す（20秒ごとの更新のたびに流れが頭に戻らないように）
  var tickRank = '', tickHtml = '';
  function tickerRender() {
    var run = root.querySelector('[data-sim-ticker]'); if (!run) return;
    var pzc = cfg.prize || {}, items = [];
    if (tickRank) items.push(tickRank);
    if (pzc.month && pzc.short) items.push('<b>' + esc(pzc.month) + 'の月間1位に' + esc(pzc.short) + '</b>をプレゼント<span class="sim-req">要申請</span>');
    var top = rankData && rankData.day && rankData.day[0];
    if (top && !top.me) items.push('今日の1位は<b>' + esc(top.name) + '</b>さん ・ ' + fmt(top.cash) + 'ポイント');
    if (prizeMe && !prizeMe.entered && pzc.until) items.push('XのIDの登録は<b>' + esc(pzc.until) + '</b>まで'); // 「・いま◯人が登録ずみ」は 2026-11-23 岸田の指示で削除
    else if (prizeMe && prizeMe.entered) items.push('<b>XのID登録ずみ</b> ・ 登録者' + fmt(prizeMe.total) + '人の中で' + fmt(prizeMe.pos) + '位');
    if (wallet.next) items.push('あと<b class="sim-num">' + fmt(Math.max(0, wallet.next.min - wallet.pt)) + '</b>コインで' + esc(String(wallet.next.name).replace(/（.*?）$/, '')) + 'に昇格');
    var one = items.map(function (h) { return '<span class="sim-ticker__item">' + h + '</span>'; }).join('');
    if (!one || one === tickHtml) return;
    tickHtml = one;
    run.classList.remove('is-run');
    run.innerHTML = '<span class="sim-ticker__set">' + one + '</span><span class="sim-ticker__set" aria-hidden="true">' + one + '</span>';
    var w = run.firstChild.getBoundingClientRect().width;
    if (w > 0) { run.style.setProperty('--tk', Math.max(12, Math.round(w / 55)) + 's'); void run.offsetWidth; run.classList.add('is-run'); } // 速さは1秒に55pxで一定
    else tickHtml = ''; // まだ画面に出ていない（幅が測れない）ときは、次の更新でもう一度作る
  }
  function renderMyRank(rk) {
    var txt;
    if (rk.pos === 1 && rk.need == null) txt = '<b>今日 1位！</b>このまま守りきりましょう';
    else if (rk.pos != null) txt = '<b>今日 ' + fmt(rk.pos) + '位</b>（' + fmt(rk.total) + '人中）' + (rk.need != null ? ' ・ あと<b class="sim-num">' + fmt(rk.need) + '</b>ポイントで' + fmt(rk.next_pos) + '位' : '');
    else if (rk.total > 0 && rk.need != null) txt = '<b>まだ圏外</b> ・ 発送で<b class="sim-num">' + fmt(rk.need) + '</b>ポイント取ると' + fmt(rk.next_pos) + '位';
    else txt = '<b>まだ誰も発送していません。</b>最初に発送すると1位です';
    Array.prototype.forEach.call(document.querySelectorAll('[data-sim-myrank]'), function (el) { el.innerHTML = txt; });
    tickRank = txt; tickerRender();
    if (rankKnown && rk.pos != null && (rankPrev == null || rk.pos < rankPrev) && play === 'game') {
      toast('<b>' + fmt(rk.pos) + '位</b>に上がりました！', 'is-rank');
      playSe('kira1', { vol: 0.8 }); playSe('shine1', { at: 0.15, vol: 0.35, dur: 1.2 });
      nudgeWant = nudgeWant || 'rank';
    }
    rankPrev = rk.pos; rankKnown = true;
  }
  function renderMe(me) {
    if (me.rank) renderMyRank(me.rank);
    if (me.prize) renderPrize(me.prize);
    var b = root.querySelector('[data-sim-me-best]');
    if (b) b.textContent = me.cash ? fmt(me.cash.week) + 'ポイント' : '—';
    var input = root.querySelector('[data-sim-name-input]');
    if (input && !input.value && me.name) input.value = me.name;
  }
  var stateTimer = 0;
  function refreshState() {
    api('state', {}).then(function (j) {
      updateLeftCells({});
      renderRecent([]);
      rankData.day = []; rankData.month = [];
      if (rankEl) renderRanking([], rankEl);
      if (rankMonthEl) renderRanking([], rankMonthEl);
      if (rankPreEl) renderRanking([], rankPreEl); // 最初の画面は月間（FVのバナー「月間ランキング上位にポケカ」と合わせる）
      renderMissions(j.missions || []);
      if (j.me) renderMe(j.me);
      renderEntry(j.entry || null);
      renderEntryYou(rankData.month, !!j.entered_month);
      if (j.wallet && !spinning) {
        walletFrom(j.wallet);
        invRender();
        if (play === 'game' && !wallet.rolled && !(dlg && dlg.open) && !(tut && tut.open)) openRoulette();
      }
    }).catch(function () {
      if (recentEl && /読み込み中/.test(recentEl.textContent)) recentEl.innerHTML = '<li class="sim-feed__empty">いま読み込めません。</li>';
      [rankEl, rankPreEl, rankMonthEl].forEach(function (el) { if (el && /読み込み中/.test(el.textContent)) el.innerHTML = '<li class="sim-feed__empty">いま読み込めません。</li>'; });
    });
  }
  function schedule() {
    clearInterval(stateTimer);
    stateTimer = setInterval(function () { if (document.visibilityState === 'visible' && !busy) refreshState(); }, 20000);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshState(); });

  var nameForm = root.querySelector('[data-sim-name-form]');
  if (nameForm) nameForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = nameForm.querySelector('[data-sim-name-input]');
    var msg = nameForm.querySelector('[data-sim-name-msg]');
    api('name', { name: input.value }).then(function (j) {
      msg.textContent = j.name ? '「' + j.name + '」で保存しました' : '名前を消しました（名無しで表示されます）';
      refreshState();
    }).catch(function (err) {
      msg.textContent = err.code === 'bad_name' ? '12文字まで。URL・@・業者名・「公式」「運営」などは使えません' : errText(err.code);
    });
  });

  // ================================================================
  // 自分で作る（ファーストビュー）
  // 定義 = {t, pr, tot, hz, tiers:[{rl, n, pt, q}]}。箱・抽選・記録はすべてこの端末の中。
  // ================================================================
  var LIMITS = { tiers: 30, tot: 1000000, pr: 10000000, pt: 100000000 };
  var maker = root.querySelector('[data-sim-maker]');
  var tiersWrap = maker && maker.querySelector('[data-sim-m-tiers]');
  var msgEl = maker && maker.querySelector('[data-sim-m-msg]');
  var shots = []; // [{file, url}]（端末の中だけ。送るのは「読み取って作る」を押したときだけ）
  var MAX_SHOTS = 6;
  var STORE_KEY = 'ot_sim_my';

  function rng(max) { // 1..max
    if (window.crypto && crypto.getRandomValues) {
      var lim = Math.floor(4294967296 / max) * max, a = new Uint32Array(1);
      do { crypto.getRandomValues(a); } while (a[0] >= lim);
      return (a[0] % max) + 1;
    }
    return Math.floor(Math.random() * max) + 1;
  }

  function freshBox(g, round) {
    var counts = g.tiers.map(function (t) { return t.q; });
    counts.push(g.hz.q);
    return { round: round, left: g.tot, pulls: 0, counts: counts };
  }

  // サーバーの OritokuSimRepository::pull と同じ形の結果を返す
  function localPull(g, box, n) {
    var b = { round: box.round, left: box.left, pulls: box.pulls, counts: box.counts.slice() };
    var T = g.tiers.length, hits = {}, pt = 0, ptUnknown = 0, bestIdx = -1, bestPt = -1, soldOut = false, drawn = 0, opened = 0;
    while (drawn < n) {
      if (b.left <= 0) {
        b = freshBox(g, b.round + 1); soldOut = true;
        if (++opened > 12) break;
      }
      var r = rng(b.left), acc = 0, idx = T;
      for (var i = 0; i < T; i++) { acc += b.counts[i]; if (r <= acc) { idx = i; break; } }
      b.counts[idx]--; b.left--; b.pulls++; drawn++;
      if (idx < T) {
        hits[idx] = (hits[idx] || 0) + 1;
        var t = g.tiers[idx];
        if (t.pt == null) ptUnknown++; else pt += t.pt;
        var score = t.pt || 0;
        if (score > bestPt) { bestPt = score; bestIdx = idx; }
      } else if (g.hz.pt != null) pt += g.hz.pt;
    }
    var list = Object.keys(hits).map(function (k) { return [parseInt(k, 10), hits[k]]; });
    return { ok: true, n: drawn, cost: g.pr * drawn, pt: pt, pt_unknown: ptUnknown, mkt: pt, mkt_n: 0, hits: list, best_idx: bestIdx,
      box: { round: b.round, left: b.left, pulls: b.pulls, sold_out: soldOut, counts: b.counts } };
  }

  function groupsOf(tiers) {
    var out = [], at = {};
    tiers.forEach(function (t) {
      var k = t.rl;
      if (!(k in at)) { at[k] = out.length; out.push({ rl: k, r: '', kinds: 0, q: 0, pt_min: null, pt_max: null }); }
      var g = out[at[k]];
      g.kinds++; g.q += t.q;
      if (t.pt != null) { g.pt_min = g.pt_min == null ? t.pt : Math.min(g.pt_min, t.pt); g.pt_max = g.pt_max == null ? t.pt : Math.max(g.pt_max, t.pt); }
    });
    return out;
  }

  var intOf = function (v) { v = String(v == null ? '' : v).replace(/[,，\s]/g, '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); return /^\d+$/.test(v) ? parseInt(v, 10) : null; };

  // 入力 → 定義（エラーは文言で返す）
  function readDef(def) {
    var errs = [];
    var pr = intOf(def.pr), tot = intOf(def.tot), hz = def.hz === '' || def.hz == null ? 0 : intOf(def.hz);
    if (!pr || pr < 1 || pr > LIMITS.pr) errs.push('1口の価格を入れてください');
    if (!tot || tot < 1 || tot > LIMITS.tot) errs.push('全部で何口あるかを入れてください（' + fmt(LIMITS.tot) + '口まで）');
    if (hz == null || hz > LIMITS.pt) errs.push('ハズレで戻るptは0以上の数字で');
    var tiers = [];
    (def.tiers || []).forEach(function (t) {
      var q = intOf(t.q), p = intOf(t.pt);
      var blank = !String(t.q || '').trim() && !String(t.pt || '').trim() && !String(t.n || '').trim();
      if (blank) return;
      if (!q || q < 1) { errs.push('「' + (t.rl || '賞') + '」の枚数を入れてください'); return; }
      if (p == null || p > LIMITS.pt) { errs.push('「' + (t.rl || '賞') + '」の戻るptを入れてください'); return; }
      tiers.push({ rl: String(t.rl || '').trim().slice(0, 12), n: String(t.n || '').trim().slice(0, 40), pt: p, q: q, no: '', m: null, mc: null });
    });
    if (!tiers.length) errs.push('賞を1つ以上入れてください（戻るptと枚数）');
    if (tiers.length > LIMITS.tiers) errs.push('賞は' + LIMITS.tiers + '個まで');
    var atari = tiers.reduce(function (a, t) { return a + t.q; }, 0);
    if (tot && atari > tot) errs.push('賞の枚数の合計（' + fmt(atari) + '枚）が全部の口数（' + fmt(tot) + '口）を超えています');
    // pt の高い順に並べ、賞の名前が空なら 1等・2等… を付ける
    tiers.sort(function (a, b) { return b.pt - a.pt; });
    var rank = 0, prevPt = null;
    tiers.forEach(function (t) { if (t.pt !== prevPt) { rank++; prevPt = t.pt; } if (!t.rl) t.rl = rank + '等'; });
    var g = null;
    if (!errs.length) {
      var hzq = tot - atari;
      var sum = tiers.reduce(function (a, t) { return a + t.pt * t.q; }, 0) + hz * hzq;
      g = { id: 'my', site: 'my', site_name: '自作', unit: 'pt', t: String(def.t || '').trim().slice(0, 40) || '自作オリパ', pr: pr, tot: tot,
        atari_q: atari, rate_pt: sum / (pr * tot), rate_m: null, pt_unknown: 0, lineup: '', limited: false,
        tiers: tiers, hz: { q: hzq, pt: hz, n: 'ハズレ' }, groups: groupsOf(tiers) };
    }
    return { errs: errs, g: g, partial: { pr: pr, tot: tot, hz: hz || 0, tiers: tiers, atari: atari } };
  }

  function tierRow(t) {
    var d = document.createElement('div');
    d.className = 'sim-tier-in';
    d.setAttribute('data-sim-m-tier', '');
    d.innerHTML =
      '<input class="sim-input" type="text" maxlength="12" placeholder="' + esc(t.ph || '1等') + '" aria-label="賞の名前" data-k="rl" value="' + esc(t.rl || '') + '">' +
      '<input class="sim-input" type="text" maxlength="40" placeholder="' + (t.first ? '景品（任意）例: PSA10 ピカチュウ' : '景品（任意）') + '" aria-label="景品" data-k="n" value="' + esc(t.n || '') + '">' +
      '<input class="sim-input" type="number" inputmode="numeric" min="0" placeholder="' + (t.first ? '戻るpt' : 'pt') + '" aria-label="戻るpt" data-k="pt" value="' + esc(t.pt == null ? '' : t.pt) + '">' +
      '<input class="sim-input" type="number" inputmode="numeric" min="1" placeholder="枚数" aria-label="枚数" data-k="q" value="' + esc(t.q == null ? '' : t.q) + '">' +
      '<button type="button" class="sim-tier-in__del" aria-label="この賞を消す" data-sim-m-del>×</button>';
    return d;
  }
  function addTier(t) {
    if (!tiersWrap || tiersWrap.children.length >= LIMITS.tiers) return;
    t = t || {};
    t.ph = (tiersWrap.children.length + 1) + '等';
    t.first = tiersWrap.children.length === 0;
    tiersWrap.appendChild(tierRow(t));
  }

  function collect() {
    var v = function (k) { var el = maker.querySelector('[data-sim-m="' + k + '"]'); return el ? el.value : ''; };
    return {
      t: v('t'), pr: v('pr'), tot: v('tot'), hz: v('hz'),
      tiers: Array.prototype.map.call(tiersWrap.querySelectorAll('[data-sim-m-tier]'), function (row) {
        var o = {}; Array.prototype.forEach.call(row.querySelectorAll('[data-k]'), function (el) { o[el.getAttribute('data-k')] = el.value; }); return o;
      })
    };
  }
  function fill(def) {
    ['t', 'pr', 'tot', 'hz'].forEach(function (k) { var el = maker.querySelector('[data-sim-m="' + k + '"]'); if (el) el.value = def[k] == null ? '' : def[k]; });
    tiersWrap.innerHTML = '';
    (def.tiers && def.tiers.length ? def.tiers : [{}, {}, {}]).forEach(function (t) { addTier(t); });
    updateCalc();
  }

  function updateCalc() {
    var r = readDef(collect()), p = r.partial;
    var set = function (k, html) { var el = maker.querySelector('[data-sim-calc-' + k + ']'); if (el) el.innerHTML = html; };
    var ok = p.pr && p.tot && p.atari <= p.tot && p.tiers.length;
    if (ok) {
      var hzq = p.tot - p.atari;
      var sum = p.tiers.reduce(function (a, t) { return a + t.pt * t.q; }, 0) + p.hz * hzq;
      var rate = sum / (p.pr * p.tot);
      set('rate', '<span class="' + (rate >= 1 ? 'is-plus' : '') + '">' + pct(rate) + '</span>');
      set('hit', p.atari > 0 ? '1/' + fmt(Math.round(p.tot / p.atari)) + '<small> ' + fmt(p.atari) + '枚</small>' : '—');
      set('hz', fmt(hzq) + '<small>口</small>');
      set('cost', fmt(p.pr * p.tot) + '<small>pt → ' + fmt(sum) + 'pt</small>');
    } else {
      set('rate', '—'); set('hit', '—'); set('hz', p.tot && p.atari <= p.tot ? fmt(p.tot - p.atari) + '<small>口</small>' : '—'); set('cost', p.pr && p.tot ? fmt(p.pr * p.tot) + '<small>pt</small>' : '—');
    }
    if (msgEl && msgEl.getAttribute('data-shown') === '1') { var e = r.errs; msgEl.textContent = e.length ? e[0] : ''; msgEl.classList.toggle('is-error', e.length > 0); }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(collect())); } catch (e) {}
  }

  // 共有リンク（#my=… に定義だけを入れる。スクショは入れない）
  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(s + '==='.slice((s.length + 3) % 4)), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function myShareUrl(g) {
    var def = { t: g.t, pr: g.pr, tot: g.tot, hz: g.hz.pt, tiers: g.tiers.map(function (t) { return [t.rl, t.n, t.pt, t.q]; }) };
    return location.origin + location.pathname + '#my=' + b64urlEncode(JSON.stringify(def));
  }
  function defFromHash(h) {
    try {
      var d = JSON.parse(b64urlDecode(h));
      return { t: d.t, pr: d.pr, tot: d.tot, hz: d.hz, tiers: (d.tiers || []).slice(0, LIMITS.tiers).map(function (a) { return { rl: a[0], n: a[1], pt: a[2], q: a[3] }; }) };
    } catch (e) { return null; }
  }
  function copyShare(btn) {
    var url = myShareUrl(current.gacha);
    var done = function () { btn.textContent = 'コピーしました'; setTimeout(function () { btn.textContent = '共有リンクをコピー'; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('このリンクをコピーしてください', url); });
    else window.prompt('このリンクをコピーしてください', url);
  }

  function playLocal(g) {
    if (busy) return;
    rows.forEach(function (r) { r.classList.remove('is-selected'); });
    current = { gacha: g, box: freshBox(g, 1), stats: null, local: true };
    playSec.hidden = false;
    renderBox();
    playSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // スクショ（object URL で表示。最大 6 枚）
  function renderShots() {
    var list = maker.querySelector('[data-sim-shots]'), empty = maker.querySelector('[data-sim-drop-empty]'), clr = maker.querySelector('[data-sim-shot-clear]'), btn = maker.querySelector('[data-sim-read]');
    list.innerHTML = shots.map(function (x, i) {
      return '<span class="sim-shots__item"><img src="' + esc(x.url) + '" alt="スクショ' + (i + 1) + '"><span class="sim-shots__n">' + (i + 1) + '</span><button type="button" class="sim-shots__del" aria-label="' + (i + 1) + '枚目を外す" data-sim-shot-del="' + i + '">×</button></span>';
    }).join('') + (shots.length < MAX_SHOTS ? '<label class="sim-shots__add" for="sim-shot-input">＋追加</label>' : '');
    list.hidden = !shots.length; empty.hidden = !!shots.length; clr.hidden = !shots.length;
    if (btn) btn.disabled = !shots.length || reading;
    maker.classList.toggle('has-shot', !!shots.length);
  }
  function addShots(files) {
    Array.prototype.forEach.call(files || [], function (f) {
      if (!f || !/^image\//.test(f.type) || shots.length >= MAX_SHOTS) return;
      shots.push({ file: f, url: URL.createObjectURL(f) });
    });
    renderShots();
  }
  function removeShot(i) {
    var x = shots.splice(i, 1)[0];
    if (x) URL.revokeObjectURL(x.url);
    renderShots();
  }
  function clearShot() {
    shots.forEach(function (x) { URL.revokeObjectURL(x.url); });
    shots = [];
    var inp = maker.querySelector('[data-sim-shot-input]'); if (inp) inp.value = '';
    renderShots();
  }

  // 送る前に縮小し、縦長のスクショは高さ 1800px ごとに切る（横 1000px まで。AI が細かい数字を読める大きさに保つ）
  function slices(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, 1000 / img.naturalWidth), w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        var step = 1800, out = [], jobs = [];
        for (var y = 0; y < h; y += step) {
          (function (y0) {
            var c = document.createElement('canvas'), hh = Math.min(step, h - y0);
            c.width = w; c.height = hh;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh);
            ctx.drawImage(img, 0, -y0, w, h);
            jobs.push(new Promise(function (ok) { c.toBlob(function (b) { out[y0 / step] = b; ok(); }, 'image/jpeg', 0.85); }));
          }(y));
        }
        Promise.all(jobs).then(function () { resolve(out.filter(Boolean)); });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad_image')); };
      img.src = url;
    });
  }

  var reading = false;
  var readText = function (code) {
    return { reader_off: '自動の読み取りはいま使えません。数字を入れてください', rate_limited: '読み取りの回数が多すぎます。1時間ほど待つか、数字を入れてください', busy: 'いま混み合っています。少し待ってからもう一度どうぞ', not_oripa: 'オリパの画面として読めませんでした。価格や景品が写ったスクショを置いてください', too_many: 'スクショが多すぎます（6枚まで）', too_large: '画像が大きすぎます', bad_image: '画像を読めませんでした。PNGかJPEGのスクショを置いてください', read_failed: 'うまく読み取れませんでした。数字を入れてください' }[code] || errText(code);
  };
  function readShots() {
    if (reading || !shots.length) return;
    var btn = maker.querySelector('[data-sim-read]'), out = maker.querySelector('[data-sim-read-msg]');
    reading = true; btn.disabled = true; btn.textContent = '読み取り中…（20秒ほど）';
    out.classList.remove('is-error'); out.textContent = '';
    Promise.all(shots.map(function (x) { return slices(x.file); })).then(function (parts) {
      var blobs = [].concat.apply([], parts).slice(0, 12);
      var fd = new FormData();
      fd.append('action', 'read'); fd.append('token', cfg.token); fd.append('client', client);
      blobs.forEach(function (b, i) { fd.append('shots[]', b, 'shot' + (i + 1) + '.jpg'); });
      return fetch(cfg.api, { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j.ok) { var e = new Error((j && j.error) || ('http_' + r.status)); e.code = (j && j.error) || ('http_' + r.status); throw e; }
          return j;
        }); });
    }).then(function (j) {
      fill(j.def);
      var rr = readDef(collect());
      var note = j.notes ? ' ' + j.notes : '';
      if (rr.g) {
        out.textContent = '読み取ってガチャを作りました。数字が違っていたら右の欄を直して、もう一度「作って引く」を押してください。' + note;
        playLocal(rr.g);
      } else {
        out.classList.add('is-error');
        out.textContent = '読み取れなかった項目があります（' + (j.missing && j.missing.length ? j.missing.join('・') : rr.errs[0]) + '）。右の欄に入れてから「作って引く」を押してください。' + note;
      }
    }).catch(function (e) {
      out.classList.add('is-error');
      out.textContent = readText(e.code || e.message);
    }).then(function () {
      reading = false; btn.textContent = 'スクショから読み取って作る'; btn.disabled = !shots.length;
    });
  }

  var SAMPLE = { t: '例: PSA10狙いの1000ptオリパ', pr: 1000, tot: 1000, hz: 300, tiers: [
    { rl: '1等', n: 'PSA10 リザードンex SAR', pt: 100000, q: 1 },
    { rl: '2等', n: 'PSA10 ピカチュウ AR', pt: 30000, q: 3 },
    { rl: '3等', n: 'SR 未鑑定', pt: 5000, q: 20 },
    { rl: '4等', n: 'RR 未鑑定', pt: 1500, q: 100 }
  ] };

  if (maker && tiersWrap) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
    fill(saved && typeof saved === 'object' ? saved : {});
    maker.addEventListener('input', updateCalc);
    maker.querySelector('[data-sim-m-add]').addEventListener('click', function () { addTier({}); var last = tiersWrap.lastElementChild; if (last) last.querySelector('input').focus(); });
    tiersWrap.addEventListener('click', function (e) {
      var del = e.target.closest('[data-sim-m-del]');
      if (!del) return;
      del.parentNode.remove();
      if (!tiersWrap.children.length) addTier({});
      updateCalc();
    });
    maker.querySelector('[data-sim-m-sample]').addEventListener('click', function () { fill(SAMPLE); msgEl.removeAttribute('data-shown'); msgEl.classList.remove('is-error'); msgEl.textContent = '例を入れました。数字を書き換えると還元率がその場で変わります。'; });
    maker.querySelector('[data-sim-m-reset]').addEventListener('click', function () { fill({}); clearShot(); msgEl.textContent = ''; msgEl.removeAttribute('data-shown'); });
    maker.addEventListener('submit', function (e) {
      e.preventDefault();
      var r = readDef(collect());
      msgEl.setAttribute('data-shown', '1');
      msgEl.classList.toggle('is-error', r.errs.length > 0);
      if (r.errs.length) { msgEl.textContent = r.errs[0]; return; }
      msgEl.textContent = '';
      playLocal(r.g);
    });
    var shotInput = maker.querySelector('[data-sim-shot-input]'), drop = maker.querySelector('[data-sim-drop]');
    shotInput.addEventListener('change', function () { addShots(shotInput.files); shotInput.value = ''; });
    maker.querySelector('[data-sim-shot-clear]').addEventListener('click', clearShot);
    maker.querySelector('[data-sim-shots]').addEventListener('click', function (e) {
      var del = e.target.closest('[data-sim-shot-del]');
      if (!del) return;
      e.preventDefault(); e.stopPropagation();
      removeShot(parseInt(del.getAttribute('data-sim-shot-del'), 10));
    });
    var readBtn = maker.querySelector('[data-sim-read]');
    if (readBtn) readBtn.addEventListener('click', readShots);
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('is-over'); }); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); addShots(e.dataTransfer.files); });
    document.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var fs = [];
      for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) fs.push(items[i].getAsFile());
      if (fs.length) addShots(fs);
    });
  }


  // ================================================================
  // 持ちポイントと遊び方（ゲーム／分析）。ポイントは架空で、端末の localStorage だけ
  // ゲーム: 週のはじめにルーレットを 1 回だけ回して持ちポイントが決まる（やり直し・追加チャージなし）。
  //   重みは (1000/額)^0.7 で、額が大きいほど止まりにくい。週（JST の月曜はじまり＝ランキングと同じ）が変わると回し直せる
  // 分析: ポイントを使わずに何度でも引ける。手持ち・発送・ランキングは無し
  // ================================================================
  var WALLET_KEY = 'ot_sim_wallet', PLAY_KEY = 'ot_sim_play';
  // 初期ポイントの差は小さく（最低と最高で2倍未満）。大きい額ほど少しだけ止まりにくい（最も出やすい額と出にくい額で約2.6倍）
  var PLANS = [5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000].map(function (pt) { return { pt: pt, w: Math.pow(10000 / pt, 1.5) }; });
  var PLAN_W = PLANS.reduce(function (a, p) { return a + p.w; }, 0);
  // 区切りは1日（日本時間の日付。サーバーのランキングと同じ）。名前は week のまま
  function thisWeek() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  var wallet = (function () {
    try {
      var w = JSON.parse(localStorage.getItem(WALLET_KEY) || 'null');
      if (w && typeof w.pt === 'number' && w.week === thisWeek()) return { pt: Math.max(0, w.pt), spent: w.spent || 0, cash: w.cash || 0, week: w.week, rolled: !!w.rolled, rev: w.rev || '', ranked: !!w.ranked, done: !!w.done };
      if (w) localStorage.removeItem('ot_sim_inv'); // 週が変わったら手持ちも持ち越さない
    } catch (e) {}
    return { pt: 0, spent: 0, cash: 0, week: thisWeek(), rolled: false };
  }());
  function walletSave() { try { localStorage.setItem(WALLET_KEY, JSON.stringify(wallet)); } catch (e) {} }
  // 持ちポイントは増減が分かるように数字を動かし、下のバーに「+◯」「−◯」を浮かせる
  var ptShown = null, ptAnim = null;
  function ptSet(v) { Array.prototype.forEach.call(document.querySelectorAll('[data-sim-wallet-pt]'), function (el) { el.textContent = fmt(v); }); }
  function ptMove(from, to) {
    cancelAnimationFrame(ptAnim);
    var t0 = performance.now();
    var step = function (now) {
      var k = Math.min(1, (now - t0) / TUNE.ptTween);
      ptSet(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) ptAnim = requestAnimationFrame(step); else ptAnim = null;
    };
    ptAnim = requestAnimationFrame(step);
    var item = document.querySelector('.sim-footbar__item--coin');
    if (item) {
      var pop = document.createElement('span');
      pop.className = 'sim-cashpop' + (to < from ? ' is-minus' : ''); pop.textContent = (to < from ? '−' : '+') + fmt(Math.abs(to - from));
      item.appendChild(pop);
      item.classList.remove('is-bump'); void item.offsetWidth; item.classList.add('is-bump');
      setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 1400);
    }
  }
  function walletRender() {
    var ptFrom = ptShown; ptShown = wallet.pt;
    if (ptFrom == null || ptFrom === wallet.pt || reduceMotion() || document.visibilityState !== 'visible') { cancelAnimationFrame(ptAnim); ptAnim = null; ptSet(wallet.pt); }
    else ptMove(ptFrom, wallet.pt);
    Array.prototype.forEach.call(root.querySelectorAll('[data-sim-wallet-spent]'), function (el) { el.textContent = fmt(wallet.spent); });
    if (!cashAnim) Array.prototype.forEach.call(document.querySelectorAll('[data-sim-wallet-cash]'), function (el) { el.textContent = fmt(wallet.cash || 0); });
    var net = (wallet.cash || 0) - wallet.spent;
    Array.prototype.forEach.call(root.querySelectorAll('[data-sim-wallet-net]'), function (el) { el.textContent = (net > 0 ? '+' : '') + fmt(net); el.className = 'sim-num ' + (net >= 0 ? 'is-plus' : 'is-minus'); });
  }
  // ---- オリ得レベル・生存日数・ガチャの鍵 ----
  var LEVEL_NAME = {}; (cfg.levels || []).forEach(function (L) { LEVEL_NAME[L.key] = L.name; });
  // ガチャの解放ラベルは（）の中を必要なptにする（2026-11-02 岸田「（）内は◯pt以上」）: ゴールド（上級者）→ ゴールド（24,000pt以上）
  function lvLabel(L) { return String(L.name).replace(/（.*?）$/, '') + '（' + fmt(L.min) + 'pt以上）'; }
  function levelFor(price) { var L = cfg.levels || []; for (var i = 0; i < L.length; i++) if (!L[i].max_price || price <= L[i].max_price) return L[i]; return null; }
  function renderStatus() {
    var box = root.querySelector('[data-sim-status]'); if (!box) return;
    var lv = wallet.level, nx = wallet.next;
    var lvEl = box.querySelector('[data-sim-level]');
    if (lv) { var lvSub = (String(lv.name).match(/（(.+)）/) || [])[1] || ''; lvEl.innerHTML = esc(lv.key.replace(/2$/, '').toUpperCase()) + (lvSub ? '<small class="sim-status__sub">（' + esc(lvSub) + '）</small>' : ''); box.className = 'sim-status sim-status--' + lv.key; var ja = box.querySelector('[data-sim-level-ja]'); if (ja) ja.textContent = lv.name; }
    box.querySelector('[data-sim-next]').innerHTML = nx ? '<span class="sim-status__left">あと <span class="sim-num">' + fmt(Math.max(0, nx.min - wallet.pt)) + '</span>コイン</span>' +
      '<span class="sim-status__bar" aria-hidden="true"><i style="width:' + (lv && nx.min > lv.min ? Math.max(4, Math.min(100, Math.round(((wallet.best || wallet.pt) - lv.min) / (nx.min - lv.min) * 100))) : 0) + '%"></i></span>' : '最高レベル';
    box.querySelector('[data-sim-survive]').textContent = fmt(Math.max(1, wallet.survive || 1));
    // 今のレベルで引けないガチャに鍵（「シルバーで解放」）
    var maxP = lv ? (lv.max_price || Infinity) : Infinity;
    rows.forEach(function (r) {
      var p = +r.getAttribute('data-price'), locked = play === 'game' && wallet.rolled && p > maxP;
      r.classList.toggle('is-locked', locked);
      if (locked) { r.classList.remove('is-unlocked'); var nw = r.querySelector('.sim-card__new'); if (nw) nw.remove(); }
      var tag = r.querySelector('.sim-card__lock');
      if (locked) {
        var need = levelFor(p);
        if (!tag) { tag = document.createElement('span'); tag.className = 'sim-card__lock'; r.querySelector('.sim-card__visual').appendChild(tag); }
        tag.textContent = (need ? lvLabel(need) : '上のレベル') + 'で解放';
      } else if (tag) tag.remove();
    });
  }

  // 結果の表示や手持ちの更新が落ち着いてから、ゲームオーバーかどうかを見る
  var overTimer = null;
  function checkOver() {
    if (play !== 'game') return;
    clearTimeout(overTimer);
    overTimer = setTimeout(function () { if (play === 'game' && !overOpen && !(dlg && dlg.open) && isOver()) openOver(); }, 1500);
  }
  // 発送で現金が増えるとき: 円の数字をカウントアップして、下のバーに「+◯円」を浮かせる
  var cashAnim = null, lastCashSe = 0;
  function cashUp(from, to) {
    if (to <= from) return;
    var els = document.querySelectorAll('[data-sim-wallet-cash]');
    var t0 = performance.now(), dur = Math.min(1500, 500 + (to - from) / 50);
    cancelAnimationFrame(cashAnim);
    var step = function (now) {
      var k = Math.min(1, (now - t0) / dur), v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      Array.prototype.forEach.call(els, function (el) { el.textContent = fmt(v); });
      if (k < 1) cashAnim = requestAnimationFrame(step); else { cashAnim = null; walletRender(); }
    };
    cashAnim = requestAnimationFrame(step);
    if (Date.now() - lastCashSe > 350) { lastCashSe = Date.now(); playSe('clearing1', { vol: 0.8 }); } // 発送＝レジの「チャリーン」（まとめて発送で鳴りすぎないよう間引く）
    var item = document.querySelector('.sim-footbar__item--cash');
    if (item) {
      var pop = document.createElement('span');
      pop.className = 'sim-cashpop'; pop.textContent = '+' + fmt(to - from) + 'ポイント';
      item.appendChild(pop);
      setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 1400);
    }
  }
  // ゲームが始まったら（今日のルーレットを回して、まだ終了していない）上の「ゲームで遊ぶ」と財布の欄を隠す
  // チャージしたら（今日のゲームを始めたら）上の選択ボタン・残高の帯・見出し・パンくずは隠す
  function markStarted() { var on = play === 'game' && !!wallet.rolled; root.toggleAttribute('data-started', on); document.documentElement.toggleAttribute('data-sim-started', on); coachRender(); tickerRender(); /* 帯が画面に出た瞬間に流し始める */ }
  // サーバーの財布をそのまま写す（持ちポイントの正本はサーバー。ここで足し引きしない）
  // レベルが上がった瞬間を祝う（2026-11-14）。演出・結果の表示が落ち着いてから出す。ルーレットで決まった最初のレベルは対象外
  function lvIndex(key) { var L = cfg.levels || []; for (var i = 0; i < L.length; i++) if (L[i].key === key) return i; return -1; }
  var lvQueue = null;
  function levelUp(from, to) { lvQueue = { from: from, to: to }; setTimeout(lvTry, 300); }
  // ---- ログインボーナス（2026-11-23 岸田「連続日数にごほうびを付けよう」）----
  // その日はじめてルーレットを回したあとに1回だけ、7日分のスタンプカードを出す。額はサーバーが決めて財布に足し済み
  var LOGIN_SEEN_KEY = 'ot_sim_login_seen', loginQueued = false;
  function loginQueue() { loginQueued = true; setTimeout(loginTry, 600); }
  function loginTry() {
    if (!loginQueued) return;
    if (busy || (dlg && dlg.open) || lvQueue || document.querySelector('.sim-lvup')) { setTimeout(loginTry, 400); return; }
    loginQueued = false;
    try { localStorage.setItem(LOGIN_SEEN_KEY, wallet.week); } catch (e) {}
    openLogin(true);
  }
  var loginBtn = root.querySelector('[data-sim-login-open]');
  if (loginBtn) loginBtn.addEventListener('click', function () { if (wallet.rolled) openLogin(false); });
  function loginSeenToday() { try { return localStorage.getItem(LOGIN_SEEN_KEY) === wallet.week; } catch (e) { return false; } }
  // ログインボーナスのシート（2026-11-23 岸田: 金の額縁 × 毎日1枚めくるカード。額は確率で変わる）。
  // 引くのはサーバー（ルーレットのとき）。ここは結果をめくって見せるだけ。fresh = その日はじめて（裏向きで出して押すとめくれる）
  function loginCard(k, rk, amt, flipped) {
    return '<div class="sim-lc__tc sim-lc--' + esc(rk || 'N') + (flipped ? ' is-flipped' : '') + '"><div class="sim-lc__face sim-lc__back"><img src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt=""><span>TAP!</span></div>' +
      '<div class="sim-lc__face sim-lc__front"><span class="sim-lc__nm">' + k + '日目<i>' + esc(rk || '') + '</i></span><span class="sim-lc__art"><span class="sim-coin">P</span></span><span class="sim-lc__pw"><small>ボーナスポイント</small><b>' + (amt ? '+' + fmt(amt) : '受取済み') + '</b></span></div></div>';
  }
  function openLogin(fresh) {
    var L = wallet.login; if (!L || !L.amounts) return;
    var n = L.cycle || 7, pos = L.pos || 1, sheet = L.sheet || [], A = L.amounts, RKS = ['N', 'R', 'SR', 'UR'];
    var cells = '';
    for (var k = 1; k <= n; k++) {
      var rk = sheet[k - 1] || '', cls = 'sim-lc' + (k === n ? ' is-last' : '') + (k === pos ? ' is-now' : '');
      if (k < pos) cells += '<div class="' + cls + '">' + loginCard(k, rk || 'N', rk ? A[rk] : 0, true) + '<span class="sim-lc__get">GET!</span></div>';
      else if (k === pos) cells += '<div class="' + cls + '">' + loginCard(k, L.rank || 'N', L.got, !fresh) + (fresh ? '' : '<span class="sim-lc__get">GET!</span>') + '</div>';
      else if (k === n) cells += '<div class="' + cls + '"><span class="sim-lc__lab">' + k + '日目<em>SR以上確定 ・ URなら +' + fmt(A.UR) + '</em></span></div>';
      else cells += '<div class="' + cls + '"><span class="sim-lc__lab">' + k + '日目<b>?</b></span></div>';
    }
    var odds = L.odds || {};
    var d = document.createElement('dialog');
    d.className = 'sim-login';
    d.innerHTML = '<div class="sim-login__frame"><img class="sim-login__logo" src="' + esc(cfg.logo || '/public/images/oritoku/oritoku-logo-nav.webp') + '" alt="オリ得"><p class="sim-login__ribbon">ログインボーナス</p><div class="sim-login__in">' +
      ((cfg.prize && cfg.prize.month) ? '<p class="sim-login__say">' + esc(cfg.prize.month) + '月間ランキング1位には<em>' + esc(cfg.prize.short || '') + '</em>！</p>' : '') +
      '<div class="sim-lc__grid">' + cells + '</div>' +
      '<p class="sim-login__got"' + (fresh ? ' hidden' : '') + '><small data-lc-rk>' + esc(L.rank || '') + '</small><span class="sim-coin">P</span>+' + fmt(L.got || 0) + '<small>pt</small></p>' +
      '<details class="sim-login__help"><summary>確率とルールを見る</summary><div class="sim-login__odds">今日のカードの確率（続けて来るほど上がる）<span>' + RKS.map(function (r) { return '<i class="sim-lc--' + r + '"><b>' + r + '</b>' + (odds[r] || 0) + '%</i>'; }).join('') + '</span></div>' +
      '<p class="sim-login__notes">〜ご注意〜<br><b>※</b>1日空けると、シートは1日目からやり直しです。<br><b>※</b>' + n + '日目は <b>SR以上確定</b>。' + (L.tier ? esc(L.tier) + 'の額' + (L.rate > 1 ? '（×' + (Math.round(L.rate * 10) / 10) + '）' : '') + 'です。' : '') + (L.next_tier ? esc(L.next_tier.name) + 'に上がるとURは +' + fmt(L.next_tier.ur) + '。' : '') + '</p></details>' +
      '<button type="button" class="sim-login__btn"' + (fresh ? ' disabled' : '') + '>' + (fresh ? '受け取ってガチャへ' : '閉じる') + '</button></div></div>';
    document.body.appendChild(d);
    var close = function () { if (d.open) d.close(); d.remove(); };
    var btn = d.querySelector('.sim-login__btn');
    btn.addEventListener('click', close);
    d.addEventListener('click', function (e) { if (e.target === d && !btn.disabled) close(); });
    d.addEventListener('cancel', function (e) { if (btn.disabled) e.preventDefault(); });
    d.addEventListener('close', function () { d.remove(); });
    var help = d.querySelector('.sim-login__help');
    if (help) help.addEventListener('toggle', function () { if (help.open) ga('sim_rule_open', { where: 'login_bonus' }); });
    var now = d.querySelector('.sim-lc.is-now');
    if (fresh && now) now.addEventListener('click', function () {
      var tc = now.querySelector('.sim-lc__tc'); if (tc.classList.contains('is-flipped')) return;
      tc.classList.add('is-flipped'); sfx.tick && sfx.tick();
      var rk = L.rank || 'N';
      ga('sim_login_bonus', { card_rank: rk, day_in_sheet: pos, bonus_pt: +L.got || 0 });
      setTimeout(function () {
        var g = document.createElement('span'); g.className = 'sim-lc__get is-pop'; g.textContent = 'GET!'; now.appendChild(g);
        if (rk === 'UR') { d.classList.add('is-ur'); playSe('jajean1', { vol: 0.9 }); try { if (navigator.vibrate && soundOn) navigator.vibrate([60, 40, 60, 40, 200]); } catch (e) {} }
        else if (rk === 'SR') playSe('kira1', { vol: 0.8 }); else playSe('shine1', { vol: 0.6 });
        var got = d.querySelector('.sim-login__got'); got.hidden = false;
        got.querySelector('[data-lc-rk]').textContent = rk + (rk === 'UR' ? ' 大当たり！' : rk === 'SR' ? ' 当たり！' : '');
        btn.disabled = false;
      }, 700);
    });
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function lvTry() {
    if (!lvQueue) return;
    if (busy || (dlg && dlg.open) || document.querySelector('.sim-rpop-done') || (rpop && rpop.classList.contains('is-drawing'))) { setTimeout(lvTry, 400); return; }
    var q = lvQueue; lvQueue = null;
    var oldMax = q.from.max_price || Infinity, newMax = q.to.max_price || Infinity, opened = [];
    rows.forEach(function (r) {
      var p = +r.getAttribute('data-price');
      if (p > oldMax && p <= newMax) {
        opened.push(r); r.classList.add('is-unlocked');
        if (!r.querySelector('.sim-card__new')) { var tag = document.createElement('span'); tag.className = 'sim-card__new'; tag.textContent = '解放！'; r.querySelector('.sim-card__visual').appendChild(tag); }
      }
    });
    var d = document.createElement('dialog');
    d.className = 'sim-lvup';
    var sub = (String(q.to.name).match(/（(.+)）/) || [])[1] || '';
    d.innerHTML = '<p class="sim-lvup__label">レベルアップ！</p>' +
      '<p class="sim-lvup__rank sim-lv--' + esc(q.to.key) + '">' + esc(q.to.key.replace(/2$/, '').toUpperCase()) + '</p>' +
      (sub ? '<p class="sim-lvup__sub">' + esc(sub) + '</p>' : '') +
      '<p class="sim-lvup__msg">' + (opened.length ? '<strong>' + fmt(opened.length) + '個のガチャ</strong>が引けるようになりました' + (q.to.max_price ? '（1回' + fmt(q.to.max_price) + 'ptまで）' : '') : 'おめでとうございます') + '</p>' +
      '<button type="button" class="sim-btn sim-btn--yellow">' + (opened.length ? '解放されたガチャを見る' : '続ける') + '</button>';
    document.body.appendChild(d);
    var close = function () { if (d.open) d.close(); d.remove(); if (opened.length) opened[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    d.querySelector('button').addEventListener('click', close);
    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    d.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    confetti(d, 90);
    playSe('trumpet1', { vol: 0.85 }); playSe('shine1', { at: 0.3, vol: 0.45, dur: 2.2 });
    try { if (navigator.vibrate && soundOn) navigator.vibrate([40, 40, 40, 40, 120]); } catch (e) {}
  }
  function walletFrom(sw) {
    if (!sw) return;
    var sameDay = wallet.week === sw.day;
    var lvOld = wallet.level, wasRolled = !!wallet.rolled;
    if (sameDay && wasRolled && sw.rolled && lvOld && sw.level && lvIndex(sw.level.key) > lvIndex(lvOld.key)) levelUp(lvOld, sw.level);
    wallet = { pt: sw.pt, spent: sw.spent, cash: sw.cash, week: sw.day, rolled: !!sw.rolled, rev: sw.revived ? sw.day : '', done: !!sw.done, ranked: sameDay && !!wallet.ranked,
      level: sw.level || null, next: sw.next || null, best: sw.best || sw.pt || 0, survive: sw.survive || 0, title: sw.title || 'beginner', login: sw.login || null };
    renderStatus();
    if (!sw.rolled) { inv = []; invSave(); } // 今日まだ回していない＝前の日の獲得商品は持ち越さない
    walletSave(); walletRender(); markStarted();
  }

  var play = (function () { try { var v = localStorage.getItem(PLAY_KEY); return v === 'game' || v === 'analyze' ? v : ''; } catch (e) { return ''; } }());
  function applyPlay() {
    root.setAttribute('data-play', play);
    markStarted();
    document.documentElement.classList.toggle('sim-play-game', play === 'game');
    Array.prototype.forEach.call(root.querySelectorAll('[data-sim-only]'), function (el) {
      var on = el.getAttribute('data-sim-only') === play;
      if (el.hasAttribute('data-sim-inv')) { if (!on) el.hidden = true; else invRender(); }
      else el.hidden = !on;
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-sim-rank-pre]'), function (el) { el.hidden = play === 'game'; }); // ゲーム中は下の詳しいランキングを使う
    // 遊び方を選ぶまでは箱の一覧と目次を出さない
    Array.prototype.forEach.call(root.querySelectorAll('[data-sim-chosen]'), function (el) { el.hidden = !play; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-sim-go]'), function (b) { var on = b.getAttribute('data-sim-go') === play; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (current && current.local && play === 'game') { playSec.hidden = true; current = null; } // 自作の箱は分析だけ
    if (current) renderBox();
    markStarted();
  }
  Array.prototype.forEach.call(root.querySelectorAll('[data-sim-go]'), function (b) {
    b.addEventListener('click', function () {
      play = b.getAttribute('data-sim-go') === 'game' ? 'game' : 'analyze';
      try { localStorage.setItem(PLAY_KEY, play); } catch (e) {}
      applyPlay();
      if (play !== 'game') return;
      // 2026-11-14: 説明5枚を読ませる前に、まずルーレットを回してもらう（TUNE.tutFirst で元に戻せる）。説明は「遊び方を先に見る」から
      if (TUNE.tutFirst && b.hasAttribute('data-sim-tutorial') && tut) openTut();
      else if (!wallet.rolled) openRoulette();
    });
  });

  // 遊びながら出す一言の案内（初回だけ）。pick=ガチャ一覧の上 / rpop=結果のポップアップ
  var HINT_KEY = 'ot_sim_hint';
  var hints = (function () { try { return JSON.parse(localStorage.getItem(HINT_KEY) || '{}') || {}; } catch (e) { return {}; } }());
  function hintSeen(k) { return !!(hints && hints[k]); } // 定義より前（初期化の途中）に呼ばれても落ちないように
  function hintDone(k) { if (hints[k]) return; hints[k] = 1; try { localStorage.setItem(HINT_KEY, JSON.stringify(hints)); } catch (e) {} coachRender(); }
  function coachRender() { var c = root.querySelector('[data-sim-coach]'); if (c) c.hidden = !(play === 'game' && wallet.rolled && !wallet.done && !hintSeen('pick')); }
  Array.prototype.forEach.call(root.querySelectorAll('[data-sim-tut-open]'), function (b) { b.addEventListener('click', function () { if (tut) { play = 'game'; try { localStorage.setItem(PLAY_KEY, play); } catch (e) {} applyPlay(); openTut(); } }); });
  // ---- チュートリアル（5枚。最後まで進むか飛ばすとルーレットへ） ----
  var tut = document.querySelector('[data-sim-tut]');
  var tutSlides = tut ? tut.querySelectorAll('[data-sim-tut-slide]') : [];
  var tutAt = 0;
  function tutShow(i) {
    tutAt = Math.max(0, Math.min(tutSlides.length - 1, i));
    Array.prototype.forEach.call(tutSlides, function (el, k) { el.hidden = k !== tutAt; });
    tut.querySelector('[data-sim-tut-no]').textContent = tutAt + 1;
    tut.querySelector('[data-sim-tut-prev]').disabled = tutAt === 0;
    tut.querySelector('[data-sim-tut-next]').textContent = tutAt === tutSlides.length - 1 ? (wallet.rolled ? 'ゲームに戻る' : 'ルーレットへ') : '次へ';
  }
  function openTut() { tutShow(0); if (typeof tut.showModal === 'function') tut.showModal(); else tut.setAttribute('open', ''); }
  function closeTut() {
    if (typeof tut.close === 'function') tut.close(); else tut.removeAttribute('open');
    if (play === 'game' && !wallet.rolled) openRoulette();
  }
  if (tut) {
    tut.querySelector('[data-sim-tut-prev]').addEventListener('click', function () { tutShow(tutAt - 1); });
    tut.querySelector('[data-sim-tut-next]').addEventListener('click', function () { if (tutAt >= tutSlides.length - 1) closeTut(); else tutShow(tutAt + 1); });
    tut.querySelector('[data-sim-tut-skip]').addEventListener('click', closeTut);
    tut.addEventListener('cancel', function (e) { e.preventDefault(); closeTut(); });
  }

  var dlg = document.querySelector('[data-sim-charge]');
  var plansEl = dlg && dlg.querySelector('[data-sim-plans]');
  var chargeMsg = dlg && dlg.querySelector('[data-sim-charge-msg]');
  var spinBtn = dlg && dlg.querySelector('[data-sim-charge-spin]');
  var spinning = false;
  // マスは高いほど濃い色
  if (plansEl) plansEl.innerHTML = PLANS.map(function (p, i) {
    var tag = ''; // 2026-11-01 岸田「ルーレットの激アツはいらない」
    return '<li class="sim-plan is-heat-' + i + '" data-sim-plan="' + i + '"><span class="sim-plan__pt"><span class="sim-coin" aria-hidden="true">P</span>' + fmt(p.pt) + '<small>pt</small></span>' + (tag ? '<span class="sim-plan__tag">' + tag + '</span>' : '') + '</li>';
  }).join('');

  // ---- ポイントが尽きたらゲームオーバー。Xでシェアすると1日1回だけルーレットをもう1回回せる（復活） ----
  var shareBtn = dlg && dlg.querySelector('[data-sim-charge-share]');
  var closeBtn = dlg && dlg.querySelector('[data-sim-charge-close]');
  var chargeTitle = dlg && dlg.querySelector('#sim-charge-title');
  var chargeLead = dlg && dlg.querySelector('[data-sim-charge-lead]');
  var leadHtml = chargeLead ? chargeLead.innerHTML : '';
  var reviving = false, overOpen = false, keyRevive = false;
  function today() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); } // JST
  function minPrice() { return rows.reduce(function (a, r) { var p = +r.getAttribute('data-price'); return p > 0 && p < a ? p : a; }, Infinity); }
  // 一番安い箱も引けず、ptに換えられる景品も無い
  function isOver() { return wallet.rolled && !wallet.done && wallet.pt < minPrice() && !inv.some(function (x) { return x.pt != null; }); }
  function setCharge(title, lead) { chargeTitle.textContent = title; chargeLead.innerHTML = lead; chargeLead.hidden = false; }
  function showDlg() { if (!dlg.open) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); } }
  // kind: 'over' = いちばん安いガチャも引けない / 'short' = 選んだガチャに足りない（あと lack pt）
  function openOver(kind, lack) {
    if (!dlg || spinning) return;
    overOpen = true; reviving = false; dlg.classList.remove('is-spot'); dlg.classList.add('is-alert');
    var used = wallet.rev === today();
    // PCは1行、スマホだけ2行に折る
    var sp = window.matchMedia && matchMedia('(max-width: 640px)').matches;
    setCharge(kind === 'short' ? (sp ? 'ポイントが\n足りません' : 'ポイントが足りません') : 'GAME OVER', // 2026-11-01 岸田: 英字で
      (kind === 'short' ? 'あと <strong>' + fmt(lack) + 'pt</strong> 足りません。' : 'ポイントがなくなりました。今日のオリ得ランクポイントは <strong>' + fmt(wallet.cash || 0) + 'ポイント</strong>。') +
      (used ? '今日の復活はもう使いました。明日になると新しいルーレットが回せます。' : '<br><strong>復活キーを入力すると、ルーレットをもう1回回してポイントが復活します。</strong>'));
    chargeMsg.textContent = '';
    spinBtn.hidden = true; shareForm.hidden = true;
    // 2026-10-31 岸田: 「安いガチャを選ぶ」は外す。閉じるのは右上の×か、枠の外を押す
    shareBtn.hidden = used; closeBtn.hidden = !used; closeBtn.textContent = '閉じる';
    Array.prototype.forEach.call(plansEl.children, function (li) { li.classList.remove('is-on', 'is-hit'); });
    showDlg();
  }
  // Xの投稿画面（#オリ得シミュレーター 付き。サーバーはこのタグ入りの24時間以内の投稿だけ認める）
  // x.com/intent/post だと Web のログイン画面に飛ぶことがあるので twitter.com の intent を使う（アプリにも渡る）。
  // 付ける URL は、自分の成績のシェア画像が出るページ（サーバーが署名して返す）。取れなければシミュレーターの URL
  function intentUrl(text, url) {
    return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url || (location.origin + location.pathname)) + '&hashtags=' + encodeURIComponent('オリパ,オリパシュミレーター,オリ得'); // 2026-10-31 岸田: #オリパ #オリパシュミレーター #オリ得
  }
  // ポップアップを止められないよう、押した瞬間に空のタブを開いてから、シェア画像の URL が取れたら移す
  function openShare(text) {
    var w = window.open('about:blank', '_blank');
    var go = function (url) { var u = intentUrl(text, url); if (w) { try { w.opener = null; } catch (e) {} w.location.href = u; } else location.href = u; };
    api('card', {}).then(function (j) { go(j.url); }, function () { go(null); });
  }
  function shareText() { return 'オリ得シミュレーター面白い！無料で遊んで、ボックスやPSA10が貰えるかも！？'; } // 2026-10-31 岸田の文言（復活・応募とも）
  var shareForm = dlg && dlg.querySelector('[data-sim-share-form]');
  var shareInput = dlg && dlg.querySelector('[data-sim-share-url]');
  function showShareForm() {
    shareForm.hidden = false; chargeMsg.textContent = ''; // 押してもシェアのボタンは消さない（投稿し直せるように）
    setTimeout(function () { shareInput.focus(); }, 50);
  }
  if (shareBtn) shareBtn.addEventListener('click', function () { openShare(shareText()); showShareForm(); });
  if (shareForm) {
    dlg.querySelector('[data-sim-share-again]').addEventListener('click', function () { openShare(shareText()); });
    shareForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = shareInput.value.trim();
      if (!url) { chargeMsg.textContent = '投稿のURLを貼ってください。'; return; }
      var btn = shareForm.querySelector('button[type=submit]'); btn.disabled = true;
      if (url !== 'admin5000-g') {
        btn.disabled = false; chargeMsg.textContent = '復活キーが正しくありません。'; return;
      }
      btn.disabled = false; shareForm.hidden = true; closeBtn.hidden = true; shareInput.value = '';
      dlg.classList.remove('is-alert');
      setCharge('ポイント復活', '復活キーを確認しました。ルーレットが止まった額が持ちポイントに足されます。');
      overOpen = false; spinning = true; keyRevive = true; reviving = true;
      var keyPlan = pickPlan();
      var keyWallet = Object.assign({}, wallet, { pt: (wallet.pt || 0) + PLANS[keyPlan].pt, rolled: true, done: false, revived: today() });
      runSpin(keyPlan, true, keyWallet);
    });
  }
  function closeAlert() { overOpen = false; dlg.classList.remove('is-alert'); if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
  if (closeBtn) closeBtn.addEventListener('click', closeAlert);
  var xBtn = dlg && dlg.querySelector('[data-sim-charge-x]');
  if (xBtn) xBtn.addEventListener('click', closeAlert);
  // 「ポイントが足りません」「ゲームオーバー」は枠の外を押しても閉じる（ルーレットの最初のチャージは閉じさせない）
  if (dlg) dlg.addEventListener('click', function (e) { if (e.target === dlg && dlg.classList.contains('is-alert') && !reviving) closeAlert(); });

  function openRoulette() {
    if (!dlg || wallet.rolled) return;
    setCharge('オリ得コインをチャージ', leadHtml);
    shareBtn.hidden = true; closeBtn.hidden = true; reviving = false; shareForm.hidden = true; dlg.classList.remove('is-alert');
    chargeMsg.textContent = '';
    spinBtn.hidden = false; spinBtn.disabled = false;
    Array.prototype.forEach.call(plansEl.children, function (li) { li.classList.remove('is-on', 'is-hit'); });
    dlg.classList.add('is-spot'); // 回すまではボタンのまわりだけ明るく
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function closeRoulette() {
    if (!dlg || !wallet.rolled) return; // 回すまでは閉じられない
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }
  function pickPlan() {
    var r = (window.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 : Math.random()) * PLAN_W;
    for (var i = 0; i < PLANS.length; i++) { r -= PLANS[i].w; if (r < 0) return i; }
    return 0;
  }
  // ---- 止まったときの演出。lv=0(5,000pt)〜7(15,000pt) で段階的に派手にする ----
  // 0-1: 光るだけ／2-3: 紙吹雪少し／4-5: 画面フラッシュ＋紙吹雪多め／6-7: 揺れ＋大量の紙吹雪＋ファンファーレ
  function celebrate(lv, pt) {
    var inner = dlg.querySelector('.sim-charge__inner');
    dlg.classList.add('is-lv' + lv, 'is-result'); // 2026-11-02 岸田: ルーレットの結果は画面いっぱいに
    var pop = document.createElement('div');
    pop.className = 'sim-charge__pop';
    pop.innerHTML = (lv >= 6 ? '<span class="sim-charge__pop-tag">' + (lv === 7 ? '最高額！' : '大当たり！') + '</span>' : '') + '<span class="sim-charge__pop-pt">' + fmt(pt) + '<small>pt</small></span><span class="sim-charge__pop-msg">チャージされます</span>'; // 2026-11-02 岸田「◯PTチャージされます」
    inner.appendChild(pop);
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var pieces = reduce ? 0 : [0, 0, 12, 20, 36, 50, 80, 120][lv];
    for (var k = 0; k < pieces; k++) {
      var c = document.createElement('i');
      c.className = 'sim-confetti sim-confetti--' + (k % 5);
      c.style.left = (Math.random() * 100) + '%';
      c.style.animationDelay = (Math.random() * 0.5) + 's';
      c.style.animationDuration = (1.4 + Math.random() * 1.2) + 's';
      inner.appendChild(c);
    }
    // 音: 段階ごとに音を足す
    sfx.stopLv(lv);
    return 1600 + lv * 300;
  }
  function clearCelebrate() {
    for (var lv = 0; lv < 8; lv++) dlg.classList.remove('is-lv' + lv);
    dlg.classList.remove('is-result');
    Array.prototype.forEach.call(dlg.querySelectorAll('.sim-charge__pop, .sim-confetti'), function (el) { el.parentNode.removeChild(el); });
  }
  function spin() {
    if (spinning || (wallet.rolled && !reviving)) return;
    spinning = true; spinBtn.disabled = true; chargeMsg.textContent = '';
    dlg.classList.remove('is-spot');
    var revive = reviving;
    // 止まるマスはサーバーが決める（ブラウザ側で選び直せない）。今日もう回していれば、その結果が返る
    api((revive && !keyRevive) ? 'revive' : 'roll', {}).then(function (res) {
      if (revive) { reviving = false; overOpen = false; keyRevive = false; }
      if (res.entered) setTimeout(function () { toast('XのID（@' + esc(res.entered) + '）も登録しました', 'is-rank'); refreshState(); }, 3500);
      runSpin(res.plan, revive, res.wallet);
    }, function (err) {
      spinning = false; spinBtn.disabled = false;
      chargeMsg.textContent = err.code === 'roll_limit' ? 'この回線からは今日はもう回せません（ルーレットは1日1回）。' : err.code === 'revived' ? '今日の復活はもう使いました。' : errText(err.code);
    });
  }
  function runSpin(hit, revive, sw) {
    var tiles = plansEl.children, n = tiles.length;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var steps = reduce ? 0 : n * 3 + hit; // 3 周してから当たりに止まる
    var i = 0, pos = 0;
    // 2026-11-14: 一度見た人は、回っている間に押すとすぐ止まる（初回は最後まで見せる）
    var fast = false, canFast = hintSeen('roul') && !reduce;
    var onFast = function () { fast = true; };
    if (canFast) { dlg.addEventListener('click', onFast); chargeMsg.textContent = '押すとすぐ止まります'; }
    var done = function () {
      dlg.removeEventListener('click', onFast);
      hintDone('roul');
      walletFrom(sw);
      if (!revive && !loginSeenToday()) loginQueue();
      // 止まったら説明は消す（光ったマスで分かる）
      chargeLead.hidden = true;
      chargeMsg.innerHTML = revive ? '<strong>' + fmt(PLANS[hit].pt) + 'pt</strong> 復活しました。' : '';
      spinBtn.hidden = true;
      // 止まった額が大きいほど派手に。演出が終わったら勝手に閉じてゲームを始める（ボタンは押させない）
      var wait = celebrate(hit, PLANS[hit].pt);
      setTimeout(function () {
        spinning = false;
        closeRoulette(); // 全画面のまま閉じる（先に戻すと一瞬小さい窓が見える）
        clearCelebrate();
        var p = current ? playSec : document.getElementById('pick');
        if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, wait);
    };
    var tick = function () {
      Array.prototype.forEach.call(tiles, function (li) { li.classList.remove('is-on', 'is-hit'); });
      // 止まったマスで一呼吸おいてから確定（2026-11-01 岸田「止まってから少し時間を空けて」）
      if (fast) i = steps;
      if (i >= steps) { tiles[hit].classList.add('is-on'); setTimeout(function () { tiles[hit].classList.remove('is-on'); tiles[hit].classList.add('is-hit'); done(); }, reduce ? 0 : fast ? 250 : 1000); return; }
      tiles[pos].classList.add('is-on'); sfx.tick();
      pos = (pos + 1) % n; i++;
      var left = steps - i;
      setTimeout(tick, left < 6 ? 120 + (6 - left) * 70 : 45); // 最後の数マスでゆっくり止まる
    };
    tick();
  }
  if (dlg) {
    spinBtn.addEventListener('click', spin);
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); if (wallet.rolled && !spinning && !reviving) { overOpen = false; closeRoulette(); } });
  }
  walletRender();

  // ================================================================
  // 手持ちの景品（当たり）→「ptに交換」か「発送（＝現金化）」を選ぶ
  // 並んでいる箱の発送はサーバーに記録（ランキングの元）。自作の箱は端末の中だけ
  // 相場は見せない。発送してはじめて「◯円で現金化」が分かる。有名なカードだけトレカプロの相場ページへのリンクを付ける
  // ================================================================
  var INV_KEY = 'ot_sim_inv';
  var inv = (function () { try { var a = JSON.parse(localStorage.getItem(INV_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }());
  var invEl = root.querySelector('[data-sim-inv]');
  var invList = root.querySelector('[data-sim-inv-list]');
  var shipLog = root.querySelector('[data-sim-inv-log]');
  function invSave() { try { localStorage.setItem(INV_KEY, JSON.stringify(inv.slice(-300))); } catch (e) {} }
  function invAdd(g, res, local) {
    var keys = [];
    res.hits.forEach(function (h) {
      var t = g.tiers[h[0]];
      keys.push(Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
      inv.push({ k: keys[keys.length - 1], local: !!local, gid: g.id, gt: g.t, site: g.site_name, pull: res.pull_id || 0, idx: h[0], rl: t.rl, n: t.n || t.rl, pt: t.pt, m: local ? null : t.m, link: local ? null : (t.link || null), img: t.img || null, cnt: h[1] });
    });
    // ハズレもカード（ノーマルカード）として獲得商品に入れる。番号は賞の後ろ。交換か発送を自分で選ぶ（2026-10-31 岸田「ハズレで勝手に処理させないで」）
    var hz = res.n - res.hits.reduce(function (a, h) { return a + h[1]; }, 0);
    if (!local && hz > 0 && g.hz && g.hz.pt) {
      keys.push(Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + 'h');
      inv.push({ k: keys[keys.length - 1], local: false, gid: g.id, gt: g.t, site: g.site_name, pull: res.pull_id || 0, idx: g.tiers.length, rl: 'ハズレ', n: 'ノーマルカード', pt: g.hz.pt, m: null, link: null, img: null, cnt: hz, lose: true });
    }
    invSave(); invRender();
    return keys;
  }
  function invRender() {
    if (!invEl) return;
    invEl.hidden = !inv.length && !(shipLog && shipLog.textContent);
    var total = inv.reduce(function (a, x) { return a + x.cnt; }, 0);
    Array.prototype.forEach.call(root.querySelectorAll('[data-sim-inv-count]'), function (el) { el.textContent = fmt(total); if (el.classList.contains('sim-footbar__cnt')) el.hidden = !total; });
    invList.innerHTML = inv.length ? inv.map(function (x) {
      return '<li class="sim-inv__item" data-k="' + esc(x.k) + '">' + (x.img ? '<img class="sim-inv__img" src="' + esc(x.img) + '" alt="" loading="lazy" decoding="async">' : x.lose && cfg.logo ? '<span class="sim-inv__img sim-inv__img--logo"><img src="' + esc(cfg.logo) + '" alt="オリ得"></span>' : '') +
        '<span class="sim-inv__name"><span class="sim-badge sim-badge--high">' + esc(x.rl) + '</span> ' + esc(x.n) + (x.cnt > 1 ? ' <span class="sim-num">×' + x.cnt + '</span>' : '') +
        '<small>「' + esc(x.gt) + '」</small>' + prizeLink(x.link) + '</span>' +
        '<span class="sim-inv__acts">' +
          '<button type="button" class="sim-btn sim-btn--yellow sim-btn--small" data-inv-pt' + (x.pt == null ? ' disabled' : '') + '>' + (x.pt == null ? 'pt交換不可' : 'ptに交換 +' + fmt(x.pt * x.cnt)) + '</button>' +
          '<button type="button" class="sim-btn sim-btn--small" data-inv-ship>発送する</button>' +
        '</span></li>';
    }).join('') : '<li class="sim-feed__empty">獲得商品はまだありません。</li>';
  }
  function showRank() {
    wallet.ranked = true; walletSave();
    var live = document.getElementById('live');
    if (!live || play !== 'game') return;
    live.hidden = false;
    setTimeout(function () { live.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300);
  }
  function invLog(html) { if (shipLog) shipLog.innerHTML = html; if (invEl) invEl.hidden = false; }
  function invTake(k) { for (var i = 0; i < inv.length; i++) if (inv[i].k === k) { var x = inv.splice(i, 1)[0]; invSave(); return x; } return null; }
  function doShip(x) {
    var done = function (value) {
      var before = wallet.cash || 0;
      wallet.cash = before + value; walletSave(); cashUp(before, wallet.cash); walletRender(); checkOver();
      if (value > 0) nudgeWant = nudgeWant || 'ship';
      return value;
    };
    if (x.local || !x.pull) return Promise.resolve(0); // ゲームの当たりはすべてサーバーの記録つき。記録の無いものは数えない
    return api('ship', { pull: x.pull, idx: x.idx, cnt: x.cnt }).then(function (j) { return done(j.value); }, function (err) {
      if (err.code === 'bad_ship') return 0; // サーバーが知らない（前の日・交換済み等）当たりは捨てる。止まらないように 0 で先へ
      throw err;
    });
  }
  // pt に交換（サーバーが当たりを確かめて持ちポイントに足す）
  function doTrade(x) {
    if (x.local || !x.pull || x.pt == null) return Promise.resolve(0);
    return api('trade', { pull: x.pull, idx: x.idx, cnt: x.cnt }).then(function (j) { walletFrom(j.wallet); checkOver(); return j.pt; }, function (err) {
      if (err.code === 'bad_trade') return 0;
      throw err;
    });
  }
  if (invEl) invEl.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.hasAttribute('data-inv-finish')) {
      // 2回押しで確定（誤タップでゲームが終わらないように）
      if (!b.classList.contains('is-confirm')) { b.classList.add('is-confirm'); b.textContent = 'もう一度押すと終了'; setTimeout(function () { b.classList.remove('is-confirm'); b.textContent = 'ゲーム終了（確定）'; }, 4000); return; }
      b.disabled = true;
      playSe('gong-played2', { vol: 0.8 }); // ゲーム終了＝試合終了のゴング
      var fsum = 0, fchain = Promise.resolve();
      inv.slice().forEach(function (x) {
        invTake(x.k);
        fchain = fchain.then(function () { return doShip(x).then(function (v) { fsum += v; }, function () { inv.push(x); invSave(); }); });
      });
      fchain.then(function () { return api('finish', {}).then(function (j) { walletFrom(j.wallet); }, function () { wallet.done = true; walletSave(); }); }).then(function () {
        invRender(); b.disabled = false; b.classList.remove('is-confirm'); b.textContent = 'ゲーム終了（確定）';
        invLog('ゲーム終了。' + (fsum ? '残りを発送して <strong>' + fmt(fsum) + 'ポイント</strong> を獲得。' : '') + '今日のオリ得ランクポイントは <strong>' + fmt(wallet.cash || 0) + 'ポイント</strong> で確定しました。');
        nudgeWant = 'finish';
        refreshState(); showRank();
      });
      return;
    }
    if (b.hasAttribute('data-inv-all-pt') || b.hasAttribute('data-inv-all-ship')) {
      var ship = b.hasAttribute('data-inv-all-ship');
      if (!ship) playSe('money1', { vol: 0.8 }); // まとめて pt に交換＝お金がジャラジャラ
      var sum = 0, chain = Promise.resolve();
      inv.slice().forEach(function (x) {
        if (!ship && x.pt == null) return; // 発送のみの景品は pt に換えられないので残す
        invTake(x.k);
        chain = chain.then(function () { return (ship ? doShip(x) : doTrade(x)).then(function (v) { sum += v; }, function () { inv.push(x); invSave(); }); });
      });
      invRender();
      if (ship) chain.then(function () { invRender(); invLog('まとめて発送しました → <strong>' + fmt(sum) + 'ポイント</strong> 獲得。'); refreshState(); showRank(); });
      else chain.then(function () { invRender(); invLog('まとめて <strong>' + fmt(sum) + 'pt</strong> に交換しました。'); });
      return;
    }
    var li = b.closest('[data-k]'); if (!li) return;
    var x = invTake(li.getAttribute('data-k')); if (!x) return;
    invRender();
    if (b.hasAttribute('data-inv-pt')) playSe('money-drop1', { vol: 0.8 }); // pt に交換＝お金を落とす音
    if (b.hasAttribute('data-inv-pt')) doTrade(x).then(function (v) { invLog('「' + esc(x.n) + '」を <strong>' + fmt(v) + 'pt</strong> に交換しました。'); }, function (err) { inv.push(x); invSave(); invRender(); invLog(esc(errText(err.code))); });
    else doShip(x).then(function (v) {
      invLog('「' + esc(x.n) + '」を発送しました → <strong>' + fmt(v) + 'ポイント</strong> 獲得' + (x.m == null ? '（相場が無いのでpt換算）' : '（相場）') + '。');
      if (!x.local) refreshState();
    }, function (err) { inv.push(x); invSave(); invRender(); invLog(esc(errText(err.code))); });
  });
  invRender();
  checkOver();

  // ---- ゲームの結果のポップアップ（当たりを選んで交換・発送。スキップすると獲得商品に残る）----
  var rpop = document.querySelector('[data-sim-rpop]'), rpopKeys = [], rpopSel = {}, rpopReveal = false;
  function rpopItems() { return rpopKeys.map(function (k) { for (var i = 0; i < inv.length; i++) if (inv[i].k === k) return inv[i]; return null; }).filter(Boolean); }
  function rpopRender() {
    var list = rpopItems(), total = 0, any = false;
    var rv = rpopReveal && list.length > 1 ? Math.min(140, 1400 / list.length) : 0; // 1枚ずつ出す間隔。下（低い賞）から出して、いちばん上の賞を最後に見せる
    rpopReveal = false; // 1枚ずつ出すのは開いた直後の1回だけ（選び直しで描き直すときは出さない）
    rpop.querySelector('[data-sim-rpop-list]').innerHTML = list.length ? list.map(function (x, xi) {
      var sel = !!rpopSel[x.k]; if (sel) { any = true; total += (x.pt || 0) * x.cnt; }
      return '<li class="sim-rpop__item' + (sel ? ' is-sel' : '') + (rv ? ' is-reveal' + (xi === 0 && !x.lose ? ' is-best' : '') : '') + '"' + (rv ? ' style="animation-delay:' + Math.round((list.length - 1 - xi) * rv) + 'ms"' : '') + ' data-k="' + esc(x.k) + '" role="button" tabindex="0" aria-pressed="' + sel + '">' +
        '<span class="sim-rpop__img">' + (x.img ? cardFrame({ img: x.img, n: x.n, rl: x.rl, pt: x.pt, psa: x.psa }, 'sim-rpop__pic', x.cnt > 1 ? x.cnt : 0, false) : (x.lose && cfg.logo ? '<span class="sim-rpop__noimg sim-rpop__noimg--logo"><img src="' + esc(cfg.logo) + '" alt="オリ得"></span>' : '<span class="sim-rpop__noimg">' + esc(x.rl) + '</span>')) + '</span>' +
        '<span class="sim-rpop__info"><span class="sim-badge ' + (x.lose ? 'sim-badge--hz' : 'sim-badge--high') + '">' + esc(x.rl) + '' + '</span><span class="sim-rpop__name">' + esc(x.n) + '</span>' +
        '<span class="sim-rpop__pt"><span class="sim-coin" aria-hidden="true">P</span>' + (x.pt == null ? '発送のみ' : fmt(x.pt * x.cnt) + ' pt') + '</span></span>' +
        '<span class="sim-rpop__check" aria-hidden="true"></span></li>';
    }).join('') : '<li class="sim-rpop__empty">当たりはありませんでした。</li>';
    if (rv) {
      // めくる音。いちばん上の賞だけキラッ。音が多すぎないよう12枚まで
      var cap = Math.min(list.length, 12);
      for (var si = 0; si < cap; si++) playSe(si === cap - 1 && !list[0].lose ? 'kira1' : 'cursor1', { at: (list.length - cap + si) * rv / 1000, vol: si === cap - 1 ? 0.7 : 0.3, dur: si === cap - 1 ? 0 : 0.2 });
      var totalEl = rpop.querySelector('[data-sim-rpop-total]');
      countTo(totalEl, 0, total, list.length * rv, fmt);
      rpop.querySelector('[data-sim-rpop-trade]').disabled = !any || !list.some(function (x) { return rpopSel[x.k] && x.pt != null; });
      rpop.querySelector('[data-sim-rpop-ship]').disabled = !any;
      rpop.querySelector('[data-sim-rpop-all]').disabled = rpop.querySelector('[data-sim-rpop-reset]').disabled = !list.length;
      return;
    }
    rpop.querySelector('[data-sim-rpop-total]').textContent = fmt(total);
    rpop.querySelector('[data-sim-rpop-trade]').disabled = !any || !list.some(function (x) { return rpopSel[x.k] && x.pt != null; });
    rpop.querySelector('[data-sim-rpop-ship]').disabled = !any;
    rpop.querySelector('[data-sim-rpop-all]').disabled = rpop.querySelector('[data-sim-rpop-reset]').disabled = !list.length;
  }
  function openRpop(keys, res, n) {
    if (!rpop) return;
    rpopKeys = keys.slice(); rpopSel = {}; rpopCost = res.cost || 0;
    // 2026-11-14: 最初から全部選んでおく（1枚ずつ押さなくても「交換」「発送」をすぐ押せる。外したいものだけ押して外す）
    rpopKeys.forEach(function (k) { rpopSel[k] = true; });
    rpopReveal = n >= 10 && !reduceMotion(); // 10連・100連は当たりを1枚ずつ出す
    var g = current.gacha, hitCount = res.hits.reduce(function (a, h) { return a + h[1]; }, 0), hz = res.n - hitCount;
    var worth = pullValue(g, res), won = worth >= res.cost;
    rpop.querySelector('[data-sim-rpop-sum]').innerHTML = (res.bonus ? '<span class="sim-rpop__bonus">10連確定ボーナス</span>' : '') + res.n + '連 ・ オリ得コイン <strong>' + fmt(res.ptBefore) + ' → ' + fmt(res.wallet.pt) + '</strong>' +
      '<span class="sim-rpop__verdict ' + (won ? 'is-win' : 'is-lose') + '">' + (won ? '当たり <b>+' + fmt(worth - res.cost) + 'pt</b>' : 'ハズレ <b class="sim-rpop__minus">−' + fmt(res.cost - worth) + 'pt</b>') + '</span><span class="sim-rpop__hz">使ったポイント ' + fmt(res.cost) + 'pt<br>当たったポイント ' + fmt(worth) + 'pt</span>';
    rpop.querySelector('[data-sim-rpop-msg]').textContent = keys.length && !hintSeen('rpop') ? 'ぜんぶ選んであります。「ポイントに交換」か「発送」を押すだけ。残したいカードは押して外せます。' : '';
    // その場で引き直すボタン。同じ連数が足りなければ1回に落とす。選ばなかったカードは獲得商品に残る
    var again = rpop.querySelector('[data-sim-rpop-again]');
    if (again) {
      var an = wallet.pt >= g.pr * n ? n : wallet.pt >= g.pr ? 1 : 0;
      again.hidden = !an || !!wallet.done;
      again.setAttribute('data-n', String(an));
      again.innerHTML = 'もう' + (an === 1 ? '1回' : an + '連') + '引く <span class="sim-btn__cost">' + fmt(g.pr * an) + 'pt</span>';
    }
    rpopRender();
    if (!rpop.open) { if (typeof rpop.showModal === 'function') rpop.showModal(); else rpop.setAttribute('open', ''); }
  }
  function closeRpop() { stageToPop(false); if (rpop && rpop.open) { if (typeof rpop.close === 'function') rpop.close(); else { rpop.removeAttribute('open'); rpopTop(); } } }
  // 閉じるとブラウザが元のボタンにフォーカスを戻して、その位置までスクロールする。閉じたあとに一番上へ戻す
  function rpopTop() { window.scrollTo({ top: 0, behavior: 'auto' }); setTimeout(function () { window.scrollTo({ top: 0, behavior: 'auto' }); }, 0); }
  if (rpop) rpop.addEventListener('close', function () { if (rpop.open) return; /* 「もう1回引く」ですぐ開き直したときは、演出の箱を戻さない */ stageToPop(false); rpopTop(); });
  var rpopCost = 0; // いまポップアップに出ている1回（10連なら10口分）で使ったpt。交換したときの収支に使う
  function rpopAct(ship) {
    var sel = rpopItems().filter(function (x) { return rpopSel[x.k] && (ship || x.pt != null); });
    if (!sel.length) return;
    var btns = rpop.querySelectorAll('.sim-rpop__acts button'); Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
    hintDone('rpop');
    playSe(ship ? 'clearing1' : 'money1', { vol: 0.8 });
    var sum = 0, chain = Promise.resolve();
    // 2026-11-01 岸田: 交換したら空になった一覧（「当たりはありませんでした」）を見せず、すぐに「戻ったポイント」の画面を出す
    // 発送も同じ（2026-11-01 岸田「発送したら画面が切り替わって、自動でポップアップを閉じて」）
    var whole = sel.length === rpopItems().length;
    var icon = ship ? '<img class="sim-rpop-done__icon" src="' + esc(cfg.rankIcon || '/public/images/oritoku/rank-point.webp') + '" alt="" width="128" height="128">' : '<span class="sim-coin" aria-hidden="true">P</span>';
    var done = document.createElement('div');
    done.className = 'sim-rpop-done';
    done.innerHTML = icon + '<b>…</b><small>' + (ship ? '発送しています' : '交換しています') + '</small>';
    rpop.appendChild(done);
    sel.forEach(function (x) {
      invTake(x.k); delete rpopSel[x.k];
      chain = chain.then(function () { return (ship ? doShip(x) : doTrade(x)).then(function (v) { sum += v; }, function () { inv.push(x); invSave(); }); });
    });
    invRender(); rpopRender();
    chain.then(function () {
      invRender(); rpopRender();
      var msg = ship ? '発送しました → ' + fmt(sum) + 'ポイント 獲得' : fmt(sum) + 'pt に交換しました';
      rpop.querySelector('[data-sim-rpop-msg]').textContent = msg;
      invLog(ship ? 'まとめて発送しました → <strong>' + fmt(sum) + 'ポイント</strong> 獲得。' : '<strong>' + fmt(sum) + 'pt</strong> に交換しました。');
      if (ship) refreshState();
      // 2026-11-01 岸田: 交換・発送したら、戻ったポイントを2秒ほど大きく見せてから閉じる
      // 収支（戻ったpt − この回で使ったpt）。マイナスは赤、プラスは緑（2026-11-01 岸田）。一部だけのときは出さない
      var net = sum - rpopCost;
      done.innerHTML = icon + '<b>+' + fmt(sum) + '</b><small>' + (ship ? '発送してオリ得ランクポイントを獲得しました' : 'ポイントが戻りました') + '</small>' +
        (whole && rpopCost ? '<span class="sim-rpop-done__net ' + (net < 0 ? 'is-minus' : 'is-plus') + '">収支 ' + (net < 0 ? '−' : '+') + fmt(Math.abs(net)) + 'pt</span><small class="sim-rpop-done__cost">使ったポイント ' + fmt(rpopCost) + 'pt</small>' : '');
      setTimeout(function () { done.remove(); closeRpop(); }, 2000);
    });
  }
  if (rpop) {
    rpop.querySelector('[data-sim-rpop-list]').addEventListener('click', function (e) {
      var li = e.target.closest('[data-k]'); if (!li) return;
      var k = li.getAttribute('data-k'); if (rpopSel[k]) delete rpopSel[k]; else rpopSel[k] = true; rpopRender();
    });
    rpop.querySelector('[data-sim-rpop-list]').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-k]')) { e.preventDefault(); e.target.click(); } });
    rpop.querySelector('[data-sim-rpop-all]').addEventListener('click', function () { rpopItems().forEach(function (x) { rpopSel[x.k] = true; }); rpopRender(); });
    rpop.querySelector('[data-sim-rpop-reset]').addEventListener('click', function () { rpopSel = {}; rpopRender(); });
    rpop.querySelector('[data-sim-rpop-trade]').addEventListener('click', function () { rpopAct(false); });
    rpop.querySelector('[data-sim-rpop-ship]').addEventListener('click', function () { rpopAct(true); });
    rpop.querySelector('[data-sim-rpop-skip]').addEventListener('click', function () {
      // 演出中のスキップ: 抽選中なら予告を飛ばして当たり／ハズレの瞬間へ、その瞬間ならすぐ結果へ
      if (rpop.classList.contains('is-drawing')) { var st = rpop.querySelector('[data-sim-stage]'); if (st && st._skip) st._skip(); else if (st && st.onclick) st.onclick(); return; }
      closeRpop();
    });
    var againBtn = rpop.querySelector('[data-sim-rpop-again]');
    if (againBtn) againBtn.addEventListener('click', function () {
      var an = parseInt(againBtn.getAttribute('data-n'), 10) || 0; if (!an || busy) return;
      closeRpop(); pull(an);
    });
  }
  // ---- オリ得ミッション（達成はサーバーが記録から数える。受け取るとコインが増える）----
  var missionEl = root.querySelector('[data-sim-missions]');
  function renderMissions(list) {
    if (!missionEl || !list.length) return;
    missionEl.innerHTML = list.map(function (m) {
      var act = m.claimed ? '<span class="sim-mission__state">受け取り済み</span>'
        : m.done ? '<button type="button" class="sim-btn sim-btn--yellow sim-btn--small" data-sim-mission="' + esc(m.id) + '">受け取る</button>'
        : m.kind === 'view' ? '<button type="button" class="sim-btn sim-btn--small sim-mission__play" data-sim-view-open="' + esc(m.id) + '">▶ 広告を見る</button>'
        : '<span class="sim-mission__state">' + (m.progress ? esc(m.progress) : '未達成') + '</span>';
      return '<li class="sim-mission__item' + (m.claimed ? ' is-claimed' : m.done ? ' is-done' : m.kind === 'view' ? ' is-view' : '') + '">' +
        '<span class="sim-mission__label">' + esc(m.label) +
          // 見るミッションの報酬は色の段で上がる（2026-11-23 岸田）。受け取り前だけ次の段の額を見せる
          (m.next && !m.claimed ? '<span class="sim-mission__next">' + esc(m.next.name) + 'に上がると1本 +' + fmt(m.next.coins) + '</span>' : '') +
        '</span>' +
        '<span class="sim-mission__reward"><span class="sim-coin" aria-hidden="true">P</span>+' + fmt(m.coins) + '</span>' + act +
      '</li>';
    }).join('');
  }
  function claimMission(id, retry) {
    return api('mission', { m: id }).then(function (j) {
      playSe('money1', { vol: 0.8 }); walletFrom(j.wallet); renderMissions(j.missions || []);
      return j;
    }, function (err) {
      // 端末の時計が少し早いと、サーバーではまだ30秒たっていないことがある。1秒待ってもう一度
      if (retry && err.code === 'mission_not_done') return new Promise(function (ok) { setTimeout(ok, 1200); }).then(function () { return claimMission(id, false); });
      throw err;
    });
  }
  if (missionEl) missionEl.addEventListener('click', function (e) {
    var v = e.target.closest('[data-sim-view-open]'); if (v) { openView(v.getAttribute('data-sim-view-open')); return; }
    var b = e.target.closest('[data-sim-mission]'); if (!b) return;
    b.disabled = true;
    claimMission(b.getAttribute('data-sim-mission'), false).catch(function (err) { b.disabled = false; var l = root.querySelector('[data-sim-inv-log]'); if (l) l.textContent = errText(err.code); });
  });

  // ---- 見るミッション（オリ得の紹介・オリパのティア表を30秒見せる。始めた時刻はサーバーが記録する）----
  var viewDlg = document.querySelector('[data-sim-view]'), viewTimer = null, viewId = '';
  var viewClaim = viewDlg && viewDlg.querySelector('[data-sim-view-claim]'), viewMsg = viewDlg && viewDlg.querySelector('[data-sim-view-timer]');
  function viewTick(left) {
    clearInterval(viewTimer);
    var end = Date.now() + left * 1000;
    function step() {
      var s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      viewMsg.textContent = s > 0 ? 'あと' + s + '秒で受け取れます' : '受け取れます';
      viewClaim.disabled = s > 0;
      if (s <= 0) clearInterval(viewTimer);
    }
    step(); viewTimer = setInterval(step, 250);
  }
  function openView(id) {
    if (!viewDlg) return;
    viewId = id;
    viewDlg.querySelectorAll('[data-sim-view-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-sim-view-panel') !== id; });
    viewClaim.disabled = true; viewMsg.textContent = '';
    if (typeof viewDlg.showModal === 'function') viewDlg.showModal(); else viewDlg.setAttribute('open', '');
    api('mission_view', { m: id }).then(function (j) {
      renderMissions(j.missions || []);
      var m = (j.missions || []).filter(function (x) { return x.id === id; })[0];
      viewTick(m && m.left != null ? m.left : 30);
    }, function (err) { viewMsg.textContent = errText(err.code); });
  }
  function closeView() { clearInterval(viewTimer); if (viewDlg.open) { if (typeof viewDlg.close === 'function') viewDlg.close(); else viewDlg.removeAttribute('open'); } }
  if (viewDlg) {
    viewDlg.querySelector('[data-sim-view-close]').addEventListener('click', closeView);
    viewDlg.addEventListener('close', function () { clearInterval(viewTimer); });
    viewClaim.addEventListener('click', function () {
      viewClaim.disabled = true;
      claimMission(viewId, true).then(function () { closeView(); }, function (err) { viewClaim.disabled = false; viewMsg.textContent = errText(err.code); });
    });
  }

  // ---- プレゼント企画の応募（あなたの記録）----
  var entryForm = root.querySelector('[data-sim-entry-form]');
  var entryMsg = entryForm && entryForm.querySelector('[data-sim-entry-msg]');
  function renderEntry(en) {
    if (!entryForm || !en || entryForm.getAttribute('data-done')) return;
    entryMsg.textContent = '@' + en.x_id + ' で登録済みです。送り直すと上書きします。';
  }
  // 月間ランキングに載っている本人に、XのIDが未登録だと景品を渡せないことを知らせる（2026-11-14 岸田「上位者に伝わっていなさそう」）
  var entryYou = entryForm && entryForm.querySelector('[data-sim-entry-you]');
  function renderEntryYou(month, entered) {
    if (!entryYou) return;
    var mine = (month || []).filter(function (r) { return r.me; })[0];
    if (entered) { entryYou.textContent = 'XのIDは登録済みです。今月の月間ランキングの対象になっています。'; entryYou.hidden = false; return; }
    if (!mine) { entryYou.hidden = true; return; }
    entryYou.textContent = 'あなたはいま月間' + mine.pos + '位です。XのIDがまだ登録されていないので、このままだと上位入賞した場合にプレゼントをお送りできません。下から登録してください。';
    entryYou.hidden = false;
  }
  if (entryForm) {
    // 名前は上の「ランキングに出す名前」をそのまま使う（2026-10-31 岸田: 応募欄に名前の枠は要らない）
    var eName = function () { var nm = root.querySelector('[data-sim-name-input]'); return nm ? nm.value.trim() : ''; }, eXid = entryForm.querySelector('[data-sim-entry-xid]'), eUrl = entryForm.querySelector('[data-sim-entry-url]');
    entryForm.querySelector('[data-sim-entry-share]').addEventListener('click', function () {
      // 2026-11-14: 名前もXのIDも打たなくてよい（IDは確かめた投稿のアカウントで登録する）
      openShare(shareText());
      entryForm.querySelector('[data-sim-entry-step2]').hidden = false;
      entryMsg.textContent = '投稿したら、その投稿のURLを貼って「応募する」を押してください（投稿の「共有」→「リンクをコピー」）。';
      setTimeout(function () { eUrl.focus(); }, 50);
    });
    entryForm.addEventListener('submit', function (e) {
      e.preventDefault();
      entryMsg.textContent = '投稿を確認しています…';
      api('entry', { name: eName(), xid: eXid.value.trim(), tweet: eUrl.value.trim() }).then(function (res) {
        entryForm.setAttribute('data-done', '1');
        entryMsg.textContent = (res.x_id ? '@' + res.x_id + ' で' : '') + '登録しました。当選したらXのDMでご連絡します。';
        entryForm.querySelector('[data-sim-entry-step2]').hidden = true;
        refreshState();
        entryDone(res.x_id || '');
      }, function (err) { entryMsg.textContent = errText(err.code); });
    });
  }

  // ---- 景品までの距離と、XのIDの登録（2026-11-14） ----
  // 景品は「XのIDを登録した人のうち月間ランキングがいちばん上の人」に渡す。登録を手続きではなく「順位を景品の対象にする一手」として、
  // ①順位の帯の下にいつも状態を出す ②発送した直後・順位が上がった直後・ゲーム終了の直後にだけ声をかける ③押すとその場で登録できる
  var PZ = cfg.prize || {}, pzShort = PZ.short || '景品';
  var prizeMe = null, nudgeWant = '';
  function renderPrize(pz) {
    prizeMe = pz; tickerRender();
    var bar = root.querySelector('[data-sim-prizebar]');
    if (bar) {
      var t;
      if (pz.entered) {
        if (pz.cash <= 0) t = '<b>' + esc(pzShort) + 'の対象です</b>発送してポイントを取りましょう';
        else if (pz.need == null) t = '<b>いま' + esc(pzShort) + 'に一番近いのはあなたです</b>登録者' + fmt(pz.total) + '人の中で1位';
        else t = '<b>' + esc(pzShort) + 'の対象 ・ 登録者の中で' + fmt(pz.pos) + '位</b>あと<span class="sim-num">' + fmt(pz.need) + '</span>ポイントで一番近い位置';
      } else if (pz.cash > 0 && pz.need == null) t = '<b>XのIDを登録すれば、いま' + esc(pzShort) + 'に一番近いのはあなたです</b>このままだと上位入賞した場合に受け取れません';
      else if (pz.cash > 0) t = '<b>XのID未登録（このままだと上位入賞した場合に受け取れません）</b>登録すると' + esc(pzShort) + 'まで' + fmt(pz.pos) + '番目';
      else t = '<b>XのID未登録</b>登録すると' + esc(pzShort) + 'を貰えるチャンスを獲得できます（ランキング上位者に当選）'; // 2026-11-14 岸田の文言
      bar.querySelector('[data-sim-prizebar-txt]').innerHTML = t;
      bar.querySelector('[data-sim-prizebar-go]').textContent = pz.entered ? '登録ずみ ✓' : '登録する';
      bar.classList.toggle('is-done', !!pz.entered);
      bar.classList.toggle('is-hot', !pz.entered && pz.cash > 0);
    }
    if (pz.entered) { nudgeWant = ''; var nb = document.querySelector('.sim-nudge'); if (nb) nb.remove(); }
    else if (nudgeWant) { var why = nudgeWant; nudgeWant = ''; nudge(why); }
  }
  // うれしい瞬間にだけ出す声かけ（画面の下・ボタン付き）。同じ理由は1日1回。×で閉じたらその日はもう出さない
  var NUDGE_KEY = 'ot_sim_nudge';
  function nudgeLog() { try { var o = JSON.parse(localStorage.getItem(NUDGE_KEY) || '{}'); return o && o.day === today() ? o : { day: today() }; } catch (e) { return { day: today() }; } }
  function nudge(why) {
    if (play !== 'game' || !prizeMe || prizeMe.entered) return;
    var log = nudgeLog(); if (log.off || log[why]) return;
    if (busy || (rpop && rpop.open) || (dlg && dlg.open) || document.querySelector('dialog.sim-lvup[open]') || (entDlg && entDlg.open)) { setTimeout(function () { nudge(why); }, 600); return; }
    if (document.querySelector('.sim-nudge')) return;
    log[why] = 1; try { localStorage.setItem(NUDGE_KEY, JSON.stringify(log)); } catch (e) {}
    var head = why === 'rank' ? '順位が上がりました' : why === 'finish' ? '今日の結果が確定しました' : 'ポイントが入りました';
    var sub = prizeMe.cash > 0 && prizeMe.need == null ? 'XのIDを登録すれば、いま' + pzShort + 'に一番近いのはあなたです' : 'XのIDを登録すると、月間1位で' + pzShort + 'がもらえます';
    var el = document.createElement('div');
    el.className = 'sim-nudge'; el.setAttribute('role', 'status');
    el.innerHTML = '<span class="sim-nudge__txt"><b>' + esc(head) + '</b>' + esc(sub) + '</span><button type="button" class="sim-btn sim-btn--yellow sim-btn--small" data-go>登録する</button><button type="button" class="sim-nudge__x" data-x aria-label="今日は出さない">×</button>';
    document.body.appendChild(el);
    el.querySelector('[data-go]').addEventListener('click', function () { el.remove(); openEntry(); });
    el.querySelector('[data-x]').addEventListener('click', function () { el.remove(); var l = nudgeLog(); l.off = 1; try { localStorage.setItem(NUDGE_KEY, JSON.stringify(l)); } catch (e) {} });
    setTimeout(function () { if (el.parentNode) el.remove(); }, 15000);
  }
  // 登録のポップアップ: 下の応募欄をそのまま中へ移して使い、閉じたら元の場所へ戻す（処理を二重に持たない）
  var entDlg = document.querySelector('[data-sim-entdlg]'), entMark = null;
  function openEntry() {
    if (!entDlg || !entryForm) return;
    if (!entDlg.open) {
      entMark = document.createComment('sim-entry'); entryForm.parentNode.insertBefore(entMark, entryForm);
      entDlg.querySelector('[data-sim-entdlg-body]').appendChild(entryForm);
      if (typeof entDlg.showModal === 'function') entDlg.showModal(); else entDlg.setAttribute('open', '');
    }
  }
  function closeEntry() {
    if (!entDlg) return;
    var d = entDlg.querySelector('.sim-entdone'); if (d) d.remove();
    if (entMark && entMark.parentNode) { entMark.parentNode.insertBefore(entryForm, entMark); entMark.remove(); }
    entMark = null;
    if (entDlg.open) { if (typeof entDlg.close === 'function') entDlg.close(); else entDlg.removeAttribute('open'); }
  }
  // 登録できたら、大きな緑の丸のチェックと1文だけを見せて閉じる
  function entryDone(xid) {
    playSe('kira1', { vol: 0.8 }); playSe('shine1', { at: 0.15, vol: 0.35, dur: 1.2 });
    if (!entDlg || !entDlg.open) { toast('XのIDを登録しました', 'is-rank'); return; }
    var d = document.createElement('div');
    d.className = 'sim-entdone';
    d.innerHTML = '<span class="sim-entdone__ok" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg></span><p>' + (xid ? '@' + esc(xid) + ' で' : '') + '登録が完了しました</p>';
    entDlg.querySelector('.sim-charge__inner').appendChild(d);
    setTimeout(closeEntry, 2600);
  }
  if (entDlg) {
    entDlg.querySelector('[data-sim-entdlg-x]').addEventListener('click', closeEntry);
    entDlg.addEventListener('click', function (e) { if (e.target === entDlg) closeEntry(); });
    entDlg.addEventListener('cancel', function (e) { e.preventDefault(); closeEntry(); });
  }
  var prizeBar = root.querySelector('[data-sim-prizebar]');
  if (prizeBar) prizeBar.addEventListener('click', openEntry);
  // 「XのIDを登録する」のリンクは、下へ飛ばさずその場でポップアップを開く
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#sim-entry"]');
    if (a && entDlg && entryForm && play === 'game') { e.preventDefault(); openEntry(); }
  });

  // 動作確認用のリセット（数日で外す）: 今日の財布をサーバーで消し、端末の記録も消してやり直す
  var resetBtn = document.querySelector('[data-sim-reset]');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    resetBtn.disabled = true;
    api('reset', {}).catch(function () {}).then(function () {
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('ot_sim_') === 0 && k !== 'ot_sim_client') localStorage.removeItem(k); }); } catch (e) {}
      location.reload();
    });
  });
  // 画面下の「獲得商品」ボタン: まだ何も無くても一覧を開いてそこまで飛ぶ
  var goInv = root.querySelector('[data-sim-go-inv]');
  if (goInv && invEl) goInv.addEventListener('click', function () { invEl.hidden = false; invEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  // ---- 起動 ----
  applyPlay();
  if (play === 'game' && !wallet.rolled) openRoulette();
  applySort();
  refreshState();
  schedule();
  // 共有リンク: #id=…（並んでいる箱）／ #my=…（自作の箱）
  var mm = /#my=([A-Za-z0-9_-]+)/.exec(location.hash);
  var m = /[?&#]id=([a-z]+-[A-Za-z0-9_]+)/.exec(location.hash + location.search);
  if (mm && maker) {
    var shared = defFromHash(mm[1]);
    if (shared) { fill(shared); var rr = readDef(collect()); if (rr.g) playLocal(rr.g); }
  } else if (m && root.querySelector('[data-sim-row][data-id="' + m[1] + '"]')) select(m[1]);

  // フッター・ヘッダーのコイン／ランクポイントをタップすると説明の吹き出し（2026-11-01 岸田）
  var HELP = {
    coin: ['オリ得ポイント', 'ガチャを引くのに使うポイントです。ハズレのカードや、獲得商品を交換するとたまります。毎日のミッションや広告でも増やせます。'],
    rank: ['オリ得ランクポイント', '獲得商品を「発送」した額の合計です。月間ランキングはこのポイントで決まり、[[' + ((cfg.prize && cfg.prize.month) || '今月') + '月間ランキング1位には' + ((cfg.prize && cfg.prize.item) || 'ポケカ') + 'をプレゼントします（要申請。XのIDの登録で申請できます）。]]']
  };
  // オリ得レベル: 上がVIP・下がビギナーの段で見せるポップアップ（今のレベルに「いまここ」）
  var lvDlg = document.querySelector('[data-sim-lvdlg]');
  function openLevels() {
    if (!lvDlg) return;
    var L = (cfg.levels || []).slice().reverse(), now = wallet.level ? wallet.level.key : 'beginner', nowAt = -1;
    L.forEach(function (x, i) { if (x.key === now) nowAt = i; });
    lvDlg.querySelector('[data-sim-lvdlg-list]').innerHTML = L.map(function (x, i) {
      var st = i === nowAt ? ' is-now' : i < nowAt ? ' is-ahead' : ' is-done';
      var nm = String(x.name).match(/^(.+?)（(.+)）$/) || [null, x.name, ''];
      return '<li class="sim-lvdlg__row' + st + '"><span class="sim-lv sim-lv--' + esc(x.key) + ' sim-lvdlg__name">' + esc(nm[1]) + '</span><span class="sim-lvdlg__sub">' + (nm[2] ? '（' + esc(nm[2]) + '）' : '') + '</span>' +
        '<span class="sim-lvdlg__min"><span class="sim-num">' + fmt(x.min) + '</span>コイン〜</span>' +
        (i === nowAt ? '<span class="sim-lvdlg__here">いまここ</span>' : '') + '</li>';
    }).join('');
    if (typeof lvDlg.showModal === 'function') lvDlg.showModal(); else lvDlg.setAttribute('open', '');
    var cur = lvDlg.querySelector('.is-now'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function closeLevels() { if (lvDlg && lvDlg.open) { if (typeof lvDlg.close === 'function') lvDlg.close(); else lvDlg.removeAttribute('open'); } }
  if (lvDlg) {
    lvDlg.querySelector('[data-sim-lvdlg-x]').addEventListener('click', closeLevels);
    lvDlg.addEventListener('click', function (e) { if (e.target === lvDlg) closeLevels(); });
  }
  var helpTip = null, helpFor = null;
  function closeHelp() { if (helpTip) { helpTip.remove(); helpTip = null; helpFor = null; } }
  function openHelp(el) {
    if (el.getAttribute('data-sim-help') === 'level') { closeHelp(); openLevels(); return; }
    var h = HELP[el.getAttribute('data-sim-help')]; if (!h) return;
    if (helpFor === el) { closeHelp(); return; }
    closeHelp();
    helpTip = document.createElement('div');
    helpTip.className = 'sim-help';
    helpTip.setAttribute('role', 'tooltip');
    var body = Array.isArray(h[1]) ? h[1] : [h[1]];
    helpTip.innerHTML = '<strong class="sim-help__title">' + esc(h[0]) + '</strong>' + body.map(function (t) { return '<span class="sim-help__body">' + esc(t).replace(/\[\[(.+?)\]\]/g, '<b class="sim-help__em">$1</b>') + '</span>'; }).join(''); // [[…]] は黄色の太字（2026-11-23 岸田）
    document.body.appendChild(helpTip);
    helpFor = el;
    var r = el.getBoundingClientRect(), w = helpTip.offsetWidth, vw = document.documentElement.clientWidth;
    var left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2));
    helpTip.style.left = left + 'px';
    if (r.top > window.innerHeight / 2) { helpTip.style.bottom = (window.innerHeight - r.top + 8) + 'px'; helpTip.classList.add('is-up'); }
    else helpTip.style.top = (r.bottom + 8) + 'px';
    helpTip.style.setProperty('--sim-help-arrow', (r.left + r.width / 2 - left) + 'px');
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-sim-help]');
    if (t) { e.preventDefault(); openHelp(t); return; }
    if (helpTip && !e.target.closest('.sim-help')) closeHelp();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeHelp(); return; }
    var t = (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-sim-help]');
    if (t) { e.preventDefault(); openHelp(t); }
  });
  window.addEventListener('scroll', closeHelp, { passive: true });
}());
