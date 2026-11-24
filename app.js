document.addEventListener('DOMContentLoaded', function () {
    // Hamburger menu toggle（既存ヘッダー内＝モバイルのドロップダウン。元の挙動）
    var btn = document.querySelector('.header__menu-btn');
    var nav = document.querySelector('.header__nav');
    if (btn && nav) {
        btn.addEventListener('click', function () {
            var expanded = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', String(!expanded));
            nav.classList.toggle('is-open');
        });
    }

    // /media/: スクロールで浮いて出現するフローティングのロゴ＋メニューボタン
    if (document.body.classList.contains('media-scope')) {
        var onScroll = function () {
            document.body.classList.toggle('is-scrolled', window.scrollY > 120);
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });

        var fBtn = document.querySelector('.media-float__btn');
        var fMenu = document.querySelector('.media-float__menu');
        if (fBtn && fMenu) {
            var setFloat = function (open) {
                fBtn.setAttribute('aria-expanded', String(open));
                fMenu.classList.toggle('is-open', open);
                document.body.classList.toggle('nav-open', open);
            };
            fBtn.addEventListener('click', function () {
                setFloat(fBtn.getAttribute('aria-expanded') !== 'true');
            });
            fMenu.addEventListener('click', function (e) {
                if (e.target.closest('a')) setFloat(false);
            });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && fBtn.getAttribute('aria-expanded') === 'true') setFloat(false);
            });
        }
    }

    // Shop filter (card game tags)
    var filterWrap = document.getElementById('shop-filter');
    var shopGrid = document.getElementById('shop-grid');
    if (filterWrap && shopGrid) {
        var activeGames = [];

        filterWrap.addEventListener('click', function (e) {
            var tag = e.target.closest('.shop-filter__tag');
            if (!tag) return;

            var game = tag.getAttribute('data-game');
            tag.classList.toggle('is-active');

            if (tag.classList.contains('is-active')) {
                activeGames.push(game);
            } else {
                activeGames = activeGames.filter(function (g) { return g !== game; });
            }

            var cards = shopGrid.querySelectorAll('.shop-card');
            var visibleCount = 0;
            cards.forEach(function (card) {
                if (activeGames.length === 0) {
                    card.style.display = '';
                    visibleCount++;
                    return;
                }
                var cardGames = card.getAttribute('data-games').split(',');
                var match = activeGames.some(function (g) {
                    return cardGames.indexOf(g) !== -1;
                });
                card.style.display = match ? '' : 'none';
                if (match) visibleCount++;
            });

            var emptyMsg = document.getElementById('shop-filter-empty');
            if (emptyMsg) emptyMsg.hidden = visibleCount > 0;
        });
    }

    // Shop sort
    var sortWrap = document.getElementById('shop-sort');
    if (sortWrap && shopGrid) {
        sortWrap.addEventListener('click', function (e) {
            var btn = e.target.closest('.shop-sort__btn');
            if (!btn) return;

            sortWrap.querySelectorAll('.shop-sort__btn').forEach(function (b) {
                b.classList.remove('is-active');
            });
            btn.classList.add('is-active');

            var sortKey = btn.getAttribute('data-sort');
            var cards = Array.from(shopGrid.querySelectorAll('.shop-card'));

            cards.sort(function (a, b) {
                var aVal, bVal;
                if (sortKey === 'review-count') {
                    aVal = parseFloat(a.getAttribute('data-review-count')) || 0;
                    bVal = parseFloat(b.getAttribute('data-review-count')) || 0;
                } else if (sortKey === 'rating') {
                    aVal = parseFloat(a.getAttribute('data-overall')) || 0;
                    bVal = parseFloat(b.getAttribute('data-overall')) || 0;
                } else {
                    aVal = parseFloat(a.getAttribute('data-overall')) || 0;
                    bVal = parseFloat(b.getAttribute('data-overall')) || 0;
                }
                return bVal - aVal;
            });

            cards.forEach(function (card) {
                shopGrid.appendChild(card);
            });
        });
    }

    // Radar chart
    var radarCanvas = document.getElementById('radar-chart');
    if (radarCanvas) {
        var ctx = radarCanvas.getContext('2d');
        var w = radarCanvas.width;
        var h = radarCanvas.height;
        var cx = w / 2;
        var cy = h / 2;
        var maxR = Math.min(cx, cy) - 40;

        var labels = ['総合', '還元率', '発送', '品揃え'];
        var values = [
            parseFloat(radarCanvas.getAttribute('data-overall')) || 0,
            parseFloat(radarCanvas.getAttribute('data-return-rate')) || 0,
            parseFloat(radarCanvas.getAttribute('data-shipping')) || 0,
            parseFloat(radarCanvas.getAttribute('data-lineup')) || 0
        ];
        var n = labels.length;

        function angleFor(i) {
            return (Math.PI * 2 * i / n) - Math.PI / 2;
        }

        // Draw grid
        ctx.strokeStyle = '#E5E7EB';
        ctx.lineWidth = 1;
        for (var level = 1; level <= 5; level++) {
            var r = (maxR / 5) * level;
            ctx.beginPath();
            for (var i = 0; i <= n; i++) {
                var a = angleFor(i % n);
                var x = cx + r * Math.cos(a);
                var y = cy + r * Math.sin(a);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Draw axes
        for (var i = 0; i < n; i++) {
            var a = angleFor(i);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + maxR * Math.cos(a), cy + maxR * Math.sin(a));
            ctx.stroke();
        }

        // Draw data polygon
        ctx.fillStyle = 'rgba(79, 70, 229, 0.15)';
        ctx.strokeStyle = '#4F46E5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var i = 0; i <= n; i++) {
            var idx = i % n;
            var a = angleFor(idx);
            var r = (values[idx] / 5) * maxR;
            var x = cx + r * Math.cos(a);
            var y = cy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.fill();
        ctx.stroke();

        // Draw data points
        ctx.fillStyle = '#4F46E5';
        for (var i = 0; i < n; i++) {
            var a = angleFor(i);
            var r = (values[i] / 5) * maxR;
            var x = cx + r * Math.cos(a);
            var y = cy + r * Math.sin(a);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw labels
        ctx.fillStyle = '#1F2937';
        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var i = 0; i < n; i++) {
            var a = angleFor(i);
            var lx = cx + (maxR + 24) * Math.cos(a);
            var ly = cy + (maxR + 24) * Math.sin(a);
            ctx.fillText(labels[i] + ' ' + values[i].toFixed(1), lx, ly);
        }
    }

    // ランキングカードのクーポンコードのコピー（.card-block__coupon-copy）
    // 表示の切り替えは writeText の解決を待たない（権限確認で止まると「押しても無反応」に見えるため）
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('.card-block__coupon-copy');
        if (!btn) return;
        // 見た目の反応（アイコンと文言の差し替え）はクラスの付け外しで出す
        btn.classList.add('is-copied');
        setTimeout(function () {
            btn.classList.remove('is-copied');
        }, 2000);
        var code = btn.getAttribute('data-copy') || '';
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code);
            return;
        }
        // clipboard API が無い環境（古いブラウザ・非セキュアコンテキスト）向けのフォールバック
        var ta = document.createElement('textarea');
        ta.value = code;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta);
    });

    // GA4: affiliate link click tracking (global)
    document.addEventListener('click', function(e) {
        var link = e.target.closest('a[href*="px.a8.net"], a[href*="cir.io"], a[data-affi-asp], a[rel~="sponsored"]');
        if (!link || typeof gtag !== 'function') return;

        // ASP判定: data-affi-asp 優先、URLパターンで補完
        var asp = link.getAttribute('data-affi-asp');
        if (!asp) {
            if (/px\.a8\.net/.test(link.href)) asp = 'a8.net';
            else if (/cir\.io/.test(link.href)) asp = 'フクロウラボ';
            else asp = 'unknown';
        }

        // サービス名: data-service-name 優先 → textContent（50字）
        var serviceName = link.getAttribute('data-service-name') || '';
        if (!serviceName) {
            serviceName = (link.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 50);
        }
        serviceName = serviceName.replace(/\s+/g, ' ').trim() || '(unknown)';

        // ページ種別: pathname プレフィックス
        var pathname = window.location.pathname;
        var pageType = (pathname === '/' || pathname === '/index.php') ? 'home'
            : (pathname.indexOf('/oritoku/oripa/area/') === 0 || pathname.indexOf('/oritoku/akiba/') === 0) ? 'area'
            : pathname.indexOf('/oritoku/oripa/shop/') === 0 ? 'shop'
            : pathname.indexOf('/pokeka-satei') === 0 ? 'satei'
            : pathname.indexOf('/media/') === 0 ? 'media'
            : 'other';

        // 配置（構造のみ）: data-position 優先、なければ CSS class から判定
        var position = link.getAttribute('data-position');
        if (!position) {
            position = link.closest('.sc-pr') ? 'pr_block'
                : link.closest('.sc-cta') ? 'cta'
                : link.closest('.sc-shops') ? 'shop_list'
                : 'inline';
        }

        // 種別: data-position-detail 優先、なければ DOM/クラス から判定
        var positionDetail = link.getAttribute('data-position-detail');
        if (!positionDetail) {
            var hasText = (link.textContent || '').replace(/\s+/g, '').length > 0;
            var hasImg = link.querySelector('img, picture') !== null;
            var isBtn = /btn/.test(link.className);
            positionDetail = isBtn ? 'cta_btn'
                : (hasImg && !hasText) ? 'image'
                : hasText ? 'text_link'
                : 'other';
        }

        gtag('event', 'clicked_affi_link', {
            service_name: serviceName,
            asp: asp,
            link_url: link.href,
            page_type: pageType,
            click_position: position,
            position_detail: positionDetail,
            page_path: pathname
        });
    });
    // Shop tabs
    var tabNav = document.querySelector('.shop-tabs__nav');
    if (tabNav) {
        tabNav.addEventListener('click', function (e) {
            var btn = e.target.closest('.shop-tabs__btn');
            if (!btn) return;

            var tabId = btn.getAttribute('data-tab');
            var tabs = document.getElementById('shop-tabs');

            tabs.querySelectorAll('.shop-tabs__btn').forEach(function (b) {
                b.classList.remove('is-active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('is-active');
            btn.setAttribute('aria-selected', 'true');

            tabs.querySelectorAll('.shop-tabs__panel').forEach(function (p) {
                p.classList.remove('is-active');
                p.hidden = true;
            });
            var panel = document.getElementById(tabId);
            if (panel) {
                panel.classList.add('is-active');
                panel.hidden = false;
            }
        });
    }

    // 開示ポップオーバー（広告開示・編集ポリシー）: 外側クリック / Esc で閉じる
    document.addEventListener('click', function (e) {
        document.querySelectorAll('details.hero__disclosure[open]').forEach(function (d) {
            if (!d.contains(e.target)) d.removeAttribute('open');
        });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('details.hero__disclosure[open]').forEach(function (d) {
                d.removeAttribute('open');
            });
        }
    });

    // 比較表「続きをみる」: is-open クラスで開閉（フォーカスジャンプ無し）
    document.querySelectorAll('.oripa-compare__more-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var wrap = btn.closest('.oripa-compare-wrap');
            if (wrap && wrap.querySelector('#oripa-tier-board')) return;
            if (!wrap) return;
            var open = wrap.classList.toggle('is-open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    });

    // 期間限定バナー帯（hero__media--campaign）: 指で横スクロールできる帯を、触っていない間だけ自動で流す
    var campaignStrip = document.querySelector('.hero__media--campaign:not(.lt-campaign) .hero__media-viewport');
    if (campaignStrip) {
        var campaignTrack = campaignStrip.querySelector('.hero__media-track');
        var campaignPaused = false;
        var campaignPos = 0;
        var campaignResume = null;
        var campaignReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var campaignHalf = function () { return campaignTrack ? campaignTrack.scrollWidth / 2 : 0; };
        var campaignWrap = function () {
            var half = campaignHalf();
            if (half <= 0) return;
            if (campaignStrip.scrollLeft >= half) campaignStrip.scrollLeft -= half;
            else if (campaignStrip.scrollLeft < 0) campaignStrip.scrollLeft += half;
        };
        var campaignPause = function () {
            campaignPaused = true;
            if (campaignResume) { clearTimeout(campaignResume); campaignResume = null; }
        };
        var campaignRelease = function () {
            // 指やマウスを離したらすぐ再開する（止まった位置から続けて流す）
            if (campaignResume) { clearTimeout(campaignResume); campaignResume = null; }
            campaignPos = campaignStrip.scrollLeft;
            campaignPaused = false;
        };
        ['pointerdown', 'touchstart', 'wheel', 'mouseenter', 'focusin'].forEach(function (ev) {
            campaignStrip.addEventListener(ev, campaignPause, { passive: true });
        });
        ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseleave', 'focusout'].forEach(function (ev) {
            campaignStrip.addEventListener(ev, campaignRelease, { passive: true });
        });
        campaignStrip.addEventListener('scroll', function () {
            if (campaignPaused) campaignWrap();
        }, { passive: true });
        if (!campaignReduce && window.requestAnimationFrame) {
            var campaignSpeed = 30; // px/秒（元のCSSカルーセルとほぼ同じ速さ。画面のリフレッシュレートに依存させない）
            var campaignLast = null;
            var campaignStep = function (now) {
                if (campaignLast === null) campaignLast = now;
                var elapsed = Math.min(now - campaignLast, 100);
                campaignLast = now;
                if (!campaignPaused) {
                    campaignPos += campaignSpeed * elapsed / 1000;
                    var half = campaignHalf();
                    if (half > 0 && campaignPos >= half) campaignPos -= half;
                    campaignStrip.scrollLeft = campaignPos;
                }
                window.requestAnimationFrame(campaignStep);
            };
            window.requestAnimationFrame(campaignStep);
        }
    }

    // 比較表の絞り込み（特徴・ジャンル）
    var oripaFilter = document.getElementById('oripa-compare-filter');
    var oripaTable = document.querySelector('.oripa-compare');
    if (oripaFilter && oripaTable) {
        var filterAxes = ['feature', 'genre'];
        var filterResetBtn = document.getElementById('oripa-compare-filter-reset');
        var filterEmptyMsg = document.getElementById('oripa-compare-filter-empty');
        var filterWrapEl = oripaTable.closest('.oripa-compare-wrap');
        var filterTags = oripaFilter.querySelectorAll('.oripa-filter__tag');

        filterTags.forEach(function (tag) {
            tag.setAttribute('aria-pressed', tag.classList.contains('is-active') ? 'true' : 'false');
        });

        var toggleDeferredColumn = function (visible) {
            oripaTable.classList.toggle('is-deferred-priority', visible);
            if (filterWrapEl) filterWrapEl.classList.toggle('is-deferred-priority', visible);
        };

        var activeValues = function (axis) {
            var values = [];
            oripaFilter.querySelectorAll('.oripa-filter__tag[data-axis="' + axis + '"].is-active').forEach(function (tag) {
                values = values.concat(tag.getAttribute('data-value').split(','));
            });
            return values;
        };

        var applyOripaFilter = function () {
            var activeByAxis = {};
            var anyActive = false;
            filterAxes.forEach(function (axis) {
                activeByAxis[axis] = activeValues(axis);
                if (activeByAxis[axis].length) anyActive = true;
            });
            toggleDeferredColumn(activeByAxis.feature.indexOf('deferred') !== -1);
            oripaTable.classList.toggle('is-showy-priority', activeByAxis.feature.indexOf('showy') !== -1);

            var rows = oripaTable.querySelectorAll('.oripa-compare__row');
            var visibleCount = 0;
            rows.forEach(function (row) {
                var match = true;
                filterAxes.forEach(function (axis) {
                    if (!match || activeByAxis[axis].length === 0) return;
                    var rowVal = row.getAttribute('data-' + axis);
                    var rowValues = rowVal ? rowVal.split(',') : [];
                    var hit = rowValues.some(function (v) {
                        return activeByAxis[axis].indexOf(v) !== -1;
                    });
                    if (!hit) match = false;
                });
                row.classList.toggle('oripa-compare__row--filtered-out', !match);
                if (match) visibleCount++;
            });

            if (anyActive && filterWrapEl) filterWrapEl.classList.add('is-open');
            if (filterResetBtn) filterResetBtn.hidden = !anyActive;
            if (filterEmptyMsg) filterEmptyMsg.hidden = visibleCount > 0;
        };

        oripaFilter.addEventListener('click', function (e) {
            var tag = e.target.closest('.oripa-filter__tag');
            if (tag) {
                tag.classList.toggle('is-active');
                tag.setAttribute('aria-pressed', tag.classList.contains('is-active') ? 'true' : 'false');
                applyOripaFilter();
                return;
            }
            if (e.target.closest('#oripa-compare-filter-reset')) {
                oripaFilter.querySelectorAll('.oripa-filter__tag.is-active').forEach(function (t) {
                    t.classList.remove('is-active');
                    t.setAttribute('aria-pressed', 'false');
                });
                applyOripaFilter();
            }
        });
    }

    // 比較表の並び替え（還元率・発送スピード）
    var sortButtons = document.querySelectorAll('.oripa-compare__sort-btn');
    if (sortButtons.length && oripaTable) {
        var gradeRank = { s: 6, a: 5, b: 4, c: 3, d: 2, e: 1 };
        var cellClassBySort = { kg: 'oripa-compare__kg', ship: 'oripa-compare__ship' };
        var sortWrapEl = oripaTable.closest('.oripa-compare-wrap');
        var tbody = oripaTable.querySelector('tbody');

        var rankFor = function (row, sortKey) {
            var cell = row.querySelector('.' + cellClassBySort[sortKey]);
            if (!cell) return 0;
            var gradeEl = cell.querySelector('.card-block__axis-grade');
            if (!gradeEl) return 0;
            var m = gradeEl.className.match(/card-block__axis-grade--(\w)/);
            return m ? (gradeRank[m[1]] || 0) : 0;
        };

        sortButtons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var sortKey = btn.getAttribute('data-sort');
                var dir = btn.getAttribute('data-dir') === 'desc' ? 'asc' : 'desc';

                sortButtons.forEach(function (b) {
                    b.classList.remove('is-active');
                    b.removeAttribute('data-dir');
                });
                btn.classList.add('is-active');
                btn.setAttribute('data-dir', dir);

                var rows = Array.prototype.slice.call(tbody.querySelectorAll('.oripa-compare__row'));
                rows.sort(function (a, b) {
                    var ra = rankFor(a, sortKey);
                    var rb = rankFor(b, sortKey);
                    return dir === 'desc' ? rb - ra : ra - rb;
                });
                rows.forEach(function (row) { tbody.appendChild(row); });

                oripaTable.classList.add('is-sorted');
                if (sortWrapEl) sortWrapEl.classList.add('is-open');
            });
        });
    }
});

