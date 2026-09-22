// Price Match Paradise — blog conversion helpers.
// 1) Point "smart" CTAs at the right store for the visitor's device.
// 2) Tag Play Store links with install referrer so blog installs show up in Play Console.
// 3) Send a gtag event on every store / download click (set it as a conversion in Google Ads).
// 4) Sticky download bar on phones, reading progress, active section in the sidebar TOC.
(function () {
    var IOS_URL = 'https://apps.apple.com/us/app/price-match-paradise/id6758967914';
    var PLAY_URL = 'https://play.google.com/store/apps/details?id=com.ihr.mybarcodeapp';

    var ua = navigator.userAgent || '';
    var isAndroid = /Android/i.test(ua);
    var isIOS = !isAndroid && (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    var campaign = document.body.getAttribute('data-campaign') || 'blog';

    function playUrl(placement) {
        var ref = 'utm_source=blog&utm_medium=' + (placement || 'article') + '&utm_campaign=' + campaign;
        return PLAY_URL + '&referrer=' + encodeURIComponent(ref);
    }

    // Smart CTAs: one button that goes straight to the right store.
    document.querySelectorAll('[data-smart-cta]').forEach(function (a) {
        var label = a.querySelector('.cta-label');
        var icon = a.querySelector('i');
        if (isIOS) {
            a.href = IOS_URL;
            if (icon) icon.className = 'fab fa-apple';
            if (label && a.hasAttribute('data-long')) label.textContent = 'Download free on the App Store';
        } else if (isAndroid) {
            a.href = playUrl(a.getAttribute('data-placement'));
            if (icon) icon.className = 'fab fa-google-play';
            if (label && a.hasAttribute('data-long')) label.textContent = 'Get it free on Google Play';
        } else {
            a.href = '/download.html';
        }
    });

    document.querySelectorAll('a[href^="' + PLAY_URL + '"]').forEach(function (a) {
        a.href = playUrl(a.getAttribute('data-placement'));
    });

    // Conversion tracking
    document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a');
        if (!a || !window.gtag) return;
        var store = a.href.indexOf('apps.apple.com') > -1 ? 'ios'
            : a.href.indexOf('play.google.com') > -1 ? 'android'
            : /\/download\.html$/.test(a.pathname) ? 'download_page' : null;
        if (!store) return;
        window.gtag('event', 'app_download_click', {
            store: store,
            placement: a.getAttribute('data-placement') || 'unknown',
            page_path: location.pathname
        });
    });

    // Nav / progress / sticky bar
    var progress = document.querySelector('.progress');
    var bar = document.querySelector('.sticky-bar');
    var finalCta = document.querySelector('.cta-final');
    var dismissed = false;
    try { dismissed = sessionStorage.getItem('pmp_bar_closed') === '1'; } catch (err) {}

    if (bar) {
        document.body.classList.add('has-sticky');
        var close = bar.querySelector('.x');
        if (close) close.addEventListener('click', function () {
            dismissed = true;
            bar.classList.remove('show');
            try { sessionStorage.setItem('pmp_bar_closed', '1'); } catch (err) {}
        });
    }

    function finalInView() {
        if (!finalCta) return false;
        var r = finalCta.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
    }

    function onScroll() {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        var pct = max > 0 ? h.scrollTop / max : 0;
        if (progress) progress.style.width = (pct * 100) + '%';
        if (bar && !dismissed) bar.classList.toggle('show', pct > 0.12 && !finalInView());
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Highlight the current section in the sidebar TOC
    var links = document.querySelectorAll('.side-toc a');
    if (links.length && 'IntersectionObserver' in window) {
        var map = {};
        links.forEach(function (l) { map[l.getAttribute('href').slice(1)] = l; });
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting || !map[en.target.id]) return;
                links.forEach(function (l) { l.classList.remove('active'); });
                map[en.target.id].classList.add('active');
            });
        }, { rootMargin: '-90px 0px -70% 0px' });
        Object.keys(map).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) io.observe(el);
        });
    }
})();
