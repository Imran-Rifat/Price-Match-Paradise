/* No framework, automatic slide switching, wheel interception, or hover selection. */
(() => {
    "use strict";
    const carousel = document.querySelector(".reels-carousel");
    if (!carousel) return;
    const cards = Array.from(carousel.querySelectorAll(".reel-card"));
    const videos = cards.map(card => card.querySelector("video"));
    const soundButtons = cards.map(card => card.querySelector(".reel-sound"));
    const selectors = Array.from(carousel.querySelectorAll("[data-reel-index]"));
    const stage = carousel.querySelector(".reels-stage");
    const status = carousel.querySelector(".reels-status");
    const error = carousel.querySelector(".reels-error");
    if (cards.length !== 3 || videos.some(video => !video) || !stage || !status) return;

    const names = ["Scan and compare", "Before you buy", "Explore tool prices"];
    let activeIndex = 0;
    let gesture = null;
    let lastNavigation = 0;
    let stageVisible = !("IntersectionObserver" in window);
    const manualPauses = new Set();
    const expectedPauses = new Set();

    function syncSound(index) {
        const button = soundButtons[index];
        if (!button) return;
        const video = videos[index];
        button.setAttribute("aria-pressed", String(!video.muted));
        button.setAttribute("aria-label", video.muted ? "Tap to unmute" : "Mute video");
        button.dataset.playing = String(!video.paused);
        button.querySelector(".reel-sound-label").textContent = video.muted ? "Tap to unmute" : "Sound on";
        button.querySelector("i").className = video.muted ? "fas fa-volume-xmark" : "fas fa-volume-high";
    }

    function pauseVideo(video) {
        if (video.paused) return;
        expectedPauses.add(video);
        video.pause();
    }

    function pauseAll(except) {
        videos.forEach(video => { if (video !== except) pauseVideo(video); });
    }

    function playSelected() {
        const video = videos[activeIndex];
        if (!stageVisible || document.hidden || manualPauses.has(video) || !video.paused) return;
        try {
            // Some browsers block autoplay; native play controls remain available.
            const playback = video.play();
            if (playback && typeof playback.catch === "function") playback.catch(() => {});
        } catch (_) { /* Keep the usable native controls if playback is unavailable. */ }
    }

    function select(index) {
        activeIndex = (index + cards.length) % cards.length;
        error.hidden = true;
        cards.forEach((card, i) => {
            const selected = i === activeIndex;
            const position = selected ? "active" : i === (activeIndex + 1) % cards.length ? "next" : "previous";
            card.dataset.position = position;
            videos[i].controls = selected;
            videos[i].tabIndex = selected ? 0 : -1;
            videos[i].setAttribute("aria-hidden", String(!selected));
            card.querySelector(".reel-select").hidden = selected;
            const caption = card.querySelector(".reel-caption");
            caption.setAttribute("aria-hidden", String(!selected));
            if (soundButtons[i]) soundButtons[i].hidden = !selected;
            if (!selected) pauseVideo(videos[i]);
            selectors[i].setAttribute("aria-pressed", String(selected));
        });
        status.textContent = "Video " + (activeIndex + 1) + " of " + cards.length + " · " + names[activeIndex];
        // Metadata is fetched only for reels the visitor selects. Other reels use posters.
        const selectedVideo = videos[activeIndex];
        // Every newly chosen reel starts quietly; sound is enabled only by a tap.
        selectedVideo.muted = true;
        manualPauses.delete(selectedVideo);
        if (selectedVideo.preload === "none") {
            selectedVideo.preload = "metadata";
            selectedVideo.load();
        }
        lastNavigation = performance.now();
        syncSound(activeIndex);
        playSelected();
    }

    carousel.classList.add("is-enhanced");
    carousel.querySelector(".reels-navigation").hidden = false;
    selectors.forEach(button => button.addEventListener("click", () => select(Number(button.dataset.reelIndex))));
    carousel.querySelectorAll("[data-reel-step]").forEach(button => {
        button.addEventListener("click", () => select(activeIndex + Number(button.dataset.reelStep)));
    });
    cards.forEach((card, i) => card.querySelector(".reel-select").addEventListener("click", () => {
        select(i);
        // Keep keyboard focus on a visible control after hiding the side-phone overlay.
        selectors[activeIndex].focus({ preventScroll: true });
    }));

    // Native video keyboard and scrubber controls keep their own arrow-key behavior.
    carousel.addEventListener("keydown", event => {
        if (!event.target.closest(".reels-navigation, .reel-select")) return;
        const indices = { ArrowLeft: activeIndex - 1, ArrowRight: activeIndex + 1, Home: 0, End: cards.length - 1 };
        if (!Object.hasOwn(indices, event.key)) return;
        event.preventDefault();
        select(indices[event.key]);
        if (event.target.closest(".reel-select")) selectors[activeIndex].focus();
    });

    // One intentional horizontal swipe per gesture. Vertical page scrolling is never blocked.
    stage.addEventListener("pointerdown", event => {
        if (!event.isPrimary || event.pointerType === "mouse" || event.target.closest("button, a")) return;
        const screen = event.target.closest(".reel-screen");
        // Do not treat native bottom-of-video seek/volume controls as carousel gestures.
        if (screen && event.clientY > screen.getBoundingClientRect().bottom - 64) return;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, { passive: true });
    stage.addEventListener("pointerup", event => {
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        gesture = null;
        if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5 || performance.now() - lastNavigation < 650) return;
        select(activeIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
    stage.addEventListener("pointercancel", () => { gesture = null; }, { passive: true });

    videos.forEach((video, i) => {
        video.addEventListener("play", () => {
            if (i !== activeIndex || document.hidden || !stageVisible) { pauseVideo(video); return; }
            manualPauses.delete(video);
            pauseAll(video);
            syncSound(i);
        });
        video.addEventListener("pause", () => {
            // A visitor's native Pause choice survives scrolling away and back.
            if (!expectedPauses.delete(video)) manualPauses.add(video);
            syncSound(i);
        });
        video.addEventListener("volumechange", () => syncSound(i));
        video.addEventListener("error", () => {
            if (i !== activeIndex) return;
            error.textContent = "This reel could not load. Refresh the page or choose another video.";
            error.hidden = false;
        });
        const soundButton = soundButtons[i];
        if (soundButton) soundButton.addEventListener("click", () => {
            if (i !== activeIndex) return;
            video.muted = !video.muted;
            syncSound(i);
            manualPauses.delete(video);
            playSelected();
        });
    });
    // Autoplay only the visible selected reel; never switch slides automatically.
    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                stageVisible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
                if (stageVisible) playSelected();
                else pauseAll();
            });
        }, { threshold: 0.25 });
        observer.observe(stage);
    }
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) pauseAll();
        else playSelected();
    });
    select(0);
})();
