/**
 * Panel del copiloto IA (bloque `panelType: 'drawer'`).
 *
 * DrawerHost (core) provee el contenedor lateral fijo, persistente y sin
 * backdrop; este componente sólo rellena su interior. Usa el React del host
 * (import map) y estilos inline con tokens `--cg-*` — el plugin no bundlea su
 * propio build de Tailwind, así que no dependemos de clases utilitarias.
 */

import { getHostReact } from '@coongro/plugin-sdk';

import { runAgent } from './agent.js';
import { fetchBalance } from './api.js';
import { startNoticeCapture } from './screen-reader.js';
import { copilotStore, getSnapshot, subscribe, type CopilotState } from './store.js';
import type { CopilotMessage, IntelligenceLevel } from './types.js';

const React = getHostReact();

const LEVELS: { value: IntelligenceLevel; label: string; hint: string }[] = [
  { value: 'fast', label: 'Rápido', hint: 'Tareas simples, menor consumo' },
  { value: 'standard', label: 'Estándar', hint: 'Equilibrio (recomendado)' },
  { value: 'advanced', label: 'Avanzado', hint: 'Tareas complejas, consume más' },
];

const SUGGESTIONS = [
  'Creá un contacto nuevo llamado Juan Pérez',
  'Registrá una consulta para el primer paciente',
];

const COLORS = {
  brand: 'var(--cg-brand, #FFC633)',
  text: 'var(--cg-text, #1a1a1a)',
  textMuted: 'var(--cg-text-muted, #6b7280)',
  border: 'var(--cg-border, #e5e7eb)',
  surface: 'var(--cg-surface, #ffffff)',
  bgMain: 'var(--cg-bg-main, #f8f8f8)',
  danger: 'var(--cg-danger, #dc2626)',
};

const START: React.CSSProperties['alignSelf'] = 'flex-start';

function bubbleStyle(msg: CopilotMessage): React.CSSProperties {
  const base: React.CSSProperties = {
    maxWidth: '88%',
    whiteSpace: 'pre-wrap',
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 13,
    lineHeight: 1.5,
  };
  if (msg.role === 'user') {
    return {
      ...base,
      alignSelf: 'flex-end',
      background: 'rgba(255,198,51,0.2)',
      color: COLORS.text,
    };
  }
  switch (msg.kind) {
    case 'thought':
      return { ...base, alignSelf: START, color: COLORS.textMuted, fontStyle: 'italic' };
    case 'action':
      return {
        ...base,
        alignSelf: START,
        background: COLORS.bgMain,
        color: COLORS.text,
        fontFamily: 'monospace',
        fontSize: 12,
      };
    case 'error':
      return {
        ...base,
        alignSelf: START,
        background: 'rgba(220,38,38,0.1)',
        color: COLORS.danger,
      };
    case 'done':
      return {
        ...base,
        alignSelf: START,
        background: 'rgba(255,198,51,0.15)',
        color: COLORS.text,
        fontWeight: 500,
      };
    default:
      return { ...base, alignSelf: START, background: COLORS.bgMain, color: COLORS.text };
  }
}

function useCopilot(): CopilotState {
  return React.useSyncExternalStore(subscribe, getSnapshot);
}

function SparklesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Chip de saldo: siempre refleja el valor exacto del servidor (ledger). */
function BalanceChip({ balance, cost }: { balance: number | null; cost: number | null }) {
  if (balance === null) {
    return <span style={{ fontSize: 11, color: COLORS.textMuted }}>Saldo…</span>;
  }
  // Se marca en rojo cuando no alcanza para la próxima tarea del nivel elegido.
  const low = cost !== null && balance < cost;
  const title =
    cost !== null
      ? `${balance} Unidades de trabajo disponibles · la próxima tarea cuesta ${cost}`
      : `${balance} Unidades de trabajo disponibles`;
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        padding: '0 8px',
        borderRadius: 11,
        fontSize: 11,
        fontWeight: 600,
        background: low ? 'rgba(220,38,38,0.1)' : 'rgba(255,198,51,0.18)',
        color: low ? COLORS.danger : COLORS.text,
      }}
    >
      ⚡ {balance}
      {cost !== null && <span style={{ fontWeight: 400, opacity: 0.7 }}>· {cost}/tarea</span>}
    </span>
  );
}

