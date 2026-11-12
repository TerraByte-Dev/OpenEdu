import type { CSSProperties } from "react";
import { GRADES, gradeLabel, normalizeGrade, type Grade } from "../lib/grade";

// The one grade picker (#243): Not set, Kindergarten, Grade 1 … Grade 12. Used in Settings › Name & grade.
export function GradeSelect({ value, onChange, id, style, ariaLabel }: {
  value: Grade | null;
  onChange: (grade: Grade | null) => void;
  id?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className="cf-input"
      style={{ width: "auto", ...style }}
      value={value === null ? "" : String(value)}
      onChange={(e) => onChange(normalizeGrade(e.target.value))}
    >
      <option value="">{gradeLabel(null)}</option>
      {GRADES.map((g) => <option key={g} value={String(g)}>{gradeLabel(g)}</option>)}
    </select>
  );
}
