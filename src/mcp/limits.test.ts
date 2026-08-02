import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkRateLimit,
  idempotencyKey,
  recallExecution,
  rememberExecution,
  resetLimits,
} from './limits.js';

describe('rate limit', () => {
  beforeEach(() => {
    resetLimits();
  });

  it('deja pasar hasta el límite y corta después', () => {
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit('cnx-1', false).allowed).toBe(true);
    }
    const blocked = checkRateLimit('cnx-1', false);
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toContain('límite de llamadas');
  });

  it('cuenta por conexión: una no consume el presupuesto de la otra', () => {
    for (let i = 0; i < 60; i++) checkRateLimit('cnx-1', false);
    expect(checkRateLimit('cnx-2', false).allowed).toBe(true);
  });

  it('corta las escrituras antes que las lecturas', () => {
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit('cnx-1', true).allowed).toBe(true);
    }
    const blocked = checkRateLimit('cnx-1', true);
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toContain('escritura');
    // El presupuesto general todavía tiene margen: solo se agotó el de escritura.
    expect(checkRateLimit('cnx-1', false).allowed).toBe(true);
  });

  it('libera el presupuesto al pasar la ventana', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 60; i++) checkRateLimit('cnx-1', false);
      expect(checkRateLimit('cnx-1', false).allowed).toBe(false);

      vi.advanceTimersByTime(61_000);
      expect(checkRateLimit('cnx-1', false).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('idempotencia', () => {
  beforeEach(() => {
    resetLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('el orden de las claves no cambia la identidad del pedido', () => {
    const a = idempotencyKey('cnx-1', 'leases.contracts.create', { b: 2, a: 1 });
    const b = idempotencyKey('cnx-1', 'leases.contracts.create', { a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('distingue conexión, capacidad y argumentos', () => {
    const base = idempotencyKey('cnx-1', 'crear', { valor: 1 });
    expect(idempotencyKey('cnx-2', 'crear', { valor: 1 })).not.toBe(base);
    expect(idempotencyKey('cnx-1', 'otra', { valor: 1 })).not.toBe(base);
    expect(idempotencyKey('cnx-1', 'crear', { valor: 2 })).not.toBe(base);
  });

  it('devuelve el resultado anterior ante un reintento idéntico', () => {
    const key = idempotencyKey('cnx-1', 'crear', { valor: 1 });
    expect(recallExecution(key)).toBeNull();

    rememberExecution(key, { id: 'abc' });
    expect(recallExecution(key)).toEqual({ result: { id: 'abc' } });
  });

  it('olvida la ejecución pasada la ventana', () => {
    vi.useFakeTimers();
    const key = idempotencyKey('cnx-1', 'crear', { valor: 1 });
    rememberExecution(key, { id: 'abc' });

    vi.advanceTimersByTime(61_000);
    expect(recallExecution(key)).toBeNull();
  });
});
