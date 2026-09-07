import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const entrypoint = await readFile(new URL('../entrypoint.sh', import.meta.url), 'utf8');

test('nginx serves static files without application-managed API routing', () => {
  for (const forbidden of ['proxy_pass', 'proxy_ssl', 'upstream voice_platform', '37.60.235.136']) {
    assert.equal(dockerfile.includes(forbidden), false, forbidden);
  }
});

test('the image contains no deployment-specific API hostname', () => {
  assert.equal(dockerfile.includes('voice-api.relate-ai.site'), false);
  assert.equal(entrypoint.includes('voice-api.relate-ai.site'), false);
});

test('container startup requires runtime configuration from Coolify', () => {
  assert.match(entrypoint, /VOICE_API_URL/);
  assert.match(entrypoint, /runtime\/voice-api-url/);
});
