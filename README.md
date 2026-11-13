# Margin: handwritten notes for iPad + Apple Pencil

A free, self-hosted note-taking web app. Your notes are stored only on your device, in the browser's storage. There's no account and no cloud.

**Features:** folders and subfolders · lined / grid / dotted / blank paper with adjustable spacing, line strength and 4 colours · fountain pen (pressure-sensitive) and ballpoint · highlighter (sits under ink) · precise or whole-stroke eraser · lasso to select, move, recolour, duplicate or delete · typed text boxes · import PDFs and images to annotate · export any note as a PDF · undo/redo · pinch-zoom · palm rejection · backup & restore.

## Files
```
index.html            the whole app
lib/                  PDF reader (pdf.js). Needed for importing PDFs
sw.js                 makes the app work offline (HTTPS only)
manifest.webmanifest  + icons: Home Screen app icon/name
```
Keep them together in one folder.

---

## Option A: GitHub Pages (recommended, free)
Gives you an `https://` address, so the app works offline from your Home Screen, anywhere.

1. Create a free account at github.com → **New repository** → name it `margin` → **Public** → Create.
2. Click **uploading an existing file**, drag in **everything in this folder** (including the `lib` folder) → **Commit changes**.
3. Go to **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` / `(root)` → Save.
4. After ~1 minute your app is at `https://YOUR-USERNAME.github.io/margin/`.

The code is public, but **your notes are not**. Notes never leave your iPad.

## Option B: Host it on your own computer (same Wi-Fi)
On a Mac, open Terminal in this folder and run:
```
python3 -m http.server 8000
```
Find your Mac's IP (System Settings → Wi-Fi → Details), then on the iPad open `http://192.168.x.x:8000`.

Limits of plain `http://`: the app won't open when your computer is off, and offline mode is disabled. Your notes still save on the iPad.

> Opening `index.html` directly from the Files app won't work. Browsers block the PDF reader on `file://` pages. Use A or B.

---

## Install on iPad
1. Open the address in **Safari** → Share button → **Add to Home Screen**.
2. Launch it from the icon. It runs full-screen like a normal app.

**Use it from the Home Screen icon.** Safari can clear storage for websites you haven't visited in 7 days, but Home Screen web apps are exempt. Your notes are also tied to the exact address you used, so stick to one.

## Using it
- **Pencil draws, fingers scroll.** One finger scrolls (with momentum). Two fingers pinch-zoom. If your palm scrolls the page as the Pencil lands, the scroll is undone. No Pencil? Turn on *Draw with finger* in ⋯ or Settings.
- Tap the active pen or highlighter again for more colours. The rainbow swatch picks any custom colour. The slider button sets an exact size.
- **Lasso:** circle ink or text, then drag inside the dashed box to move it. The black bar offers Colour, Duplicate and Delete.
- **Text:** pick the T tool and tap the page. The colour and size buttons style it.
- **⋯ menu:** page style (template, line spacing / square size / dot spacing, line strength and paper colour, for this page or all pages, with a live preview), insert a PDF or image, duplicate or delete a page, fit to width, export as PDF.
- Keyboard (Magic Keyboard / Mac): P H E L T switch tools, ⌘Z / ⇧⌘Z undo/redo, ⌘+ / ⌘− / ⌘0 zoom, Delete removes a selection.

## Getting PDFs and images in
iPadOS doesn't let web apps appear in the Share sheet (only native apps can). Margin offers these instead:
- **Import → Choose from Files…**: pick one or more PDFs or images. Margin asks whether to make a **new note** or **add the pages to an existing note**.
- **Drag and drop:** open Files, Mail, Photos or Safari next to Margin (Split View, Slide Over or Stage Manager) and drag a PDF or image across.
  - Dropped on the library, Margin asks new or existing.
  - Dropped on a note's thumbnail, it goes straight into that note.
  - Dropped inside an open note, it's added after the current page.
- **Paste:** copy an image (or a PDF, where the app allows it), then use **Import → Paste** or **⋯ → Paste image or PDF** in a note. With a keyboard, ⌘V works too.
- **Android / desktop Chrome:** once installed, Margin *does* appear in the Share sheet and asks new or existing.

## Back up your notes
Settings (gear) → **Export** saves everything in one `.json` file. Save it to Files or iCloud Drive. **Import** restores it, even on another device.

## Updating the app
Replace the files, and change `VERSION` in `sw.js` (e.g. `margin-v2`) so devices fetch the new version. Your notes aren't touched.
