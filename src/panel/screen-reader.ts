/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Observador de pantalla ARIA-first. Convierte la UI viva en `ObservedScreen`
 * leyendo ROL ARIA + nombre accesible + estado ARIA de cada control. Un único
 * recorrido cubre checkbox/switch/radio/tabs/combobox/expandibles/inputs/etc.
 * sin un lector a medida por widget. Cada control se taggea con
 * data-cg-ai-ref (para reubicarlo) y data-cg-ai-kind (para que el actuador sepa
 * cómo manejarlo).
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
  toggles: '[role="checkbox"],[role="switch"]',
  numbers: '[role="spinbutton"],[role="slider"]',
  buttons: 'button,[role="button"],a[href]',
};

const SKIP_INPUT_TYPES = new Set(['hidden', 'checkbox', 'radio', 'submit', 'button', 'file']);

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

/**
 * Capa a observar: overlay abierto (dialog/popover) tiene prioridad sobre main.
 * El drawer del propio copiloto se excluye explícitamente (data-cg-copilot-panel)
 * para que el agente no se lea a sí mismo.
 */
function getScope(): { el: HTMLElement; layer: ScreenLayer } {
  const dialog = document.querySelector<HTMLElement>(
    '[role="dialog"][data-state="open"]:not([data-cg-copilot-panel]),[role="alertdialog"][data-state="open"]'
  );
  if (dialog && isVisible(dialog)) return { el: dialog, layer: 'dialog' };
  const popover = document.querySelector<HTMLElement>(
    '[data-radix-popper-content-wrapper] [data-state="open"],[role="menu"][data-state="open"]'
  );
  if (popover && isVisible(popover)) return { el: popover, layer: 'popover' };
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
      const label = computeAccessibleName(item, true) || clean(item.getAttribute('value'));
      const selected = item.getAttribute(selectedAttr) === 'true';
      options.push({ label, selected });
      if (selected) value = label;
    }
    emit(ctx, group, { kind: 'choice', name: computeAccessibleName(group), value, options });
  });
}

function readComboboxes(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>(SEL.combobox).forEach((cb) => {
    if (ctx.claimed.has(cb) || !isVisible(cb)) return;
    ctx.claimed.add(cb);
    cb.querySelectorAll('*').forEach((d) => ctx.claimed.add(d));
    const inner = cb.querySelector('input');
    emit(ctx, cb, {
      kind: 'select',
      name: computeAccessibleName(cb),
      value: inner?.value || clean(cb.textContent),
      placeholder: inner?.placeholder || undefined,
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
    });
  });
}

function inputKind(el: HTMLInputElement | HTMLTextAreaElement): ControlKind {
  if (el instanceof HTMLTextAreaElement) return 'text';
  if (el.type === 'number') return 'number';
  if (el.type === 'date' || el.type === 'time' || el.type === 'datetime-local') return 'date';
  if (el.readOnly && el.getAttribute('data-cg-control') === 'date') return 'date';
  if (el.readOnly && el.getAttribute('role') !== 'combobox') return 'date'; // trigger de picker readonly
  return 'text';
}

function readInputs(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>('input, textarea').forEach((node) => {
    const el = node as HTMLInputElement | HTMLTextAreaElement;
    if (ctx.claimed.has(el) || el.closest(SEL.combobox)) return;
    if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type)) return;
    if (!isVisible(el)) return;
    ctx.claimed.add(el);
    emit(ctx, el, {
      kind: inputKind(el),
      name: computeAccessibleName(el),
      value: el.value || '',
      placeholder: (el as HTMLInputElement).placeholder || undefined,
    });
  });
}

function readToggles(ctx: Ctx): void {
  ctx.scope.querySelectorAll<HTMLElement>(SEL.toggles).forEach((el) => {
    if (ctx.claimed.has(el) || !isVisible(el)) return;
    ctx.claimed.add(el);
    const state = toggleState(el);
    emit(ctx, el, { kind: 'toggle', name: computeAccessibleName(el), value: state, state });
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
    emit(ctx, el, { kind: 'number', name: computeAccessibleName(el), value, meta });
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
      state: expanded ? 'expanded' : 'collapsed',
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
    emit(ctx, el, { kind: 'button', name });
  });
}

function readTable(ctx: Ctx): ScreenTable | null {
  const table = ctx.scope.querySelector('table');
  if (!table || !isVisible(table)) return null;
  const columns: string[] = [];
  table.querySelectorAll('thead th').forEach((th) => columns.push(clean(th.textContent)));
  const rows: ScreenTable['rows'] = [];
  const allRows = table.querySelectorAll('tbody tr');
  allRows.forEach((tr, i) => {
    if (i >= 15) return;
    const cells: string[] = [];
    tr.querySelectorAll('td').forEach((td) => cells.push(clean(td.textContent)));
    if (cells.length === 0) return;
    const ref = `c${ctx.n++}`;
    (tr as HTMLElement).setAttribute(AI_REF_ATTR, ref);
    (tr as HTMLElement).setAttribute(AI_KIND_ATTR, 'button');
    rows.push({ ref, cells });
  });
  return { columns, rows, truncated: allRows.length > 15 };
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
  readComboboxes(ctx);
  readNativeSelects(ctx);
  readInputs(ctx);
  readToggles(ctx);
  readNumbers(ctx);
  readExpandables(ctx);
  readButtons(ctx);
  const table = readTable(ctx);

  const activeViewId = getActiveViewId();
  return {
    activeViewId,
    viewTitle: resolveViewTitle(activeViewId, menus),
    layer,
    menus,
    controls: ctx.controls,
    table,
  };
}
