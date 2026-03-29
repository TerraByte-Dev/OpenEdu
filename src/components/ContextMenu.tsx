import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 9999,
  };

  return (
    <div
      ref={menuRef}
      style={style}
      className="min-w-[160px] py-1 rounded-lg bg-surface-700 border border-surface-500 shadow-xl shadow-black/40"
    >
      {items.map((item, i) => (
        <button
          key={i}
          disabled={item.disabled}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors
            ${item.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
            ${item.danger
              ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
              : "text-zinc-200 hover:bg-surface-600"
            }`}
        >
          {item.icon && <span className="shrink-0 opacity-70">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}
