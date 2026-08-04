/**
 * Reads an API response without assuming it is JSON.
 *
 * Not every failure comes from our routes. The framework answers an oversized
 * body with plain "Payload Too Large", and a worker that dies mid-request can
 * answer with nothing at all. Calling response.json() on either throws a
 * SyntaxError whose message — "Unexpected token 'P'" — then gets shown to
 * whoever was trying to place an order.
 */
export async function readResult<T = Record<string, unknown>>(
  response: Response,
  fallback: string,
): Promise<T & { error?: string }> {
  const text = await response.text();

  if (!text) {
    throw new Error(
      response.ok
        ? fallback
        : `${fallback} (서버 응답 ${response.status}, 본문 없음 — Worker 로그를 확인해 주세요.)`,
    );
  }

  let parsed: (T & { error?: string }) | null = null;
  try {
    parsed = JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(
      response.status === 413
        ? "보내려는 파일이 너무 큽니다. 더 작은 파일로 다시 시도해 주세요."
        : `${fallback} (서버 응답 ${response.status})`,
    );
  }

  if (!response.ok) throw new Error(parsed.error || fallback);
  return parsed;
}