/* ブランドヘッダーは追尾しない（position: relative で自然に流れて消える）方針。
   カテゴリナビ(.category-nav)は CSS で position:fixed + translateY(-100%) の初期状態にしてあり、
   ブランドヘッダーが完全にスクロールアウトしたら画面上端に現れる（全柱ページ共通）。
   ここでは .category-nav--reveal（表示）と .category-nav--compact（PCのみ縮小）の付け外しを行う。 */
document.addEventListener('DOMContentLoaded', function () {
    var nav = document.querySelector('.area-article--best-pillar .category-nav');
    var header = document.querySelector('.header');
    if (!nav || !header) return;
    var ticking = false;
    function update() {
        var headerGone = header.getBoundingClientRect().bottom <= 0;
        nav.classList.toggle('category-nav--reveal', headerGone);
        nav.classList.toggle('category-nav--compact', headerGone);
        ticking = false;
    }
    window.addEventListener('scroll', function () {
        if (!ticking) {
            window.requestAnimationFrame(update);
            ticking = true;
        }
    }, { passive: true });
    update();
});

// カテゴリナビ「もっと見る」関連記事ドロップダウンの開閉
document.addEventListener('DOMContentLoaded', function () {
    var moreBtn = document.querySelector('.category-nav__more-btn');
    var morePanel = document.getElementById('oripaMorePanel');
    if (!moreBtn || !morePanel) return;
    function closePanel() {
        moreBtn.setAttribute('aria-expanded', 'false');
        morePanel.hidden = true;
    }
    function openPanel() {
        moreBtn.setAttribute('aria-expanded', 'true');
        morePanel.hidden = false;
    }
    moreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (moreBtn.getAttribute('aria-expanded') === 'true') closePanel();
        else openPanel();
    });
    document.addEventListener('click', function (e) {
        if (morePanel.hidden) return;
        if (!morePanel.contains(e.target) && !moreBtn.contains(e.target)) closePanel();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !morePanel.hidden) closePanel();
    });
});

