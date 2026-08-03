import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  completeStructured,
  resetStructuredCircuitForTests,
  structuredValueProblems,
} from './structured-completion.js';

const schema = {
  name: 'agentic_binding_v1',
  schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['resolved', 'unresolved'] },
      strategy: { type: ['string', 'null'] },
    },
    required: ['status', 'strategy'],
    additionalProperties: false,
  },
};

beforeEach(resetStructuredCircuitForTests);

describe('completeStructured', () => {
  it('elige el modelo por nivel y devuelve solamente data JSON más metadatos', async () => {
    const call = vi.fn((_options: { level?: string }) =>
      Promise.resolve({
        content: '{"status":"resolved","strategy":"parentRecord"}',
        model: 'test/fast',
        usage: { promptTokens: 10, completionTokens: 5 },
      })
    );

    const result = await completeStructured(
      {
        messages: [{ role: 'user', content: 'decidí' }],
        level: 'fast',
        responseSchema: schema,
        promptId: 'bind-required-input',
        promptVersion: '1.0.0',
      },
      { call, now: () => 1 }
    );

    expect(call.mock.calls[0]?.[0].level).toBe('fast');
    expect(result.data).toEqual({ status: 'resolved', strategy: 'parentRecord' });
    expect(result.meta).toMatchObject({ level: 'fast', attempts: 1, promptVersion: '1.0.0' });
  });

  it('reintenta una sola vez cuando la primera respuesta no es JSON', async () => {
    let invocation = 0;
    const seenMessages: Array<Array<{ content: string }>> = [];
    const call = vi.fn((options: { messages: Array<{ content: string }> }) => {
      invocation += 1;
      seenMessages.push(options.messages);
      return Promise.resolve(
        invocation === 1
          ? { content: 'texto libre', model: 'test/standard' }
          : {
              content: '{"status":"unresolved","strategy":null}',
              model: 'test/standard',
            }
      );
    });

    const result = await completeStructured(
      {
        messages: [{ role: 'user', content: 'decidí' }],
        responseSchema: schema,
        promptId: 'bind-required-input',
        promptVersion: '1.0.0',
      },
      { call, now: () => 1 }
    );

    expect(call).toHaveBeenCalledTimes(2);
    expect(seenMessages[1]?.at(-1)?.content).toContain('únicamente un objeto JSON');
    expect(result.meta.attempts).toBe(2);
  });

  it('desactiva reasoning y amplía el presupuesto solamente si la salida fue truncada', async () => {
    let invocation = 0;
    const call = vi.fn(
      (_options: { maxTokens?: number; reasoning?: { effort?: string; enabled?: boolean } }) => {
        invocation += 1;
        return Promise.resolve(
          invocation === 1
            ? { content: '{"status":', finishReason: 'length', model: 'test/standard' }
            : {
                content: '{"status":"unresolved","strategy":null}',
                finishReason: 'stop',
                model: 'test/standard',
              }
        );
      }
    );

    const result = await completeStructured(
      {
        messages: [{ role: 'user', content: 'decidí' }],
        responseSchema: schema,
        promptId: 'bind-required-input',
        promptVersion: '1.0.0',
        maxTokens: 500,
        reasoningEnabled: false,
      },
      { call, now: () => 1 }
    );

    expect(call.mock.calls[0]?.[0]).toMatchObject({
      maxTokens: 500,
      reasoning: { enabled: false, exclude: true },
    });
    expect(call.mock.calls[1]?.[0].maxTokens).toBe(1000);
    expect(result.meta.attempts).toBe(2);
  });

  it('una salida inválida no abre el circuit breaker de infraestructura', async () => {
    const call = vi.fn(() => Promise.resolve({ content: 'no-json', model: 'test/standard' }));
    const request = {
      messages: [{ role: 'user' as const, content: 'decidí' }],
      responseSchema: schema,
      promptId: 'bind-required-input',
      promptVersion: '1.0.0',
    };

    for (let index = 0; index < 4; index += 1) {
      await expect(completeStructured(request, { call, now: () => 1 })).rejects.toMatchObject({
        code: 'STRUCTURED_OUTPUT_INVALID',
        statusCode: 422,
      });
    }
    expect(call).toHaveBeenCalledTimes(8);
  });
});

describe('structuredValueProblems', () => {
  it('rechaza campos extra y enum inventado', () => {
    expect(
      structuredValueProblems({ status: 'maybe', strategy: null, invented: true }, schema.schema)
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('enum'),
        expect.stringContaining('no permitido'),
      ])
    );
  });
});
