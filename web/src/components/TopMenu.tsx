import { useEffect, useRef, useState } from 'react';

export interface MenuAction {
  label: string;
  color?: string;
  danger?: boolean;
  onSelect: () => void;
}

/** Sağ üstteki üç nokta düğmesi ve açılan seçenek listesi. */
export default function TopMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className="btn btn-icon btn-blue"
        aria-label="Menü"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="planner-menu"
        onClick={() => setOpen((current) => !current)}
      >
        ⋯
      </button>

      {open && (
        <div className="menu" id="planner-menu" role="menu">
          {actions.map((action, index) => (
            <div key={action.label}>
              {action.danger && index > 0 && <div className="menu-sep" />}
              <button
                className={`menu-item${action.danger ? ' danger' : ''}`}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
              >
                {action.color && <span className="dot" style={{ background: action.color }} />}
                {action.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
