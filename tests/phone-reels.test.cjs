// Run with: node --test tests/phone-reels.test.cjs
// Local DOM/media mocks verify navigation without starting a browser or media download.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'phone-reels.css'), 'utf8');
const source = fs.readFileSync(path.join(root, 'phone-reels.js'), 'utf8');
const reelMarkup = Array.from(html.matchAll(/<article\b([^>]*\bdata-reel="[^"]+"[^>]*)>([\s\S]*?)<\/article>/g));

function attributes(raw) {
    const result = {};
    for (const match of raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        result[match[1]] = (match[2] ?? match[3]).replaceAll('&amp;', '&');
    }
    return result;
}

function boot(options = {}) {
    let now = 1000;
    const observers = [];
    const document = { hidden: Boolean(options.documentHidden), activeElement: null, listeners: new Map() };
    class Element {
        constructor(tag, attrs = {}, parent = null) {
            this.tag = tag;
            this.attrs = { ...attrs };
            this.parent = parent;
            this.children = [];
            this.dataset = {};
            this.hidden = false;
            this.tabIndex = 0;
            this.textContent = '';
            this.listeners = new Map();
            this.classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
            this.classList = {
                add: value => this.classes.add(value),
                remove: value => this.classes.delete(value),
                contains: value => this.classes.has(value),
                toggle: (value, force) => {
                    const enabled = force ?? !this.classes.has(value);
                    if (enabled) this.classes.add(value); else this.classes.delete(value);
                    return enabled;
                }
            };
            for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) {
                this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
            }
            if (parent) parent.children.push(this);
        }
        matches(selector) {
            selector = selector.trim();
            if (selector.includes(' ')) {
                const parts = selector.split(/\s+/);
                const child = parts.pop();
                return this.matches(child) && Boolean(this.parent?.closest(parts.join(' ')));
            }
            if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
            if (selector.startsWith('[')) return Object.hasOwn(this.attrs, selector.slice(1, -1));
            return selector === this.tag;
        }
        closest(selector) {
            if (selector.split(',').some(part => this.matches(part))) return this;
            return this.parent ? this.parent.closest(selector) : null;
        }
        querySelectorAll(selector) {
            return this.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector) ]);
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        get className() { return [...this.classes].join(' '); }
        set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
        setAttribute(name, value) { this.attrs[name] = String(value); }
        getAttribute(name) { return this.attrs[name]; }
        addEventListener(name, listener, config) {
            if (!this.listeners.has(name)) this.listeners.set(name, []);
            this.listeners.get(name).push({ listener, config });
        }
        dispatch(name, overrides = {}) {
            const event = { target: this, prevented: false, preventDefault() { this.prevented = true; }, ...overrides };
            for (const { listener } of this.listeners.get(name) || []) listener(event);
            return event;
        }
        focus() { document.activeElement = this; }
        click() { this.focus(); return this.dispatch('click'); }
        getBoundingClientRect() { return { bottom: 800 }; }
    }

    const carousel = new Element('div', attributes(html.match(/<div\b[^>]*class="reels-carousel"[^>]*>/)[0]));
    const stage = new Element('div', { class: 'reels-stage' }, carousel);
    const cards = [];
    const videos = [];
    const overlays = [];
    const captions = [];
    const sounds = [];
    for (const [raw, videoMarkup] of reelMarkup.slice(0, options.cardCount ?? 3).map(match => [match[1], match[2]])) {
        const card = new Element('article', attributes(raw), stage);
        const screen = new Element('div', { class: 'reel-screen' }, card);
        const videoAttrs = attributes(videoMarkup.match(/<video\b([^>]*)>/)[1]);
        const video = new Element('video', videoAttrs, screen);
        video.controls = true;
        video.preload = videoAttrs.preload;
        video.paused = true;
        video.loadCalls = 0;
        video.pauseCalls = 0;
        video.playCalls = 0;
        video.pendingPlayback = [];
        video.rejectPlay = options.rejectPlay === true || (Array.isArray(options.rejectPlay) && options.rejectPlay.includes(videos.length));
        let muted = /\bmuted\b/.test(videoMarkup.match(/<video\b([^>]*)>/)[1]);
        Object.defineProperty(video, 'muted', {
            get: () => muted,
            set: value => {
                const changed = muted !== Boolean(value);
                muted = Boolean(value);
                if (changed) video.dispatch('volumechange');
            }
        });
        video.load = () => { video.loadCalls++; };
        video.pause = () => {
            video.pauseCalls++;
            const changed = !video.paused;
            video.paused = true;
            if (changed) video.dispatch('pause');
        };
        video.play = () => {
            video.playCalls++;
            if (video.rejectPlay) return Promise.reject(new Error('Autoplay denied by browser'));
            const start = () => {
                const changed = video.paused;
                video.paused = false;
                if (changed) video.dispatch('play');
            };
            if (options.deferPlay) return new Promise(resolve => video.pendingPlayback.push(() => { start(); resolve(); }));
            start();
            return Promise.resolve();
        };
        const overlay = new Element('button', { class: 'reel-select' }, screen);
        overlay.hidden = true;
        const soundMarkup = videoMarkup.match(/<button\b([^>]*class="reel-sound"[^>]*)>([\s\S]*?)<\/button>/);
        let sound = null;
        if (soundMarkup) {
            sound = new Element('button', attributes(soundMarkup[1]), screen);
            sound.hidden = /\bhidden\b/.test(soundMarkup[1]);
            const label = new Element('span', { class: 'reel-sound-label' }, sound);
            label.textContent = soundMarkup[2].match(/class="reel-sound-label"[^>]*>([^<]*)/)?.[1].trim() || '';
            const icon = new Element('span', { class: 'reel-sound-icon' }, sound);
            new Element('i', { class: 'fas fa-volume-xmark' }, icon);
        }
        const caption = new Element('div', { class: 'reel-caption' }, card);
        cards.push(card); videos.push(video); overlays.push(overlay); captions.push(caption); sounds.push(sound);
    }
    const navigation = new Element('div', { class: 'reels-navigation' }, carousel);
    navigation.hidden = true;
    const previous = new Element('button', { 'data-reel-step': '-1' }, navigation);
    const status = new Element('p', { class: 'reels-status' }, navigation);
    const next = new Element('button', { 'data-reel-step': '1' }, navigation);
    const selectors = [0, 1, 2].map(i => new Element('button', { 'data-reel-index': String(i) }, navigation));
    const error = new Element('p', { class: 'reels-error' }, navigation);
    error.hidden = true;
    document.querySelector = selector => options.absent ? null : selector === '.reels-carousel' ? carousel : null;
    document.addEventListener = (name, listener) => {
        if (!document.listeners.has(name)) document.listeners.set(name, []);
        document.listeners.get(name).push(listener);
    };
    const window = {};
    class Observer {
        constructor(callback, config) { this.callback = callback; this.config = config; observers.push(this); }
        observe(element) { this.element = element; }
    }
    if (options.observer !== false) window.IntersectionObserver = Observer;
    vm.runInNewContext(source, { document, window, performance: { now: () => now }, IntersectionObserver: Observer }, { filename: 'phone-reels.js' });
    return {
        carousel, stage, cards, videos, overlays, captions, sounds, navigation, previous, next, selectors, status, error, document, observers,
        advance(milliseconds = 1000) { now += milliseconds; },
        fulfillPlay(index) { videos[index].pendingPlayback.shift()?.(); },
        visible(value, ratio = value ? 1 : 0) {
            for (const observer of observers) observer.callback([{ target: stage, isIntersecting: value, intersectionRatio: ratio }]);
        },
        hideDocument(value) {
            document.hidden = value;
            for (const listener of document.listeners.get('visibilitychange') || []) listener();
        },
        swipe(dx, dy = 0, extra = {}) {
            stage.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 300, target: videos[0], ...extra });
            return stage.dispatch('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 200 + dx, clientY: 300 + dy, target: videos[0] });
        }
    };
}

