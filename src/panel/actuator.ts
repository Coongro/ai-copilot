/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Actuador: ejecuta una `AgentAction` sobre la UI viva con animación. Cada
 * driver elige su estrategia según el `kind` del control (data-cg-ai-kind que
 * dejó observe()): toggle idempotente por estado checked, choice por nombre de
 * opción, expand por aria-expanded (abre y también pliega con open:false),
 * setNumber para stepper/numérico/slider, pickDate para el calendario, select
 * para combobox, click genérico para el resto.
 *
 * Principio: NUNCA fallar en silencio ni "adivinar". Si la opción pedida no
 * existe, si el control está deshabilitado o si el valor no se pudo fijar, se
 * tira un Error descriptivo — el loop del agente lo guarda en el historial y
 * el modelo se recupera con esa información.
 *
 * Contrato completo y guía de extensión: docs/observador-actuador.md
 */

import { computeAccessibleName } from './accname.js';
import { navigateTo } from './bridge.js';
import { AI_REF_ATTR, AI_KIND_ATTR, AI_RADIOS_ATTR, isDisabled } from './screen-reader.js';
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

function assertEnabled(el: HTMLElement): void {
  if (isDisabled(el)) {
    throw new Error(
      `«${computeAccessibleName(el, true) || 'El control'}» está deshabilitado — probablemente falte completar otro campo antes.`
    );
  }
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

/** Etiqueta legible de una opción (radios nativos no tienen textContent). */
function optionLabel(el: HTMLElement): string {
  const name = computeAccessibleName(el, true);
  if (name) return name;
  if (el instanceof HTMLInputElement) return el.value;
  return '';
}

/**
 * Busca la opción por etiqueta. SIN fallback silencioso: si el modelo pidió
 * una opción y no está, devolvemos null y el caller tira un error que LISTA
 * las opciones disponibles (así el modelo se recupera eligiendo una real).
 * Query vacío = "la primera disponible" (explícito en el protocolo).
 */
function pickByLabel<T extends HTMLElement>(
  items: T[],
  query: string
): { match: T | null; labels: string[] } {
  const labels = items.map(optionLabel);
  if (items.length === 0) return { match: null, labels };
  if (!query.trim()) return { match: items[0], labels };
  const wanted = norm(query);
  const idx = labels.findIndex((l) => norm(l).includes(wanted));
  return { match: idx >= 0 ? items[idx] : null, labels };
}

function noOptionError(option: string, labels: string[]): Error {
  const visible = labels.filter(Boolean).slice(0, 12).join(', ');
  return new Error(
    `No encontré la opción "${option}". Opciones disponibles: ${visible || '(ninguna)'}.`
  );
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
  assertEnabled(el);
  await focusAndReveal(el);
  el.click();
  await sleep(650);
}

async function doType(ref: string, value: string): Promise<void> {
  const target = getEl(ref);
  if (!target) throw new Error(`No encontré el campo ${ref}.`);
  const input = findInput(target);
  if (!input) throw new Error(`El elemento ${ref} no es un campo de texto.`);
  assertEnabled(input);
  if (input.readOnly) {
    throw new Error(`El campo «${computeAccessibleName(input)}» es de solo lectura.`);
  }
  await focusAndReveal(input);
  await typeInto(input, value);
  await sleep(250);
}

async function selectInChoice(el: HTMLElement, option: string): Promise<void> {
  // El host de radios nativos puede contener radios de otros grupos: si
  // observe() dejó el name del grupo, restringir las opciones a ese grupo.
  const radioName = el.getAttribute(AI_RADIOS_ATTR);
  const nativeSel = radioName
    ? `input[type="radio"][name="${CSS.escape(radioName)}"]`
    : 'input[type="radio"]';
  const items = Array.from(
    el.querySelectorAll<HTMLElement>(`[role="radio"],[role="tab"],${nativeSel}`)
  ).filter((i) => i.getBoundingClientRect().width > 0);
  const { match, labels } = pickByLabel(items, option);
  if (!match) {
    if (items.length === 0) throw new Error('El grupo no tiene opciones visibles.');
    throw noOptionError(option, labels);
  }
  assertEnabled(match);
  highlightEl(match);
  await sleep(250);
  match.click();
  await sleep(450);
}

/** Tipea un query en el buscador del combobox y devuelve las opciones visibles. */
async function typeAndCollect(search: HTMLInputElement, query: string): Promise<HTMLElement[]> {
  await typeInto(search, query);
  await sleep(750);
  let options = visibleOptions();
  if (options.length === 0) {
    await sleep(400);
    options = visibleOptions();
  }
  return options;
}

/**
 * ¿La opción corresponde al query? Contención en cualquier dirección: cubre el
 * caso "Rocco Labrador" (lo que el modelo pidió, del nombre completo) vs "Rocco"
 * (la opción real que muestra un buscador que filtra por nombre).
 */
function optionMatches(o: HTMLElement, query: string): boolean {
  const l = norm(optionLabel(o));
  const q = norm(query);
  return l.length > 0 && (l.includes(q) || q.includes(l));
}

async function selectInCombobox(el: HTMLElement, option: string): Promise<void> {
  el.click();
  await sleep(450);
  const query = option.trim();
  const search = el.querySelector('input');

  // Sin buscador (o query vacío): las opciones ya están; elegir por etiqueta.
  if (!search || !query) {
    await sleep(500);
    let options = visibleOptions();
    if (options.length === 0) {
      await sleep(600);
      options = visibleOptions();
    }
    if (options.length === 0) throw new Error('El selector no mostró opciones.');
    const { match, labels } = pickByLabel(options, query);
    if (!match) throw noOptionError(option, labels);
    highlightEl(match);
    await sleep(250);
    match.click();
    await sleep(450);
    return;
  }

  // Buscador async: tipear el texto completo y, si no aparece nada, reintentar
  // con prefijos cada vez más cortos (como un humano: "Rocco Labrador" → "Rocco").
  // Muchos pickers filtran solo por nombre y no matchean el label completo.
  const queries = [query];
  if (query.includes(' ')) {
    const words = query.split(/\s+/);
    for (let n = words.length - 1; n >= 1; n--) queries.push(words.slice(0, n).join(' '));
  }
  let options: HTMLElement[] = [];
  for (const q of queries) {
    // eslint-disable-next-line no-await-in-loop -- reintento secuencial por diseño
    options = await typeAndCollect(search, q);
    if (options.length > 0) break;
  }
  if (options.length === 0) throw new Error('El selector no mostró opciones.');

  // Elegir SIN adivinar: la opción tiene que corresponder al query pedido.
  const match = options.find((o) => optionMatches(o, query));
  if (!match) throw noOptionError(option, options.map(optionLabel));
  highlightEl(match);
  await sleep(250);
  match.click();
  await sleep(450);
}

function selectNative(el: HTMLSelectElement, option: string): void {
  const opts = Array.from(el.options);
  if (opts.length === 0) throw new Error('El select no tiene opciones.');
  const query = option.trim();
  const match = query ? opts.find((o) => norm(o.textContent ?? '').includes(norm(query))) : opts[0];
  if (!match) {
    throw noOptionError(
      option,
      opts.map((o) => (o.textContent ?? '').trim())
    );
  }
  el.value = match.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function doSelect(ref: string, option: string): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el selector ${ref}.`);
  assertEnabled(el);
  await focusAndReveal(el);
  if (el instanceof HTMLSelectElement) {
    selectNative(el, option);
    await sleep(450);
    return;
  }
  if (kindOf(el) === 'choice') return selectInChoice(el, option);
  return selectInCombobox(el, option);
}

function isCheckedNow(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  return el.getAttribute('aria-checked') === 'true';
}

async function doToggle(ref: string, on?: boolean): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el control ${ref}.`);
  assertEnabled(el);
  await focusAndReveal(el);
  const checked = isCheckedNow(el);
  if (on === undefined || on !== checked) {
    el.click();
    await sleep(450);
  }
  // El click puede no producir el cambio (handler ajeno, elemento sin estado):
  // si el modelo pidió un estado concreto, verificarlo en vez de asumir éxito.
  if (on !== undefined && isCheckedNow(el) !== on) {
    throw new Error(
      `No pude ${on ? 'activar' : 'desactivar'} «${computeAccessibleName(el)}» (el estado no cambió).`
    );
  }
}

