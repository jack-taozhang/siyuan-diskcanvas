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
| **Netdisk file** | Netdisk file | A file on NebulaDisk | Open with its previewer |
| **SiYuan note** | SiYuan note | A SiYuan document | Jump back to SiYuan |
| **SiYuan block** | SiYuan block | A block inside a note | Jump back to SiYuan |
| **Internal file** | Internal file | A SiYuan asset (image / PDF …) | Jump to its document and block |
| **Link** | — | A web address | Open in browser |
| **Group** | — | Frames related cards together | Collapse / expand |

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
npm run build      # output goes to ./dev
npm test           # unit tests (vitest)
```

## License

MIT
