import type { TranscriptionModelV4, TranscriptionModelV4CallOptions } from "@ai-sdk/provider";

/**
 * AI SDK transcription model backed by OpenRouter's `/api/v1/audio/transcriptions`.
 *
 * `@openrouter/ai-sdk-provider` only ships language/image models, so this small adapter
 * implements the AI SDK `TranscriptionModelV4` spec. That lets us call the standard
 * `transcribe()` from `ai` exactly as we would with any first-party provider.
 */
export function openRouterTranscription(
  modelId: string,
  settings: { apiKey: string; baseURL?: string; appName?: string },
): TranscriptionModelV4 {
  const baseURL = settings.baseURL ?? "https://openrouter.ai/api/v1";

  return {
    specificationVersion: "v4",
    provider: "openrouter.transcription",
    modelId,

    async doGenerate(options: TranscriptionModelV4CallOptions) {
      const timestamp = new Date();
      const data = typeof options.audio === "string" ? options.audio : Buffer.from(options.audio).toString("base64");

      const body = {
        model: modelId,
        input_audio: { data, format: formatFromMediaType(options.mediaType) },
        // verbose_json gives us language, duration and (when the provider scores it) confidence.
        response_format: "verbose_json",
        ...(options.providerOptions?.openrouter ?? {}),
      };

      const response = await fetch(`${baseURL}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          ...(settings.appName ? { "X-Title": settings.appName } : {}),
          ...cleanHeaders(options.headers),
        },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });

      const payload = (await response.json().catch(() => null)) as OpenRouterTranscription | null;
      if (!response.ok || !payload) {
        const message = payload?.error?.message ?? `OpenRouter transcription failed (${response.status})`;
        throw new Error(message);
      }

      return {
        text: payload.text?.trim() ?? "",
        segments: (payload.segments ?? []).map((s) => ({
          text: s.text,
          startSecond: s.start,
          endSecond: s.end,
        })),
        language: payload.language,
        durationInSeconds: payload.duration ?? payload.usage?.seconds,
        warnings: [],
        response: {
          timestamp,
          modelId,
          headers: Object.fromEntries(response.headers.entries()),
        },
        providerMetadata: {
          openrouter: {
            confidence: payload.confidence ?? null,
            cost: payload.usage?.cost ?? null,
            generationId: response.headers.get("x-generation-id"),
          },
        },
      };
    },
  };
}

type OpenRouterTranscription = {
  text?: string;
  language?: string;
  duration?: number;
  confidence?: number;
  segments?: { text: string; start: number; end: number }[];
  usage?: { seconds?: number; cost?: number };
  error?: { message?: string };
};

function formatFromMediaType(mediaType: string) {
  const sub = mediaType.split(";")[0]!.split("/")[1]?.toLowerCase() ?? "wav";
  const map: Record<string, string> = {
    wav: "wav",
    "x-wav": "wav",
    wave: "wav",
    mpeg: "mp3",
    mp3: "mp3",
    mp4: "m4a",
    "x-m4a": "m4a",
    m4a: "m4a",
    aac: "aac",
    ogg: "ogg",
    webm: "webm",
    flac: "flac",
  };
  return map[sub] ?? sub;
}

function cleanHeaders(headers?: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(headers ?? {}).filter((e): e is [string, string] => e[1] !== undefined));
}
