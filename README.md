# LR-007 — Lunar Site Navigator

Explore lunar landing locations for sunlight and direct Earth visibility. Built incrementally, with scientific validation before 3D polish.

## Milestone 1: interface foundation

Implemented: coordinate and UTC inputs, immediate selected-observer updates, range validation and a responsive dashboard. NASA calculations, terrain modelling, 3D, timelines and comparisons are not implemented yet. The initial location (89° south, 0° east) is an illustrative coordinate, not a certified landing site.

## Run locally

Requires Node.js 20.19+ or 22.12+ (Node 24 is suitable).

```sh
npm install
npm run dev
```

`npm install` downloads the dependencies described in `package.json`; the lockfile records their exact versions. `npm run dev` starts Vite, which prints the local browser address. Keep that terminal running; Ctrl+C stops it.

```sh
npm run build
```

This checks that Vite can compile the app and writes the browser-ready files to `dist/`. A successful build does not validate astronomy or browser interactions.

## How the files connect

1. `index.html` supplies the `root` element and loads `src/main.jsx`.
2. `src/main.jsx` mounts the React application and loads the stylesheet.
3. `src/App.jsx` stores latitude, longitude and time using `useState`.
4. Editing an input calls its setter. React renders the interface again with the new value, updating the selected-observer panel.
5. `src/styles.css` controls the appearance and narrow-screen layout.

Input values stay as strings while typing so an empty input is not silently converted to zero. Latitude must be −90 to +90 degrees; longitude must be −180 to +180 degrees, east positive. The datetime control deliberately accepts UTC wall-clock text. Its initial value is taken from `toISOString()`, which uses UTC. Do not parse this input as local time when adding the backend: construct an explicit UTC timestamp.

## Manual verification

- Change latitude to −85.5 and longitude to 30: the selection must show those values.
- Enter latitude 91 or clear a coordinate: a range message must appear and that selection must show a dash.
- Change UTC time: the same time must appear in the selection, with no local timezone shift.
- Reduce the browser width: panels must stack and inputs remain usable.
- Sun and Earth values must remain dashes until the real data connection is implemented.

## Next milestone (requires approval)

Connect a backend to NASA/JPL Horizons for Sun (10) and Earth (399), observed from a lunar surface coordinate on body 301. Request quantity 4 (apparent azimuth and elevation). Explicitly validate UTC handling, coordinate order, east-positive longitude and output parsing. Compare one result with the official Horizons interface using identical settings.

Elevation above an ideal local horizon is not a terrain-shadow calculation or proof of a working communication link. Terrain, angular disk sizes, link budgets and sampled visibility windows need separate treatment.

References: [Vite guide](https://vite.dev/guide/), [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html).

## Milestone 2: local backend connection

Requires Python 3.10 or later; no Python packages need installing.

Open a second terminal in the repository and run:

```sh
python3 backend/server.py
```

Keep both this terminal and `npm run dev` running. Restart Vite once after adding `vite.config.js` (Ctrl+C, then `npm run dev`) so it loads the new proxy configuration. In the dashboard, press **Check backend connection**.

The request path is: browser → Vite `/api/health` proxy → Python on port 8000 → JSON response → React connection state. The backend returns `{"status": "ok", "service": "lunar-navigator-api"}`. React checks both the HTTP status and this response shape, then displays success or an error. A five-second timeout prevents an indefinitely pending check. No coordinates or NASA requests are sent by this health check.

The button's state changes from idle to checking to connected or error. It is disabled while checking to prevent overlapping clicks. Connected means the last check succeeded, not continuous monitoring.

### Verify the connection

1. Start both servers and click the check button: expect **Backend connected**.
2. Stop Python with Ctrl+C and click again: expect a helpful error.
3. Restart Python and retry: expect recovery without reloading the page.
4. `http://127.0.0.1:8000/api/health` returns JSON directly. Unknown routes return a JSON 404.

The Python server is for local development and binds only to your own computer. The Vite proxy applies to `npm run dev`; a built static deployment will require separate backend routing.