// ヘッダー「検証記事」ドロップダウン（PCはCSSホバー、タップ/クリックはここで開閉）
document.addEventListener('DOMContentLoaded', function () {
    var group = document.querySelector('.header__nav-group');
    if (!group) return;
    var toggle = group.querySelector('.header__nav-toggle');
    if (!toggle) return;

    function setOpen(open) {
        group.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('click', function (e) {
        if (toggle.getAttribute('aria-expanded') !== 'true') return;
        if (!group.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') setOpen(false);
    });
});

// 下部フローティングバナー（#float-banner）
// 遷移直後は出さず、data-reveal-after-scroll を超えてスクロールしたら表示する。
// × を押した回はそのページ表示中は出さない（保存はしない＝リロードで復活）。
document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('float-banner');
    if (!el) return;

    var closeBtn = document.getElementById('float-banner-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            el.style.display = 'none';
        });
    }

    var threshold = Math.max(0, Number(el.dataset.revealAfterScroll) || 0);
    function onScroll() {
        if (window.pageYOffset > threshold) {
            el.classList.add('is-revealed');
            window.removeEventListener('scroll', onScroll);
        }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
});

// 記事本文の画像カルーセル（連続2枚の figure）
// 1画面1枚。ボタンで1枚ずつスクロールし、端でボタンを無効化する。
// JSが無くても viewport は横スクロールできるのでフォールバックは成立する。
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-carousel]').forEach(function (root) {
        var view = root.querySelector('[data-carousel-viewport]');
        var prev = root.querySelector('[data-carousel-prev]');
        var next = root.querySelector('[data-carousel-next]');
        var indexEl = root.querySelector('[data-carousel-index]');
        if (!view) return;

        var slides = Array.prototype.slice.call(view.children);
        if (slides.length < 2) {
            if (prev) prev.hidden = true;
            if (next) next.hidden = true;
            return;
        }

        function current() {
            var pos = view.scrollLeft;
            var best = 0;
            var bestGap = Infinity;
            slides.forEach(function (s, i) {
                var gap = Math.abs(s.offsetLeft - view.offsetLeft - pos);
                if (gap < bestGap) { bestGap = gap; best = i; }
            });
            return best;
        }

        function sync() {
            var i = current();
            if (indexEl) indexEl.textContent = String(i + 1);
            if (prev) prev.disabled = i === 0;
            if (next) next.disabled = i === slides.length - 1;
        }

        function go(step) {
            var target = slides[Math.min(slides.length - 1, Math.max(0, current() + step))];
            view.scrollTo({ left: target.offsetLeft - view.offsetLeft, behavior: 'smooth' });
        }

        if (prev) prev.addEventListener('click', function () { go(-1); });
        if (next) next.addEventListener('click', function () { go(1); });

        var tick;
        view.addEventListener('scroll', function () {
            clearTimeout(tick);
            tick = setTimeout(sync, 80);
        }, { passive: true });
        window.addEventListener('resize', sync);
        sync();
    });

    // 本文中のカード画像・図版はクリック/タップで拡大表示（ポップアップ）。
    // 表の中の !img と :::samples の画像はサムネイルが小さく、絵柄の判別ができないため。
    // 単体図版（.article-figure）も、グラフ・比較図の細部が SP 幅では読めないため対象にする。
    // 直下の img だけに限定しているのは、出典リンク付きの図版（figure > a > img）は
    // 本来のリンク遷移を優先するため（下の closest('a') チェックと二重の担保）。
    // .cl-zoom は収録カードリスト（/media/pokeka-30th-atari/30th-card-list/）の
    // カードサムネ。data-zoom-src があればそちらを拡大表示する（サムネは140px幅で粗いため）。
    // .article-ranking__img は :::ranking（当たりTOP3 等）のカード画像。SP の3列では絵柄が小さいため。
    var zoomImgs = document.querySelectorAll(
        '.article-table-wrap .article-inline-img, .article-samples img,'
        + ' .article-figure > img, .article-figure > picture > img, .article-gallery__item > img, .cl-zoom,'
        + ' .article-ranking__img'
    );
    if (zoomImgs.length) {
        var lb = null;
        var lbImg = null;
        var lbClose = null;
        var lbLastFocus = null;

        var closeLightbox = function () {
            if (!lb || !lb.classList.contains('is-open')) return;
            lb.classList.remove('is-open');
            document.body.classList.remove('is-lightbox-open');
            lbImg.removeAttribute('src');
            if (lbLastFocus && lbLastFocus.focus) lbLastFocus.focus();
        };

        var buildLightbox = function () {
            lb = document.createElement('div');
            lb.className = 'img-lightbox';
            lb.setAttribute('role', 'dialog');
            lb.setAttribute('aria-modal', 'true');

            lbImg = document.createElement('img');
            lbImg.className = 'img-lightbox__img';
            lbImg.alt = '';

            lbClose = document.createElement('button');
            lbClose.type = 'button';
            lbClose.className = 'img-lightbox__close';
            lbClose.setAttribute('aria-label', '閉じる');
            lbClose.textContent = '\u00d7';

            lb.appendChild(lbImg);
            lb.appendChild(lbClose);
            document.body.appendChild(lb);

            // 背景・画像・×ボタンのどこを押しても閉じる
            lb.addEventListener('click', closeLightbox);
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' || e.key === 'Esc') closeLightbox();
            });
        };

        var openLightbox = function (img) {
            if (!lb) buildLightbox();
            lbLastFocus = document.activeElement;
            lbImg.src = img.getAttribute('data-zoom-src') || img.currentSrc || img.src;
            lbImg.alt = img.alt || '';
            lb.classList.add('is-open');
            document.body.classList.add('is-lightbox-open');
            lbClose.focus();
        };

        Array.prototype.forEach.call(zoomImgs, function (img) {
            if (img.closest('a')) return; // リンク画像は本来の遷移を優先
            img.setAttribute('role', 'button');
            img.setAttribute('tabindex', '0');
            img.addEventListener('click', function () { openLightbox(img); });
            img.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openLightbox(img);
                }
            });
        });
    }
});

