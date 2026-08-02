/**
 * Nueva conexión — composición y render (generado por el Builder de Vistas).
 *
 * ⚠️ ARCHIVO REGENERABLE: se reescribe al guardar el diseño en el Builder.
 * La lógica custom va en `handlers.ts` (nunca se pisa). Diseño: `spec.json`.
 */
import { actions, getHostReact, getHostUI } from '@coongro/plugin-sdk';

import { useNuevaConexionView } from './use-nueva-conexion.js';

const React = getHostReact();
const { useState } = React;
const h = React.createElement;
// Componentes del HOST: el diseño vive en core — una actualización de
// ui-components se refleja acá sin regenerar esta vista.
const UI = getHostUI() as any;

/**
 * Valor que solo se ve una vez: se genera con la acción y queda en el estado
 * del bloque. No hay recarga posible — si se pierde, hay que generar otro.
 */
function SecretRevealBlock(props: {
  buttonLabel: string;
  label: string;
  warning: string;
  copyLabel: string;
  valueKey: string;
  run?: () => Promise<unknown>;
}) {
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const generate = async () => {
    if (!props.run) return;
    setBusy(true);
    try {
      const res: any = await props.run();
      const raw = props.valueKey && res && typeof res === 'object' ? res[props.valueKey] : res;
      setValue(
        typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw)
      );
      setCopied(false);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    // navigator.clipboard NO existe fuera de contexto seguro (http en LAN,
    // que es como se prueba en desarrollo). execCommand está deprecado pero
    // sigue siendo el único camino ahí, y el valor queda seleccionado para
    // copiar a mano si tampoco funciona: el secreto no se pierde.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        return;
      }
    } catch {
      /* sigue por execCommand */
    }
    const field = inputRef.current;
    if (!field) return;
    field.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    setCopied(ok);
  };
  if (!value) {
    return h(
      'div',
      { style: { display: 'flex' } },
      h(
        UI.Button,
        {
          onClick: () => {
            void generate();
          },
          disabled: busy || !props.run,
        },
        busy ? 'Generando…' : props.buttonLabel
      )
    );
  }
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '14px',
        borderRadius: '10px',
        border: '1px solid var(--cg-border)',
        background: 'var(--cg-surface)',
      },
    },
    h('span', { style: { fontSize: '12px', fontWeight: 600 } }, props.label),
    h(
      'div',
      { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      h('input', {
        ref: inputRef,
        readOnly: true,
        value,
        onFocus: (e: any) => e.target.select(),
        style: {
          flex: 1,
          minWidth: 0,
          fontFamily: 'ui-monospace, monospace',
          fontSize: '12px',
          padding: '9px 11px',
          borderRadius: '8px',
          border: '1px solid var(--cg-border-light)',
          background: 'var(--cg-bg-main)',
          color: 'var(--cg-text-secondary)',
        },
      }),
      h(
        UI.Button,
        {
          variant: 'secondary',
          onClick: () => {
            void copy();
          },
        },
        copied ? 'Copiado' : props.copyLabel
      )
    ),
    h('span', { style: { fontSize: '11.5px', color: 'var(--cg-gold-deep)' } }, props.warning)
  );
}

export function NuevaConexionView() {
  const { values, errors, setField } = useNuevaConexionView();

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column' as const } },
    h(
      'div',
      {
        style: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '16px' },
      },
      h(
        'div',
        { 'data-cg-block-id': 'card', style: { display: 'contents' } },
        h(
          UI.FormSection,
          { icon: 'Plug', title: 'Datos de la conexión' },
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                padding: '24px',
                alignItems: 'stretch',
              },
            },
            h(
              'div',
              { 'data-cg-block-id': 'f_name', style: { display: 'contents' } },
              h(
                'div',
                { style: { flex: '1 1 100%', minWidth: 0 } },
                h(
                  UI.Label,
                  { htmlFor: 'name', style: { display: 'block', marginBottom: '6px' } },
                  'Nombre',
                  h('span', { style: { color: 'var(--cg-danger)' } }, ' *')
                ),
                h(UI.Input, {
                  id: 'name',
                  type: 'text',
                  value: String(values['name'] ?? ''),
                  placeholder: 'Ej: Claude de Lucía',
                  onChange: (e: any) => setField('name', e.target.value),
                }),
                errors['name']
                  ? h(
                      'div',
                      { style: { fontSize: '12px', color: 'var(--cg-danger)', marginTop: '4px' } },
                      errors['name']
                    )
                  : null
              )
            ),
            h(
              'div',
              { 'data-cg-block-id': 'f_profile', style: { display: 'contents' } },
              h(
                'div',
                { style: { flex: '1 1 100%', minWidth: 0 } },
                h(
                  UI.Label,
                  { htmlFor: 'profile', style: { display: 'block', marginBottom: '6px' } },
                  'Permisos',
                  h('span', { style: { color: 'var(--cg-danger)' } }, ' *')
                ),
                h(
                  UI.Select,
                  {
                    value: String(values['profile'] ?? ''),
                    onValueChange: (v: string) => setField('profile', v),
                    placeholder: 'Elegir…',
                    clearable: true,
                  },
                  h(
                    UI.SelectItem,
                    { key: 'Solo consulta', value: 'Solo consulta' },
                    'Solo consulta'
                  ),
                  h(
                    UI.SelectItem,
                    { key: 'Consulta y opera', value: 'Consulta y opera' },
                    'Consulta y opera'
                  ),
                  h(
                    UI.SelectItem,
                    { key: 'Sin restricción', value: 'Sin restricción' },
                    'Sin restricción'
                  )
                ),
                errors['profile']
                  ? h(
                      'div',
                      { style: { fontSize: '12px', color: 'var(--cg-danger)', marginTop: '4px' } },
                      errors['profile']
                    )
                  : null
              )
            ),
            h(
              'div',
              { 'data-cg-block-id': 'secreto', style: { display: 'contents' } },
              h(SecretRevealBlock, {
                buttonLabel: 'Generar enlace',
                label: 'Enlace para el cliente',
                warning: 'Copialo ahora: por seguridad no se vuelve a mostrar.',
                copyLabel: 'Copiar',
                valueKey: 'url',
                run: () => actions.execute('ai-copilot.connections.create', { data: values }),
              })
            )
          )
        )
      )
    )
  );
}
