/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Actuador: ejecuta una `AgentAction` sobre la UI viva con animación. Cada
 * driver elige su estrategia según el `kind` del control (data-cg-ai-kind que
 * dejó observe()): toggle idempotente por aria-checked, choice por nombre de
 * opción, expand por aria-expanded, setNumber para stepper/numérico, pickDate
 * para el calendario, select para combobox, click genérico para el resto.
 */

import { computeAccessibleName } from './accname.js';
import { navigateTo } from './bridge.js';
import { AI_REF_ATTR, AI_KIND_ATTR } from './screen-reader.js';
import type { AgentAction } from './types.js';

const TYPE_DELAY_MS = 38;
const HIGHLIGHT_ID = 'cg-ai-highlight';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// --- Highlight que sigue al elemento (rAF) y se auto-oculta al irse del DOM ---

let trackedEl: Element | null = null;
let rafId = 0;

function ensureStyles(): void {
  if (document.getElementById('cg-ai-styles')) return;
  const style = document.createElement('style');
  style.id = 'cg-ai-styles';
  style.textContent = `
    #${HIGHLIGHT_ID} {
      position: fixed; pointer-events: none; z-index: 2147483600;
      border: 2px solid var(--cg-brand, #FFC633); border-radius: 8px;
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--cg-brand, #FFC633) 30%, transparent);
      transition: opacity .2s ease; opacity: 0;
    }
    #${HIGHLIGHT_ID}.cg-ai-on { opacity: 1; animation: cg-ai-pulse 1.4s ease-in-out infinite; }
    @keyframes cg-ai-pulse {
      0%,100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--cg-brand,#FFC633) 30%, transparent); }
      50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--cg-brand,#FFC633) 12%, transparent); }
    }`;
  document.head.appendChild(style);
}

function positionBox(box: HTMLElement, el: Element): boolean {
  if (!document.contains(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const pad = 4;
  box.style.top = `${rect.top - pad}px`;
  box.style.left = `${rect.left - pad}px`;
  box.style.width = `${rect.width + pad * 2}px`;
  box.style.height = `${rect.height + pad * 2}px`;
  return true;
}

function trackLoop(): void {
  const box = document.getElementById(HIGHLIGHT_ID);
  if (!box || !trackedEl) return;
  if (positionBox(box, trackedEl)) {
    box.classList.add('cg-ai-on');
    rafId = requestAnimationFrame(trackLoop);
  } else {
    box.classList.remove('cg-ai-on');
    trackedEl = null;
  }
}

function highlightEl(el: Element): void {
  ensureStyles();
  let box = document.getElementById(HIGHLIGHT_ID);
  if (!box) {
    box = document.createElement('div');
    box.id = HIGHLIGHT_ID;
    document.body.appendChild(box);
  }
  trackedEl = el;
  cancelAnimationFrame(rafId);
  trackLoop();
}

export function clearHighlight(): void {
  trackedEl = null;
  cancelAnimationFrame(rafId);
  const box = document.getElementById(HIGHLIGHT_ID);
  if (box) box.classList.remove('cg-ai-on');
}

// --- Helpers DOM ---

function getEl(ref: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${AI_REF_ATTR}="${CSS.escape(ref)}"]`);
}

function kindOf(el: HTMLElement): string {
  return el.getAttribute(AI_KIND_ATTR) ?? '';
}

async function focusAndReveal(el: HTMLElement): Promise<void> {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await sleep(280);
  highlightEl(el);
  await sleep(220);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  // eslint-disable-next-line @typescript-eslint/unbound-method -- setter del prototipo, lo invocamos con .call
  const setter = descriptor?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function typeInto(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  animate = true
): Promise<void> {
  el.focus();
  setNativeValue(el, '');
  if (animate) {
    let acc = '';
    for (const ch of value) {
      acc += ch;
      setNativeValue(el, acc);
      // eslint-disable-next-line no-await-in-loop
      await sleep(TYPE_DELAY_MS);
    }
  } else {
    setNativeValue(el, value);
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function findInput(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return el.querySelector('input, textarea');
}

function visibleOptions(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter((o) => {
    const r = o.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

function pickByName<T extends HTMLElement>(items: T[], query: string): T | null {
  if (items.length === 0) return null;
  if (!query) return items[0];
  const wanted = norm(query);
  return items.find((o) => norm(o.textContent ?? '').includes(wanted)) ?? items[0];
}

// --- Drivers ---

async function doNavigate(viewId: string): Promise<void> {
  clearHighlight();
  navigateTo(viewId);
  await sleep(900);
}

async function doClick(ref: string): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el elemento ${ref}.`);
  await focusAndReveal(el);
  el.click();
  await sleep(650);
}

async function doType(ref: string, value: string): Promise<void> {
  const target = getEl(ref);
  if (!target) throw new Error(`No encontré el campo ${ref}.`);
  const input = findInput(target);
  if (!input) throw new Error(`El elemento ${ref} no es un campo de texto.`);
  await focusAndReveal(input);
  await typeInto(input, value);
  await sleep(250);
}

