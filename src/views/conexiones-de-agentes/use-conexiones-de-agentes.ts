/**
 * Conexiones de agentes — datos y estado (generado por el Builder de Vistas).
 *
 * ⚠️ ARCHIVO REGENERABLE: se reescribe al guardar el diseño en el Builder.
 * La lógica custom va en `handlers.ts` (nunca se pisa). Diseño: `spec.json`.
 */
import { actions, events, getHostReact, usePlugin, views } from '@coongro/plugin-sdk';

import { customHandlers } from './handlers.js';

const React = getHostReact();
const { useState, useEffect, useCallback, useMemo, useRef } = React;

export function useConexionesDeAgentesView() {
  const { toast } = usePlugin();
  const mounted = useRef(true);
  // reset en el mount (no solo cleanup): StrictMode desmonta y REMONTA
  // conservando refs — con cleanup solo, el remonte quedaría muerto
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Registro con el que se abrió la vista (views.open(id, { record })): en una
  // ficha es por lo que filtran sus tablas hijas. Null en una lista suelta.
  const viewRecord = ((views.params as any)?.record ?? null) as Record<string, any> | null;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ctx = {
        execute: function exec<T = unknown>(id: string, args?: unknown): Promise<T> {
          return actions.execute<T>(id, args);
        },
        record: viewRecord,
      };
      const byBlock = customHandlers.loadDataFor?.['tabla'];
      const data = byBlock
        ? await byBlock(ctx)
        : customHandlers.loadData
          ? await customHandlers.loadData(ctx)
          : await actions.execute<any[]>('ai-copilot.connections.list');
      if (mounted.current) setRows(Array.isArray(data) ? data : []);
    } catch {
      if (mounted.current) {
        setRows([]);
        toast.error('Error', 'No se pudieron cargar los datos');
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
    // deps intencionalmente fijas: el efecto corre una sola vez
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const offs = [
      'ai-copilot.connections.create',
      'ai-copilot.connections.update',
      'ai-copilot.connections.delete',
      'ai-copilot.connections.restore',
    ].map((id) =>
      events.on(id, () => {
        void load();
      })
    );
    return () => {
      for (const off of offs) off();
    };
  }, [load]);

  const normKey = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  // columnas de la tabla: key + label (+ ref/refDisplay/refPath/ref2/display/values/prefix/suffix/format/iconFrom/empty*)
  const COLUMNS: {
    key: string;
    label: string;
    ref?: string;
    refDisplay?: string;
    refPath?: string;
    ref2?: string;
    display?: string;
    values?: { value: string; label?: string; icon?: string; tone?: string }[];
    tone?: string;
    prefix?: string;
    suffix?: string;
    format?: string;
    iconFrom?: string;
    emptyLabel?: string;
    emptyIcon?: string;
  }[] = [
    { key: 'name', label: 'Conexión' },
    {
      key: 'profile',
      label: 'Permisos',
      display: 'pill',
      values: [
        { value: 'readonly', label: 'Solo consulta', icon: 'Eye', tone: 'neutral' },
        { value: 'operator', label: 'Consulta y opera', icon: 'Pencil', tone: 'warning' },
        { value: 'admin', label: 'Sin restricción', icon: 'ShieldAlert', tone: 'danger' },
      ],
    },
    {
      key: 'enabled',
      label: 'Estado',
      display: 'pill',
      values: [
        { value: 'true', label: 'Activa', tone: 'success' },
        { value: 'false', label: 'Revocada', tone: 'neutral' },
      ],
    },
    { key: 'last_used_at', label: 'Último uso', format: 'datetime', emptyLabel: 'Nunca' },
    { key: 'expires_at', label: 'Vence', format: 'date' },
  ];
  // columnas OCULTAS: alimentan el detalle de la fila expandible
  const HIDDEN_COLUMNS: typeof COLUMNS = [
    { key: 'kit_id', label: 'Alcance', emptyLabel: 'Todo el espacio' },
    { key: 'token_hint', label: 'Fin del token', display: 'mono' },
  ];
  const cellValue = (
    row: any,
    c: { key: string; ref?: string; refDisplay?: string; refPath?: string; ref2?: string }
  ) => {
    let v = row?.[c.key];
    if (v === undefined) {
      const k = Object.keys(row ?? {}).find((x) => normKey(x) === normKey(c.key));
      v = k ? row[k] : undefined;
    }
    return v;
  };
  const mapRow =
    customHandlers.mapRow ??
    ((row: any) =>
      COLUMNS.map((c) => {
        const v = cellValue(row, c);
        return v === null || v === undefined
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v);
      }));

  // orden por columna (click en el encabezado) + filtros automáticos
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  // firma del UI.DataTable del host: (key, 'asc' | 'desc' | null)
  const onSortChange = useCallback((k: string, d: 'asc' | 'desc' | null) => {
    setSort(d ? { k, d: d === 'asc' ? 1 : -1 } : null);
  }, []);
  const [filters, setFilters] = useState<Record<string, string>>({ enabled: 'true' });
  // filtrable = columna con pocos valores distintos (2..12) en los datos
  const filterOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of COLUMNS) {
      const vals = [
        ...new Set(
          rows
            .map((r) => {
              const v = cellValue(r, c);
              return v === null || v === undefined ? '' : String(v);
            })
            .filter(Boolean)
        ),
      ];
      if (vals.length >= 2 && vals.length <= 12) out[c.key] = vals.sort();
    }
    return out;
    // deps intencionalmente fijas: el efecto corre una sola vez
  }, [rows]);
  const visibleRows = useMemo(() => {
    let out = rows;
    if (search)
      out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));
    for (const [k, fv] of Object.entries(filters)) {
      if (!fv) continue;
      const c = COLUMNS.find((x) => x.key === k);
      if (c)
        out = out.filter((r) => {
          const v = cellValue(r, c);
          return String(v ?? '') === fv;
        });
    }
    if (sort) {
      const c = COLUMNS.find((x) => x.key === sort.k);
      if (c)
        out = [...out].sort((ra, rb) => {
          const va = cellValue(ra, c);
          const vb = cellValue(rb, c);
          const na = Number(va);
          const nb = Number(vb);
          const cmp =
            !Number.isNaN(na) && !Number.isNaN(nb) && va !== '' && vb !== ''
              ? na - nb
              : String(va ?? '').localeCompare(String(vb ?? ''));
          return sort.d * cmp;
        });
    }
    return out;
    // deps intencionalmente fijas: el efecto corre una sola vez
  }, [rows, search, filters, sort]);
  // limpiar todo: búsqueda + filtros + orden (botón "Limpiar filtros" del FilterBar)
  const clearFilters = useCallback(() => {
    setSearch('');
    setFilters({});
    setSort(null);
  }, []);
  // paginación (20 por página); vuelve a la página 1 al buscar/filtrar/ordenar
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [search, filters, sort]);
  const pagedRows = useMemo(
    () => visibleRows.slice((page - 1) * 20, page * 20),
    [visibleRows, page]
  );
  const [pendingDelete, setPendingDelete] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const removeRow = useCallback((row: any) => {
    setPendingDelete(row ?? null);
  }, []);
  const cancelDelete = useCallback(() => {
    if (!deleting) setPendingDelete(null);
  }, [deleting]);
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await actions.execute('ai-copilot.connections.delete', { id: pendingDelete.id });
      toast.success('Eliminado', 'El registro se eliminó correctamente');
      setPendingDelete(null);
      void load();
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
    // deps intencionalmente fijas: el efecto corre una sola vez
  }, [pendingDelete, load]);

  return {
    sort,
    onSortChange,
    filters,
    setFilters,
    filterOptions,
    cellValue,
    clearFilters,
    page,
    setPage,
    pagedRows,
    pendingDelete,
    deleting,
    confirmDelete,
    cancelDelete,
    loading,
    search,
    setSearch,
    load,
    COLUMNS,
    mapRow,
    visibleRows,
    removeRow,
    HIDDEN_COLUMNS,
  };
}