/** Estado expandido actual; null si el elemento no expone estado. */
function isExpandedNow(el: HTMLElement): boolean | null {
  // <summary> nativo: el estado vive en el <details> padre, no en ARIA.
  if (el.tagName === 'SUMMARY' && el.parentElement instanceof HTMLDetailsElement) {
    return el.parentElement.open;
  }
  const attr = el.getAttribute('aria-expanded');
  return attr === null ? null : attr === 'true';
}

async function doExpand(ref: string, open?: boolean): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré la sección ${ref}.`);
  assertEnabled(el);
  await focusAndReveal(el);
  const isOpen = isExpandedNow(el);
  if (isOpen === null) {
    throw new Error('El control no expone estado expandido (aria-expanded).');
  }
  const want = open ?? true;
  if (isOpen !== want) {
    el.click();
    await sleep(650);
    if (isExpandedNow(el) !== want) {
      throw new Error(`No pude ${want ? 'desplegar' : 'plegar'} la sección (el estado no cambió).`);
    }
  }
}

function valueNow(el: HTMLElement): number {
  return Number(el.getAttribute('aria-valuenow') ?? 'NaN');
}

function pressArrow(el: HTMLElement, key: 'ArrowRight' | 'ArrowLeft'): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Nos pasamos del objetivo: retroceder un paso si el valor previo era el más cercano. */
async function settleOvershoot(
  el: HTMLElement,
  key: 'ArrowRight' | 'ArrowLeft',
  current: number,
  after: number,
  value: number
): Promise<void> {
  if (Math.abs(current - value) < Math.abs(after - value)) {
    pressArrow(el, key === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight');
    await sleep(60);
  }
}

/** Slider ARIA: se maneja por teclado (flechas sobre el elemento con el rol). */
async function slideTo(el: HTMLElement, value: number): Promise<void> {
  el.focus();
  let step = 0;
  for (let i = 0; i < 120; i++) {
    const current = valueNow(el);
    if (!Number.isFinite(current) || current === value) break;
    const key = current < value ? 'ArrowRight' : 'ArrowLeft';
    pressArrow(el, key);
    // eslint-disable-next-line no-await-in-loop
    await sleep(60); // margen para re-render antes del stuck-check
    const after = valueNow(el);
    if (after === current) break; // no responde al teclado — cortar
    step = Math.abs(after - current);
    // Overshoot: el objetivo no está alineado al step del slider. Quedarse con
    // el valor más cercano en vez de oscilar hasta agotar el bucle.
    if (after !== value && current < value !== after < value) {
      // eslint-disable-next-line no-await-in-loop
      await settleOvershoot(el, key, current, after, value);
      break;
    }
  }
  const final = valueNow(el);
  // Tolerancia de un step para objetivos no alineados (step=5, objetivo 7 → queda 5).
  if (!Number.isFinite(final) || Math.abs(final - value) > step) {
    throw new Error(
      `No pude fijar el valor ${value} (quedó en ${Number.isFinite(final) ? final : 'desconocido'}).`
    );
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
  if (!inc && !dec) {
    throw new Error('El control numérico no tiene campo editable ni botones +/- reconocibles.');
  }
  for (let i = 0; i < 50; i++) {
    const current = valueNow(el);
    if (!Number.isFinite(current) || current === value) break;
    const btn = current < value ? inc : dec;
    if (!btn) break;
    btn.click();
    // eslint-disable-next-line no-await-in-loop
    await sleep(180);
  }
  const final = valueNow(el);
  if (final !== value) {
    throw new Error(
      `No pude llegar al valor ${value} (quedó en ${Number.isFinite(final) ? final : 'desconocido'}).`
    );
  }
}

async function doSetNumber(ref: string, value: number): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el campo numérico ${ref}.`);
  assertEnabled(el);
  await focusAndReveal(el);
  const input = findInput(el);
  if (input) {
    if (input.readOnly)
      throw new Error(`El campo «${computeAccessibleName(input)}» es de solo lectura.`);
    await typeInto(input, String(value));
    await sleep(250);
    return;
  }
  if (el.getAttribute('role') === 'slider') return slideTo(el, value);
  await stepTo(el, value);
}

