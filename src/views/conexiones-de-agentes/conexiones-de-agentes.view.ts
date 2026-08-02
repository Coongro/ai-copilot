/**
 * Conexiones de agentes — composición y render (generado por el Builder de Vistas).
 *
 * ⚠️ ARCHIVO REGENERABLE: se reescribe al guardar el diseño en el Builder.
 * La lógica custom va en `handlers.ts` (nunca se pisa). Diseño: `spec.json`.
 */
import { getHostReact, getHostUI, useIsMobile, views } from '@coongro/plugin-sdk';

import { useConexionesDeAgentesView } from './use-conexiones-de-agentes.js';

const React = getHostReact();
const h = React.createElement;
// Componentes del HOST: el diseño vive en core — una actualización de
// ui-components se refleja acá sin regenerar esta vista.
const UI = getHostUI() as any;

export function ConexionesDeAgentesView() {
  const isMobile = useIsMobile();
  const {
    loading,
    visibleRows,
    COLUMNS,
    removeRow,
    pendingDelete,
    deleting,
    confirmDelete,
    cancelDelete,
    sort,
    onSortChange,
    cellValue,
    search,
    setSearch,
    clearFilters,
    filters,
    setFilters,
    page,
    setPage,
    pagedRows,
    HIDDEN_COLUMNS,
  } = useConexionesDeAgentesView();

  const cellText = (row: any, c: any) => {
    const v = cellValue(row, c);
    return v === null || v === undefined
      ? ''
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
  };
  const TONE_VARIANT: Record<string, string> = {
    neutral: 'neutral-soft',
    success: 'success-soft',
    warning: 'warning-soft',
    danger: 'danger-soft',
    outline: 'outline',
  };
  const enumVal = (c: any, raw: string) => (c.values ?? []).find((e: any) => e.value === raw);
  const formatDate = (fmt: string, raw: string) => {
    const s = String(raw ?? '');
    const only = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (only) return only[3] + '/' + only[2] + '/' + only[1];
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const p = (n: number) => String(n).padStart(2, '0');
    const dmy = p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
    const hm = p(d.getHours()) + ':' + p(d.getMinutes());
    return fmt === 'datetime' ? dmy + ' ' + hm : fmt === 'time' ? hm : dmy;
  };
  const renderCell = (row: any, c: any) => {
    const raw = cellText(row, c);
    if (raw === '' && c.emptyLabel) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--cg-text-muted)',
          },
        },
        c.emptyIcon ? h(UI.DynamicIcon, { icon: c.emptyIcon, size: 15 }) : null,
        c.emptyLabel
      );
    }
    const ev = enumVal(c, raw);
    const label = c.format ? formatDate(c.format, raw) : (ev?.label ?? raw);
    const shown = raw !== '' ? (c.prefix ?? '') + label + (c.suffix ?? '') : label;
    if (c.display === 'avatar') {
      const initial = (String(raw).trim().charAt(0) || '?').toUpperCase();
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
        h(
          'span',
          {
            style: {
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--cg-gold-soft)',
              border: '1px solid var(--cg-gold-lt)',
              color: 'var(--cg-gold-deep)',
              fontWeight: 700,
              fontSize: '11px',
            },
          },
          initial
        ),
        h('span', null, shown)
      );
    }
    const iconName = ev?.icon;
    const icon = iconName ? h(UI.DynamicIcon, { icon: iconName, size: 16 }) : null;
    if (c.display === 'pill') {
      return label
        ? h(
            UI.Badge,
            {
              variant: TONE_VARIANT[ev?.tone ?? c.tone ?? 'neutral'] ?? 'neutral-soft',
              size: 'compact',
              icon,
            },
            label
          )
        : '';
    }
    if (c.display === 'progress') {
      const n = Math.max(0, Math.min(100, Number(cellValue(row, c)) || 0));
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '90px' } },
        h(
          'div',
          {
            style: {
              flex: '1 1 0',
              height: '6px',
              borderRadius: '999px',
              background: 'var(--cg-bg-secondary)',
              overflow: 'hidden',
            },
          },
          h('div', {
            style: {
              width: n + '%',
              height: '100%',
              borderRadius: '999px',
              background: 'var(--cg-gold)',
            },
          })
        ),
        h(
          'span',
          { style: { fontSize: '12px', color: 'var(--cg-text-muted)' } },
          Math.round(n) + '%'
        )
      );
    }
    if (c.display === 'mono')
      return h(
        'span',
        { style: { fontFamily: 'ui-monospace, monospace', fontSize: '12px' } },
        shown
      );
    return icon
      ? h(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          icon,
          shown
        )
      : shown;
  };
  const valueLabel = (key: string, raw: string) =>
    (COLUMNS.find((c) => c.key === key)?.values ?? []).find((v: any) => v.value === raw)?.label ??
    raw;
  const ROW_ACTIONS = [
    {
      label: 'Revocar',
      variant: 'destructive' as const,
      icon: 'Ban',
      onClick: (row: any) => {
        void removeRow(row);
      },
      hidden: (row: any) => !['true'].includes(String(row?.['enabled'] ?? '')),
    },
    {
      label: 'Reactivar',
      icon: 'RotateCcw',
      onClick: () => {},
      hidden: (row: any) => !['false'].includes(String(row?.['enabled'] ?? '')),
    },
    {
      label: 'Eliminar',
      variant: 'destructive' as const,
      icon: 'Trash2',
      onClick: (row: any) => {
        void removeRow(row);
      },
    },
  ];
  const renderTable = () =>
    h(
      'div',
      {
        style: {
          background: 'var(--cg-bg)',
          border: '1px solid var(--cg-border)',
          borderRadius: '14px',
          padding: '20px',
        },
      },
      h(UI.DataTable, {
        data: pagedRows,
        rowKey: (row: any) => String(row.id ?? JSON.stringify(row)),
        loading,
        columns: COLUMNS.map((c) => ({
          key: c.key,
          header: c.label,
          sortable: true,
          render: (row: any) => renderCell(row, c),
        })),
        searchPlaceholder: 'Buscar…',
        searchValue: search,
        onSearchChange: setSearch,
        filterSections: [
          {
            label: 'Estado',
            options: [
              { value: '', label: 'Todos' },
              ...[
                { value: 'Activa', label: valueLabel('enabled', 'Activa') },
                { value: 'Revocada', label: valueLabel('enabled', 'Revocada') },
              ],
            ],
            value: filters['enabled'] ?? '',
            onChange: (v: string) => setFilters((ff: any) => ({ ...ff, ['enabled']: v })),
          },
          {
            label: 'Permisos',
            options: [
              { value: '', label: 'Todos' },
              ...[
                { value: 'Solo consulta', label: valueLabel('profile', 'Solo consulta') },
                { value: 'Consulta y opera', label: valueLabel('profile', 'Consulta y opera') },
                { value: 'Sin restricción', label: valueLabel('profile', 'Sin restricción') },
              ],
            ],
            value: filters['profile'] ?? '',
            onChange: (v: string) => setFilters((ff: any) => ({ ...ff, ['profile']: v })),
          },
        ].filter((s) => s.options.length > 1),
        sortKey: sort?.k ?? null,
        sortDirection: sort ? (sort.d > 0 ? 'asc' : 'desc') : null,
        onSortChange,
        pagination: { page, pageSize: 20, total: visibleRows.length },
        onPageChange: setPage,
        onRowClick: (row: any) => {
          views.open('ai-copilot.nueva-conexion.open', { record: row }, { mode: 'dialog' });
        },
        actions: ROW_ACTIONS,
        itemLabel: (row: any) => cellText(row, COLUMNS[0]),
        renderExpanded: (row: any) =>
          h(
            'div',
            {
              style: {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '14px',
              },
            },
            ...HIDDEN_COLUMNS.map((c) =>
              h(
                'div',
                { key: c.key, style: { minWidth: 0 } },
                h(
                  'div',
                  {
                    style: {
                      fontSize: '10.5px',
                      fontWeight: 700,
                      letterSpacing: '.06em',
                      textTransform: 'uppercase' as const,
                      color: 'var(--cg-text-muted)',
                    },
                  },
                  c.label
                ),
                h('div', { style: { fontSize: '13.5px', marginTop: '2px' } }, renderCell(row, c))
              )
            )
          ),
        mobileRender: (row: any) =>
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column' as const, gap: '6px' } },
            h(
              'div',
              { style: { fontSize: '14px', fontWeight: 600, color: 'var(--cg-text)' } },
              renderCell(row, COLUMNS[0])
            ),
            ...COLUMNS.slice(1).map((c) =>
              h(
                'div',
                {
                  key: c.key,
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '13px',
                  },
                },
                h('span', { style: { color: 'var(--cg-text-muted)', flexShrink: 0 } }, c.label),
                h(
                  'span',
                  {
                    style: {
                      textAlign: 'right' as const,
                      minWidth: 0,
                      flex: '1 1 auto',
                      display: 'flex',
                      justifyContent: 'flex-end',
                    },
                  },
                  renderCell(row, c)
                )
              )
            )
          ),
        onClearFilters: () => {
          clearFilters();
        },
        emptyState: {
          title: 'Todavía no hay conexiones',
          description:
            'Generá una y pegá su URL en Claude o ChatGPT para que trabajen con tus datos.',
          filteredTitle: 'Sin resultados',
          filteredDescription: 'Probá con otros términos o ajustá los filtros.',
        },
      })
    );

  return h(
    'div',
    {
      style: {
        minHeight: '100%',
        backgroundColor: 'var(--cg-bg-secondary)',
        padding: isMobile ? '16px' : '24px',
      },
    },
    h(
      'div',
      { style: { width: '100%', display: 'flex', flexDirection: 'column' as const, gap: '18px' } },
      h(
        'div',
        { 'data-cg-block-id': 'hdr', style: { display: 'contents' } },
        h(
          'div',
          null,
          h(
            'div',
            {
              style: {
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase' as const,
                color: 'var(--cg-gold-deep)',
                marginBottom: '5px',
              },
            },
            'Asistente IA'
          ),
          h(UI.PageHeader, {
            title: 'Conexiones de agentes',
            subtitle:
              'Conectá Claude, ChatGPT o Codex a tu Coongro. Cada conexión ve solo lo que habilitan sus permisos.',
            action: h(
              UI.Button,
              {
                variant: 'default',
                onClick: () => {
                  views.open('ai-copilot.nueva-conexion.open', undefined, { mode: 'dialog' });
                },
              },
              'Nueva conexión'
            ),
          })
        )
      ),
      h('div', { 'data-cg-block-id': 'tabla', style: { display: 'contents' } }, renderTable())
    ),
    h(UI.ConfirmDialog, {
      open: !!pendingDelete,
      onOpenChange: (o: boolean) => {
        if (!o) cancelDelete();
      },
      title: 'Eliminar registro',
      description: '¿Seguro que querés eliminar este registro? No se puede deshacer.',
      confirmLabel: 'Eliminar',
      loading: deleting,
      onConfirm: () => {
        void confirmDelete();
      },
    })
  );
}
