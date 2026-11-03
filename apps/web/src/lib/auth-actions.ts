export interface AuthFailure {
  message?: string;
  status?: number;
  statusText?: string;
  code?: string;
}

export function authFailureMessage(error: unknown, provider?: "google"): string {
  const failure = error && typeof error === "object" ? error as AuthFailure & { name?: string } : {};
  const message = failure.message ?? "";
  if (failure.name === "AbortError" || failure.name === "TimeoutError" || /timed?\s*out|timeout/i.test(message)) {
    return "The sign-in request timed out. Please try again.";
  }
  if (error instanceof TypeError || /failed to fetch|network request failed|load failed|networkerror/i.test(message)) {
    return "Cannot reach the sign-in server. Check your connection and try again.";
  }
  if (provider === "google" && (failure.status === 404 || /provider.*(not.*found|not.*enabled|disabled)|unknown.provider/i.test(`${failure.code ?? ""} ${message}`))) {
    return "Google sign-in is unavailable. Use email and password, or ask the administrator to enable Google.";
  }
  if ((failure.status ?? 0) >= 500) return "The sign-in server is unavailable. Please try again shortly.";
  return message || failure.statusText || "Sign-in failed. Please try again.";
}

/** Better Auth can return an error or reject before receiving an HTTP response.
 * Every path restores the controls so network failures remain retryable. */
export async function runAuthAction(
  request: () => Promise<{ error?: AuthFailure | null }>,
  callbacks: {
    provider?: "google";
    onSuccess?: () => void;
    onError: (message: string) => void;
    onSettled: () => void;
  },
): Promise<boolean> {
  try {
    const result = await request();
    if (result.error) {
      callbacks.onError(authFailureMessage(result.error, callbacks.provider));
      return false;
    }
    callbacks.onSuccess?.();
    return true;
  } catch (error) {
    callbacks.onError(authFailureMessage(error, callbacks.provider));
    return false;
  } finally { callbacks.onSettled(); }
}