/** Adapta "YYYY-MM-DD" / "YYYY-MM-DDTHH:MM" al formato exacto que exige el input nativo. */
function coerceDateValue(type: string, date: string): string {
  if (type === 'date') return date.slice(0, 10);
  if (type === 'datetime-local') return date.includes('T') ? date : `${date}T00:00`;
  if (type === 'time') return date.includes('T') ? date.slice(11, 16) : date;
  return date;
}

async function doPickDate(ref: string, date: string): Promise<void> {
  const el = getEl(ref);
  if (!el) throw new Error(`No encontré el campo de fecha ${ref}.`);
  assertEnabled(el);
  const input = findInput(el);
  if (
    input &&
    (input.type === 'date' || input.type === 'time' || input.type === 'datetime-local')
  ) {
    const value = coerceDateValue(input.type, date);
    await focusAndReveal(input);
    await typeInto(input, value, false);
    // Los inputs nativos rechazan EN SILENCIO un formato inválido (value queda vacío).
    if (!input.value) {
      throw new Error(`El campo no aceptó "${value}" (es un input de tipo ${input.type}).`);
    }
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
      return doExpand(action.ref, action.open);
    case 'setNumber':
      return doSetNumber(action.ref, action.value);
    case 'pickDate':
      return doPickDate(action.ref, action.date);
    case 'wait':
      return sleep(action.ms ?? 600);
    case 'finish':
      clearHighlight();
      return;
    default: {
      // Guard de exhaustividad: un verbo nuevo en types/parse sin driver acá debe fallar ruidoso.
      const unknown: never = action;
      throw new Error(`Acción sin driver: ${JSON.stringify(unknown)}`);
    }
  }
}