test('three unique native videos retain controls, muted looping and lightweight initial loading', () => {
    assert.equal(reelMarkup.length, 3);
    const sources = [];
    const posters = [];
    for (const match of reelMarkup) {
        const card = attributes(match[1]);
        const raw = match[2].match(/<video\b([^>]*)>/)[1];
        const video = attributes(raw);
        const media = attributes(match[2].match(/<source\b([^>]*)>/)[1]);
        assert.equal(card.role, 'group');
        assert.ok(card['aria-label']);
        assert.ok(video['aria-label']);
        assert.equal(video.preload, 'none');
        for (const attribute of ['controls', 'muted', 'playsinline', 'loop']) assert.match(raw, new RegExp('\\b' + attribute + '\\b'));
        assert.doesNotMatch(raw, /\bautoplay\b/i, 'Autoplay is managed for the selected reel, not all three static videos');
        assert.equal(media.type, 'video/mp4');
        assert.match(media.src, /^asset\/price-match\/web\/.+\.mp4$/);
        sources.push(media.src); posters.push(video.poster);
        assert.ok(match[2].includes(`href="${media.src}"`), 'Direct file fallback exists');
    }
    assert.equal(new Set(sources).size, 3);
    assert.equal(new Set(posters).size, 3);
    for (const files of [sources, posters]) {
        const hashes = files.map(file => {
            const data = fs.readFileSync(path.join(root, file));
            assert.ok(data.length > 0, 'Media asset is non-empty');
            return crypto.createHash('sha256').update(data).digest('hex');
        });
        assert.equal(new Set(hashes).size, 3, 'No duplicate content disguised as another reel');
    }
    // Uploaded, untracked source clips need not be shipped with browser-ready derivatives.
    for (const original of ['asset/price-match/app-demo.mov', 'asset/price-match/app-demo.mp4', 'asset/profile/app-demo.mp4']) {
        assert.ok(fs.existsSync(path.join(root, original)), 'Original retained: ' + original);
    }
});

