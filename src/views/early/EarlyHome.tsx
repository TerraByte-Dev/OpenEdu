import type { ReactNode } from "react";
import { PACKS, SKILLS } from "../../lib/early/packs";
import {
  STARS_PER_DAY, tileStatus, currentSkill, playTogetherToday, type SkillProgress, type TileStatus,
} from "../../lib/early/engine";
import type { PackId, SkillId } from "../../lib/early/types";
import type { ReadAloud } from "../../lib/useReadAloud";
import GrownUpsButton from "./GrownUpsButton";
import { BookIcon, ColorsArt, CountingArt, PlayIcon, ShapesArt, SpeakerIcon, Star, StarRow } from "./pictures";

// The K-1 learner's home (#244): a greeting they can hear, today's stars, one big tile per pack, and an
// idea to play away from the screen with a grown-up. Everything shown is computed from the stored
// attempts by engine.ts.

const TILE_ART: Record<PackId, ReactNode> = { colors: <ColorsArt />, counting: <CountingArt />, shapes: <ShapesArt /> };
const TILE_TINT: Record<PackId, string> = { colors: "rose", counting: "sky", shapes: "lilac" };

function statusLine(s: TileStatus): ReactNode {
  if (s.kind === "done") return <span className="flex items-center gap-1.5 text-[15px] font-medium text-success"><Star filled size={18} />You learned it!</span>;
  if (s.kind === "going") return <span className="text-[15px] font-medium text-phosphor">Keep going: {s.left} more</span>;
  return <span className="flex items-center gap-1.5 text-[15px] text-[var(--ink-dim)]"><PlayIcon />Tap to play</span>;
}

interface Props {
  learnerName: string;
  progress: Record<SkillId, SkillProgress>;
  stars: number;
  /** The skill of the most recent attempt: its pack's tile is outlined as the one in progress. */
  lastSkill: SkillId | null;
  speech: ReadAloud;
  onOpen: (pack: PackId) => void;
  onGrownUps: () => void;
}

export default function EarlyHome({ learnerName, progress, stars, lastSkill, speech, onOpen, onGrownUps }: Props) {
  const name = learnerName.trim() || "friend";
  const greeting = `Hi, ${name}! What do you want to play?`;
  const idea = playTogetherToday(progress, new Date());

  return (
    <div className="early flex-1 min-h-0 overflow-y-auto flex flex-col">
      <header className="flex flex-wrap items-center gap-4 px-10 py-4">
        <span className="flex items-center gap-2.5 text-[19px] font-semibold text-phosphor grow"><BookIcon />OpenEdu</span>
        <GrownUpsButton onHeld={onGrownUps} />
      </header>

      <main className="w-full max-w-[1120px] mx-auto px-10 pt-3 pb-10 flex flex-col gap-7">
        <div className="flex flex-wrap items-center gap-5">
          <span
            aria-hidden="true"
            className="w-[88px] h-[88px] rounded-full flex items-center justify-center text-[40px] font-semibold"
            style={{ background: "var(--early-avatar)", color: "var(--early-avatar-ink)" }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
          <h1 className="m-0 text-[56px] font-semibold tracking-[-0.02em] text-ink">Hi, {name}!</h1>
          {speech.supported && (
            <button
              type="button"
              className="early-round early-speak w-16 h-16"
              aria-label={`Hear: ${greeting}`}
              aria-pressed={speech.speakingId === "greeting"}
              onClick={() => speech.speak("greeting", greeting)}
            >
              <SpeakerIcon size={30} />
            </button>
          )}
          <div className="ml-auto">
            <StarRow filled={stars} total={STARS_PER_DAY} label={`${stars} of ${STARS_PER_DAY} stars today`} />
          </div>
        </div>

        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {PACKS.map((pack) => {
            const status = tileStatus(pack, progress);
            const current = lastSkill !== null && SKILLS[lastSkill]?.pack === pack.id && status.kind === "going";
            const skill = SKILLS[currentSkill(pack, progress)];
            return (
              <button
                key={pack.id}
                type="button"
                className="early-tile"
                data-tint={TILE_TINT[pack.id]}
                data-current={current}
                aria-label={`${pack.title}: ${skill.name}`}
                onClick={() => onOpen(pack.id)}
              >
                {TILE_ART[pack.id]}
                <span className="text-[30px] font-semibold">{pack.title}</span>
                {statusLine(status)}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4 px-[22px] py-[18px] rounded-[20px] bg-panel border border-[var(--rule)]">
          {speech.supported && (
            <button
              type="button"
              className="early-round w-16 h-16 border-none"
              style={{ background: "var(--phosphor-dim)", color: "var(--phosphor)" }}
              aria-label="Hear today's game"
              onClick={() => speech.speak("idea", `Play with a grown-up. ${idea}`)}
            >
              <SpeakerIcon size={24} waves={1} />
            </button>
          )}
          <div className="flex flex-col gap-0.5 min-w-0" style={{ flex: "1 1 300px" }}>
            <span className="text-sm text-[var(--ink-faint)]">Play with a grown-up</span>
            <span className="text-[22px] font-medium text-ink">{idea}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
