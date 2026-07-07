/**
 * Acceso tipado al bridge `window.coongro` desde el panel del copiloto.
 *
 * El plugin NO importa nada de apps/web: usa solo la superficie pública del
 * host (navegación, menús, apiBaseUrl). Reemplaza los imports de core que
 * tenía el POC (useViewStore, menusApi, API_BASE_URL).
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

interface SectionMenuItem {
  label: string;
  path?: string;
  viewId?: string | null;
  children?: SectionMenuItem[];
}

interface MenuSection {
  items?: SectionMenuItem[];
}

interface CoongroBridge {
  apiBaseUrl: string;
  menus: { list: () => Promise<{ success: boolean; data?: unknown }> };
  views: {
    open: (viewId: string, params?: Record<string, unknown>) => void;
    activeViewId: string | null;
  };
}

function getBridge(): CoongroBridge {
  const bridge = (globalThis as any).coongro;
  if (!bridge) throw new Error('[ai-copilot] Coongro bridge (window.coongro) no disponible.');
  return bridge as CoongroBridge;
}

export function apiBaseUrl(): string {
  return getBridge().apiBaseUrl;
}

export function navigateTo(viewId: string): void {
  getBridge().views.open(viewId);
}

export function getActiveViewId(): string | null {
  try {
    return getBridge().views.activeViewId;
  } catch {
    return null;
  }
}

export type { SectionMenuItem, MenuSection };

/** Devuelve las secciones de menú crudas del host (para aplanar en screen-reader). */
export async function listMenuSections(): Promise<MenuSection[]> {
  const res = await getBridge().menus.list();
  if (!res.success || !Array.isArray(res.data)) return [];
  return res.data as MenuSection[];
}
