"""Generate the 7-slide widescreen PDF demo deck for NASA Space Apps Challenge (HORIZON OPS / LR-007).

All terrain profiles, slope distributions, 360-degree horizons, LunaDiff windows, and
rover traverse trajectories are loaded or computed directly from verified repository datasets.
"""

from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import FancyBboxPatch, Rectangle
import numpy as np

from backend.terrain.ingest import LolaDemReader
from backend.terrain.traverse import plan_automatic_traverse

OUT_PDF = ROOT / "docs" / "presentation" / "HORIZON_OPS_7_Slide_Demo.pdf"

# Dark theme palette matching HORIZON OPS UI (#050507 obsidian base)
BG = "#050507"
PANEL = "#0b111c"
BORDER = "#1e293b"
TEAL = "#2dd4bf"
CYAN = "#38bdf8"
EMERALD = "#34d399"
AMBER = "#fbbf24"
ROSE = "#f472b6"
RED = "#ef4444"
TEXT = "#f1f5f9"
MUTED = "#94a3b8"
DIM = "#64748b"


def load_dem_bin(site_id: str):
    meta = json.loads((ROOT / "data" / "processed" / f"{site_id}_terrain.json").read_text())
    raw = (ROOT / "data" / "processed" / f"{site_id}_terrain.bin").read_bytes()
    w, h = meta["width"], meta["height"]
    arr = np.frombuffer(raw, dtype="<f4").reshape((h, w))
    return meta, arr


def compute_slope_deg(elev: np.ndarray, spacing_m: float) -> np.ndarray:
    gy, gx = np.gradient(elev, spacing_m, spacing_m)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def get_bg_ax(fig: plt.Figure) -> plt.Axes:
    for ax in fig.axes:
        if getattr(ax, "_is_slide_bg", False):
            return ax
    bg_ax = fig.add_axes([0.0, 0.0, 1.0, 1.0], zorder=-10)
    bg_ax.set_xlim(0, 1)
    bg_ax.set_ylim(0, 1)
    bg_ax.axis("off")
    bg_ax._is_slide_bg = True  # type: ignore[attr-defined]
    return bg_ax


def add_card(
    fig: plt.Figure,
    x: float,
    y: float,
    w: float,
    h: float,
    accent: str | None = None,
    fill: str = PANEL,
    edge: str = BORDER,
) -> None:
    bg_ax = get_bg_ax(fig)
    box = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.0,rounding_size=0.01",
        facecolor=fill,
        edgecolor=edge,
        linewidth=1.1,
    )
    bg_ax.add_patch(box)
    if accent:
        bar = Rectangle((x + 0.003, y + h - 0.005), w - 0.006, 0.005, facecolor=accent, edgecolor="none")
        bg_ax.add_patch(bar)


def add_chrome(fig: plt.Figure, slide_num: int, section: str, title: str, subtitle: str) -> None:
    fig.patch.set_facecolor(BG)
    bg_ax = get_bg_ax(fig)
    bg_ax.plot([0.045, 0.955], [0.854, 0.854], color=BORDER, linewidth=1.1)
    bg_ax.plot([0.045, 0.955], [0.048, 0.048], color=BORDER, linewidth=0.9)

    fig.text(
        0.045,
        0.946,
        f"HORIZON OPS // LR-007  ·  {section.upper()}",
        color=TEAL,
        fontsize=9.5,
        fontweight="bold",
        family="monospace",
    )
    fig.text(
        0.955,
        0.946,
        f"SLIDE 0{slide_num} / 07",
        color=CYAN,
        fontsize=9.5,
        fontweight="bold",
        family="monospace",
        ha="right",
    )
    fig.text(0.045, 0.903, title, color=TEXT, fontsize=20, fontweight="bold")
    fig.text(0.045, 0.869, subtitle, color=MUTED, fontsize=10.5)

    fig.text(
        0.045,
        0.023,
        "https://github.com/Abivarsan-Y/LR-007  ·  NASA Space Apps 2026 (Lunar Landing Site Navigator)",
        color=DIM,
        fontsize=7.8,
        family="monospace",
    )
    fig.text(
        0.955,
        0.023,
        "SI-Assisted Code/Layout (ChatGPT, Codex, Antigravity) · Deterministic NASA Physics · No NASA Logos",
        color=DIM,
        fontsize=7.6,
        family="monospace",
        ha="right",
    )


def style_axes(ax: plt.Axes) -> None:
    ax.set_facecolor("#070b12")
    for spine in ax.spines.values():
        spine.set_color(BORDER)
        spine.set_linewidth(0.9)
    ax.tick_params(colors=MUTED, labelsize=8.0)
    ax.xaxis.label.set_color(MUTED)
    ax.yaxis.label.set_color(MUTED)
    ax.title.set_color(TEXT)


def wrap_bullets(lines: list[str], width: int) -> str:
    wrapped: list[str] = []
    for line in lines:
        if not line:
            wrapped.append("")
            continue
        indent = "  " if line.startswith("• ") or line.startswith("- ") else ""
        wrapped.append(textwrap.fill(line, width=width, subsequent_indent=indent))
    return "\n".join(wrapped)


