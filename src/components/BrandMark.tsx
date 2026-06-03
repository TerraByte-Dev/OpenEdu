interface BrandMarkProps {
  size?: number;
  glow?: boolean;
  className?: string;
  title?: string;
}

// The TerraByte Solutions emblem, rendered as a CSS-masked shape so it takes the active theme's accent
// color — works across every CRT recolor and the universal Dark/Light themes without per-theme assets.
// Decorative by default (aria-label provided for screen readers).
export function BrandMark({ size = 28, glow = false, className = "", title = "TerraByte Solutions" }: BrandMarkProps) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`tb-logo ${glow ? "tb-logo--glow" : ""} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