// カード内「総合評価」リンク（.card-block__rating-link）はアンカー先セクションの
// 内容をモーダルに複製して表示する（href="#sec-method" 等はJS無効時のフォールバックとして残す）
document.addEventListener('DOMContentLoaded', function () {
    var links = document.querySelectorAll('.card-block__rating-link');
    if (!links.length) return;

    var modal, modalBody, lastFocus;

    function buildModal() {
        modal = document.createElement('div');
        modal.className = 'rating-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML =
            '<div class="rating-modal__overlay" data-rating-modal-close></div>' +
            '<div class="rating-modal__card">' +
                '<button type="button" class="rating-modal__close" data-rating-modal-close aria-label="閉じる">×</button>' +
                '<div class="rating-modal__body"></div>' +
            '</div>';
        document.body.appendChild(modal);
        modalBody = modal.querySelector('.rating-modal__body');

        modal.addEventListener('click', function (e) {
            if (e.target.closest('[data-rating-modal-close]')) closeModal();
        });
        document.addEventListener('keydown', function (e) {
            if ((e.key === 'Escape' || e.key === 'Esc') && modal.classList.contains('is-open')) closeModal();
        });
    }

    function openModal(sourceEl) {
        if (!modal) buildModal();
        lastFocus = document.activeElement;
        modalBody.innerHTML = sourceEl.innerHTML;
        modal.classList.add('is-open');
        document.body.classList.add('is-rating-modal-open');
        modal.querySelector('.rating-modal__close').focus();
    }

    function closeModal() {
        modal.classList.remove('is-open');
        document.body.classList.remove('is-rating-modal-open');
        if (lastFocus) lastFocus.focus();
    }

    Array.prototype.forEach.call(links, function (link) {
        var href = link.getAttribute('href') || '';
        if (href.charAt(0) !== '#') return;
        var target = document.getElementById(href.slice(1));
        if (!target) return;
        link.addEventListener('click', function (e) {
            e.preventDefault();
            openModal(target);
        });
    });
});

