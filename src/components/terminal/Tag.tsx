import type { ReactNode } from "react";

interface TagProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function Tag({ children, active, onClick, className = "" }: TagProps) {
  const cls = `tag cursor-pointer ${active ? "border-phosphor text-phosphor" : ""} ${className}`;
  return onClick
    ? <button className={cls} onClick={onClick}>{children}</button>
    : <span className={cls}>{children}</span>;
}
