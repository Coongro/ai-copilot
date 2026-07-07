/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Observador de pantalla ARIA-first. Convierte la UI viva en `ObservedScreen`
 * leyendo ROL ARIA + nombre accesible + estado de cada control. Un único
 * recorrido cubre checkbox/switch/radio/tabs/combobox/expandibles/inputs/etc.
 * sin un lector a medida por widget. Cada control se taggea con
 * data-cg-ai-ref (para reubicarlo) y data-cg-ai-kind (para que el actuador sepa
 * cómo manejarlo).
 *
 * Cubre tanto widgets ARIA (Radix) como controles NATIVOS sin rol explícito
 * (checkbox/radio/submit): el selector de atributo [role=...] no ve roles
 * implícitos, así que cada familia nativa tiene su lector.
 *
 * Contrato completo y guía de extensión: docs/observador-actuador.md
 *
 * Versión de plugin: obtiene menús y vista activa vía window.coongro (bridge),
 * no de los stores del core.
 */

import { computeAccessibleName } from './accname.js';
import { getActiveViewId, listMenuSections, type SectionMenuItem } from './bridge.js';
import type {
  ControlKind,
  ControlOption,
  MenuItem,
  ObservedScreen,
  ScreenControl,
  ScreenLayer,
  ScreenTable,
} from './types.js';

export const AI_REF_ATTR = 'data-cg-ai-ref';
export const AI_KIND_ATTR = 'data-cg-ai-kind';

const SEL = {
  combobox: '[role="combobox"]',
  radiogroup: '[role="radiogroup"]',
  radio: '[role="radio"]',
  tablist: '[role="tablist"]',
  tab: '[role="tab"]',
  // Nativos incluidos: input[type=checkbox] no matchea [role="checkbox"].
  toggles: '[role="checkbox"],[role="switch"],input[type="checkbox"]',
  numbers: '[role="spinbutton"],[role="slider"]',
  buttons: 'button,[role="button"],a[href],input[type="submit"],input[type="button"]',
  overlays: '[role="dialog"],[role="alertdialog"],dialog[open]',
};

// checkbox/radio los leen readToggles/readNativeRadioGroups; submit/button, readButtons.
const SKIP_INPUT_TYPES = new Set(['hidden', 'checkbox', 'radio', 'submit', 'button', 'file']);

const MAX_TABLE_ROWS = 15;

// --- Menús (cache corta) ---

let menuCache: { items: MenuItem[]; at: number } | null = null;
const MENU_TTL_MS = 60_000;

function flattenMenu(items: SectionMenuItem[], acc: MenuItem[]): void {
  for (const item of items) {
    if (item.viewId) acc.push({ label: item.label, viewId: item.viewId, path: item.path ?? '' });
    if (item.children?.length) flattenMenu(item.children, acc);
  }
}

async function getMenus(): Promise<MenuItem[]> {
  const now = Date.now();
  if (menuCache && now - menuCache.at < MENU_TTL_MS) return menuCache.items;
  try {
    const sections = await listMenuSections();
    const items: MenuItem[] = [];
    for (const section of sections) flattenMenu(section.items ?? [], items);
    menuCache = { items, at: now };
    return items;
  } catch {
    return menuCache?.items ?? [];
  }
}

// --- Helpers DOM ---

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function isVisible(el: Element): boolean {
  const he = el as HTMLElement;
  if (he.closest('[inert],[aria-hidden="true"]')) return false;
  if (he.offsetParent === null && getComputedStyle(he).position !== 'fixed') return false;
  const rect = he.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  const style = getComputedStyle(he);
  return style.visibility !== 'hidden' && style.opacity !== '0';
}

export function isDisabled(el: HTMLElement): boolean {
  if ('disabled' in el && (el as HTMLInputElement | HTMLButtonElement).disabled) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return el.closest('fieldset[disabled]') !== null;
}

/**
 * Capa a observar: overlay abierto (dialog/alertdialog/<dialog> nativo) tiene
 * prioridad sobre main; popover abierto, sobre ambos. Soporta overlays sin
 * data-state (no-Radix): solo se descarta data-state con valor distinto de
 * "open" (animación de salida de Radix). Con varios overlays apilados gana el
 * último del DOM (el de arriba). Todo lo que viva dentro del drawer del
 * copiloto (data-cg-copilot-panel) se excluye para que el agente no se lea a
 * sí mismo.
 */
