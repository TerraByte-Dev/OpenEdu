// CompanionSprite — static pixel-headshot renderer for the active tutor persona (Phase 4b).
//
// Animation (idle blink / talk) is a documented fast-follow; this MVP renders the crisp static
// 128x128 headshot scaled down with `image-rendering: pixelated`. Falls back to a neutral robot
// glyph when the id resolves to no registered persona — covers legacy NULL sprite_id and any future
// art swap that lands before its PNG does.

import { getSpritePersona } from "../lib/sprites/registry";

interface CompanionSpriteProps {
  spriteId?: string | null;
  size?: number;
  className?: string;
  title?: string;
}

export function CompanionSprite({ spriteId, size = 40, className = "", title }: CompanionSpriteProps) {
  const persona = getSpritePersona(spriteId);
  const dim = { width: size, height: size };

  if (!persona) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-panel-lite border border-[var(--rule)] text-[var(--ink-faint)] ${className}`}
        style={dim}
        title={title ?? "Tutor"}
        aria-hidden
      >
        <span style={{ fontSize: size * 0.5, lineHeight: 1 }}>🤖</span>
      </div>
    );
  }

  return (
    <img
      src={persona.imagePath}
      alt={persona.displayName}
      title={title ?? persona.displayName}
      width={size}
      height={size}
      className={`rounded-lg bg-panel-lite border border-phosphor/30 ${className}`}
      style={{ ...dim, imageRendering: "pixelated", objectFit: "contain" }}
      draggable={false}
    />
  );
}
