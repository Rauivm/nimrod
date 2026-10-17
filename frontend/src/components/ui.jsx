import { createContext, useContext, useEffect, useId, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import BrandSeal from './BrandSeal.jsx';

export function Button({ variant = 'secondary', className = '', children, ...props }) {
  return <button type="button" className={`ui-button ui-button-${variant} ${className}`} {...props}>{children}</button>;
}

export function PageHeader({ eyebrow, title, description, action, emblem = false }) {
  return <header className="ui-page-header">
    <div className="ui-page-heading">{eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}<div className="ui-title-row">{emblem && <BrandSeal className="ui-title-seal" />}<h1>{title}</h1></div>{description && <p className="ui-page-description">{description}</p>}</div>
    {action && <div className="ui-page-action">{action}</div>}
  </header>;
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}

export function StatePanel({ kind = 'empty', title, children, action }) {
  return <div className={`ui-state ui-state-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'error' ? <AlertCircle size={28} aria-hidden="true" /> : <BrandSeal className="ui-state-seal" />}<strong>{title}</strong>{children && <p>{children}</p>}{action}
  </div>;
}

export function LoadingCards({ count = 3, label = 'Carregando…' }) {
  return <div role="status" aria-label={label} className="ui-loading-grid"><span className="sr-only">{label}</span>
    {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton ui-loading-card" aria-hidden="true" />)}
  </div>;
}

let openDialogs = 0;
let previousOverflow = '';
export function Modal({ title, children, onClose, dismissible = true, wide = false, showHeader = true }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    const element = ref.current;
    const previousFocus = document.activeElement;
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    element.showModal();
    return () => {
      element.close();
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(<dialog ref={ref} aria-labelledby={showHeader ? id : undefined} aria-label={showHeader ? undefined : title} className={`ui-dialog ${wide ? 'ui-dialog-wide' : ''}`}
    onCancel={event => { event.preventDefault(); if (dismissible) closeRef.current?.(); }}>
    <div className="ui-dialog-content">
      {showHeader && <header className="ui-dialog-header"><h2 id={id}>{title}</h2>
        {onClose && <Button variant="ghost" className="ui-icon-button" aria-label="Fechar diálogo" disabled={!dismissible} onClick={onClose}><X size={20} /></Button>}
      </header>}
      {children}
    </div>
  </dialog>, document.body);
}

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null);
  const notify = useCallback((text, tone = 'success') => setMessage({ text, tone, id: Date.now() }), []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  return <ToastContext.Provider value={notify}>{children}
    <div className="ui-toast-region" role="status" aria-live="polite" aria-atomic="true">
      {message && <div className={`ui-toast ui-toast-${message.tone}`}>
        {message.tone === 'error' ? <AlertCircle size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}<span>{message.text}</span>
        <Button variant="ghost" className="ui-icon-button" aria-label="Dispensar notificação" onClick={() => setMessage(null)}><X size={18} /></Button>
      </div>}
    </div>
  </ToastContext.Provider>;
}