function getScope(): { el: HTMLElement; layer: ScreenLayer } {
  const notOurs = (el: HTMLElement): boolean => !el.closest('[data-cg-copilot-panel]');
  const radixOpen = (el: HTMLElement): boolean => {
    const state = el.getAttribute('data-state');
    return state === null || state === 'open';
  };

  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(SEL.overlays)).filter(
    (el) => notOurs(el) && radixOpen(el) && isVisible(el)
  );
  const dialog = dialogs.at(-1);
  if (dialog) return { el: dialog, layer: 'dialog' };

  const popovers = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-radix-popper-content-wrapper] [data-state="open"],[role="menu"][data-state="open"]'
    )
  ).filter((el) => notOurs(el) && isVisible(el));
  const popover = popovers.at(-1);
  if (popover) return { el: popover, layer: 'popover' };

  const main = document.querySelector('main');
  return { el: main ?? document.body, layer: 'main' };
}

interface Ctx {
  scope: HTMLElement;
  claimed: WeakSet<Element>;
  controls: ScreenControl[];
  n: number;
}

function emit(ctx: Ctx, el: HTMLElement, control: Omit<ScreenControl, 'ref'>): void {
  const ref = `c${ctx.n++}`;
  el.setAttribute(AI_REF_ATTR, ref);
  el.setAttribute(AI_KIND_ATTR, control.kind);
  ctx.controls.push({ ref, ...control });
}

function toggleState(el: Element): string {
  if (el instanceof HTMLInputElement) {
    if (el.indeterminate) return 'mixed';
    return el.checked ? 'checked' : 'unchecked';
  }
  const c = el.getAttribute('aria-checked');
  if (c === 'mixed') return 'mixed';
  return c === 'true' ? 'checked' : 'unchecked';
}

// --- Lectores por familia (en orden de prioridad; cada uno "reclama" su subtree) ---

function readChoices(ctx: Ctx, groupSel: string, itemSel: string, selectedAttr: string): void {
  ctx.scope.querySelectorAll<HTMLElement>(groupSel).forEach((group) => {
    if (ctx.claimed.has(group) || !isVisible(group)) return;
    const items = Array.from(group.querySelectorAll<HTMLElement>(itemSel));
    ctx.claimed.add(group);
    const options: ControlOption[] = [];
    let value = '';
    for (const item of items) {
      ctx.claimed.add(item);
      // Solo las opciones visibles son elegibles — el actuador clickea por
      // tamaño y una opción oculta sería inaccionable.
      if (!isVisible(item)) continue;
      const label = computeAccessibleName(item, true) || clean(item.getAttribute('value'));
      const selected = item.getAttribute(selectedAttr) === 'true';
      options.push({ label, selected });
      if (selected) value = label;
    }
    if (options.length === 0) return;
    emit(ctx, group, { kind: 'choice', name: computeAccessibleName(group), value, options });
  });
}

/**
 * Radios NATIVOS (input[type=radio] sin role explícito): se agrupan por `name`
 * y se emite UN control choice sobre el ancestro común mínimo del grupo, para
 * que el actuador encuentre las opciones adentro.
 */
function readNativeRadioGroups(ctx: Ctx): void {
  const radios = Array.from(
    ctx.scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')
  ).filter((r) => !ctx.claimed.has(r) && isVisible(r));

  const groups = new Map<string, HTMLInputElement[]>();
  for (const radio of radios) {
    const key = radio.name || '__sin_name__';
    const list = groups.get(key) ?? [];
    list.push(radio);
    groups.set(key, list);
  }

  for (const items of groups.values()) {
    items.forEach((i) => ctx.claimed.add(i));
    let host: HTMLElement = items[0];
    while (host.parentElement && !items.every((i) => host.contains(i))) {
      host = host.parentElement;
    }
    if (ctx.claimed.has(host)) continue;
    ctx.claimed.add(host);

    const options: ControlOption[] = [];
    let value = '';
    for (const item of items) {
      const label = computeAccessibleName(item) || clean(item.value);
      options.push({ label, selected: item.checked });
      if (item.checked) value = label;
    }
    emit(ctx, host, { kind: 'choice', name: computeAccessibleName(host), value, options });
  }
}

