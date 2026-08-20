import type { LLMProvider, ProviderRequest } from '../types.js';

export { anthropicProvider, type AnthropicProviderOptions } from './anthropic.js';
export { openaiProvider, type OpenAIProviderOptions } from './openai.js';

/**
 * Wraps any function that can turn a request into JSON. Use this for an
 * internal gateway, a queue, a self-hosted model, or a provider RS Redact does
 * not ship an adapter for.
 */
export function customProvider(spec: {
  name: string;
  supportsVision?: boolean;
  generate: (request: ProviderRequest) => Promise<unknown>;
}): LLMProvider {
  return {
    name: spec.name,
    supportsVision: spec.supportsVision ?? false,
    async generateJson<T>(request: ProviderRequest): Promise<T> {
      return (await spec.generate(request)) as T;
    },
  };
}

/**
 * Replays canned responses in order. This is how the pipeline is tested without
 * a network call, and it is also the way to re-run a document against a
 * previously recorded detection set.
 */
export function scriptedProvider(
  responses: unknown[],
  options: { name?: string; supportsVision?: boolean } = {},
): LLMProvider & { calls: ProviderRequest[] } {
  const calls: ProviderRequest[] = [];
  let cursor = 0;

  return {
    name: options.name ?? 'scripted',
    supportsVision: options.supportsVision ?? true,
    calls,
    async generateJson<T>(request: ProviderRequest): Promise<T> {
      calls.push(request);
      const response = responses[cursor];
      cursor++;
      if (response === undefined) {
        throw new Error(
          `scriptedProvider ran out of responses after ${cursor - 1} call(s). ` +
            'Add one response per expected LLM call.',
        );
      }
      return response as T;
    },
  };
}