// カード内の画像（.card-block__media-track）が2枚以上あるカードだけ、
// メイン画像＋下にサムネ一覧のカルーセルへ progressive enhancement する。
// 1枚しかないカードは既存の横スクロール表示のまま変える必要がないので触らない。
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.card-block__media-track').forEach(function (track) {
        // querySelectorAll を使うのは、アフィリエイトサムネが <a class="card-block__image-link"
        // (display:contents)> で包まれ、直接の子ではなくなっている場合があるため。
        var slides = Array.prototype.slice.call(track.querySelectorAll('.card-block__image'));
        if (slides.length < 2) return;

        var media = track.closest('.card-block__media');
        if (!media) return;

        track.classList.add('card-block__media-track--carousel');
        slides[0].classList.add('is-active');

        // 前後の送りボタンは置かない（画像に重なって見た目を損なうため）。
        // 画像の切り替えは下のサムネイル一覧だけで行う。
        var thumbs = document.createElement('div');
        thumbs.className = 'card-block__media-thumbs';
        var thumbEls = slides.map(function (slide, i) {
            var thumb = document.createElement('button');
            thumb.type = 'button';
            thumb.className = 'card-block__media-thumb' + (i === 0 ? ' is-active' : '');
            var sourceImage = slide.querySelector('img');
            if (sourceImage) {
                var preview = document.createElement('img');
                preview.loading = 'lazy';
                preview.decoding = 'async';
                preview.alt = '';
                preview.src = sourceImage.getAttribute('data-thumbnail') || sourceImage.src;
                thumb.appendChild(preview);
            } else {
                thumb.style.backgroundImage = slide.style.backgroundImage;
            }
            thumb.setAttribute('aria-label', '画像' + (i + 1) + '/' + slides.length);
            thumb.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
            thumb.addEventListener('click', function () { show(i); });
            thumbs.appendChild(thumb);
            return thumb;
        });
        // 画像直下の注釈（.card-block__media-note）があれば、サムネ一覧はその手前に置く
        media.insertBefore(thumbs, media.querySelector(':scope > .card-block__media-note'));

        function show(i) {
            slides.forEach(function (s, idx) { s.classList.toggle('is-active', idx === i); });
            thumbEls.forEach(function (t, idx) {
                t.classList.toggle('is-active', idx === i);
                t.setAttribute('aria-pressed', idx === i ? 'true' : 'false');
            });
        }
    });
});

