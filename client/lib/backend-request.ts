function backendBaseUrls(): string[] {
  const isDev = process.env.NODE_ENV !== 'production'
  return [
    process.env.BACKEND_PROXY_URL,
    process.env.SERVER_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    ...(isDev ? ['http://localhost:3001'] : []),
    'http://voiceai-server:3001',
    'https://api.axamaz.com',
    'http://server:3001',
    'http://localhost:3001',
  ].filter((url): url is string => typeof url === 'string' && url.length > 0 && !url.includes('undefined'))
}

export async function fetchBackend(path: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown

  for (const baseUrl of backendBaseUrls()) {
    try {
      return await fetch(`${baseUrl}${path}`, init)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Backend service is unavailable')
}
