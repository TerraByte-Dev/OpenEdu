import type { ReactNode } from "react";

interface LcdProps {
  children: ReactNode;
  className?: string;
}

export default function Lcd({ children, className = "" }: LcdProps) {
  return <div className={`lcd ${className}`}>{children}</div>;
}
