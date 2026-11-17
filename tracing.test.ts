import { expect, test } from 'bun:test';
import { traceBridge } from './tracing';
import { createBridge } from './server';

test('real bridge traces lookup without sending credentials or captured content', async () => {
  const sent: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body))); return Response.json({ accepted: 50 });
  }) as typeof fetch;
  try {
    const ingest = 'synthetic-ingest-key-'.repeat(3), client = 'synthetic-client-key-'.repeat(3);
    const bridge = traceBridge(createBridge(ingest, { test: client }), { url: 'http://127.0.0.1:8786', writeKey: 'synthetic-write-key' });
    const response = await bridge(new Request('http://localhost/v1/recent', { method: 'POST', headers: { authorization: 'Bearer '+client, 'content-type': 'application/json' }, body: JSON.stringify({ service: 'synthetic-private-service', since: new Date().toISOString() }) }));
    expect(response.status).toBe(200); await response.text();
    await Bun.sleep(30);
    const wire = JSON.stringify(sent);
    expect(wire).toContain('otp_lookup'); expect(wire).toContain('workflow-trace-v1');
    expect(wire).not.toContain(client); expect(wire).not.toContain('synthetic-private-service');
    expect(wire).not.toContain('authorization');
  } finally { globalThis.fetch = original; }
});

test('disabled or invalid telemetry preserves one execution and original response', async () => {
  for (const config of [{}, { url: 'invalid', writeKey: 'synthetic' }]) {
    let calls = 0;
    const bridge = traceBridge(async () => { calls++; return new Response('unchanged', { status: 403 }); }, config);
    const result = await bridge(new Request('http://localhost/v1/claim'));
    expect(result.status).toBe(403); expect(await result.text()).toBe('unchanged'); expect(calls).toBe(1);
  }
});
