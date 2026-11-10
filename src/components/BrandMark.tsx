interface BrandMarkProps {
  size?: number;
  className?: string;
  title?: string;
}

// The TerraByte Solutions emblem, rendered as a CSS-masked shape so it takes the accent color in both
// light and dark mode without per-mode assets. Used only for the maker credit in Settings › About; the
// app chrome is OpenEdu's alone. Decorative by default (aria-label provided for screen readers).
export function BrandMark({ size = 28, className = "", title = "TerraByte Solutions" }: BrandMarkProps) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`tb-logo ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
