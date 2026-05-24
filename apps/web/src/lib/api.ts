export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, headers, method = 'GET', ...rest } = options;

  const finalHeaders = new Headers(headers);
  const isMutating = method !== 'GET' && method !== 'HEAD';
  if (isMutating && body !== undefined && !finalHeaders.has('Content-Type')) {
    finalHeaders.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: finalHeaders,
    body:
      body === undefined
        ? undefined
        : typeof body === 'string' || body instanceof FormData
          ? (body as BodyInit)
          : JSON.stringify(body),
    ...rest,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const parsed: unknown = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (!res.ok) {
    const message =
      (isJson &&
        parsed &&
        typeof parsed === 'object' &&
        'message' in parsed &&
        typeof (parsed as { message: unknown }).message === 'string' &&
        (parsed as { message: string }).message) ||
      `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as T;
}
