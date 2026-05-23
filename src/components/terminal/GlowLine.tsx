interface GlowLineProps {
  className?: string;
}

export default function GlowLine({ className = "" }: GlowLineProps) {
  return <div className={`glow-line ${className}`} />;
}