function readComboboxes(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>(SEL.combobox).forEach((cb) => {
    if (ctx.claimed.has(cb) || !isVisible(cb)) return;
    ctx.claimed.add(cb);
    cb.querySelectorAll('*').forEach((d) => ctx.claimed.add(d));
    const inner = cb.querySelector('input');
    // Radix marca con data-placeholder al trigger que todavía muestra el
    // placeholder: ese texto NO es un valor elegido.
    const showsPlaceholder =
      cb.hasAttribute('data-placeholder') || !!cb.querySelector('[data-placeholder]');
    emit(ctx, cb, {
      kind: 'select',
      name: computeAccessibleName(cb),
      value: inner?.value || (showsPlaceholder ? '' : clean(cb.textContent)),
      placeholder: inner?.placeholder || undefined,
      state: isDisabled(cb) ? 'disabled' : undefined,
    });
  });
}

function readNativeSelects(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLSelectElement>('select').forEach((el) => {
    if (ctx.claimed.has(el) || !isVisible(el)) return;
    ctx.claimed.add(el);
    const options: ControlOption[] = Array.from(el.options).map((o) => ({
      label: clean(o.textContent),
      selected: o.selected,
    }));
    emit(ctx, el, {
      kind: 'choice',
      name: computeAccessibleName(el),
      value: clean(el.selectedOptions[0]?.textContent),
      options,
      state: isDisabled(el) ? 'disabled' : undefined,
    });
  });
}

function inputKind(el: HTMLInputElement | HTMLTextAreaElement): ControlKind {
  if (el instanceof HTMLTextAreaElement) return 'text';
  if (el.type === 'number') return 'number';
  if (el.type === 'date' || el.type === 'time' || el.type === 'datetime-local') return 'date';
  // Trigger de picker: readonly + marca explícita. Un readonly genérico NO es
  // fecha — es un campo de solo lectura (total calculado, código, etc.).
  if (
    el.readOnly &&
    (el.getAttribute('data-cg-control') === 'date' || el.hasAttribute('aria-haspopup'))
  ) {
    return 'date';
  }
  return 'text';
}

function inputState(
  el: HTMLInputElement | HTMLTextAreaElement,
  kind: ControlKind
): string | undefined {
  if (isDisabled(el)) return 'disabled';
  // Los triggers de picker son readonly por diseño; solo los campos de
  // texto/número readonly son realmente no-editables para el agente.
  if (el.readOnly && kind !== 'date') return 'readonly';
  return undefined;
}

function readInputs(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>('input, textarea').forEach((node) => {
    const el = node as HTMLInputElement | HTMLTextAreaElement;
    if (ctx.claimed.has(el) || el.closest(SEL.combobox)) return;
    if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type)) return;
    if (!isVisible(el)) return;
    ctx.claimed.add(el);
    const kind = inputKind(el);
    emit(ctx, el, {
      kind,
      name: computeAccessibleName(el),
      value: el.value || '',
      placeholder: (el as HTMLInputElement).placeholder || undefined,
      state: inputState(el, kind),
    });
  });
}

function readToggles(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>(SEL.toggles).forEach((el) => {
    if (ctx.claimed.has(el) || !isVisible(el)) return;
    ctx.claimed.add(el);
    const state = toggleState(el);
    emit(ctx, el, {
      kind: 'toggle',
      name: computeAccessibleName(el),
      value: state,
      state: isDisabled(el) ? 'disabled' : state,
    });
  });
}

function readNumbers(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>(SEL.numbers).forEach((el) => {
    if (ctx.claimed.has(el) || !isVisible(el)) return;
    ctx.claimed.add(el);
    const value = el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow') || '';
    const meta: Record<string, string> = {};
    const min = el.getAttribute('aria-valuemin');
    const max = el.getAttribute('aria-valuemax');
    if (min) meta.min = min;
    if (max) meta.max = max;
    emit(ctx, el, {
      kind: 'number',
      name: computeAccessibleName(el),
      value,
      meta,
      state: isDisabled(el) ? 'disabled' : undefined,
    });
  });
}

