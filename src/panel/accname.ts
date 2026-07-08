/**
 * Cómputo del NOMBRE ACCESIBLE de un control (subset del algoritmo W3C accname).
 *
 * Resolver bien el nombre es lo que hace que switch/checkbox/radio (que no tienen
 * texto propio) sean visibles para la IA, y elimina el bug de "robar" el label de
 * otra sección. Orden de prioridad:
 *   1. aria-labelledby (texto de los elementos referenciados)
 *   2. aria-label
 *   3. <label> asociado (for=id o label que envuelve al control)
 *   4. label "huérfano" en el wrapper del campo (convención de los forms Coongro,
 *      que ponen <Label> y control como hermanos sin htmlFor)
 *   5. texto propio del control (botones, tabs)
 *   6. placeholder
 *   7. title
 */

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function fromLabelledby(el: HTMLElement): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  const text = ids
    .split(/\s+/)
    .map((id) => clean(document.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(' ');
  return clean(text);
}

function fromAssociatedLabel(el: HTMLElement): string {
  const id = el.getAttribute('id');
  if (id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const t = clean(forLabel?.textContent);
    if (t) return t;
  }
  const wrapping = el.closest('label');
  if (wrapping) return clean(wrapping.textContent);
  return '';
}

/**
 * Convención Coongro: el <Label> es hermano (sin htmlFor) dentro del wrapper del
 * campo. Subimos buscando un label hijo directo, cortando al llegar a un
 * contenedor con varios campos (para no robar el label de otra sección).
 */
function fromWrapperLabel(el: HTMLElement): string {
  let node: HTMLElement | null = el.parentElement;
  for (let hops = 0; node && hops < 3; hops++) {
    const label = node.querySelector(':scope > label');
    if (label && !label.contains(el)) {
      const t = clean(label.textContent);
      if (t) return t;
    }
    if (
      node.querySelectorAll('input, textarea, [role="combobox"], [role="radiogroup"]').length > 1
    ) {
      break;
    }
    node = node.parentElement;
  }
  return '';
}

/** Título de la FormSection contenedora (último recurso de etiqueta). */
export function nearestSectionTitle(el: HTMLElement): string {
  let node: HTMLElement | null = el.parentElement;
  for (let hops = 0; node && hops < 6; hops++) {
    const heading = node.querySelector('h2, h3, h4');
    if (heading) return clean(heading.textContent);
    node = node.parentElement;
  }
  return '';
}

/**
 * Texto de un elemento insertando un espacio en cada frontera de sub-elemento,
 * para no PEGAR textos de nodos hermanos. `textContent` aplana todo sin
 * separador: una tarjeta con <span>Rocco</span><span>Labrador</span> daría
 * "RoccoLabrador"; acá da "Rocco Labrador". `clean()` colapsa el excedente.
 */
function textWithBoundaries(el: Node): string {
  let out = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      out += ` ${textWithBoundaries(node)} `;
    }
  });
  return out;
}

/**
 * Para controles cuyo nombre ES su texto (botones, tabs, opciones).
 * Los input[type=submit|button] no tienen textContent: su texto es el value.
 */
function ownText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) return clean(el.value);
  return clean(textWithBoundaries(el));
}

export function computeAccessibleName(el: HTMLElement, includeOwnText = false): string {
  const labelledby = fromLabelledby(el);
  if (labelledby) return labelledby;

  const ariaLabel = clean(el.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  const associated = fromAssociatedLabel(el);
  if (associated) return associated;

  const wrapper = fromWrapperLabel(el);
  if (wrapper) return wrapper;

  if (includeOwnText) {
    const text = ownText(el);
    if (text) return text;
  }

  const placeholder = clean(el.getAttribute('placeholder'));
  if (placeholder) return placeholder;

  const title = clean(el.getAttribute('title'));
  if (title) return title;

  return includeOwnText ? '' : nearestSectionTitle(el);
}