/* SP ボトムタブバー（partials/oripa-tabbar.php）の店舗別 / 景品別シート。
   同ページ内の <dialog class="oripa-sheet"> をボトムシートとして開閉する。
   残る3タブ（選定基準 / イベント / 攻略）は素のリンクなので JS を通らない。 */
document.addEventListener('DOMContentLoaded', function () {
    var tabbar = document.querySelector('.oripa-tabbar');
    if (!tabbar) return;

    Array.prototype.forEach.call(tabbar.querySelectorAll('[data-tabbar-open]'), function (btn) {
        var sheet = document.getElementById(btn.getAttribute('data-tabbar-open'));
        if (!sheet || typeof sheet.showModal !== 'function') return;
        btn.addEventListener('click', function () {
            btn.setAttribute('aria-expanded', 'true');
            sheet.showModal();
        });
        sheet.addEventListener('close', function () {
            btn.setAttribute('aria-expanded', 'false');
        });
        var closeBtn = sheet.querySelector('[data-tabbar-close]');
        if (closeBtn) closeBtn.addEventListener('click', function () { sheet.close(); });
        // シート外（::backdrop）のタップで閉じる
        sheet.addEventListener('click', function (e) {
            if (e.target === sheet) sheet.close();
        });
    });
});

/* ============================================================
   表の並べ替え・絞り込み（表の直前の {filter=景品:PSA|BOX;1口:100coin以下}。Markdown.php が .article-table-tools を出す）
   並べ替えは「おすすめ順＝書いた順／1口が安い順／1口が高い順」。
   段ごとに1つ選び、すべての段を満たす行だけ残す。語は行の文字に含むか、
   「◯coin以下」「◯coin以上」は1口の値段（2列目以降で最初に出る「◯coin/」。無ければ最初の◯coin）で判定する。
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-table-tools]').forEach(function (tools) {
        var next = tools.nextElementSibling;
        var table = next && (next.matches('table') ? next : next.querySelector('table'));
        var tbody = table && table.tBodies[0];
        if (!tbody) return;
        var rows = Array.prototype.slice.call(tbody.rows);
        rows.forEach(function (tr, i) {
            tr.dataset.order = i;
            var coin = Infinity;
            for (var c = 1; c < tr.cells.length; c++) {
                var text = tr.cells[c].textContent;
                var m = text.match(/([\d,]+)\s*coin〜?\s*\//) || text.match(/([\d,]+)\s*coin/);
                if (m) { coin = parseInt(m[1].replace(/,/g, ''), 10); break; }
            }
            tr.dataset.coin = coin;
        });
        var num = function (v) { return parseInt(v.replace(/,/g, ''), 10); };
        var match = function (tr, f) {
            if (f === '') return true;
            var m = f.match(/^([\d,]+)\s*coin(以下|以上)$/);
            if (m) {
                var coin = Number(tr.dataset.coin);
                return m[2] === '以下' ? coin <= num(m[1]) : coin >= num(m[1]);
            }
            return tr.textContent.indexOf(f) !== -1;
        };
        var empty = tools.querySelector('.article-table-tools__empty');
        var state = {};
        var sort = '';
        var apply = function () {
            var shown = 0;
            rows.slice().sort(function (a, b) {
                var d = sort === 'asc' ? a.dataset.coin - b.dataset.coin
                    : sort === 'desc' ? b.dataset.coin - a.dataset.coin : 0;
                return d || a.dataset.order - b.dataset.order;
            }).forEach(function (tr) {
                tbody.appendChild(tr);
                var ok = Object.keys(state).every(function (g) { return match(tr, state[g]); });
                tr.hidden = !ok;
                if (ok) shown++;
            });
            if (empty) empty.hidden = shown > 0;
        };
        tools.addEventListener('click', function (e) {
            var btn = e.target.closest('.article-table-tools__chip');
            if (!btn) return;
            var group = btn.closest('[data-group], [data-sort-group]');
            if (btn.hasAttribute('data-sort')) {
                sort = btn.getAttribute('data-sort');
            } else {
                state[group.getAttribute('data-group')] = btn.getAttribute('data-filter') || '';
            }
            group.querySelectorAll('.article-table-tools__chip').forEach(function (b) {
                var on = b === btn;
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            apply();
        });
    });
});

/* ============================================================
   クーポンコードのコピー（:::proripa のコピーボタン）
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-copy-text]').forEach(function (btn) {
        var done = function () {
            btn.classList.add('is-copied');
            setTimeout(function () { btn.classList.remove('is-copied'); }, 2000);
        };
        // navigator.clipboard は非フォーカス時などに reject するので、必ず execCommand へ退避する
        var fallback = function (text) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            done();
        };
        var copy = function () {
            var text = btn.getAttribute('data-copy-text') || '';
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(function () { fallback(text); });
                return;
            }
            fallback(text);
        };
        btn.addEventListener('click', copy);
        // コード欄のどこをタップしてもコピーできるようにする
        var field = btn.closest('.article-proripa__coupon');
        if (field) {
            field.addEventListener('click', function (e) {
                if (e.target.closest('.article-proripa__copy')) return;
                copy();
            });
        }
    });
});

/* /oritoku/oripa/ のスマホ: ブランドヘッダーがスクロールアウトしたら「≡」を右上に浮かせる。
   上端に出るカテゴリナビ（.category-nav--reveal）と重ならないよう、その下端に合わせて置く。
   メニュー本体は既存の .header__nav をそのまま使い、浮いている間だけ fixed のパネルにする。 */
