import type { LLMProvider, ProviderRequest } from '../types.js';
import { MissingDependencyError, ProviderError } from '../errors.js';

export interface AnthropicProviderOptions {
  /** Defaults to process.env.ANTHROPIC_API_KEY, or an `ant auth login` profile. */
  apiKey?: string;
  /** Defaults to claude-opus-5. */
  model?: string;
  /** low | medium | high | xhigh | max. Omit for the API default (high). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  baseUrl?: string;
}

/**
 * Anthropic backend. Uses structured outputs so the reply is guaranteed to
 * match the schema RS Redact asked for, which is what lets the pipeline treat
 * the response as data instead of parsing prose.
 */
export function anthropicProvider(options: AnthropicProviderOptions = {}): LLMProvider {
  const model = options.model ?? 'claude-opus-5';
  let clientPromise: Promise<AnthropicLike> | null = null;

  const client = async (): Promise<AnthropicLike> => {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      let module: { default: new (init: Record<string, unknown>) => AnthropicLike };
      try {
        module = (await import('@anthropic-ai/sdk')) as never;
      } catch {
        throw new MissingDependencyError('@anthropic-ai/sdk', 'use the Anthropic provider');
      }
      const init: Record<string, unknown> = {};
      if (options.apiKey) init.apiKey = options.apiKey;
      if (options.baseUrl) init.baseURL = options.baseUrl;
      return new module.default(init);
    })();
    return clientPromise;
  };

  return {
    name: `anthropic:${model}`,
    supportsVision: true,

    async generateJson<T>(request: ProviderRequest): Promise<T> {
      const anthropic = await client();
      const content: unknown[] = [];

      for (const image of request.images ?? []) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.data },
        });
      }
      content.push({ type: 'text', text: request.prompt });

      const response = await anthropic.messages.create({
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content }],
        output_config: {
          format: { type: 'json_schema', schema: request.schema.schema },
          ...(options.effort ? { effort: options.effort } : {}),
        },
      });

      if (response.stop_reason === 'refusal') {
        throw new ProviderError(
          'Anthropic declined this request. Detection results are incomplete.',
          `anthropic:${model}`,
        );
      }

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!text.trim()) {
        throw new ProviderError('Anthropic returned no content', `anthropic:${model}`);
      }
      return parseJson<T>(text, `anthropic:${model}`);
    },
  };
}

function parseJson<T>(text: string, provider: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ProviderError(
      `Could not parse the model reply as JSON: ${text.slice(0, 200)}`,
      provider,
      error,
    );
  }
}

/** The slice of the SDK this adapter touches. */
interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<{
      stop_reason?: string | null;
      content: ({ type: string } & { text?: string })[];
    }>;
  };
}
