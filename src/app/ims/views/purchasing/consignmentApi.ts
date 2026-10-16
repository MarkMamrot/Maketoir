export async function consignmentApi<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/ims/consignment/${path}`, body === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'Consignment request failed. Reload and retry.');
  return result.data as T;
}
