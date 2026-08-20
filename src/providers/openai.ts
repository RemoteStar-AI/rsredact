import type { LLMProvider, ProviderRequest } from '../types.js';
import { MissingDependencyError, ProviderError } from '../errors.js';
import { toStrictSchema } from './strict-schema.js';

export interface OpenAIProviderOptions {
  /** Defaults to process.env.OPENAI_API_KEY. */
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Set false for a model without image input. */
  supportsVision?: boolean;
  /**
   * Image fidelity for vision mode. A CV page is dense, and the grid labels are
   * small, so this defaults to 'high'. 'low' is cheaper and usually too coarse
   * to read a page from.
   */
  imageDetail?: 'auto' | 'low' | 'high';
}

/**
 * OpenAI backend, and by extension anything that speaks the same API
 * (Azure, OpenRouter, vLLM, Ollama) via baseUrl.
 */
export function openaiProvider(options: OpenAIProviderOptions = {}): LLMProvider {
  const model = options.model ?? 'gpt-4.1';
  let clientPromise: Promise<OpenAILike> | null = null;

  const client = async (): Promise<OpenAILike> => {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      let module: { default: new (init: Record<string, unknown>) => OpenAILike };
      try {
        module = (await import('openai')) as never;
      } catch {
        throw new MissingDependencyError('openai', 'use the OpenAI provider');
      }
      const init: Record<string, unknown> = {};
      if (options.apiKey) init.apiKey = options.apiKey;
      if (options.baseUrl) init.baseURL = options.baseUrl;
      return new module.default(init);
    })();
    return clientPromise;
  };

  return {
    name: `openai:${model}`,
    supportsVision: options.supportsVision ?? true,

    async generateJson<T>(request: ProviderRequest): Promise<T> {
      const openai = await client();
      const content: unknown[] = [{ type: 'text', text: request.prompt }];
      for (const image of request.images ?? []) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mediaType};base64,${image.data}`,
            detail: options.imageDetail ?? 'high',
          },
        });
      }

      const response = await openai.chat.completions.create({
        model,
        max_completion_tokens: request.maxTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: request.schema.name,
            description: request.schema.description,
            schema: toStrictSchema(request.schema.schema),
            strict: true,
          },
        },
      });

      const text = response.choices?.[0]?.message?.content;
      if (!text) {
        throw new ProviderError('OpenAI returned no content', `openai:${model}`);
      }
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        throw new ProviderError(
          `Could not parse the model reply as JSON: ${text.slice(0, 200)}`,
          `openai:${model}`,
          error,
        );
      }
    },
  };
}

interface OpenAILike {
  chat: {
    completions: {
      create(body: Record<string, unknown>): Promise<{
        choices?: { message?: { content?: string | null } }[];
      }>;
    };
  };
}