test('index keeps one demo anchor and loads the replacement without obsolete demo code', () => {
    const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.filter(id => id === 'demo').length, 1);
    assert.equal((html.match(/href="phone-reels.css\?v=6"/g) || []).length, 1);
    assert.equal((html.match(/src="phone-reels.js\?v=6"/g) || []).length, 1);
    assert.match(html, /<script src="phone-reels.js\?v=6" defer>/);
    for (const obsolete of ['demoVideo', 'demoDevice', 'updateDemoAnimation', '.demo-section', '.demo-device', '.video-shell', '.sound-btn']) assert.ok(!html.includes(obsolete), 'Obsolete demo implementation: ' + obsolete);
    assert.doesNotMatch(source, /\bset(?:Interval|Timeout)\s*\(|addEventListener\(\s*["']wheel/);
});

test('all three reels retain the original titanium phone structure', () => {
    for (const match of reelMarkup) {
        for (const detail of ['reel-island', 'reel-action', 'reel-volume-up', 'reel-volume-down', 'reel-power', 'reel-home-bar', 'reel-glare', 'reel-glow', 'reel-reflection']) {
            assert.ok(match[2].includes(detail), 'Missing phone detail: ' + detail);
        }
    }
    assert.match(css, /border-radius:\s*52px/);
    assert.match(css, /inset:\s*13px/);
    assert.match(css, /#d4d4d8 0%, #a1a1aa 18%, #52525b 42%/);
    assert.doesNotMatch(html, /reel-speaker|reel-side-button/);
});

test('static fallback keeps all controls available and reduced motion disables reel animations', () => {
    assert.match(html, /class="reels-navigation" hidden/);
    assert.equal((html.match(/class="reel-select"[^>]*hidden/g) || []).length, 3);
    assert.match(css, /\.reels-stage\s*\{[^}]*overflow-x:\s*auto;/);
    assert.match(css, /\.reel-screen video\s*\{[^}]*object-fit:\s*cover;/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(reduced, /animation:\s*none\s*!important/);
    assert.match(reduced, /transition:\s*none\s*!important/);
    assert.match(reduced, /scroll-behavior:\s*auto\s*!important/);
    assert.match(css, /touch-action:\s*pan-y pinch-zoom/);
    assert.match(css, /:focus-visible/);
});

test('enhanced carousel disables fallback scrolling and snap offsets', () => {
    const stageRule = css.match(/\.is-enhanced \.reels-stage\s*\{([^}]*)\}/);
    assert.ok(stageRule, 'Enhanced stage has an explicit layout rule');
    assert.match(stageRule[1], /\boverflow:\s*clip\s*;/);
    assert.match(stageRule[1], /\bscroll-snap-type:\s*none\s*;/);
    // Leave room for wrapping captions at laptop/tablet widths inside the clipped stage.
    assert.match(stageRule[1], /height:\s*calc\(var\(--reel-width\)\s*\*\s*2\.168\s*\+\s*196px\)/);
});

test('videos fill the phone without padding or additional sizing controls and explanation', () => {
    assert.doesNotMatch(html, /data-reel-fit|data-video-fit|reels-sizing|Fill screen|Fit entire video/);
    assert.doesNotMatch(source, /sizingButtons|data-reel-fit|videoFit|reels-sizing/);
    assert.doesNotMatch(css, /data-video-fit|reels-sizing|object-fit:\s*contain/);
    assert.match(css, /\.reel-screen video\s*\{[^}]*object-fit:\s*cover;/);
    const videoRules = Array.from(css.matchAll(/\bvideo\s*\{([^}]*)\}/g), match => match[1]);
    assert.ok(videoRules.length > 0);
    for (const rule of videoRules) {
        for (const padding of rule.matchAll(/\bpadding(?:-(?:top|right|bottom|left))?\s*:\s*([^;}]*)/g)) {
            assert.match(padding[1].trim(), /^0(?:px)?$/, 'Video has no artificial display inset');
        }
    }
});

test('captions have no visible duration links and selection works without caption anchors', () => {
    assert.doesNotMatch(html, /reel-file-link|Open video\s*·/);
    assert.doesNotMatch(css, /reel-file-link/);
    assert.doesNotMatch(source, /caption\.querySelector\(["']a["']\)/);
    for (const match of reelMarkup) {
        const caption = match[2].match(/<div\b[^>]*class="reel-caption"[^>]*>([\s\S]*?)<\/div>/);
        assert.ok(caption);
        assert.doesNotMatch(caption[1], /<a\b/);
        assert.match(match[2], /<video\b[^>]*>[\s\S]*?<a\b/, 'Native unsupported-video fallback remains available');
    }
    const app = boot();
    app.visible(true);
    app.next.click();
    assert.equal(app.cards[1].dataset.position, 'active');
    assert.equal(app.videos[1].playCalls, 1);
    assert.ok(app.captions.every(caption => caption.querySelector('a') === null));
});

test('initial enhancement waits for stage visibility and requests only selected metadata', () => {
    const app = boot();
    assert.equal(app.carousel.classList.contains('is-enhanced'), true);
    assert.equal(app.navigation.hidden, false);
    assert.deepEqual(app.cards.map(card => card.dataset.position), ['active', 'next', 'previous']);
    assert.deepEqual(app.videos.map(video => video.preload), ['metadata', 'none', 'none']);
    assert.deepEqual(app.videos.map(video => video.loadCalls), [1, 0, 0]);
    assert.ok(app.videos.every(video => video.paused && video.playCalls === 0));
    assert.deepEqual(app.videos.map(video => video.controls), [true, false, false]);
    assert.deepEqual(app.videos.map(video => video.tabIndex), [0, -1, -1]);
    assert.deepEqual(app.selectors.map(button => button.getAttribute('aria-pressed')), ['true', 'false', 'false']);
    assert.match(app.status.textContent, /^Video 1 of 3/);
    assert.deepEqual(app.sounds.map(button => button.hidden), [false, true, true]);
});

test('each reel has an accessible sound toggle that is selected-only and reflects native volume changes', () => {
    for (const match of reelMarkup) {
        const button = match[2].match(/<button\b([^>]*class="reel-sound"[^>]*)>([\s\S]*?)<\/button>/);
        assert.ok(button, 'Every phone retains a dedicated sound button');
        assert.equal(attributes(button[1]).type, 'button');
        assert.equal(attributes(button[1])['aria-pressed'], 'false');
        assert.match(button[1], /\bhidden\b/, 'Custom controls remain hidden without enhancement');
        assert.match(button[2], /class="reel-sound-label"[^>]*>Tap to unmute/);
        assert.match(button[2], /class="reel-sound-icon"/);
    }
    const app = boot();
    app.visible(true);
    const video = app.videos[0], button = app.sounds[0];
    assert.equal(video.muted, true);
    button.click();
    assert.equal(video.muted, false);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.doesNotMatch(button.querySelector('.reel-sound-label').textContent, /unmute/i);
    video.muted = true;
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.match(button.querySelector('.reel-sound-label').textContent, /Tap to unmute/);
    video.muted = false;
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    const nativeKey = app.carousel.dispatch('keydown', { target: button, key: 'ArrowRight' });
    assert.equal(nativeKey.prevented, false, 'Sound buttons do not trigger reel navigation');
    app.next.click();
    assert.deepEqual(app.sounds.map(control => control.hidden), [true, false, true]);
    app.previous.click();
    assert.equal(video.muted, true, 'Re-selecting a reel never brings back unexpected audio');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
});

test('only the visible selected reel muted-autoplays at the stage observer threshold', () => {
    const app = boot();
    assert.equal(app.observers.length, 1);
    assert.equal(app.observers[0].element, app.stage);
    assert.equal(app.observers[0].config.threshold, 0.25);
    app.visible(true, 0.1);
    assert.ok(app.videos.every(video => video.paused && video.playCalls === 0));
    app.visible(true, 0.25);
    assert.deepEqual(app.videos.map(video => video.playCalls), [1, 0, 0]);
    assert.deepEqual(app.videos.map(video => video.paused), [false, true, true]);
    assert.equal(app.videos[0].muted, true);
    app.videos[1].muted = false;
    app.next.click();
    assert.deepEqual(app.videos.map(video => video.paused), [true, false, true]);
    assert.equal(app.videos[1].muted, true, 'A newly selected reel always starts muted');
    app.visible(false);
    assert.ok(app.videos.every(video => video.paused));
    app.next.click();
    assert.equal(app.videos[2].playCalls, 0, 'Offscreen navigation cannot autoplay');
    app.visible(true);
    assert.equal(app.videos[2].playCalls, 1);
    assert.ok(app.videos.slice(0, 2).every(video => video.paused));
});

test('arrows wrap across exactly three reels and do not repeatedly reload visited media', () => {
    const app = boot();
    app.next.click();
    assert.equal(app.cards[1].dataset.position, 'active');
    app.next.click();
    assert.equal(app.cards[2].dataset.position, 'active');
    app.next.click();
    assert.equal(app.cards[0].dataset.position, 'active');
    app.previous.click();
    assert.equal(app.cards[2].dataset.position, 'active');
    assert.deepEqual(app.videos.map(video => video.loadCalls), [1, 1, 1]);
    assert.ok(app.videos.every(video => video.paused && video.playCalls === 0));
});

test('picker and inactive-phone activation update state and preserve keyboard focus', () => {
    const app = boot();
    app.selectors[1].click();
    assert.equal(app.cards[1].dataset.position, 'active');
    assert.equal(app.overlays[1].hidden, true);
    assert.equal(app.captions[0].getAttribute('aria-hidden'), 'true');
    assert.equal(app.captions[0].querySelector('a'), null);
    app.overlays[2].click();
    assert.equal(app.cards[2].dataset.position, 'active');
    assert.equal(app.overlays[2].hidden, true);
    assert.equal(app.document.activeElement, app.selectors[2], 'Focus does not stay on a newly hidden selector');
    assert.match(app.status.textContent, /Explore tool prices/);
});

test('navigation keyboard shortcuts work while native video arrow keys remain untouched', () => {
    const app = boot();
    const event = app.carousel.dispatch('keydown', { target: app.selectors[0], key: 'ArrowRight' });
    assert.equal(event.prevented, true);
    assert.equal(app.cards[1].dataset.position, 'active');
    app.carousel.dispatch('keydown', { target: app.next, key: 'End' });
    assert.equal(app.cards[2].dataset.position, 'active');
    app.carousel.dispatch('keydown', { target: app.previous, key: 'Home' });
    assert.equal(app.cards[0].dataset.position, 'active');
    const native = app.carousel.dispatch('keydown', { target: app.videos[0], key: 'ArrowRight' });
    assert.equal(native.prevented, false);
    assert.equal(app.cards[0].dataset.position, 'active');
    app.carousel.dispatch('keydown', { target: app.overlays[1], key: 'ArrowLeft' });
    assert.equal(app.cards[2].dataset.position, 'active');
    assert.equal(app.document.activeElement, app.selectors[2]);
});

test('deliberate touch swipes select one reel and ignore small or vertical movements', () => {
    const app = boot();
    app.advance(); app.swipe(-20);
    assert.equal(app.cards[0].dataset.position, 'active');
    app.swipe(-100, 250);
    assert.equal(app.cards[0].dataset.position, 'active');
    const horizontal = app.swipe(-110);
    assert.equal(horizontal.prevented, false);
    assert.equal(app.cards[1].dataset.position, 'active');
    app.swipe(-110);
    assert.equal(app.cards[1].dataset.position, 'active', 'Rapid successive gestures do not race past the desired reel');
    app.advance(); app.swipe(110);
    assert.equal(app.cards[0].dataset.position, 'active');
    app.advance(); app.swipe(-110, 0, { pointerType: 'mouse' });
    assert.equal(app.cards[0].dataset.position, 'active');
});

test('native bottom-of-video controls, selector buttons and cancelled gestures never cause a swipe', () => {
    const app = boot(); app.advance();
    app.swipe(-110, 0, { clientY: 790 });
    assert.equal(app.cards[0].dataset.position, 'active');
    app.swipe(-110, 0, { target: app.overlays[1] });
    assert.equal(app.cards[0].dataset.position, 'active');
    app.stage.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 300, target: app.videos[0] });
    app.stage.dispatch('pointercancel');
    app.stage.dispatch('pointerup', { pointerId: 1, clientX: 50, clientY: 300 });
    assert.equal(app.cards[0].dataset.position, 'active');
});

test('visible selection autoplays only the active video and switching pauses the previous video', () => {
    const app = boot();
    app.visible(true);
    assert.equal(app.videos[0].paused, false);
    assert.ok(app.videos.slice(1).every(video => video.paused));
    app.next.click();
    assert.equal(app.videos[0].paused, true);
    assert.equal(app.videos[1].playCalls, 1);
    app.videos[0].play();
    assert.equal(app.videos[0].paused, true, 'An inactive video cannot continue playing');
    app.videos[1].play();
    assert.equal(app.videos[1].paused, false);
    assert.ok([app.videos[0], app.videos[2]].every(video => video.paused));
    app.selectors[2].click(); app.selectors[0].click(); app.selectors[1].click();
    assert.deepEqual(app.videos.map(video => video.paused), [true, false, true], 'Rapid selections still leave exactly one active player');
});

test('offscreen and background playback pause, while programmatic pauses permit visible resume', () => {
    const app = boot();
    app.visible(true); app.visible(false);
    assert.ok(app.videos.every(video => video.paused));
    app.visible(true);
    assert.equal(app.videos[0].playCalls, 2);
    assert.equal(app.videos[0].paused, false);
    app.hideDocument(true);
    assert.ok(app.videos.every(video => video.paused));
    app.next.click();
    assert.equal(app.videos[1].playCalls, 0, 'Selecting while the tab is hidden cannot autoplay');
    app.hideDocument(false);
    assert.equal(app.videos[1].playCalls, 1);
    assert.equal(app.videos[1].paused, false);
    app.visible(false); app.hideDocument(true); app.hideDocument(false);
    assert.equal(app.videos[1].playCalls, 1, 'Returning to a tab cannot start an offscreen reel');
    const fallback = boot({ observer: false });
    assert.equal(fallback.videos[0].playCalls, 1, 'Without IntersectionObserver the selected reel remains usable');
    assert.equal(fallback.videos[0].muted, true);
    fallback.hideDocument(true);
    assert.equal(fallback.videos[0].paused, true);
    fallback.hideDocument(false);
    assert.equal(fallback.videos[0].playCalls, 2);
    const hiddenFallback = boot({ observer: false, documentHidden: true });
    assert.ok(hiddenFallback.videos.every(video => video.playCalls === 0));
});

test('manual native pause survives viewport and tab changes until explicit playback or selection', () => {
    const app = boot();
    app.visible(true);
    app.videos[0].pause();
    assert.equal(app.sounds[0].dataset.playing, 'false');
    app.visible(false); app.visible(true);
    app.hideDocument(true); app.hideDocument(false);
    assert.equal(app.videos[0].playCalls, 1, 'Manual pause is not treated as an offscreen programmatic pause');
    assert.equal(app.videos[0].paused, true);
    app.selectors[0].click();
    assert.equal(app.videos[0].playCalls, 2, 'Choosing the reel again is explicit intent to resume');
    app.videos[0].pause();
    app.sounds[0].click();
    assert.equal(app.videos[0].playCalls, 3);
    assert.equal(app.videos[0].paused, false);
    assert.equal(app.videos[0].muted, false);
    assert.equal(app.sounds[0].dataset.playing, 'true');
    app.videos[0].pause();
    app.videos[0].play();
    app.visible(false); app.visible(true);
    assert.equal(app.videos[0].paused, false, 'Native Play also clears the manual-pause preference');
});

test('browser autoplay rejection keeps native controls available without claiming playback', async () => {
    const app = boot({ rejectPlay: true });
    app.visible(true);
    await Promise.resolve();
    assert.equal(app.videos[0].playCalls, 1);
    assert.equal(app.videos[0].paused, true);
    assert.equal(app.videos[0].controls, true);
    assert.equal(app.sounds[0].dataset.playing, 'false');
    assert.equal(app.error.hidden, true, 'A browser autoplay block is not a media-load failure');
    app.sounds[0].click();
    await Promise.resolve();
    assert.equal(app.videos[0].paused, true);
    assert.equal(app.sounds[0].dataset.playing, 'false');
    app.videos[0].rejectPlay = false;
    await app.videos[0].play();
    assert.equal(app.videos[0].paused, false);
    assert.equal(app.sounds[0].dataset.playing, 'true');
});

test('a delayed play event from a previous selection cannot revive an inactive or hidden reel', async () => {
    const app = boot({ deferPlay: true });
    app.visible(true);
    app.next.click();
    app.fulfillPlay(0);
    await Promise.resolve();
    assert.equal(app.videos[0].paused, true, 'A stale autoplay request is paused when it eventually starts');
    app.fulfillPlay(1);
    await Promise.resolve();
    assert.deepEqual(app.videos.map(video => video.paused), [true, false, true]);
    app.next.click();
    app.hideDocument(true);
    app.fulfillPlay(2);
    await Promise.resolve();
    assert.ok(app.videos.every(video => video.paused), 'Deferred media must still respect current tab visibility');
});

test('media failures display refresh or selection recovery guidance only for the active reel', () => {
    const app = boot();
    app.videos[1].dispatch('error');
    assert.equal(app.error.hidden, true);
    app.videos[0].dispatch('error');
    assert.equal(app.error.hidden, false);
    assert.match(app.error.textContent, /Refresh the page or choose another video/);
    app.next.click();
    assert.equal(app.error.hidden, true);
});

test('missing or incomplete carousel markup exits without breaking the native fallback', () => {
    assert.doesNotThrow(() => boot({ absent: true }));
    const app = boot({ cardCount: 2 });
    assert.equal(app.carousel.classList.contains('is-enhanced'), false);
    assert.equal(app.navigation.hidden, true);
    assert.ok(app.videos.every(video => video.controls && video.preload === 'none'));
});
