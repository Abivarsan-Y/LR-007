const RAD = Math.PI / 180
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => t * t * (3 - 2 * t)

export interface Point { lat: number; lon: number }
export interface LunarSite extends Point { id: string; name: string }

export function parseLocation(value: string, sites: LunarSite[]) {
  const input = value.trim()
  const name = input.toLowerCase().replace(/\s+/g, ' ')
  const site = sites.find(s => [s.name.toLowerCase(), s.id, s.name.split(' ')[0].toLowerCase()].includes(name))
  if (site) return { point: { lat: site.lat, lon: site.lon }, site }
  const coords = /^([+-]?\d*\.?\d+)\s*(?:,\s*|\s+)([+-]?\d*\.?\d+)$/.exec(input)
  if (!coords) return null
  const lat = Number(coords[1]), lon = Number(coords[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || lon < -180 || lon > 360) return null
  const point = { lat, lon: ((lon + 180) % 360 + 360) % 360 - 180 }
  // Match explicit grid centers only. The current grids do not declare a search projection.
  const match = sites.find(s => Math.abs(s.lat - lat) < 0.000001 && Math.abs(s.lon - point.lon) < 0.000001)
  return { point, site: match }
}

const TEXTURE_W = 720, TEXTURE_H = 360
let texture: Uint8Array | undefined

function makeTexture() {
  let seed = 39
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const pixels = new Float32Array(TEXTURE_W * TEXTURE_H).fill(174)
  for (const [size, amplitude] of [[12, 33], [29, 21], [73, 13], [163, 8], [359, 6]]) {
    const h = Math.ceil(size / 2)
    const noise = Float32Array.from({ length: size * (h + 1) }, () => random() - .5)
    for (let y = 0; y < TEXTURE_H; y++) for (let x = 0; x < TEXTURE_W; x++) {
      const u = x / TEXTURE_W * size, v = y / TEXTURE_H * h
      const i = Math.floor(u), j = Math.floor(v), f = smooth(u % 1), g = smooth(v % 1)
      const next = (i + 1) % size
      pixels[y * TEXTURE_W + x] += amplitude * mix(mix(noise[j * size + i], noise[j * size + next], f), mix(noise[(j + 1) * size + i], noise[(j + 1) * size + next], f), g)
    }
  }
  for (let n = 0; n < 3800; n++) {
    const cx = random() * TEXTURE_W, cy = TEXTURE_H * (.5 + Math.asin(random() * 2 - 1) / Math.PI)
    const radius = n < 15 ? 15 + random() * 22 : 1 + 18 * random() ** 4
    const squash = Math.max(.25, Math.sin(cy / TEXTURE_H * Math.PI))
    const stretch = radius / squash
    const depth = n < 15 ? 13 + random() * 12 : 14 + random() * 27
    for (let y = Math.max(0, Math.floor(cy - radius * 1.25)); y < Math.min(TEXTURE_H, cy + radius * 1.25); y++) {
      for (let x = Math.floor(cx - stretch * 1.25); x < cx + stretch * 1.25; x++) {
        const dx = (x - cx) / stretch, dy = (y - cy) / radius, r = Math.hypot(dx, dy)
        if (r > 1.25) continue
        const bowl = r < .95 ? -(1 - r * .73) * depth : 0
        const rim = Math.exp(-((r - .95) ** 2) / .008) * depth * (.22 + .36 * (-dx + dy))
        const slope = r < .93 ? (dx - dy) * depth * .52 : 0
        pixels[y * TEXTURE_W + ((x + TEXTURE_W) % TEXTURE_W)] += bowl + rim + slope
      }
    }
  }
  return Uint8Array.from(pixels, v => clamp(v, 35, 232))
}

const vector = ({ lat, lon }: Point) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)]
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function drawMoon(ctx: CanvasRenderingContext2D, center: Point, scale: number, target?: Point) {
  texture ??= makeTexture()
  const { width, height } = ctx.canvas
  const radius = Math.min(width, height) * .423 * scale
  const img = ctx.createImageData(width, height)
  const forward = vector(center)
  const right = [Math.cos(center.lon * RAD), 0, -Math.sin(center.lon * RAD)]
  const up = [-Math.sin(center.lat * RAD) * Math.sin(center.lon * RAD), Math.cos(center.lat * RAD), -Math.sin(center.lat * RAD) * Math.cos(center.lon * RAD)]
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = (i + .5 - width / 2) / radius, y = (height / 2 - j - .5) / radius
    const d = 1 - x * x - y * y
    if (d < 0) continue
    const z = Math.sqrt(d)
    const X = right[0] * x + up[0] * y + forward[0] * z
    const Y = up[1] * y + forward[1] * z
    const Z = right[2] * x + up[2] * y + forward[2] * z
    const u = (Math.atan2(X, Z) / (2 * Math.PI) + .5) * TEXTURE_W
    const v = Math.acos(clamp(Y, -1, 1)) / Math.PI * TEXTURE_H
    const col = Math.floor(u) % TEXTURE_W, row = Math.floor(clamp(v, 0, TEXTURE_H - 1))
    const tone = texture[row * TEXTURE_W + col]
    const light = .23 + .83 * Math.max(0, -.48 * x + .52 * y + .71 * z)
    const value = tone * light
    const k = (j * width + i) * 4
    img.data[k] = value
    img.data[k + 1] = value * 1.02
    img.data[k + 2] = value * 1.06
    img.data[k + 3] = Math.min(255, z * radius * 255)
  }
  ctx.putImageData(img, 0, 0)
  if (!target) return
  const vec = vector(target)
  if (dot(vec, forward) < 0) return
  drawMarker(ctx, width / 2 + radius * dot(vec, right), height / 2 - radius * dot(vec, up))
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath()
  ctx.arc(x, y, 6, 0, Math.PI * 2)
  ctx.fillStyle = '#112434'
  ctx.fill()
  ctx.strokeStyle = '#8ef5ff'
  ctx.lineWidth = 2
  ctx.stroke()
}
