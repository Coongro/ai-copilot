import { describe, expect, it } from 'vitest';

import { applySchemaValues, validateArgs } from './validate.js';

/**
 * Esta capa existe porque del otro lado hay un modelo que improvisa argumentos.
 * Los casos son los que se vieron en las pruebas contra clientes reales.
 */
describe('validateArgs', () => {
  const schema = {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        description: 'Datos del contrato',
        properties: {
          unit_id: { type: 'string', format: 'uuid', description: 'Unidad' },
          start_date: { type: 'string', format: 'date', description: 'Inicio' },
          rent_amount: { type: 'string', pattern: '^\\d+(\\.\\d{1,2})?$', description: 'Monto' },
          due_day: { type: 'integer', description: 'Día de vencimiento' },
          status: { type: 'string', enum: ['vigente', 'finalizado'], description: 'Estado' },
          active: { type: 'boolean', description: 'Activo' },
          tags: { type: 'array', items: { type: 'string', description: 'Etiqueta' } },
        },
        required: ['unit_id', 'start_date'],
        additionalProperties: false,
      },
    },
    required: ['data'],
    additionalProperties: false,
  };

  const valid = {
    data: {
      unit_id: '56d0b2e3-9093-4d60-89c8-39dd80adfbe1',
      start_date: '2026-08-01',
      rent_amount: '586612.50',
      due_day: 10,
      status: 'vigente',
      active: true,
      tags: ['prioritario'],
    },
  };

  it('acepta argumentos que cumplen el schema', () => {
    expect(validateArgs(schema, valid)).toBeNull();
  });

  it('rechaza un escalar donde va un objeto', () => {
    expect(validateArgs(schema, { data: 'un contrato' })).toBe('data debe ser un objeto.');
  });

  it('nombra los campos requeridos que faltan', () => {
    const problem = validateArgs(schema, { data: { unit_id: valid.data.unit_id } });
    expect(problem).toContain('start_date');
  });

  it('rechaza campos que el schema no declara y sugiere los válidos', () => {
    const problem = validateArgs(schema, { data: { ...valid.data, color: 'azul' } });
    expect(problem).toContain('color');
    expect(problem).toContain('unit_id');
  });

  it('exige el formato de fecha en vez de dejar pasar texto libre', () => {
    const args = { data: { ...valid.data, start_date: '1 de agosto' } };
    expect(validateArgs(schema, args)).toContain('AAAA-MM-DD');
  });

  it('exige UUID donde el schema lo pide', () => {
    const args = { data: { ...valid.data, unit_id: 'la unidad 3' } };
    expect(validateArgs(schema, args)).toContain('UUID');
  });

  it('aplica el pattern de los montos', () => {
    const args = { data: { ...valid.data, rent_amount: '586.612,50' } };
    expect(validateArgs(schema, args)).toContain('formato esperado');
  });

  it('rechaza un número mandado como texto', () => {
    const args = { data: { ...valid.data, due_day: '10' } };
    expect(validateArgs(schema, args)).toBe('data.due_day debe ser un número entero.');
  });

  it('rechaza un decimal donde va un entero', () => {
    const args = { data: { ...valid.data, due_day: 10.5 } };
    expect(validateArgs(schema, args)).toContain('entero');
  });

  it('limita los valores de un enum', () => {
    const args = { data: { ...valid.data, status: 'pendiente' } };
    expect(validateArgs(schema, args)).toContain('vigente');
  });

  it('valida cada item de una lista', () => {
    const args = { data: { ...valid.data, tags: ['ok', 42] } };
    expect(validateArgs(schema, args)).toContain('tags[1]');
  });

  it('deja pasar los opcionales ausentes', () => {
    const args = { data: { unit_id: valid.data.unit_id, start_date: '2026-08-01' } };
    expect(validateArgs(schema, args)).toBeNull();
  });

  it('no valida contra un pattern malformado en vez de romper', () => {
    const broken = {
      type: 'object',
      properties: { code: { type: 'string', pattern: '[', description: 'Código' } },
      additionalProperties: false,
    };
    expect(validateArgs(broken, { code: 'lo que sea' })).toBeNull();
  });

  it('acepta un schema sin argumentos', () => {
    const empty = { type: 'object', properties: {}, additionalProperties: false };
    expect(validateArgs(empty, {})).toBeNull();
    expect(validateArgs(empty, { inventado: 1 })).toContain('inventado');
  });
});

describe('applySchemaValues', () => {
  it('inyecta defaults y valores fijos de forma recursiva', () => {
    const schema = {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            status: { type: 'string', const: 'vigente' },
            active: { type: 'boolean', default: true },
            name: { type: 'string' },
          },
        },
      },
    };

    expect(
      applySchemaValues(schema, {
        data: { status: 'hackeado', name: 'Contrato' },
      })
    ).toEqual({ data: { status: 'vigente', active: true, name: 'Contrato' } });
  });
});