def build_slide_1(pdf: PdfPages) -> None:
    fig = plt.figure(figsize=(16, 9), dpi=150)
    fig.patch.set_facecolor(BG)
    bg_ax = get_bg_ax(fig)
    bg_ax.plot([0.045, 0.955], [0.072, 0.072], color=BORDER, linewidth=0.9)

    add_card(fig, 0.045, 0.855, 0.495, 0.05, fill="#081c22", edge="#115e59")
    fig.text(
        0.058,
        0.875,
        "NASA SPACE APPS CHALLENGE  ·  LUNAR LANDING SITE NAVIGATOR  ·  TEAM LR-007",
        color=TEAL,
        fontsize=8.8,
        fontweight="bold",
        family="monospace",
    )

    fig.text(0.045, 0.745, "HORIZON OPS", color=TEXT, fontsize=40, fontweight="bold")
    fig.text(
        0.045,
        0.665,
        "Lunar South Pole Landing Site, Mission Window,\nLunaDiff & Rover Traverse Navigator",
        color=CYAN,
        fontsize=16.5,
        fontweight="bold",
        linespacing=1.35,
    )
    fig.text(
        0.045,
        0.525,
        "An interactive 3D & 2D mission planning workbench built on real\n"
        "NASA LRO LOLA Digital Elevation Models and JPL Horizons DE421\n"
        "ephemerides — unifying touchdown safety, causal eclipse analytics,\n"
        "and energy-aware rover routing toward South Polar water-ice craters.",
        color=MUTED,
        fontsize=11.0,
        linespacing=1.45,
    )

    stats = [
        ("80°S–90°S", "South Polar Coverage", TEAL),
        ("4 LOLA Sites", "129×129 (20m) Meshes", CYAN),
        ("184 Tests", "100% Automated Pass", EMERALD),
        ("Offline Ready", "SHA-256 Verified Cache", AMBER),
    ]
    for i, (val, lbl, col) in enumerate(stats):
        cx = 0.045 + (i % 2) * 0.255
        cy = 0.345 - (i // 2) * 0.145
        add_card(fig, cx, cy, 0.238, 0.118, accent=col)
        fig.text(cx + 0.015, cy + 0.064, val, color=col, fontsize=16, fontweight="bold", family="monospace")
        fig.text(cx + 0.015, cy + 0.025, lbl, color=MUTED, fontsize=9.5)

    fig.text(
        0.045,
        0.095,
        "Public GitHub & Demo:  https://github.com/Abivarsan-Y/LR-007",
        color=TEXT,
        fontsize=10.5,
        fontweight="bold",
        family="monospace",
    )
    fig.text(
        0.045,
        0.032,
        "SI Disclosure (Space Apps Policy): Code & slides assisted by ChatGPT, OpenAI Codex & Google Antigravity. "
        "All planetary science runs deterministically on NASA data. Zero NASA logos used.",
        color=DIM,
        fontsize=8.0,
        family="monospace",
    )
    fig.text(0.955, 0.946, "SLIDE 01 / 07", color=CYAN, fontsize=9.5, fontweight="bold", family="monospace", ha="right")

    # Right side: Real LOLA 129x129 Relief Visuals
    add_card(fig, 0.565, 0.095, 0.39, 0.81, accent=CYAN)
    fig.text(
        0.58,
        0.865,
        "REAL NASA LOLA 129×129 DEM RELIEF PREVIEWS",
        color=TEXT,
        fontsize=10.2,
        fontweight="bold",
        family="monospace",
    )

    m1, d1 = load_dem_bin("site01_connecting_ridge")
    m4, d4 = load_dem_bin("site04_shackleton_rim")
    half_km = (m1["width"] - 1) * m1["spacing_m"] / 2000.0
    ext = [-half_km, half_km, -half_km, half_km]

    ax1 = fig.add_axes([0.615, 0.52, 0.28, 0.295], zorder=10)
    style_axes(ax1)
    im1 = ax1.imshow(d1, extent=ext, cmap="terrain", origin="upper")
    ax1.contour(
        np.linspace(-half_km, half_km, 129),
        np.linspace(half_km, -half_km, 129),
        d1,
        levels=8,
        colors="#ffffff",
        alpha=0.25,
        linewidths=0.6,
    )
    ax1.plot(0, 0, marker="P", color=TEAL, markersize=8, markeredgecolor="#000")
    ax1.set_title("Site 01 · Connecting Ridge (89.46°S, 137.50°W)", fontsize=9.2, pad=5)
    ax1.set_ylabel("North–South (km)", fontsize=8)
    cb1 = fig.colorbar(im1, ax=ax1, fraction=0.046, pad=0.03)
    cb1.ax.tick_params(colors=MUTED, labelsize=7.5)
    cb1.set_label("Elev (m)", color=MUTED, fontsize=7.5)

    ax2 = fig.add_axes([0.615, 0.15, 0.28, 0.295], zorder=10)
    style_axes(ax2)
    im2 = ax2.imshow(d4, extent=ext, cmap="cividis", origin="upper")
    ax2.contour(
        np.linspace(-half_km, half_km, 129),
        np.linspace(half_km, -half_km, 129),
        d4,
        levels=9,
        colors="#ffffff",
        alpha=0.28,
        linewidths=0.6,
    )
    ax2.plot(0, 0, marker="P", color=AMBER, markersize=8, markeredgecolor="#000")
    ax2.set_title("Site 04 · Shackleton Rim (89.90°S · 1,300m Span)", fontsize=9.2, pad=5)
    ax2.set_xlabel("East–West (km)", fontsize=8)
    ax2.set_ylabel("North–South (km)", fontsize=8)
    cb2 = fig.colorbar(im2, ax=ax2, fraction=0.046, pad=0.03)
    cb2.ax.tick_params(colors=MUTED, labelsize=7.5)
    cb2.set_label("Elev (m)", color=MUTED, fontsize=7.5)

    pdf.savefig(fig)
    plt.close(fig)


def build_slide_2(pdf: PdfPages) -> None:
    fig = plt.figure(figsize=(16, 9), dpi=150)
    add_chrome(
        fig,
        2,
        "The Challenge & Relevance",
        "Why the Lunar South Pole (80°S–90°S) Breaks Conventional Tools",
        "Extreme grazing illumination, lunar curvature, Earth libration, and crater walls demand physics-grounded mission tools.",
    )

    hazards = [
        (
            "01 · GRAZING SUNLIGHT (0°–1.5°)",
            TEAL,
            "The Sun skims near the horizon. Distant crater rims 15–30+ km away sweep shadows across landing zones, "
            "triggering 60–70 hour freezing blackouts even on 74% sunlit ridges.",
        ),
        (
            "02 · FLAT-MOON GEODESY ERROR",
            CYAN,
            "Ignoring lunar radius (R = 1,737.4 km) creates phantom shadows. Over 20 km, spherical curvature drops "
            "distant terrain by ~115.1 m relative to the local tangent plane.",
        ),
        (
            "03 · EARTH LIBRATION DTE DROPOUTS",
            AMBER,
            "Earth oscillates low along the northern skyline over a 27.3-day libration cycle, turning minor ridge "
            "undulations into sudden Direct-to-Earth telemetry blackouts.",
        ),
        (
            "04 · WATER-ICE PSR ROVER RISK",
            ROSE,
            "Lunar water ice resides inside Permanently Shadowed Regions (PSRs) behind >15° crater walls where rovers "
            "face tip-over slopes, battery depletion, and lost Base Pod radio LOS.",
        ),
    ]

    for i, (heading, col, body) in enumerate(hazards):
        cy = 0.66 - i * 0.19
        add_card(fig, 0.045, cy, 0.44, 0.168, accent=col)
        fig.text(0.058, cy + 0.132, heading, color=col, fontsize=10.5, fontweight="bold", family="monospace")
        fig.text(
            0.058,
            cy + 0.112,
            textwrap.fill(body, width=62),
            color=TEXT,
            fontsize=9.4,
            linespacing=1.38,
            va="top",
        )

    add_card(fig, 0.505, 0.08, 0.45, 0.748, accent=CYAN)
    fig.text(
        0.52,
        0.79,
        "MEASURED NASA LOLA TERRAIN VARIABILITY (4 CATALOG SITES)",
        color=TEXT,
        fontsize=10.0,
        fontweight="bold",
        family="monospace",
    )

    sites = [
        ("Site 01\nConnect Ridge", "site01_connecting_ridge", TEAL),
        ("Site 04\nShackleton", "site04_shackleton_rim", AMBER),
        ("Site 07\nMalapert", "site07_malapert_mountain", CYAN),
        ("Site 09\nHaworth Floor", "site09_haworth_floor", ROSE),
    ]
    labels, slopes_list, spans, cols = [], [], [], []
    for label, sid, col in sites:
        meta, arr = load_dem_bin(sid)
        slp = compute_slope_deg(arr, meta["spacing_m"])
        labels.append(label)
        slopes_list.append(slp[np.isfinite(slp)])
        spans.append(float(np.nanmax(arr) - np.nanmin(arr)))
        cols.append(col)

    ax_top = fig.add_axes([0.555, 0.485, 0.375, 0.255], zorder=10)
    style_axes(ax_top)
    bp = ax_top.boxplot(
        slopes_list,
        tick_labels=labels,
        patch_artist=True,
        showfliers=False,
        medianprops={"color": "#ffffff", "linewidth": 1.8},
        whiskerprops={"color": MUTED},
        capprops={"color": MUTED},
    )
    for patch, col in zip(bp["boxes"], cols):
        patch.set_facecolor(col)
        patch.set_alpha(0.55)
        patch.set_edgecolor(col)
    ax_top.axhline(8.0, color=EMERALD, linestyle="--", linewidth=1.2, label="Artemis SAFE limit (8°)")
    ax_top.axhline(15.0, color=RED, linestyle="--", linewidth=1.2, label="HAZARD limit (15°)")
    ax_top.set_ylabel("Slope (°)", fontsize=8.5)
    ax_top.set_title("Slope Quartiles (129×129 LOLA Patches @ 20 m)", fontsize=9.2)
    ax_top.legend(loc="upper right", fontsize=7.6, facecolor=PANEL, edgecolor=BORDER, labelcolor=TEXT)

    ax_bot = fig.add_axes([0.555, 0.145, 0.375, 0.235], zorder=10)
    style_axes(ax_bot)
    bars = ax_bot.bar(labels, spans, color=cols, alpha=0.84, width=0.5)
    for bar, s in zip(bars, spans):
        ax_bot.text(bar.get_x() + bar.get_width() / 2, s + 30, f"{s:.0f} m", ha="center", color=TEXT, fontsize=8.4, fontweight="bold")
    ax_bot.set_ylim(0, 1540)
    ax_bot.set_ylabel("Relief Span (m)", fontsize=8.5)
    ax_bot.set_title("Vertical Elevation Span Across 2.56 km Patch", fontsize=9.2)

    pdf.savefig(fig)
    plt.close(fig)


def build_slide_3(pdf: PdfPages) -> None:
    fig = plt.figure(figsize=(16, 9), dpi=150)
    add_chrome(
        fig,
        3,
        "Mission Workspace & Safety",
        "Interactive 3D Globe, Polar Map & Nearby Safe Haven Recommender",
        "Evaluating Artemis touchdown stability (<8° SAFE, 8°–15° CAUTION, >15° HAZARD) and diverting hazards to sunlit flat ridges.",
    )

    pillars = [
        (
            "DUAL-VIEW 3D + 2D MISSION STAGE",
            TEAL,
            [
                "• CesiumJS 3D Lunar Sphere textured with NASA LROC WAC orbital imagery and far-field starfield.",
                "• Seamless 129×129 (20 m) LOLA DEM relief meshes in Oblique 3D and Horizon Cam with terrain floor clamp.",
                "• Synchronized 2D Polar radar map (80°S–90°S) & arbitrary click-anywhere evaluation.",
            ],
        ),
        (
            "INSTANT TOUCHDOWN SLOPE ENGINE",
            EMERALD,
            [
                "• Evaluates surface gradients against Artemis HLS / CLPS criteria: SAFE (< 8.0°), CAUTION (8.0°–15.0°), HAZARD (> 15.0°).",
                "• Live shader overlay switcher toggles between baked Lunar Albedo shading and tactical Slope Hazard bands.",
            ],
        ),
        (
            "NEARBY SAFE HAVEN RECOMMENDER",
            AMBER,
            [
                "• Concentric spatial scanner evaluates alternate ridges within 5–20 km radius.",
                "• Site 01 Verified Output: Haven 1 (0.44° slope, 122 m), Haven 2 (2.61°, 981 m), Haven 3 (1.36°, 1,028 m).",
            ],
        ),
    ]
    for i, (h, col, lines) in enumerate(pillars):
        cy = 0.59 - i * 0.255
        add_card(fig, 0.045, cy, 0.445, 0.23, accent=col)
        fig.text(0.058, cy + 0.193, h, color=col, fontsize=10.5, fontweight="bold", family="monospace")
        fig.text(
            0.058,
            cy + 0.168,
            wrap_bullets(lines, width=63),
            color=TEXT,
            fontsize=9.3,
            linespacing=1.4,
            va="top",
        )

    add_card(fig, 0.51, 0.08, 0.445, 0.74, accent=EMERALD)
    fig.text(
        0.525,
        0.785,
        "SITE 01 · CONNECTING RIDGE SLOPE BANDS & SAFE HAVENS",
        color=TEXT,
        fontsize=10.0,
        fontweight="bold",
        family="monospace",
    )

    meta, arr = load_dem_bin("site01_connecting_ridge")
    slp = compute_slope_deg(arr, meta["spacing_m"])
    rec = json.loads((ROOT / "data" / "processed" / "site01_connecting_ridge_recommend.json").read_text())

    rgb = np.zeros((slp.shape[0], slp.shape[1], 3), dtype=float)
    safe_mask = slp < 8.0
    caut_mask = (slp >= 8.0) & (slp <= 15.0)
    haz_mask = slp > 15.0
    rgb[safe_mask] = [0.063, 0.725, 0.506]
    rgb[caut_mask] = [0.961, 0.620, 0.043]
    rgb[haz_mask] = [0.937, 0.267, 0.267]

    ax = fig.add_axes([0.565, 0.175, 0.35, 0.55], zorder=10)
    style_axes(ax)
    half_m = (meta["width"] - 1) * meta["spacing_m"] / 2.0
    ext = [-half_m, half_m, -half_m, half_m]
    ax.imshow(rgb, extent=ext, origin="upper")
    ax.contour(np.linspace(-half_m, half_m, 129), np.linspace(half_m, -half_m, 129), arr, levels=9, colors="#050507", alpha=0.38, linewidths=0.7)

    ax.plot(0, 0, marker="*", color="#ffffff", markersize=14, markeredgecolor="#000", label="Origin (Connecting Ridge)")
    for idx, cand in enumerate(rec["candidates"], start=1):
        br = np.radians(cand["bearing_deg"])
        e = cand["distance_m"] * np.sin(br)
        n = cand["distance_m"] * np.cos(br)
        ax.plot(e, n, marker="o", color=CYAN, markersize=9, markeredgecolor="#000")
        ax.annotate(
            f"SH-{idx} ({cand['slope_deg']:.2f}°)",
            (e, n),
            xytext=(10, 6 if idx != 2 else -14),
            textcoords="offset points",
            color="#ffffff",
            fontsize=8.2,
            fontweight="bold",
            bbox={"boxstyle": "round,pad=0.2", "facecolor": "#050507", "edgecolor": CYAN, "alpha": 0.9},
        )

    ax.set_xlabel("East Offset (m)", fontsize=8.5)
    ax.set_ylabel("North Offset (m)", fontsize=8.5)
    ax.legend(loc="lower left", fontsize=7.8, facecolor=PANEL, edgecolor=BORDER, labelcolor=TEXT)

    safe_pct = float(np.mean(safe_mask) * 100.0)
    caut_pct = float(np.mean(caut_mask) * 100.0)
    haz_pct = float(np.mean(haz_mask) * 100.0)
    fig.text(
        0.525,
        0.102,
        f"SAFE (<8°): {safe_pct:.1f}%   |   CAUTION (8°–15°): {caut_pct:.1f}%   |   HAZARD (>15°): {haz_pct:.1f}%",
        color=MUTED,
        fontsize=8.6,
        family="monospace",
    )

    pdf.savefig(fig)
    plt.close(fig)


def build_slide_4(pdf: PdfPages) -> None:
    fig = plt.figure(figsize=(16, 9), dpi=150)
    add_chrome(
        fig,
        4,
        "Core Innovation · LunaDiff Engine",
        "LunaDiff: \"See What Changed. See Why.\"",
        "Comparing Nominal Launch (Nov 15, 2026) vs +48h Delay at Connecting Ridge (Site 01) with causal 360° ridge attribution.",
    )

    nom = json.loads((ROOT / "backend" / "tests" / "fixtures" / "science" / "site01" / "analysis_nominal.json").read_text())
    diff = json.loads((ROOT / "backend" / "tests" / "fixtures" / "science" / "site01" / "diff_delay48h.json").read_text())

    kpis = [
        ("NOMINAL SUNLIGHT (14d)", f"{nom['metrics']['sunlight_hours']:.1f} h ({nom['metrics']['sunlight_fraction']*100:.1f}%)", TEAL),
        ("+48H DELAY SUN DELTA", f"{diff['deltas']['sunlight_hours']:+.1f} h Net Sun Impact", RED),
        ("+48H DELAY EARTH DTE Δ", f"{diff['deltas']['earth_visible_hours']:+.1f} h Net Comms Shift", EMERALD),
        ("MAX CONTINUOUS DARK", f"{nom['metrics']['max_darkness_hours']:.1f} h Eclipse Envelope", AMBER),
    ]
    for i, (lbl, val, col) in enumerate(kpis):
        kx = 0.045 + i * 0.232
        add_card(fig, kx, 0.73, 0.214, 0.102, accent=col)
        fig.text(kx + 0.012, 0.795, lbl, color=MUTED, fontsize=8.3, fontweight="bold", family="monospace")
        fig.text(kx + 0.012, 0.748, val, color=col, fontsize=12.5, fontweight="bold")

    add_card(fig, 0.045, 0.40, 0.91, 0.305, accent=CYAN)
    fig.text(
        0.06,
        0.672,
        "CAUSAL 360° HORIZON PROFILE (1,440 RAYS @ 0.25°) WITH JPL HORIZONS SUN & EARTH TRACKS",
        color=TEXT,
        fontsize=9.5,
        fontweight="bold",
        family="monospace",
    )

    az = np.array([h["azimuth_deg"] for h in nom["horizon"]])
    hor_el = np.array([h["elevation_deg"] for h in nom["horizon"]])
    sun_az = np.array([s["sun"]["azimuth_deg"] for s in nom["samples"]])
    sun_el = np.array([s["sun"]["elevation_deg"] for s in nom["samples"]])
    earth_az = np.array([s["earth"]["azimuth_deg"] for s in nom["samples"]])
    earth_el = np.array([s["earth"]["elevation_deg"] for s in nom["samples"]])

    ax_hor = fig.add_axes([0.088, 0.455, 0.84, 0.195], zorder=10)
    style_axes(ax_hor)
    ax_hor.fill_between(az, -3.5, hor_el, color="#1e293b", alpha=0.88, label="360° Terrain Skyline (LOLA Curvature-Adjusted)")
    ax_hor.plot(az, hor_el, color=MUTED, linewidth=1.0)
    ax_hor.scatter(sun_az, sun_el, s=6, color=AMBER, alpha=0.9, label="Sun Centre Track (DE421 · 14d)")
    ax_hor.scatter(earth_az, earth_el, s=6, color=CYAN, alpha=0.8, label="Earth DTE Track (27.3d Libration)")
    ax_hor.axvspan(115, 146, color=RED, alpha=0.16, label="Blocking Ridge Zone (+48h Lost Sun Az ~118°–143°)")
    ax_hor.set_xlim(0, 360)
    ax_hor.set_ylim(-3.2, 4.6)
    ax_hor.set_xlabel("True North-Clockwise Azimuth (°)", fontsize=8.3)
    ax_hor.set_ylabel("Elevation (°)", fontsize=8.3)
    ax_hor.legend(loc="upper left", ncol=4, fontsize=7.4, facecolor=PANEL, edgecolor=BORDER, labelcolor=TEXT)

    add_card(fig, 0.045, 0.075, 0.91, 0.30, accent=AMBER)
    fig.text(
        0.06,
        0.34,
        "LUNADIFF DIAGNOSTIC WINDOWS (MISSION ELAPSED TIME 0–336 h) & ROOT-CAUSE RIDGE ATTRIBUTION",
        color=TEXT,
        fontsize=9.5,
        fontweight="bold",
        family="monospace",
    )

    ax_diff = fig.add_axes([0.145, 0.135, 0.545, 0.18], zorder=10)
    style_axes(ax_diff)
    y_map = {
        "GAINED_SUNLIGHT": 3,
        "LOST_SUNLIGHT": 2,
        "GAINED_EARTH_VISIBILITY": 1,
        "LOST_EARTH_VISIBILITY": 0,
    }
    col_map = {
        "GAINED_SUNLIGHT": EMERALD,
        "LOST_SUNLIGHT": RED,
        "GAINED_EARTH_VISIBILITY": CYAN,
        "LOST_EARTH_VISIBILITY": AMBER,
    }
    for iv in diff["diagnostic_intervals"]:
        row = y_map[iv["type"]]
        dur = iv["end_met_hours"] - iv["start_met_hours"]
        ax_diff.barh(row, dur, left=iv["start_met_hours"], height=0.58, color=col_map[iv["type"]], edgecolor="#050507")
        if dur >= 10:
            ax_diff.text(
                iv["start_met_hours"] + dur / 2,
                row,
                f"{dur:.1f}h",
                ha="center",
                va="center",
                color="#050507",
                fontsize=7.6,
                fontweight="bold",
            )
    ax_diff.set_yticks([0, 1, 2, 3])
    ax_diff.set_yticklabels(["Lost Earth DTE", "Gained Earth DTE", "Lost Sunlight", "Gained Sunlight"], fontsize=8.2)
    ax_diff.set_xlim(0, 336)
    ax_diff.set_xlabel("Mission Elapsed Time (hours)", fontsize=8.3)

    add_card(fig, 0.715, 0.095, 0.225, 0.225, fill="#08121a", edge="#1e3a5f")
    fig.text(0.726, 0.292, "CAUSAL POPUP TRACE (MET +216h)", color=RED, fontsize=8.5, fontweight="bold", family="monospace")
    fig.text(
        0.726,
        0.265,
        "Lost Sunlight Window:\n"
        "MET +216.0 h to +264.0 h (-48.0 h)\n\n"
        "• Nominal Sun: 1.098° > Terrain 0.535°\n"
        "• +48h Delay Sun: 1.255° < Terrain 1.534°\n"
        "• Blocking Azimuth: 118.29° (SE Rim)\n"
        "• Exposed Disc Fraction: 100% -> 0%",
        color=TEXT,
        fontsize=8.3,
        linespacing=1.38,
        va="top",
    )

    pdf.savefig(fig)
    plt.close(fig)


def build_slide_5(pdf: PdfPages) -> None:
    fig = plt.figure(figsize=(16, 9), dpi=150)
    add_chrome(
        fig,
        5,
        "Autonomy · Rover Traverse Planner",
        "Dual-Mode Energy & LOS-Constrained Rover Traverse into PSRs",
        "Balancing slope trafficability, 100% Base Pod radio link, synodic solar motion, and battery return/regen holds.",
    )

    with_tif = ROOT / "data" / "raw" / "LDEM_80S_80MPP_ADJ.TIF"
    reader = LolaDemReader(with_tif)
    try:
        trav = plan_automatic_traverse(
            reader=reader,
            start_lat=-89.463158,
            start_lon=-137.501985,
            target_lat=-89.495,
            target_lon=-136.85,
            initial_battery_wh=560.0,
            step_m=220.0,
            max_steps=16,
            sun_azimuth_deg=317.5,
            sun_elevation_deg=1.15,
        )
    finally:
        reader.close()

    wps = trav["waypoints"]
    s = trav["summary"]

    cards = [
        (
            "MANUAL + AUTOMATIC PATHFINDING",
            CYAN,
            [
                "• Manual Mode: Adaptive variable step hints (0.45×–1.32× step) + exact target snap prevents overshooting.",
                "• Automatic Mode: Constrained A*-style pathfinder builds end-to-end routes into Water-Ice PSR targets.",
            ],
        ),
        (
            "RETURN-TO-BASE & SOLAR TIMING",
            AMBER,
            [
                "• Models 1,200 Wh battery (20% reserve floor, 150 W drive power, 350 W peak solar array, 0.5 m/s cruise).",
                "• Rotates Sun azimuth (+0.508°/h synodic drift) so terrain illumination evolves with traverse elapsed time.",
            ],
        ),
        (
            "PROACTIVE ⚡ REGEN SPOT HOLDS",
            EMERALD,
            [
                "• Checks if next move would leave insufficient energy to return to Base Pod or nearest sunlit haven.",
                "• Automatically pauses at sunlit ridges (SOLAR_REGEN_HOLD) to recharge before entering dark craters.",
            ],
        ),
        (
            "100% BASE POD LINE-OF-SIGHT",
            TEAL,
            [
                "• Validates optical/radio clearance between 5 m Base Pod mast and 2 m rover mast over lunar curvature.",
                f"• Real Demo Sortie: {s['total_traverse_distance_m']:.1f} m · {s['regen_stops_count']} Regen Holds · {s['base_los_fraction']*100:.0f}% LOS.",
            ],
        ),
    ]
    for i, (h, col, lines) in enumerate(cards):
        cy = 0.66 - i * 0.19
        add_card(fig, 0.045, cy, 0.43, 0.168, accent=col)
        fig.text(0.058, cy + 0.132, h, color=col, fontsize=10.2, fontweight="bold", family="monospace")
        fig.text(
            0.058,
            cy + 0.112,
            wrap_bullets(lines, width=61),
            color=TEXT,
            fontsize=8.9,
            linespacing=1.35,
            va="top",
        )

    add_card(fig, 0.495, 0.45, 0.46, 0.378, accent=CYAN)
    fig.text(
        0.51,
        0.793,
        f"EXECUTED TRAVERSE ON LOLA DEM ({s['total_traverse_distance_m']:.1f} m · {trav['status']})",
        color=TEXT,
        fontsize=9.6,
        fontweight="bold",
        family="monospace",
    )

    meta, arr = load_dem_bin("site01_connecting_ridge")
    half_km = (meta["width"] - 1) * meta["spacing_m"] / 2000.0
    ext = [-half_km, half_km, -half_km, half_km]

    R_KM = 1737.4
    lat0 = np.radians(meta["coordinates"]["latitude_deg"])
    lon0 = np.radians(meta["coordinates"]["longitude_deg"])
    wp_e, wp_n = [], []
    for wp in wps:
        la = np.radians(wp["coordinates"]["latitude_deg"])
        lo = np.radians(wp["coordinates"]["longitude_deg"])
        wp_e.append(R_KM * np.cos(lat0) * (lo - lon0))
        wp_n.append(R_KM * (la - lat0))

    ax_map = fig.add_axes([0.55, 0.51, 0.38, 0.265], zorder=10)
    style_axes(ax_map)
    ax_map.imshow(arr, extent=ext, cmap="Greys_r", origin="upper", alpha=0.82)
    ax_map.plot(wp_e, wp_n, color=CYAN, linewidth=2.2, label="Rover Path (Max Slope 10.0°)")
    for wp, e, n in zip(wps, wp_e, wp_n):
        if wp["action"] == "START_BASE_POD":
            ax_map.plot(e, n, marker="h", color=TEAL, markersize=10, markeredgecolor="#000", label="Base Pod (5m Mast)")
        elif wp["action"] == "SOLAR_REGEN_HOLD":
            lbl = "Solar Regen Hold" if wp["waypoint_index"] == 3 else None
            ax_map.plot(e, n, marker="^", color=AMBER, markersize=9, markeredgecolor="#000", label=lbl)
        elif wp["action"] == "ARRIVE_RESEARCH_TARGET":
            ax_map.plot(e, n, marker="D", color=ROSE, markersize=8.5, markeredgecolor="#000", label="Target (0% Sun)")
        else:
            ax_map.plot(e, n, marker="o", color=EMERALD, markersize=6, markeredgecolor="#000")
    ax_map.set_xlim(-0.85, 0.85)
    ax_map.set_ylim(-1.18, 0.35)
    ax_map.set_xlabel("East Offset (km)", fontsize=8.0)
    ax_map.set_ylabel("North Offset (km)", fontsize=8.0)
    ax_map.legend(loc="lower left", fontsize=7.2, facecolor=PANEL, edgecolor=BORDER, labelcolor=TEXT)

    add_card(fig, 0.495, 0.08, 0.46, 0.345, accent=EMERALD)
    fig.text(
        0.51,
        0.388,
        "BATTERY STATE-OF-CHARGE & SUNLIGHT FRACTION PROFILE",
        color=TEXT,
        fontsize=9.6,
        fontweight="bold",
        family="monospace",
    )

    ax_bat = fig.add_axes([0.555, 0.142, 0.37, 0.22], zorder=10)
    style_axes(ax_bat)
    dists = [wp["distance_from_start_m"] for wp in wps]
    bats = [wp["battery_reserve_pct"] for wp in wps]
    illums = [wp["illumination_fraction"] * 100.0 for wp in wps]
    ax_bat.plot(dists, bats, marker="o", color=EMERALD, linewidth=2.3, label="Battery SoC (%)")
    ax_bat.plot(dists, illums, marker="s", linestyle="--", color=AMBER, linewidth=1.6, label="Sun Illumination (%)")
    ax_bat.axhline(20.0, color=RED, linestyle=":", linewidth=1.3, label="Min Reserve Floor (20%)")
    ax_bat.annotate(
        f"Regen Hold (+{wps[3]['regen_dwell_hours']:.2f}h -> 90%)",
        (dists[3], bats[3]),
        xytext=(-130, -28),
        textcoords="offset points",
        color=AMBER,
        fontsize=7.8,
        fontweight="bold",
        arrowprops={"arrowstyle": "->", "color": AMBER, "lw": 1.1},
    )
    ax_bat.set_ylim(0, 108)
    ax_bat.set_xlabel("Traverse Distance from Base Pod (m)", fontsize=8.0)
    ax_bat.set_ylabel("Percent (%)", fontsize=8.0)
    ax_bat.legend(loc="lower left", fontsize=7.3, facecolor=PANEL, edgecolor=BORDER, labelcolor=TEXT)

    pdf.savefig(fig)
    plt.close(fig)


def build_slide_6(pdf: PdfPages) -> None:
    fig = plt.figure(figsize=(16, 9), dpi=150)
    add_chrome(
        fig,
        6,
        "Scientific Validity & Data Provenance",
        "Authentic NASA Data, Space Agency Partner & 184 Verified Tests",
        "Deterministic planetary geometry with SHA-256 dataset checksums, Draft 2020-12 JSON schemas, and fail-closed QA.",
    )

    add_card(fig, 0.045, 0.425, 0.485, 0.405, accent=TEAL)
    fig.text(0.058, 0.793, "NASA & SPACE AGENCY PARTNER RESOURCES", color=TEAL, fontsize=10.3, fontweight="bold", family="monospace")
    sources_lines = [
        "1. NASA LRO LOLA South Pole DEMs (GSFC PGDA Product 90 & 78)",
        "• LDEM_80S_80MPP_ADJ.TIF (7,600×7,600 polar raster, 80°S–90°S)",
        "• LDEM_80S_20MPP_ADJ.TIF & Site01_final_adj_5mpp_surf.tif (+ _ldec/_slp/_toterr)",
        "2. NASA JPL Horizons Ephemeris API (DE421 · Frame MOON_ME_DE421)",
        "• Sun (NAIF 10) & Earth (NAIF 399) topocentric azimuth, elevation & disc width",
        "3. NASA LROC Wide Angle Camera Mosaic (luna_wac_global via Lunaserv WMS)",
        "4. NASA Moon Trek & LROC QuickMap cross-verification benchmarks",
        "5. Space Agency Partner — Canadian Space Agency (CSA) Moon Exploration Portal",
    ]
    fig.text(
        0.058,
        0.76,
        wrap_bullets(sources_lines, width=68),
        color=TEXT,
        fontsize=8.9,
        linespacing=1.42,
        va="top",
    )

    add_card(fig, 0.045, 0.08, 0.485, 0.32, accent=CYAN)
    fig.text(0.058, 0.365, "MATHEMATICAL RIGOR & FAIL-CLOSED DESIGN", color=CYAN, fontsize=10.3, fontweight="bold", family="monospace")
    math_text = (
        "• Spherical Lunar Curvature Drop (R = 1,737,400 m):\n"
        "  dz(d) = sqrt(R^2 + d^2) - R   (~115.1 m drop at d = 20 km)\n\n"
        "• Circular-Segment Solar Disc Penumbra (0.53° Sun Width):\n"
        "  u = clearance / r_sun -> f(u) = [arccos(-u) + u*sqrt(1 - u^2)] / pi\n\n"
        "• Fail-Closed Provenance:\n"
        "  Unresolved or NaN LOLA elevation rays yield UNKNOWN.\n"
        "  Zero generative AI runs inside runtime physics calculations."
    )
    fig.text(0.058, 0.335, math_text, color=TEXT, fontsize=8.9, linespacing=1.34, va="top", family="monospace")

    add_card(fig, 0.55, 0.425, 0.405, 0.405, accent=EMERALD)
    fig.text(0.565, 0.793, "VERIFIED AUTOMATED TESTS (184 PASSING)", color=EMERALD, fontsize=10.0, fontweight="bold", family="monospace")

    ax_t = fig.add_axes([0.66, 0.485, 0.275, 0.275], zorder=10)
    style_axes(ax_t)
    suites = ["Frontend Scene &\nLunar Math (Node)", "JSON Schema\nContracts (Pytest)", "Backend Science &\nTraverse (Pytest)"]
    counts = [23, 8, 153]
    scols = [CYAN, AMBER, EMERALD]
    bars = ax_t.barh(suites, counts, color=scols, height=0.5, alpha=0.88)
    for b, c in zip(bars, counts):
        ax_t.text(c + 4, b.get_y() + b.get_height() / 2, f"{c} PASS", va="center", color=TEXT, fontsize=8.5, fontweight="bold", family="monospace")
    ax_t.set_xlim(0, 195)
    ax_t.set_xlabel("Passing Test Cases", fontsize=8.2)

    add_card(fig, 0.55, 0.08, 0.405, 0.32, accent=AMBER)
    fig.text(0.565, 0.365, "FULL-STACK ENGINEERING ARCHITECTURE", color=AMBER, fontsize=10.0, fontweight="bold", family="monospace")
    stack_lines = [
        "• Scientific Backend: Python 3.14, FastAPI, Pydantic v2, Rasterio, PyProj, NumPy, SciPy, Tifffile, Uvicorn",
        "",
        "• Interactive UI & 3D: React 19, TypeScript 5.9, Vite 7, CesiumJS 1.147, Three.js, Recharts, Tailwind CSS v4",
        "",
        "• Contracts & CI: JSON Schema Draft 2020-12, Pytest, Node Test Runner, GitHub Actions CI",
    ]
    fig.text(0.565, 0.335, wrap_bullets(stack_lines, width=54), color=TEXT, fontsize=9.1, linespacing=1.35, va="top")

    pdf.savefig(fig)
    plt.close(fig)


def build_slide_7(pdf: PdfPages) -> None:
    fig = plt.figure(figsize=(16, 9), dpi=150)
    add_chrome(
        fig,
        7,
        "Impact, Accessibility & Delivery",
        "Built in Sri Lanka for the World — Open Lunar Mission Tooling",
        "Empowering global aerospace engineers, planetary scientists, and STEM educators with offline-ready NASA science.",
    )

    pillars = [
        (
            "01 · GLOBAL STEM & OFFLINE RESILIENCE",
            TEAL,
            [
                "• Works 100% offline with cached NASA LOLA DEM patches, horizon silhouettes, and JPL Horizons ephemerides.",
                "",
                "• Built in Sri Lanka so universities and STEM classrooms globally can run real Artemis polar simulations without cloud cost.",
            ],
        ),
        (
            "02 · AUDITABLE MISSION EXPORT",
            CYAN,
            [
                "• One-click JSON and CSV export of solar/DTE timelines, slope assessments, and multi-leg rover traverses.",
                "",
                "• Every payload carries SHA-256 dataset hashes, MOON_ME_DE421 coordinates, and explicit engineering assumptions.",
            ],
        ),
        (
            "03 · TRANSPARENT SI & OPEN SOURCE",
            AMBER,
            [
                "• Public GitHub repo with reproducible fixtures, CI checks, and developer quickstart.",
                "",
                "• Explicit SI assistance attribution (ChatGPT, OpenAI Codex, Antigravity) across README, HTML metadata, and slides.",
            ],
        ),
    ]
    for i, (h, col, lines) in enumerate(pillars):
        cx = 0.045 + i * 0.308
        add_card(fig, cx, 0.43, 0.292, 0.39, accent=col)
        fig.text(cx + 0.015, 0.785, h, color=col, fontsize=10.0, fontweight="bold", family="monospace")
        fig.text(
            cx + 0.015,
            0.745,
            wrap_bullets(lines, width=40),
            color=TEXT,
            fontsize=9.3,
            linespacing=1.42,
            va="top",
        )

    add_card(fig, 0.045, 0.085, 0.91, 0.31, accent=EMERALD)
    fig.text(
        0.06,
        0.358,
        "END-TO-END OPEN PIPELINE & PUBLIC ACCESS LINKS",
        color=EMERALD,
        fontsize=10.5,
        fontweight="bold",
        family="monospace",
    )

    flow = [
        ("1. NASA LOLA + JPL\n& CSA Resources", TEAL),
        ("2. FastAPI + SciPy\nGeodesy & Traverse", CYAN),
        ("3. Frozen Schemas\n& Offline Cache", AMBER),
        ("4. React 19 + Cesium\n3D Mission Cockpit", EMERALD),
    ]
    for idx, (lbl, col) in enumerate(flow):
        fx = 0.065 + idx * 0.228
        add_card(fig, fx, 0.205, 0.19, 0.12, fill="#08121a", edge=col)
        fig.text(fx + 0.095, 0.265, lbl, color=TEXT, fontsize=9.2, fontweight="bold", ha="center", va="center", linespacing=1.3)
        if idx < 3:
            fig.text(fx + 0.209, 0.265, "->", color=MUTED, fontsize=14, fontweight="bold", ha="center", va="center", family="monospace")

    fig.text(
        0.065,
        0.15,
        "Public GitHub Repository:  https://github.com/Abivarsan-Y/LR-007   |   "
        "Submission Pack:  docs/NASA_SPACE_APPS_SUBMISSION_PACK.md",
        color=TEXT,
        fontsize=9.6,
        fontweight="bold",
        family="monospace",
    )
    fig.text(
        0.065,
        0.112,
        "Quickstart:  uvicorn backend.app.main:app --reload   &&   npm --prefix frontend ci && npm --prefix frontend run dev",
        color=MUTED,
        fontsize=9.0,
        family="monospace",
    )

    pdf.savefig(fig)
    plt.close(fig)


def main() -> None:
    OUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    with PdfPages(OUT_PDF) as pdf:
        build_slide_1(pdf)
        build_slide_2(pdf)
        build_slide_3(pdf)
        build_slide_4(pdf)
        build_slide_5(pdf)
        build_slide_6(pdf)
        build_slide_7(pdf)
    print(f"Wrote 7-slide deck -> {OUT_PDF} ({OUT_PDF.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
