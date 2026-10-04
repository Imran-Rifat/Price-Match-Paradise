# App reel carousel

## Current website integration

This is a static HTML/CSS/JavaScript website, not a React application. The home
page's former single-video section is now an animated three-phone carousel.
No React, Tailwind, TypeScript, shadcn, or npm dependencies were installed.

- Markup and media descriptions: `index.html`, section `#demo`.
- Scoped styles and reduced-motion rules: `phone-reels.css`.
- Selection, keyboard, swipe, and playback lifecycle: `phone-reels.js`.
- Browser-ready MP4s and still-frame posters: `asset/price-match/web/`.

Use the numbered buttons, arrows, side phones, or a deliberate horizontal swipe.
The carousel does not switch slides automatically or intercept page scrolling.
Native video controls provide play, pause, volume, seeking, and fullscreen.
The selected video loops and autoplays muted when the section is visible. The
original-style Tap to unmute pill enables sound and can mute it again; native
volume controls remain synchronized. Switching reels starts the new video muted
and pauses the old one. Leaving the section or hiding the tab pauses playback;
returning resumes it unless the visitor deliberately paused with native controls.
Browsers that block autoplay retain a usable native play button.
Without JavaScript, all three videos remain playable in a horizontal list.

The three reels are the distinct recordings from `app-demo.mp4`,
`new.2(with sticker).mp4`, and `voice.mp4`. The existing MOV and profile copy
duplicate the first reel and are not repeated as extra slides. Originals are
unchanged. The web derivatives use H.264/AAC, 720-pixel width, and MP4 fast start;
the original phone shell is retained. Videos fill the entire display by default,
without artificial top padding. Recordings whose shape differs from the phone
may be zoomed/cropped to fill its display. Sizing buttons and separate Open video
links are intentionally omitted; native fullscreen remains available through the
video controls.

To add another reel, add its video, poster, description, and selector. The current
three-position carousel intentionally guards for three cards; extend that position
logic and its tests if adding more recordings.

## Optional React/shadcn setup (a separate project, not needed for this site)

The pasted `phone-mockups-1.tsx` is a wrapper for an image carousel. Its imported
`phone-mockups-1-utils/phone-carousel` implementation was not included. Copying the
wrapper and Button alone would not produce a working carousel or video support.
Stock Unsplash images would also not demonstrate this app.

If you choose to migrate later, create a separate project rather than running an
initializer over this static website:

```bash
npx create-next-app@latest price-match-react --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
cd price-match-react
npx shadcn@latest init
npx shadcn@latest add button
npm install @radix-ui/react-slot class-variance-authority
```

These TypeScript/Tailwind options are documented in the
[Next.js CLI reference](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
The initialization and Button commands follow the
[shadcn Next.js installation guide](https://ui.shadcn.com/docs/installation/next).

For that root-based layout, shared UI components belong in `components/ui/`,
global styles in `app/globals.css`, and class-name helpers in `lib/utils.ts`.
The `@/*` alias must resolve to the project root. If choosing a `src/` layout
instead, the corresponding paths become `src/components/ui/`,
`src/app/globals.css`, and `src/lib/utils.ts`.

`components/ui/` keeps shared primitives and the supplied import paths organized;
creating that directory by itself does not add React or a TypeScript build to an
HTML website.

After obtaining the missing utility, place it at
`components/ui/phone-mockups-1-utils/phone-carousel.tsx` and its wrapper at
`components/ui/phone-mockups-1.tsx`. Replace its image-only data contract with video
items containing `src`, `poster`, `title`, and `description`. Interactive carousel
code needs `"use client"`, local selection state, paused inactive videos,
keyboard/swipe controls, and reduced-motion handling. No global state provider or
API key is needed. Do not paste the demo image URLs into the production app reel.

## Validation

Run `node --test tests/*.test.cjs`. Preview over a local HTTP server and verify the
three selections, native playback/sound, keyboard navigation, mobile swiping,
ordinary vertical scrolling, and no page overflow. Commit and push only when
requested; deployment is handled separately by the site's existing workflow.
