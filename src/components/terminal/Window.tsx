import type { ReactNode } from "react";

interface WindowProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function Window({ title, children, className = "" }: WindowProps) {
  return (
    <div className={`window ${className}`}>
      <div className="window-titlebar">
        <span className="window-dot close" />
        <span className="window-dot min" />
        <span className="window-dot max" />
        {title && (
          <span className="ml-2 text-[var(--ink-faint)] tracking-widest uppercase text-[10px]">
            {title}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
