// Shared primitives for the settings panels (extracted from SettingsModal so
// per-integration panels can live in their own files without duplication).
import { useState } from 'react';
import type { MessageKey } from '../../lib/i18n';

export type T = (key: MessageKey) => string;
export type Res = { ok: boolean; msg: string } | null;

// ---- tiny inline icons (chevrons) ----
export const ChevR = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
);
export const ChevL = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
);

// ---- shared field helpers (module-level components keep input focus stable) ----
export function Field({ label, type = 'text', value, onChange, placeholder }: { label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[11px] text-[var(--text-muted)] mb-1.5 block">{label}</label>
      <input className="field" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Area({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[11px] text-[var(--text-muted)] mb-1.5 block">{label}</label>
      <textarea className="field !h-24 !py-2 resize-none font-mono text-[12px]" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; label: string }[] }) {
  return (
    <div>
      <label className="text-[11px] text-[var(--text-muted)] mb-1.5 block">{label}</label>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function ResultLine({ r }: { r: Res }) {
  if (!r) return null;
  return <p className={`text-[13px] font-mono break-words ${r.ok ? '' : 'text-red-400'}`} style={r.ok ? { color: 'rgb(var(--hi-rgb))' } : undefined}>{r.msg}</p>;
}

export function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 pt-1">{children}</div>;
}

// Collapsible "how to get this" help: numbered steps + official links. Links open
// in the system browser (Electron's window-open handler / a new tab in browsers).
export function Guide({ t, body, links }: { t: T; body: string; links?: { label: string; url: string }[] }) {
  const [open, setOpen] = useState(false);
  const steps = body.split('\n').map((s) => s.trim()).filter(Boolean);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        <span>💡 {t('guideHowTo')}</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}><ChevR size={13} /></span>
      </button>
      {open && (
        <div className="px-3.5 pb-3 space-y-2">
          <ol className="space-y-1 text-[12px] leading-relaxed text-[var(--text-primary)] opacity-75 list-decimal list-inside">
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {links && links.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
              {links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-[12px] font-medium" style={{ color: 'rgb(var(--hi-rgb))' }}>{l.label} ↗</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
