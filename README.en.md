# Floor Plan Interior Designer

[中文](README.md) | English

📘 **[Usage Guide (AI generator — upload a plan, get 2D/3D)](使用说明.md)** (Chinese)

A pure front-end tool for interior design on a floor plan: place furniture, remove or modify walls, and take measurements on a 2D plan, then switch to a Three.js 3D scene with one click — view it from above or walk through it in first person. The whole app is a single `index.html`: no build step, just open it.

## Features

**2D Floor Plan**
- Displays the original floor plan at 1:60 / 1:100 scale, dimensions in mm
- Drag 60+ furniture and appliance items from the library on the left (bedroom, living room, dining & kitchen, bathroom, appliances, study & leisure)
- Move, rotate (hold Shift for free angle), and resize items, with automatic snapping to walls
- Measuring tool (snaps to nearby walls; hold Shift to lock horizontal / vertical)
- Remove or modify non-load-bearing walls; load-bearing walls are marked separately
- Layer toggles: dimensions, room names, furniture, grid, load-bearing walls

**3D Scene**
- Bird's-eye, oblique, and top-down views; click a room in the list to fly to it
- Walkthrough mode: WASD + mouse on desktop, virtual joystick on touch devices; click doors to open / close them
- Toggle between full-height and cut-away walls, time-of-day sunlight slider, night lighting
- Detailed furniture models: cabinet door gaps and handles, upholstered headboards, metal and ceramic materials with environment reflections, and more
- Select and drag furniture in 3D as well, kept in sync with the 2D plan in real time

**Plans & Statistics**
- Automatic calculation of room areas and net usable floor area
- Change the floor material of each room (wood, tiles, marble, terrazzo, carpet, etc.), with cost estimates based on area plus 5% wastage
- Undo / redo; plans are auto-saved in the browser's local storage
- Chinese / English UI toggle (button on the right of the top bar; defaults to Chinese and remembers your choice)
- Export to PNG, export / import plans as JSON

## Quick Start

```bash
git clone <repository-url>
cd <repository-directory>
```

Then simply open `index.html` in your browser. Alternatively, start a local static server:

```bash
python3 -m http.server 8000
# Visit http://localhost:8000
```

> Three.js is loaded from the jsDelivr CDN, so an internet connection is required the first time you open the 3D scene.

## AI generator: upload a plan, get 2D / 3D (app.html)

`app.html` is the deliverable web entry: **upload a floor-plan image and an AI vision model parses it into walls, openings, rooms and furniture, then renders a CAD-style 2D drawing and an interactive 3D scene**. Both can be exported as PNG, and the plan can be downloaded as JSON (hand-editable and re-importable).

- Pure static site — deployable to any static host (GitHub Pages / Vercel / nginx)
- The AI endpoint is configured in the page (OpenAI-compatible; defaults to Zhipu `glm-4.5v`, any image-capable model works); the key never leaves the local browser
- If direct calls hit CORS: `node server.js` (zero dependencies) serves the site plus an `/api/proxy` passthrough
- Rendering engine lives in `plan-render.js` (`Plan2D` / `Plan3D` classes); sample data in `demo-plan.js`

```bash
python3 -m http.server 8000     # or: node server.js (with CORS proxy)
# http://localhost:8000/app.html        upload entry
# http://localhost:8000/app.html#demo   view the sample plan without a key
```

## Example: auto-generated 2D / 3D from a design drawing (design.html)

`design.html` is a standalone demo modeled on `doc/1.jpg` (a private-dining-room floor plan). The plan was reverse-parsed into data, and **opening the page automatically generates both a 2D drawing and a 3D animated scene** of the same layout:

- 2D: CAD-style plan (walls / openings / furniture / dimensions / title), zoom & pan with the wheel or drag, one-click export to 3200×2400 PNG
- 3D: Three.js scene with a fly-in intro and toggleable auto-rotate, free orbit / zoom with mouse or touch, PNG export
- Three.js is vendored into `lib/` so it works offline; pre-rendered 2D / 3D images are included in `doc/`

```bash
python3 -m http.server 8000
# http://localhost:8000/design.html        interactive page
# http://localhost:8000/design.html#3d     jump straight to the 3D scene
# http://localhost:8000/design.html#full   full-bleed 2D drawing mode
```

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `T` | Toggle 2D / 3D |
| `V` / `M` / `X` | Select / Measure / Modify walls |
| `R` / `Shift+R` | Rotate selected furniture 90° clockwise / counterclockwise |
| `Delete` / `Backspace` | Delete selected furniture |
| `Ctrl/⌘ + D` | Duplicate selected furniture |
| `Ctrl/⌘ + Z`, `Ctrl/⌘ + Shift + Z` | Undo, redo |
| `F` | Fit to window |
| `+` / `-` | Zoom in / out |
| `[` / `]` | Show / hide the furniture library (left) and the side panel (right) |
| `Shift + F` | Fullscreen |
| `Esc` | Cancel current action |
| Walkthrough: `WASD` / arrow keys, `Shift`, `E` | Move, walk faster, open / close doors |

## Tech Stack

- Vanilla HTML / CSS / JavaScript — no framework, no build step
- 2D floor plan rendered with SVG
- 3D scene built with [Three.js](https://threejs.org/) r160 (OrbitControls, PointerLockControls, RoundedBoxGeometry, RoomEnvironment, CSS2DRenderer)
- Data stored in `localStorage`

## Customizing the Floor Plan

The floor plan data lives in `index.html`:

- `ROOMS`: room polygons, names, and default floor materials
- `WALLS` / `WINS`: walls and window openings
- `MATS`: floor material names and unit prices
- `LIB`: furniture library (type, name, default size, color)
- `buildFurniture()`: 3D models for each furniture type

Edit this data to use your own floor plan.

## Social Media

- X (Twitter): [@akokoi1](https://x.com/akokoi1)

## License

[MIT](LICENSE)