function Header({
  running,
  balance,
  cost,
  onClose,
}: {
  running: boolean;
  balance: number | null;
  cost: number | null;
  onClose?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        height: 64,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '0 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: COLORS.brand, display: 'inline-flex' }}>
          <SparklesIcon />
        </span>
        <span style={{ fontWeight: 600 }}>Asistente IA</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BalanceChip balance={balance} cost={cost} />
        <button
          type="button"
          onClick={() => copilotStore.reset()}
          disabled={running}
          aria-label="Nuevo chat (borra el contexto de la conversación)"
          title="Empieza un chat nuevo y olvida el contexto anterior"
          style={iconBtnStyle(running)}
        >
          Nuevo chat
        </button>
        <button
          type="button"
          onClick={() => onClose?.()}
          aria-label="Cerrar asistente"
          style={iconBtnStyle(false)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Composer({
  running,
  level,
  onLevel,
  onSend,
  onStop,
}: {
  running: boolean;
  level: IntelligenceLevel;
  onLevel: (l: IntelligenceLevel) => void;
  onSend: (goal: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = React.useState('');
  const submit = () => {
    onSend(input);
    setInput('');
  };
  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${COLORS.border}`, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: COLORS.textMuted }}>Inteligencia</label>
        <select
          value={level}
          onChange={(e) => onLevel(e.target.value as IntelligenceLevel)}
          disabled={running}
          aria-label="Nivel de inteligencia"
          style={{
            height: 28,
            borderRadius: 6,
            border: `1px solid ${COLORS.border}`,
            background: COLORS.surface,
            color: COLORS.text,
            fontSize: 12,
            padding: '0 6px',
          }}
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value} title={l.hint}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Pedile algo al asistente…"
          disabled={running}
          style={{
            flex: 1,
            height: 36,
            borderRadius: 8,
            border: `1px solid ${COLORS.border}`,
            background: COLORS.surface,
            color: COLORS.text,
            fontSize: 13,
            padding: '0 12px',
          }}
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Detener al asistente"
            title="Detener al asistente"
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: `1px solid ${COLORS.danger}`,
              background: 'transparent',
              color: COLORS.danger,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ⏹ Detener
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={input.trim().length === 0}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: 'none',
              background: COLORS.brand,
              color: '#1a1a1a',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              opacity: input.trim().length === 0 ? 0.5 : 1,
            }}
          >
            Enviar
          </button>
        )}
      </div>
    </div>
  );
}

export function CopilotDrawer({ onClose }: { onClose?: () => void }): React.ReactElement {
  const state = useCopilot();
  const [level, setLevel] = React.useState<IntelligenceLevel>('standard');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Captura de toasts desde que se abre el drawer: son efímeros y el agente
  // observa después de actuar — sin el buffer nunca vería el feedback.
  React.useEffect(() => {
    startNoticeCapture();
  }, []);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.messages]);

  // Saldo inicial exacto al abrir el panel; luego cada tarea lo refresca desde
  // la respuesta del cobro (ver agent.ts). Fallo silencioso: el chip queda en
  // "Saldo…" si no se pudo leer, sin romper el panel.
  React.useEffect(() => {
    let cancelled = false;
    void fetchBalance()
      .then((res) => {
        if (!cancelled) copilotStore.setBalance(res.balance, res.taskCost);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const cost = state.taskCost ? state.taskCost[level] : null;

  const send = (goal: string) => {
    const trimmed = goal.trim();
    if (!trimmed || state.running) return;
    copilotStore.addMessage('user', 'text', trimmed);
    void runAgent(trimmed, level);
  };

  const statusLabel =
    state.status === 'thinking'
      ? 'Pensando…'
      : state.status === 'acting'
        ? 'Operando la interfaz…'
        : null;

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', color: COLORS.text }}>
      <Header running={state.running} balance={state.balance} cost={cost} onClose={onClose} />

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: 16,
        }}
      >
        {state.messages.length === 0 ? (
          <EmptyState onPick={send} />
        ) : (
          state.messages.map((msg) => (
            <div key={msg.id} style={bubbleStyle(msg)}>
              {msg.text}
            </div>
          ))
        )}
        {statusLabel && (
          <div style={{ alignSelf: START, fontSize: 12, color: COLORS.textMuted }}>
            {statusLabel}
          </div>
        )}
      </div>

      <Composer
        running={state.running}
        level={level}
        onLevel={setLevel}
        onSend={send}
        onStop={() => copilotStore.requestAbort()}
      />
    </div>
  );
}

function iconBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    color: COLORS.textMuted,
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    padding: '4px 8px',
  };
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: COLORS.textMuted }}>
      <p style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
        Soy un copiloto que opera Coongro por vos: navego, abro formularios y los completo solo.
        Contame qué necesitás hacer.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            style={{
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.bgMain,
              color: COLORS.text,
              padding: '8px 12px',
              textAlign: 'left',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export default CopilotDrawer;