function readExpandables(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>('[aria-expanded]').forEach((el) => {
    if (ctx.claimed.has(el) || el.matches(SEL.combobox) || !isVisible(el)) return;
    ctx.claimed.add(el);
    const expanded = el.getAttribute('aria-expanded') === 'true';
    emit(ctx, el, {
      kind: 'expandable',
      name: computeAccessibleName(el, true),
      state: isDisabled(el) ? 'disabled' : expanded ? 'expanded' : 'collapsed',
    });
  });
}

function readButtons(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>(SEL.buttons).forEach((el) => {
    if (ctx.claimed.has(el) || el.closest(SEL.combobox)) return;
    if (!isVisible(el)) return;
    const name = computeAccessibleName(el, true);
    if (!name) return;
    ctx.claimed.add(el);
    // Los deshabilitados se emiten IGUAL con state disabled: el modelo tiene
    // que saber que "Guardar" existe pero está bloqueado (falta completar algo).
    emit(ctx, el, { kind: 'button', name, state: isDisabled(el) ? 'disabled' : undefined });
  });
}

function readTables(ctx: Ctx): ScreenTable[] {
  const tables: ScreenTable[] = [];
  ctx.scope.querySelectorAll('table').forEach((table) => {
    if (!isVisible(table)) return;
    const caption = clean(table.querySelector('caption')?.textContent);
    const name = caption || clean(table.getAttribute('aria-label')) || undefined;
    const columns: string[] = [];
    table.querySelectorAll('thead th').forEach((th) => columns.push(clean(th.textContent)));
    const rows: ScreenTable['rows'] = [];
    const allRows = table.querySelectorAll('tbody tr');
    allRows.forEach((tr, i) => {
      if (i >= MAX_TABLE_ROWS) return;
      const cells: string[] = [];
      tr.querySelectorAll('td').forEach((td) => cells.push(clean(td.textContent)));
      if (cells.length === 0) return;
      const ref = `c${ctx.n++}`;
      (tr as HTMLElement).setAttribute(AI_REF_ATTR, ref);
      (tr as HTMLElement).setAttribute(AI_KIND_ATTR, 'button');
      rows.push({ ref, cells });
    });
    tables.push({ name, columns, rows, truncated: allRows.length > MAX_TABLE_ROWS });
  });
  return tables;
}

function clearRefs(): void {
  document.querySelectorAll(`[${AI_REF_ATTR}]`).forEach((el) => {
    el.removeAttribute(AI_REF_ATTR);
    el.removeAttribute(AI_KIND_ATTR);
  });
}

function resolveViewTitle(activeViewId: string | null, menus: MenuItem[]): string | null {
  if (!activeViewId) return null;
  return menus.find((m) => m.viewId === activeViewId)?.label ?? activeViewId;
}

/** Foto de la pantalla actual; taggea cada control accionable. */
export async function observe(): Promise<ObservedScreen> {
  const menus = await getMenus();
  const { el: scope, layer } = getScope();
  clearRefs();

  const ctx: Ctx = { scope, claimed: new WeakSet(), controls: [], n: 0 };
  // Orden: grupos compuestos primero (reclaman su subtree), luego simples.
  readChoices(ctx, SEL.radiogroup, SEL.radio, 'aria-checked');
  readChoices(ctx, SEL.tablist, SEL.tab, 'aria-selected');
  readNativeRadioGroups(ctx);
  readComboboxes(ctx);
  readNativeSelects(ctx);
  readInputs(ctx);
  readToggles(ctx);
  readNumbers(ctx);
  readExpandables(ctx);
  readButtons(ctx);
  const tables = readTables(ctx);

  const activeViewId = getActiveViewId();
  return {
    activeViewId,
    viewTitle: resolveViewTitle(activeViewId, menus),
    layer,
    menus,
    controls: ctx.controls,
    tables,
  };
}
