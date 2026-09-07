export interface RuntimeConfig {
  apiBaseUrl: string;
}

type RuntimeConfigResponse = Pick<Response, 'ok' | 'status' | 'text'>;
type RuntimeConfigFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<RuntimeConfigResponse>;

export function parseApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('VOICE_API_URL must be a valid HTTPS origin');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('VOICE_API_URL must be an HTTPS origin without credentials, path, query, or fragment');
  }

  return url.origin;
}

export async function loadRuntimeConfig(fetcher: RuntimeConfigFetcher = fetch): Promise<RuntimeConfig> {
  const response = await fetcher('/runtime/voice-api-url', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`Voice runtime configuration is unavailable (${response.status})`);
  }

  return { apiBaseUrl: parseApiBaseUrl(await response.text()) };
}
