export const HOUR_MS = 3_600_000
const DEG = Math.PI / 180

export type Delay = 0 | 24 | 48
export type Body = 'sun' | 'earth'
export interface Direction {
  azimuth_deg: number
  elevation_deg: number
  horizon_deg: number
  visible: boolean
}
export interface MissionSample {
  met_hours: number
  utc: string
  sun: Direction
  earth: Direction
}
export interface WindowChange {
  body: Body
  gained: boolean
  start: number
  end: number
  a: Direction
  b: Direction
}

export function createSkyline() {
  return Array.from({ length: 361 }, (_, azimuth) => {
    const rim = Math.exp(-((Math.cos((azimuth - 105) * DEG) - 1) ** 2) / .055)
    return .5 + .55 * Math.cos(3 * (azimuth - 32) * DEG) + rim * 2.4
  })
}

// A controlled, illustrative dataset for testing the UI before the science API is connected.
export function createSamples(start: number, days: number, delay: Delay, skyline: number[]) {
  return Array.from({ length: days * 24 + 1 }, (_, hour): MissionSample => {
    const t = hour + delay
    const direction = (azimuth: number, elevation: number): Direction => {
      const horizon = skyline[Math.round(azimuth)]
      return { azimuth_deg: azimuth, elevation_deg: elevation, horizon_deg: horizon, visible: elevation >= horizon }
    }
    return {
      met_hours: hour, utc: new Date(start + t * HOUR_MS).toISOString(),
      sun: direction((72 + t * 1.15) % 360, 1.8 + 2 * Math.sin(t * DEG * 5)),
      earth: direction(106 + 35 * Math.sin(t * DEG * 2.5), 2.2 + 1.6 * Math.cos(t * DEG * 5)),
    }
  })
}

export function summarize(samples: MissionSample[]) {
  let sun = 0, earth = 0, darkest = 0, darkness = 0
  for (const sample of samples.slice(0, -1)) {
    if (sample.sun.visible) { sun++; darkness = 0 }
    else { darkness++; darkest = Math.max(darkest, darkness) }
    if (sample.earth.visible) earth++
  }
  return { sun, earth, darkest, durationHours: samples.length - 1 }
}

export function compareSamples(a: MissionSample[], b: MissionSample[]) {
  const windows: WindowChange[] = []
  for (const body of ['sun', 'earth'] as const) {
    let current: WindowChange | undefined
    for (let i = 0; i < a.length - 1; i++) {
      const left = a[i][body], right = b[i][body]
      if (left.visible === right.visible) { current = undefined; continue }
      if (current?.gained === right.visible) { current.end = i + 1; continue }
      current = { body, gained: right.visible, start: i, end: i + 1, a: left, b: right }
      windows.push(current)
    }
  }
  return windows
}
