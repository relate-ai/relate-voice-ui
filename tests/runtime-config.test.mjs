import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/runtime-config.ts', import.meta.url), 'utf8').catch(() => '');
const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
const runtimeConfig = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('normalises a Coolify-provided HTTPS API origin', () => {
  assert.equal(runtimeConfig.parseApiBaseUrl('  https://api.example.test  '), 'https://api.example.test');
  assert.equal(runtimeConfig.parseApiBaseUrl('https://api.example.test:8443'), 'https://api.example.test:8443');
});

for (const value of [
  '',
  'http://api.example.test',
  'https://user:password@api.example.test',
  'https://api.example.test/path',
  'https://api.example.test?query=value',
  'https://api.example.test#fragment',
]) {
  test(`rejects an invalid API origin: ${value || '<empty>'}`, () => {
    assert.throws(() => runtimeConfig.parseApiBaseUrl(value), /VOICE_API_URL/);
  });
}

test('loads the API origin from the runtime asset', async () => {
  const requested = [];
  const fetcher = async (url) => {
    requested.push(url);
    return { ok: true, text: async () => 'https://api.example.test\n' };
  };

  const result = await runtimeConfig.loadRuntimeConfig(fetcher);

  assert.deepEqual(requested, ['/runtime/voice-api-url']);
  assert.deepEqual(result, { apiBaseUrl: 'https://api.example.test' });
});

test('rejects an unavailable runtime asset', async () => {
  const fetcher = async () => ({ ok: false, status: 404, text: async () => '' });

  await assert.rejects(() => runtimeConfig.loadRuntimeConfig(fetcher), /runtime configuration/);
});