document.addEventListener('DOMContentLoaded', function () {
    var header = document.querySelector('.header--oripa');
    var btn = header && header.querySelector('.header__menu-btn');
    var nav = header && header.querySelector('.header__nav');
    if (!header || !btn || !nav) return;
    var mq = window.matchMedia('(max-width: 820px)');
    var catNav = document.querySelector('.category-nav');
    var ticking = false;
    function close() {
        btn.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
    }
    function update() {
        ticking = false;
        var floating = mq.matches && header.getBoundingClientRect().bottom <= 0;
        if (document.body.classList.contains('oripa-float-menu') !== floating) {
            close();
            document.body.classList.toggle('oripa-float-menu', floating);
        }
        var top = 10;
        if (floating && catNav && catNav.classList.contains('category-nav--reveal')) {
            top = Math.max(0, catNav.getBoundingClientRect().bottom) + 10;
        }
        document.documentElement.style.setProperty('--oripa-float-top', top + 'px');
    }
    window.addEventListener('scroll', function () {
        if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    window.addEventListener('resize', update);
    document.addEventListener('click', function (e) {
        if (!document.body.classList.contains('oripa-float-menu') || !nav.classList.contains('is-open')) return;
        if (btn.contains(e.target)) return;
        var link = e.target.closest && e.target.closest('a');
        if (!nav.contains(e.target) || link) close();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('is-open')) { close(); btn.focus(); }
    });
    // スマホのメニュー（.header__sp-menu）のリンクは、浮いていないときも押したら閉じる（ページ内リンクで開きっぱなしにしない）
    nav.addEventListener('click', function (e) {
        var link = e.target.closest && e.target.closest('.header__sp-menu a');
        if (link && mq.matches) close();
    });
    update();
});

/* ============================================================
   GA4: 内部リンクのクリック計測（internal_link_click）
   遷移先が同じオリジンの <a> を押したら「どの枠の何番目のリンクか」を送る。
   仕様・枠名の一覧: docs/work-log/internal-link-click.md
   ============================================================ */
(function () {
    // コンテナのセレクタ → 枠名。リンクから親をたどり、最も内側で一致したものを採る
    // （並び順が効くのは、同じ要素に複数の行が一致したときだけ＝上の行が勝つ）。
    // HTML 側に data-link-module があれば同じ走査で優先する。
    // クラス名を変えると黙って other に落ちるので、変えたら網羅チェックをやり直す。
    var LINK_MODULES = [
        // ヘッダー・フッター・フローティング
        ['.header__brand', 'header_logo'],
        ['nav.header__nav', 'header_nav'],
        ['#oripaReviewMenu', 'header_menu'],
        ['.header__sp-menu', 'header_sp_menu'],
        ['.media-float', 'media_float_menu'],
        ['footer.footer', 'footer'],
        // 記事の枠（テンプレ）。柱ページ JSON の hero 内にも同じ役割のものがある
        ['nav.breadcrumb', 'breadcrumb'],
        ['.hero__breadcrumb', 'breadcrumb'],
        ['.article__byline', 'byline'],
        ['.hero__byline', 'byline'],
        ['.sc-head', 'byline'],
        ['section.hero', 'hero'],
        ['.area-article__header', 'hero'],
        ['aside.article-supervisor', 'supervisor'],
        ['.area-body .author', 'supervisor'],
        ['nav.article-toc', 'toc'],
        ['nav.sc-toc', 'toc'],
        ['.article__body', 'body'],
        ['.area-body', 'body'],
        ['.sc-prose', 'body'],
        ['article.sc', 'body'],
        ['.satei', 'body'],
        ['section.media-related', 'related'],
        ['article.cardlist section#related', 'related'],
        ['ul.sc-related', 'satei_related'],
        ['.sc-cta', 'cta'],
        ['section.article-relations', 'cta'],
        // /oritoku/oripa/ 柱ページの共通ナビ
        ['nav.category-nav', 'category_nav'],
        ['#oripaMorePanel', 'category_nav_more'],
        ['nav.oripa-tabbar', 'tabbar'],
        ['dialog.oripa-sheet', 'tabbar_sheet'],
        ['.area-section--cluster', 'cluster_articles'],
        ['section.area-section--related', 'area_related'],
        // 本文内のパーツ（src/Markdown.php・柱ページ JSON）
        ['.article-cta-inline', 'cta'],
        ['.article-btn-wrap', 'cta'],
        // 柱ページのランキングカード内レビューリンク（src/helpers.php）。同じ要素に .article-blogcard-wrap も
        // 付くので、その行より上に置く（同じ要素に複数一致したら表の上の行が勝つ）
        ['.card-block__review', 'card_review'],
        ['.article-blogcard-wrap', 'blogcard'],
        ['nav.article-navtiles', 'navtiles'],
        ['.article-compare', 'compare'],
        ['.article-say', 'say'],
        ['aside.article-proripa', 'proripa'],
        ['details.article-faq', 'faq'],
        ['.faq-item', 'faq'],
        ['.article-table-wrap', 'table'],
        ['.card-block', 'card_block'],
        // 柱ページ JSON（data/pillars/*.json）のブロック
        ['.oripa-explore', 'pillar_explore'],
        ['.oripa-compare-wrap', 'compare'],
        ['.oripa-evcal', 'eventcal'],
        ['.oripa-changelog', 'pillar_changelog'],
        ['.gd-tiles', 'pillar_tiles'],
        ['.gd-cards', 'pillar_cards'],
        ['.gd-rows', 'pillar_rows'],
        ['.gd-step__links', 'pillar_steps'],
        ['.gd-tablewrap', 'pillar_table'],
        // /oritoku/oripa/area/（templates/area/index.php）
        ['.mainareas', 'area_index_main'],
        ['.jpmap', 'area_index_map'],
        ['.area-select', 'area_index_select'],
        ['section.nominees', 'area_index_award'],
        ['section.natlist', 'area_index_list'],
        // /media/（templates/media/index.php）
        ['.media-hero', 'media_index_hero'],
        ['.media-samples', 'media_index'],
        ['.media-pitch', 'media_index_pitch'],
        // 単独ページ（診断・アンケート・記事LP）
        ['#result-view', 'sindan_result'],
        ['.spage', 'survey'],
        ['footer.lp-footer', 'footer']
    ];

    function findContainer(a) {
        for (var el = a; el && el.nodeType === 1; el = el.parentElement) {
            var mod = el.getAttribute('data-link-module');
            if (mod) return { module: mod, container: el };
            for (var i = 0; i < LINK_MODULES.length; i++) {
                if (el.matches(LINK_MODULES[i][0])) return { module: LINK_MODULES[i][1], container: el };
            }
        }
        return { module: 'other', container: document.body };
    }

    // 枠の判定。網羅チェックや将来のリンク台帳クロールでも同じロジックを使うため公開する
    // 戻り値: { module: 枠名, container: 一致した要素, index: 枠内で何番目の <a> か（1始まり） }
    window.tcgLinkModule = function (a) {
        var hit = findContainer(a);
        var index = Array.prototype.indexOf.call(hit.container.querySelectorAll('a'), a) + 1;
        // コンテナがリンク自身のときは querySelectorAll に含まれないので 1 番目とする
        return { module: hit.module, container: hit.container, index: index || 1 };
    };

    document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a || typeof gtag !== 'function') return;
        // href はクリック時に読む（JS で後から差し替えるリンクがあるため）
        // SVG の <a>（/oritoku/oripa/area/ の地図）は origin・pathname を持たないので URL で解決する
        var u = typeof a.origin === 'string' ? a : new URL(a.getAttribute('href'), location.href);
        // 外部・mailto:・tel:・javascript: は origin が一致しないのでここで落ちる
        if (u.origin !== location.origin) return;
        // 同じページ内のアンカー（比較表の絶対URL＋#card-x も含む）は遷移ではないので送らない。
        // href="#" は URL にすると hash が空文字になるので、元の href に # があるかでも判定する
        if (u.pathname === location.pathname && (u.hash || (a.getAttribute('href') || '').indexOf('#') !== -1)) return;

        var info = window.tcgLinkModule(a);
        // テキスト: 空白を詰めて50字。画像だけのリンクは alt、それも無ければ aria-label
        var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) {
            var img = a.querySelector('img[alt]');
            text = ((img && img.getAttribute('alt')) || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        }

        gtag('event', 'internal_link_click', {
            link_module: info.module,
            link_path: u.pathname,
            link_index: info.index,
            link_text: text.substring(0, 50)
        });
    });
})();
