export const MFA_RETRY_MESSAGE = 'We could not complete sign-in. Please try again in a moment.';

export async function parseMfaResponse<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(MFA_RETRY_MESSAGE);
  }
}