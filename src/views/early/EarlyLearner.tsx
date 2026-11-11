import { useEffect, useMemo, useState } from "react";
import { getEarlyAttempts, getActiveLearnerId, recordEarlyAttempt } from "../../lib/db";
import { packOf } from "../../lib/early/packs";
import {
  currentSkill, lastItemIn, skillProgress, starsToday, type AttemptRow, type NewAttempt,
} from "../../lib/early/engine";
import type { PackId, SkillId } from "../../lib/early/types";
import { useReadAloud } from "../../lib/useReadAloud";
import EarlyHome from "./EarlyHome";
import EarlyActivity from "./EarlyActivity";

// The early-learner screens for a K-1 learner (#244): the home and one activity at a time. Owns the
// learner's attempt rows (read once from early_attempts, then appended as taps are stored), and works
// everything else out from them with engine.ts. No model, no network.

interface Round {
  pack: PackId;
  skillId: SkillId;
  seed: number;
  avoid: string | null;
  masteredBefore: boolean;
}

// created_at the way datetime('now') writes it, for a row added before the DB echoes it back.
function nowUtc(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export default function EarlyLearner({ learnerName, onGrownUps }: { learnerName: string; onGrownUps: () => void }) {
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const speech = useReadAloud();
  const progress = useMemo(() => skillProgress(rows), [rows]);

  useEffect(() => {
    const learnerId = getActiveLearnerId();
    let alive = true;
    getEarlyAttempts()
      .then((r) => { if (alive && getActiveLearnerId() === learnerId) setRows(r); })
      .catch((e) => console.warn("[early] could not read attempts", e));
    return () => { alive = false; };
  }, []);

  const startRound = (pack: PackId) => {
    speech.stop();
    const skillId = currentSkill(packOf(pack), progress);
    setRound({ pack, skillId, seed: Date.now() >>> 0, avoid: lastItemIn(rows, skillId), masteredBefore: progress[skillId].mastered });
  };

  const onAttempt = (a: NewAttempt) => {
    // Shown at once; stored in the background. A failed write costs that row in the history, nothing on screen.
    setRows((r) => [...r, { skill_id: a.skillId, item_id: a.itemId, correct: a.correct ? 1 : 0, first_try: a.firstTry ? 1 : 0, created_at: nowUtc() }]);
    recordEarlyAttempt(a).catch((e) => console.warn("[early] could not store an attempt", e));
  };

  const home = () => { speech.stop(); setRound(null); };

  if (round) {
    return (
      <EarlyActivity
        key={round.seed}
        skillId={round.skillId}
        avoid={round.avoid}
        seed={round.seed}
        masteredBefore={round.masteredBefore}
        masteredNow={progress[round.skillId].mastered}
        speech={speech}
        onAttempt={onAttempt}
        onPlayAgain={() => startRound(round.pack)}
        onHome={home}
      />
    );
  }

  return (
    <EarlyHome
      learnerName={learnerName}
      progress={progress}
      stars={starsToday(rows, new Date())}
      lastSkill={rows.length ? (rows[rows.length - 1].skill_id as SkillId) : null}
      speech={speech}
      onOpen={startRound}
      onGrownUps={() => { speech.stop(); onGrownUps(); }}
    />
  );
}