async function selectInChoice(el: HTMLElement, option: string): Promise<void> {
  const items = Array.from(el.querySelectorAll<HTMLElement>('[role="radio"],[role="tab"]')).filter(
    (i) => i.getBoundingClientRect().width > 0
  );
  const match = pickByName(items, option);
  if (!match) throw new Error('El grupo no tiene opciones.');
  highlightEl(match);
  await sleep(250);
  match.click();
  await sleep(450);
}

async function selectInCombobox(el: HTMLElement, option: string): Promise<void> {
  el.click();
  await sleep(450);
  const query = option.trim();
  const search = el.querySelector('input');
  if (search && query) {
    await typeInto(search, query);
    await sleep(750);
  } else {
    await sleep(500);
  }
  let options = visibleOptions();
  if (options.length === 0) {
    await sleep(600);
    options = visibleOptions();
  }
  const match = pickByName(options, query);
  if (!match) throw new Error('El selector no mostró opciones.');
  highlightEl(match);
  await sleep(250);
  match.click();
  await sleep(450);
}

function selectNative(el: HTMLSelectElement, option: string): void {
  const opts = Array.from(el.options);
  const match = option.trim()
    ? (opts.find((o) => norm(o.textContent ?? '').includes(norm(option))) ?? opts[0])
    : opts[0];
  if (!match) throw new Error('El select no tiene opciones.');
  el.value = match.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function doSelect(ref: string, option: string): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el selector ${ref}.`);
  await focusAndReveal(el);
  if (el instanceof HTMLSelectElement) {
    selectNative(el, option);
    await sleep(450);
    return;
  }
  if (kindOf(el) === 'choice') return selectInChoice(el, option);
  return selectInCombobox(el, option);
}

async function doToggle(ref: string, on?: boolean): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el control ${ref}.`);
  await focusAndReveal(el);
  const checked = el.getAttribute('aria-checked') === 'true';
  if (on === undefined || on !== checked) {
    el.click();
    await sleep(450);
  }
}

async function doExpand(ref: string): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré la sección ${ref}.`);
  await focusAndReveal(el);
  if (el.getAttribute('aria-expanded') !== 'true') {
    el.click();
    await sleep(650);
  }
}

async function stepTo(el: HTMLElement, value: number): Promise<void> {
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
  const inc = buttons.find((b) =>
    /aument|increase|más|mas|\+|subir/i.test(computeAccessibleName(b, true))
  );
  const dec = buttons.find((b) =>
    /dismin|decrease|menos|restar|-|bajar/i.test(computeAccessibleName(b, true))
  );
  for (let i = 0; i < 50; i++) {
    const current = Number(el.getAttribute('aria-valuenow') ?? 'NaN');
    if (!Number.isFinite(current) || current === value) break;
    const btn = current < value ? inc : dec;
    if (!btn) break;
    btn.click();
    // eslint-disable-next-line no-await-in-loop
    await sleep(180);
  }
}

async function doSetNumber(ref: string, value: number): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el campo numérico ${ref}.`);
  await focusAndReveal(el);
  const input = findInput(el);
  if (input) {
    await typeInto(input, String(value));
    await sleep(250);
    return;
  }
  await stepTo(el, value);
}

async function doPickDate(ref: string, date: string): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el campo de fecha ${ref}.`);
  const input = findInput(el);
  if (
    input &&
    (input.type === 'date' || input.type === 'time' || input.type === 'datetime-local')
  ) {
    await focusAndReveal(input);
    await typeInto(input, date, false);
    return;
  }
  // Trigger de calendario en popover.
  await focusAndReveal(el);
  el.click();
  await sleep(600);
  const day = date.slice(0, 10);
  const cells = Array.from(
    document.querySelectorAll<HTMLElement>('[data-date],[role="gridcell"] button,[role="gridcell"]')
  ).filter((c) => c.getBoundingClientRect().width > 0);
  const match =
    cells.find((c) => (c.getAttribute('data-date') ?? '').startsWith(day)) ??
    cells.find((c) => norm(c.getAttribute('aria-label') ?? '').includes(norm(day)));
  if (match) {
    highlightEl(match);
    await sleep(250);
    match.click();
    await sleep(450);
    return;
  }
  throw new Error(`No pude fijar la fecha ${date} (calendario sin data-date).`);
}

export async function act(action: AgentAction): Promise<void> {
  switch (action.type) {
    case 'navigate':
      return doNavigate(action.viewId);
    case 'click':
      return doClick(action.ref);
    case 'type':
      return doType(action.ref, action.text);
    case 'select':
      return doSelect(action.ref, action.option);
    case 'toggle':
      return doToggle(action.ref, action.on);
    case 'expand':
      return doExpand(action.ref);
    case 'setNumber':
      return doSetNumber(action.ref, action.value);
    case 'pickDate':
      return doPickDate(action.ref, action.date);
    case 'wait':
      return sleep(action.ms ?? 600);
    case 'finish':
      clearHighlight();
      return;
    default:
      return;
  }
}
