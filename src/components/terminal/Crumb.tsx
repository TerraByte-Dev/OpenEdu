interface CrumbProps {
  path: string;
  className?: string;
}

export default function Crumb({ path, className = "" }: CrumbProps) {
  return (
    <span className={`font-mono text-[11px] tracking-widest ${className}`}>
      <span className="text-[var(--ink-faint)]">C:\OPENEDU\</span>
      <span className="text-phosphor-ink">{path.toUpperCase()}</span>
      <span className="text-phosphor caret" />
    </span>
  );
}
