# DiskCanvas

**English** · [简体中文](README_zh_CN.md)

> Spread netdisk files and SiYuan notes across an infinite canvas, then connect them with edges.

## What it solves

Your material usually lives in two places: **files on a NAS** (designs, documents, drawings)
and **notes in SiYuan**. To connect the dots you either juggle windows or hold the whole
picture in your head — you want to *spread it out and look at it*.

This plugin adds an infinite canvas to SiYuan:

- Drag **netdisk files** onto the canvas. Images, PDFs, Office files and drawings each use
  their own preview channel.
- Drag **SiYuan notes** (documents or blocks) and **SiYuan assets** onto the canvas too.
- Draw an **edge** between them and the relationship is recorded.

Under the hood it uses the open `.canvas` (JSON Canvas) format — plain JSON you can read and
move around.

## Card types

Each card shows its **kind** in the header (e.g. "Netdisk file"), with a small badge for the
finer type (`PDF` / `DWG` / `DOCUMENT`).

| Card | Header | Content | Double-click |
| --- | --- | --- | --- |
| **Text** | Text | Markdown written directly on the canvas | Edit |
| **Netdisk file** | Netdisk file | A file on NebulaDisk | Open with its previewer ※ |
| **SiYuan note** | SiYuan note | A SiYuan document | Jump back to SiYuan |
| **SiYuan block** | SiYuan block | A block inside a note | Jump back to SiYuan |
| **Internal file** | Internal file | A SiYuan asset (image / PDF …) | Jump to its document and block |
| **Link** | — | A web address | Open in browser |
| **Group** | — | Frames related cards together | Collapse / expand |

> ※ When editing in a **standalone page** (see below), double-clicking a netdisk card opens the
> netdisk file **in its own browser page** instead. Everything else behaves the same.

> Note cards show only the **title and outline** by default, so the structure reads at a glance.

## Edges

- Drag from any of the four anchors on a card to create an edge
- Text labels ("references", "causes", "belongs to")
- Arrow direction: none / single / double
- Drag an endpoint onto another card to re-target; drop on empty space to delete
- **Solid or dashed** line style; colours from a 12-colour palette or a custom picker

## Canvas controls

| Action | Result |
| --- | --- |
| Click | Select |
| `Ctrl` / `Shift` + click | Multi-select |
| Drag card | Move |
| Drag edge / corner | Resize |
| Drag anchor | Create edge |
| Marquee on empty space | Batch select |
| **Right-drag** | **Pan** |
| **Middle-button double-click** | **Zoom to fit all content** |
| Wheel | Zoom around cursor (0.1x ~ 2.5x) |
| `Ctrl + Z` / `Ctrl + Shift + Z` | Undo / redo |

- The canvas **auto-saves** by default
- The toolbar has **Refresh** (reload the current canvas from disk) and **Export PNG**
  (with selectable range and background)

### Grid

The **Grid** button (right next to the palette button) adjusts the canvas reference grid on the fly:

| Setting | Values |
| --- | --- |
| Style | Hidden / Dots / Grid / Rows / Columns |
| Spacing | 16 / 24 / 32 / 48 px (world units; any value from 8–64 in the settings panel) |
| Snap to grid | On / off (cards land on grid lines when dragged, created, **or resized**) |

- The grid lives in **world space**: it scales with zoom and follows panning — it is a ruler,
  not a wallpaper
- Snapping targets the **edge being dragged / the drop point** (so cards snap even when they did not
  start on the grid); resizing still respects the minimum card size, and **alignment guides win
  over the grid** within 8 px
- It **hides itself** when the spacing drops below 4 px on screen (otherwise it turns into grey
  noise); the popover explains why
- Grid line colour follows the theme, so it adapts to light/dark automatically
- **A canvas preview embedded in a note shows no grid** — that is a reading surface, and the
  grid would fight the note's own line rhythm
- Also available under **Settings → Plugin → DiskCanvas**

## Standalone page editing

The rightmost toolbar button (**just after Help**) is **Open in standalone page**: it puts the
current canvas file into its own browser tab for editing, **without SiYuan's UI around it**.

- The URL looks like `/plugins/siyuan-diskcanvas/standalone.html?path=<canvas path>`
- **Rendering is identical to SiYuan** — it is not "a simpler renderer", it is the **same
  component code** (`CanvasWorkspace` is shared by the tab, the embed preview, and this page).
  On startup the page pulls SiYuan's own base stylesheet, theme stylesheet and enabled CSS
  snippets from the kernel, and reuses the same plugin settings — so colours, fonts and card
  details line up.
- Editing, saving, undo, zoom, edges, palette and shortcuts all work; it writes the same
  `.canvas` file
- In the standalone page, **double-clicking a netdisk card opens that file in its own browser
  page** (the URL is produced by the netdisk side according to file type: direct link for native
  types, online preview for Office/archives, CAD viewer for drawings)

> Requires netdisk plugin **1.0.4 or newer** (the `webUrl` contract method). Older versions get a
> clear error instead of failing silently.

## Relationship to the netdisk plugin

**The canvas does not configure a netdisk connection of its own.**

The `siyuan-nebuladisk` plugin exposes an external contract via
`window.__nebuladiskPlugin.external` (`listMounts` / `list` / `stat` / `previewUrl` …).
The canvas consumes that contract:

- Once the netdisk plugin is signed in, the canvas just works — **no need to enter the address
  and credentials a second time in the canvas settings**
- Preview URLs are always constructed by the netdisk side; the canvas only forwards them,
  so internal addresses and signing logic never leak into the canvas

> That is why this plugin's settings panel has **no** netdisk section; if the netdisk is
> unavailable it says so explicitly.

## Drag files from the netdisk tree

Drag a file straight from the netdisk plugin's file tree onto the canvas to create a netdisk
file card. The drag payload is the netdisk plugin's `application/x-nebuladisk-embed` MIME;
each plugin lets through drags it does not recognise, so they never interfere.

## Built-in features

- **Search highlighting** — text matched by SiYuan's global search is highlighted on the canvas
- **Embedded preview** — embed a `.canvas` into a note as a **read-only preview block**
  (zoom and right-drag pan work; nothing is editable)
- **Palette** — 12 colours per theme, plus a custom colour picker
- **Line styles** — solid/dashed for cards, groups and edges

## Notes

- Follows the [obsidianmd/jsoncanvas](https://github.com/obsidianmd/jsoncanvas) open spec
- Unknown fields are preserved on save, keeping files interoperable with Obsidian
- Built on the **canvas kernel** of [famotime/siyuan-canvas](https://github.com/famotime/siyuan-canvas);
  the business layer has been rewritten

## Development

```bash
npm install
npm run build              # plugin + standalone page (outputs to ./dist)
npm run build:plugin       # plugin bundle only
npm run build:standalone   # standalone page only (standalone.html / .js / .css)
npm test                   # unit tests (vitest)
npm run verify             # contract checks + build + artifact gate + end-to-end
npm run check:template     # only the "undeclared identifier in template/script" gate
```

> The standalone page and the plugin bundle are **two builds into one output directory**:
> `build:plugin` empties `dist` and writes `index.js`, then `build:standalone` only adds files.
> The order matters — `check:standalone` guards it.

## License

MIT
