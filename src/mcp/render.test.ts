import { describe, expect, it, vi } from 'vitest';

import type { CapabilityOutput } from '../endpoints/_context.js';

import { renderResult } from './render.js';

const output: CapabilityOutput = {
  kind: 'collection',
  identifierKey: 'id',
  defaultLimit: 2,
  maxLimit: 3,
  fields: [
    { key: 'tenant_name', name: 'tenantName', label: 'Inquilino' },
    { key: 'start_date', name: 'startDate', label: 'Desde', format: 'date' },
    { key: 'rent_amount', name: 'rentAmount', label: 'Alquiler', format: 'money' },
    {
      key: 'status',
      name: 'status',
      label: 'Estado',
      values: [{ value: 'active', label: 'Vigente' }],
    },
  ],
};

describe('renderResult con contrato de salida', () => {
  it('proyecta campos legibles, preserva _ref y aplica el límite', async () => {
    const result = await renderResult(
      [
        {
          id: '8aec2a1d-e13b-47a0-a476-054bc5b3fb87',
          tenant_name: 'Martina Ruiz',
          start_date: '2025-09-01',
          rent_amount: '485000.50',
          status: 'active',
          tenant_id: 'interno',
        },
        { id: '2', tenant_name: 'Diego Sosa', rent_amount: '460000', status: 'active' },
        { id: '3', tenant_name: 'Nicolás Vera', rent_amount: '505000', status: 'active' },
      ],
      { output, args: {} }
    );

    expect(result.text).toContain('Mostrando 1-2 de 3 resultados (hay más).');
    expect(result.text).toContain(
      'Inquilino: Martina Ruiz · Desde: 01/09/2025 · Alquiler: $ 485.000,50 · Estado: Vigente'
    );
    expect(result.text).not.toContain('tenant_id');
    // La referencia SÍ va en el texto visible (goal.md §12): no todos los
    // clientes MCP le muestran `structuredContent` al modelo, y sin el handle a
    // la vista el agente ve el registro pero no puede encadenar nada con él —
    // lista el edificio y después no puede crearle una unidad. Lo que no debe
    // aparecer es el UUID como si fuera un campo del negocio, y por eso va
    // etiquetado como «Referencia».
    expect(result.text).toContain('Referencia: 8aec2a1d-e13b-47a0-a476-054bc5b3fb87');
    expect(result.data).toEqual({
      items: [
        {
          _ref: '8aec2a1d-e13b-47a0-a476-054bc5b3fb87',
          tenantName: 'Martina Ruiz',
          startDate: '01/09/2025',
          rentAmount: '$ 485.000,50',
          status: 'Vigente',
        },
        {
          _ref: '2',
          tenantName: 'Diego Sosa',
          rentAmount: '$ 460.000',
          status: 'Vigente',
        },
      ],
      page: { offset: 0, limit: 2, returned: 2, total: 3, hasMore: true },
    });
  });

  it('permite pedir la página siguiente sin superar el máximo', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: String(index + 1),
      tenant_name: `Persona ${index + 1}`,
    }));
    const result = await renderResult(rows, { output, args: { offset: 2, limit: 99 } });

    expect(result.data).toMatchObject({
      items: [
        { _ref: '3', tenantName: 'Persona 3' },
        { _ref: '4', tenantName: 'Persona 4' },
        { _ref: '5', tenantName: 'Persona 5' },
      ],
      page: { offset: 2, limit: 3, returned: 3, total: 6, hasMore: true },
    });
  });

  it('resuelve referencias con cache y no muestra el UUID referido', async () => {
    const resolveReference = vi.fn(() => Promise.resolve({ id: 'person-1', name: 'Ana Pérez' }));
    const referenced: CapabilityOutput = {
      ...output,
      fields: [
        {
          key: 'tenant_id',
          name: 'tenant',
          label: 'Inquilino',
          reference: { action: 'contacts.people.getById', displayField: 'name' },
        },
      ],
    };
    const result = await renderResult(
      [
        { id: '1', tenant_id: 'person-1' },
        { id: '2', tenant_id: 'person-1' },
      ],
      { output: referenced, resolveReference }
    );

    expect(resolveReference).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('Inquilino: Ana Pérez');
    expect(result.text).not.toContain('person-1');
  });

  it('proyecta un record aunque el repositorio devuelva un array de una fila', async () => {
    // `.returning()` de Drizzle devuelve array. Exigir un objeto hacía que la
    // proyección no se aplicara y el agente recibiera el volcado crudo con las
    // columnas internas. Detectado por el agente ciego (COONG-293).
    const output = {
      kind: 'record' as const,
      identifierKey: 'id',
      fields: [{ key: 'name', name: 'name', label: 'Unidad' }],
    };
    const result = await renderResult(
      [{ id: 'u-1', name: '1° A', deleted_at: null, is_active: true }],
      {
        output,
        resource: 'properties.units',
      }
    );

    expect(result.text).toContain('Unidad: 1° A');
    expect(result.text).toContain('Referencia: properties.units:u-1');
    expect(result.text).not.toContain('deleted_at');
    expect(result.text).not.toContain('is_active');
  });

  it('emite la referencia como handle nominal cuando conoce el recurso', async () => {
    // Un id pelado obliga al agente a adivinar de qué recurso era; el handle
    // `recurso:id` es lo que un input `ref` acepta sin traducción. Detectado
    // por el agente ciego (COONG-293): listaba el edificio, veía sus datos y
    // no tenía con qué crearle una unidad.
    const output = {
      kind: 'collection' as const,
      identifierKey: 'id',
      fields: [{ key: 'name', name: 'name', label: 'Propiedad' }],
    };
    const result = await renderResult([{ id: 'bld-1', name: 'Belgrano 1240' }], {
      output,
      resource: 'properties.buildings',
    });

    expect(result.text).toContain('Referencia: properties.buildings:bld-1');
    expect((result.data as { items: Array<{ _ref: string }> }).items[0]._ref).toBe(
      'properties.buildings:bld-1'
    );
  });
});
