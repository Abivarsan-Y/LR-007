import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
let server, client
before(async () => {
  server = await createServer({
    root: new URL('../', import.meta.url).pathname,
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    logLevel: 'error',
  })
  client = await server.ssrLoadModule('/src/api/client.ts')
})
after(async () => {
  await server?.close()
})
test('missing skyline never becomes zero sunlight or a zero outage', () => {
  const w = client.buildCustomCoordinateWorkspace({
    label: 'Unknown',
    latitude_deg: -89,
    longitude_deg: 0,
    elevation_m: 0,
    observerHeightM: 2,
    horizonAnglesDeg: Array(72).fill(NaN),
  })
  assert.equal(w.analysis.samples[0].sun.visible, null)
  assert.ok(Object.values(w.analysis.metrics).every((v) => v === null))
})
test('an unsupported height cannot silently return a recorded 2m result', async () => {
  await assert.rejects(
    client.loadCatalogSiteWorkspace(client.CATALOG_SITES[0], 5),
    /Only the recorded 2 m/,
  )
})
test('API export uses a cached analysis identity and offline CSV preserves reproducibility', async () => {
  const analysis = JSON.parse(
    await readFile(
      new URL(
        '../../backend/tests/fixtures/science/site01/analysis_nominal.json',
        import.meta.url,
      ),
    ),
  )
  const original = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    window: globalThis.window,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  }
  let body, downloaded
  globalThis.window = {
    setTimeout: (fn) => {
      fn()
      return 0
    },
  }
  globalThis.document = {
    createElement: () => ({ click() {} }),
    body: { appendChild() {}, removeChild() {} },
  }
  URL.createObjectURL = (blob) => {
    downloaded = blob
    return 'blob:test'
  }
  URL.revokeObjectURL = () => {}
  try {
    globalThis.fetch = async (_, options) => {
      body = JSON.parse(options.body)
      return new Response('{}', { status: 200 })
    }
    await client.exportAnalysisReport(analysis, 'json')
    assert.deepEqual(body, {
      analysis_id: analysis.analysis_id,
      format: 'json',
    })
    globalThis.fetch = async () => new Response('', { status: 503 })
    await client.exportAnalysisReport(analysis, 'csv')
    const csv = await downloaded.text()
    for (const source of analysis.provenance.sources)
      assert.ok(csv.includes(source.sha256) && csv.includes(source.uri))
    assert.ok(csv.includes('# assumption:'))
    assert.ok(
      csv.includes(String(analysis.samples[460].sun.illumination_fraction)),
    )
  } finally {
    globalThis.fetch = original.fetch
    globalThis.document = original.document
    globalThis.window = original.window
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  }
})
