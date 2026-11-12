import type { ReactNode } from "react";
import type { FlowPage } from "../early/PrintView";
import type { CourseStanding, LearningRecord } from "../../lib/record/build";
import { RECORD_COPY, RECORD_RULES, fill, type PillKey } from "../../lib/record/copy";
import {
  coverSheet, detailPages, learnerName, page1, type CoverSheet, type Page1, type PrintHeader,
} from "../../lib/record/print";
import {
  approxTimeText, dayText, durationText, evidenceText, localDayText, ownWordsNoneText, quizTimeText, standingCounts, whenText, withoutProofText,
  type Audience,
} from "../../lib/record/view";
import { toStored } from "../../lib/record/time";

// The learning record on paper (#258 PR 3b, spec §4a). Every word and number comes from
// lib/record/print.ts and the one LearningRecord; this file only sets them on US Letter sheets.
// Fixed ink colours (index.css .rec-*), the same in both themes: paper is paper.

const C = RECORD_COPY;
const V = RECORD_COPY.view;
const P = RECORD_COPY.print;

/**
 * One learner's printed record: the cover sheet (school year, grown-up reader), page 1, then the detail
 * pages. A record with no course and no activity is page 1 alone: its detail pages would only say "none".
 */
export function recordPrintPages(record: LearningRecord, audience: Audience, now: Date): Array<ReactNode | FlowPage> {
  const summary = page1(record, audience, now);
  return [
    ...(summary.plan.cover ? [<CoverPage key="cover" c={coverSheet(record, now)} />] : []),
    <SummaryPage key="page1" p={summary} />,
    ...(summary.detail ? [{ flow: <DetailPages record={record} audience={audience} now={now} /> }] : []),
  ];
}

function Header({ h }: { h: PrintHeader }) {
  return (
    <>
      <div className="rec-top"><b>{h.kicker}</b><span>{h.printed}</span></div>
      <h1>{h.title}</h1>
      <div className="rec-sub">{h.sub}</div>
      {h.built && <div className="rec-built">{h.built}</div>}
      {h.gone && <div className="rec-built">{h.gone}</div>}
      {h.note && <div className="rec-built">{h.note}</div>}
    </>
  );
}

function Rules({ n }: { n: number }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} className="rec-rule" />)}</>;
}

function Signature() {
  return (
    <div className="rec-sign">
      <span>{C.writeIn.signature}<i /></span>
      <span>{C.writeIn.date}<i /></span>
    </div>
  );
}

function Footer({ disclaimer, pointer = true }: { disclaimer: string; pointer?: boolean }) {
  return (
    <footer>
      <span>{C.authorship}</span>
      <span>{disclaimer}</span>
      {pointer && <span>{P.rulesPointer}</span>}
    </footer>
  );
}

// ── Page 1 ──────────────────────────────────────────────────────────────────────────────────────────

function SummaryPage({ p }: { p: Page1 }) {
  const tile = (t: Page1["tiles"]["days"]) => (
    <div className="rec-tile">
      <b>{t.big}</b>
      <span>{t.rest}</span>
      {t.extra && <span>{t.extra}</span>}
    </div>
  );
  return (
    <div className="print-record rec-sheet">
      <Header h={p.header} />

      <div className="rec-tiles">{tile(p.tiles.days)}{tile(p.tiles.time)}{tile(p.tiles.mastered)}</div>

      <h2>{p.masteredHead}</h2>
      {p.mastered.length ? (
        <ul className="rec-mastered">
          {p.mastered.map((m, i) => (
            <li key={i} className={m.early ? "rec-early" : undefined}>
              <span className="rec-skill">{m.skill}</span>
              <span className="rec-meta">{m.meta}</span>
            </li>
          ))}
        </ul>
      ) : <div className="rec-none">{V.masteredNone}</div>}
      {p.masteredMore && <div className="rec-more">{p.masteredMore}</div>}

      <h2>{p.standHead}</h2>
      {p.courses.length ? (
        <table className="rec-stand">
          <colgroup><col style={{ width: "34%" }} /><col style={{ width: "18%" }} /><col style={{ width: "22%" }} /><col style={{ width: "13%" }} /><col style={{ width: "13%" }} /></colgroup>
          <thead>
            <tr>
              <th>{P.standColumns.course}</th><th>{P.standColumns.level}</th>
              <th className="rec-num">{P.standColumns.mastered}</th><th className="rec-num">{P.standColumns.early}</th><th className="rec-num">{P.standColumns.learning}</th>
            </tr>
          </thead>
          <tbody>
            {p.courses.map((c, i) => (
              <tr key={i}>
                <td>{c.course}</td>
                {c.kind === "note" ? <td colSpan={4} className="rec-dim">{c.note}</td> : (
                  <>
                    <td>{c.level}</td>
                    <td className="rec-num">{c.mastered}</td><td className="rec-num">{c.early}</td><td className="rec-num">{c.learning}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="rec-none">{P.noCourses}</div>}
      {p.coursesMore && <div className="rec-more">{p.coursesMore}</div>}

      <WriteIn p={p} />
      <Footer disclaimer={p.disclaimer} pointer={p.detail} />
    </div>
  );
}

function WriteIn({ p }: { p: Page1 }) {
  const reflection = (
    <div>
      <h3>{C.writeIn.reflectionHead}</h3>
      {C.writeIn.reflection.map((q) => (
        <div key={q}><div className="rec-prompt">{q}</div><Rules n={1} /></div>
      ))}
    </div>
  );
  return (
    <div className="rec-write">
      {p.plan.otherLearning ? (
        <div className="rec-write-cols">
          <div><h3>{p.otherLearningHead}</h3><Rules n={6} /></div>
          {reflection}
        </div>
      ) : reflection}
      {p.plan.grownUpNotes && <div><h3>{C.writeIn.grownUpNotes}</h3><Rules n={2} /></div>}
      {p.plan.attestation && (
        <div>
          <div className="rec-attest">{C.writeIn.attestation}</div>
          <Signature />
        </div>
      )}
    </div>
  );
}

// ── The school-year cover sheet ─────────────────────────────────────────────────────────────────────

function CoverPage({ c }: { c: CoverSheet }) {
  const K = P.cover;
  const num = (n: number) => <td className="rec-num">{n}</td>;
  const time = (m: number) => <td className="rec-num">{m ? fill(V.about, { time: durationText(m) }) : "—"}</td>;
  return (
    <div className="print-record rec-sheet rec-cover">
      <Header h={c.header} />

      <h2>{K.fieldsHead}</h2>
      {c.fields.map((f) => <div key={f} className="rec-field">{f}<i /></div>)}

      <h2>{K.totalsHead}</h2>
      <dl className="rec-totals">
        {c.totals.map((t) => <div key={t.label}><dt>{t.label}</dt><dd>{t.value}</dd></div>)}
      </dl>

      <h2>{K.tableHead}</h2>
      <table className="rec-cover-table">
        <colgroup><col style={{ width: "38%" }} /><col style={{ width: "16%" }} /><col style={{ width: "12%" }} /><col style={{ width: "14%" }} /><col style={{ width: "20%" }} /></colgroup>
        <thead>
          <tr>
            <th>{K.columns.name}</th><th className="rec-num">{K.columns.mastered}</th><th className="rec-num">{K.columns.levels}</th>
            <th className="rec-num">{K.columns.quizzes}</th><th className="rec-num">{K.columns.time}</th>
          </tr>
        </thead>
        <tbody>
          {c.table.subjects.map((s) => (
            [
              <tr key={s.subject ?? "none"} className="rec-subject">
                <td>{s.subject ?? C.noSubject}</td>{num(s.mastered)}{num(s.levels)}{num(s.quizzes)}{time(s.minutes)}
              </tr>,
              ...(c.withCourses ? s.courses.map((x) => (
                <tr key={x.courseId} className="rec-course">
                  <td>{x.course}</td>{num(x.mastered)}{num(x.levels)}{num(x.quizzes)}{time(x.minutes)}
                </tr>
              )) : []),
            ]
          ))}
          <tr className="rec-all">
            {/* No summed time: approximate per-course minutes never stand as a rival to the time total. */}
            <td>{K.allCourses}</td>{num(c.table.all.mastered)}{num(c.table.all.levels)}{num(c.table.all.quizzes)}<td className="rec-num">—</td>
          </tr>
        </tbody>
      </table>
      <div className="rec-note">{c.timeNote}{c.withCourses ? "" : ` ${K.subjectsOnly}`}</div>

      <div className="rec-write">
        <div>
          <div className="rec-attest">{C.writeIn.attestation}</div>
          <Signature />
        </div>
      </div>
      <Footer disclaimer={c.disclaimer} />
    </div>
  );
}

// ── The detail pages ────────────────────────────────────────────────────────────────────────────────

const PILL_TONE: Partial<Record<PillKey, string>> = { mastered: "rec-done", tutor: "rec-soft", keyword: "rec-soft", no_proof: "rec-soft", not_yet: "rec-soft" };

function Tag({ pill, children }: { pill?: PillKey; children: ReactNode }) {
  return <span className={`rec-tag ${pill ? PILL_TONE[pill] ?? "" : ""}`}>{children}</span>;
}

function DetailPages({ record: r, audience, now }: { record: LearningRecord; audience: Audience; now: Date }) {
  const d = detailPages(r, audience);
  const name = learnerName(r);
  const asOf = r.current ? dayText(toStored(now), true) : localDayText(r.period.to);
  // B1/B2 by subject (the builder orders courses by subject, then title).
  const groups: Array<{ subject: string | null; courses: CourseStanding[] }> = [];
  for (const c of d.courses) {
    const g = groups.find((x) => x.subject === c.subject);
    if (g) g.courses.push(c);
    else groups.push({ subject: c.subject, courses: [c] });
  }
  const T = RECORD_RULES.tiles;
  const S = RECORD_RULES.sections;
  return (
    <div className="print-record rec-detail">
      <div className="rec-top"><b>{P.detailKicker}</b><span>{`${name} · ${r.period.label}`}</span></div>
      <h1>{fill(V.namedRecord, { name })}</h1>
      <div className="rec-small">{P.detailIntro}</div>

      <h2>{fill(V.masteredHead, { who: name, when: whenText(r) })}</h2>
      {d.mastered.length ? (
        <table>
          <colgroup><col style={{ width: "30%" }} /><col style={{ width: "20%" }} /><col style={{ width: "8%" }} /><col style={{ width: "10%" }} /><col style={{ width: "32%" }} /></colgroup>
          <thead><tr><th>{P.columns.skill}</th><th>{P.columns.course}</th><th>{P.columns.level}</th><th>{P.columns.date}</th><th>{P.columns.evidence}</th></tr></thead>
          <tbody>
            {d.mastered.map((m) => (
              <tr key={`${m.courseId}-${m.level}-${m.skillId}`}>
                <td>{m.skill}{m.earlySign && <> <Tag pill="early_sign">{C.pills.early_sign}</Tag></>}</td>
                <td className="rec-dim">{m.course}</td>
                <td>{m.level}</td>
                <td>{dayText(m.date)}</td>
                <td className="rec-small">{evidenceText(m.evidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="rec-dim">{V.masteredNone}</p>}

      {d.talkAboutIt && (d.talkAboutIt.explain.length > 0 || d.talkAboutIt.nextUp.length > 0) && (
        <>
          <h2>{V.talkAboutIt}</h2>
          <ul>
            {d.talkAboutIt.explain.map((t) => (
              <li key={`${t.courseId}-${t.level}-${t.skillId}`}>
                {fill(C.talkAboutIt.explain, { name, skill: t.skill })}
                {t.selfExplanation && (
                  <>
                    <blockquote className="rec-quote">{t.selfExplanation}</blockquote>
                    <span className="rec-small">{fill(C.talkAboutIt.readTogether, { name })}</span>
                  </>
                )}
              </li>
            ))}
            {d.talkAboutIt.nextUp.map((l) => (
              <li key={`n-${l.courseId}-${l.level}-${l.skillId}`}>{fill(C.talkAboutIt.nextUp, { skill: l.skill, correct: l.correct, total: l.total })}</li>
            ))}
          </ul>
        </>
      )}

      <h2>{V.recheckedHead}</h2>
      {d.rechecked.held.length + d.rechecked.slipped.length ? (
        <>
          <p>{fill(C.rechecked, { n: d.rechecked.held.length + d.rechecked.slipped.length, held: d.rechecked.held.length, slipped: d.rechecked.slipped.length })}</p>
          {d.rechecked.slipped.length > 0 && <p className="rec-dim">{fill(V.slipped, { skills: d.rechecked.slipped.map((s) => s.skill).join(", ") })}</p>}
        </>
      ) : <p className="rec-dim">{V.recheckedNone}</p>}

      <h2>{V.standHead}</h2>
      <div className="rec-small rec-lede">{fill(V.standAsOf, { date: asOf })}</div>
      {groups.length === 0 && <p className="rec-dim">{P.noCourses}</p>}
      {groups.map((g) => (
        <div key={g.subject ?? "none"}>
          {/* The subject's name sits inside its first course's heading, so a page never ends on it. */}
          {g.courses.map((c, i) => <CourseDetail key={c.courseId} c={c} record={r} subject={i === 0 ? g.subject ?? C.noSubject : null} />)}
        </div>
      ))}

      <h2>{V.levelsHead}</h2>
      {d.levelsPassed.length ? (
        <table>
          <thead><tr><th>{P.columns.course}</th><th>{P.columns.level}</th><th>{P.columns.date}</th></tr></thead>
          <tbody>
            {d.levelsPassed.map((p) => (
              <tr key={`${p.courseId}-${p.level}`}>
                <td>{p.course}</td><td>{p.level}</td><td>{p.date ? dayText(p.date, true) : C.levels.passedUndated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="rec-dim">{V.levelsNone}</p>}

      <h2>{V.hardHead}</h2>
      <div className="rec-small rec-lede">{S.hard_ones}</div>
      {d.hardOnes.length ? d.hardOnes.map((h) => (
        <div key={`${h.courseId}-${h.level}-${h.skillId}`} className="rec-block">
          <div className="rec-block-head">
            <h3>{h.skill}</h3>
            <div className="rec-small">{`${h.course} · ${fill(V.levelOnly, { level: h.level })} · ${fill(V.hardLine, { correct: h.correct, total: h.total })}`}</div>
          </div>
          {h.missed.map((q, i) => (
            <dl key={i} className="rec-qa">
              <dt>{C.hardOnes.question}</dt><dd>{q.question}</dd>
              <dt>{C.hardOnes.answered}</dt><dd>{q.answered}</dd>
              <dt>{C.hardOnes.key}</dt><dd>{q.key}</dd>
            </dl>
          ))}
        </div>
      )) : <p className="rec-dim">{V.hardNone}</p>}

      <h2>{V.quizzesHead}</h2>
      <div className="rec-small rec-lede">{C.quizzes.header}</div>
      {d.quizzes.length ? (
        <table>
          <thead>
            <tr>{Object.values(V.columns).map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {d.quizzes.map((q) => (
              <tr key={q.attemptId}>
                <td>{dayText(q.date)}</td>
                <td>{q.course}</td>
                <td>{q.level}</td>
                <td>{q.levelTest ? C.quizzes.levelTest : C.quizzes.quiz}{q.passed !== null && <div className="rec-small">{q.passed ? C.quizzes.passed : C.quizzes.notPassed}</div>}</td>
                <td>
                  {q.score === null ? fill(V.resultCell, { correct: q.correct, total: q.total }) : fill(V.resultScore, { correct: q.correct, total: q.total, score: Math.round(q.score) })}
                  {q.timedOutUnstored && <div className="rec-small">{C.quizzes.timedOutUnstored}</div>}
                  {q.unanswered > 0 && <div className="rec-small">{fill(V.unansweredNote, { n: q.unanswered })}</div>}
                </td>
                <td>{quizTimeText(q.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="rec-dim">{V.quizzesNone}</p>}
      {d.startedNotFinished > 0 && <p>{fill(C.quizzes.startedNotFinished, { n: d.startedNotFinished })}</p>}
      <div className="rec-small">{C.quizzes.repeatFootnote}</div>

      <h2>{fill(V.ownWordsNamed, { name })}</h2>
      {d.ownWords.length ? d.ownWords.map((w, i) => (
        <div key={i} className="rec-block">
          <blockquote className="rec-quote">{w.text}</blockquote>
          <div className="rec-small">
            {w.kind === "note"
              ? `${w.title ? `${w.title} · ` : ""}${w.course} · ${fill(C.ownWords.noteStarted, { date: dayText(w.date) })}`
              : `${w.skill ? `${fill(V.explanationOn, { skill: w.skill })} · ` : ""}${w.course} · ${dayText(w.date)}`}
          </div>
        </div>
      )) : <p className="rec-dim">{ownWordsNoneText(r)}</p>}
      {d.ownWordsNote && <div className="rec-small">{d.ownWordsNote}</div>}

      <h2>{V.activityHead}</h2>
      <ul>
        <li>{fill(C.activity.lessons, { n: d.activity.lessonsOpened })}</li>
        <li>{fill(C.activity.tutor, { messages: d.activity.tutorMessages, conversations: d.activity.tutorConversations })}</li>
        <li>
          {fill(C.activity.flashcards, { n: d.activity.flashcardsMade })}
          {d.activity.flashcardsMadeByApp > 0 && `, ${fill(C.activity.flashcardsByApp, { n: d.activity.flashcardsMadeByApp })}`}
        </li>
        {d.activity.flashcardsReviewed !== null && <li>{fill(C.activity.reviewed, { n: d.activity.flashcardsReviewed })}</li>}
        {d.activity.notesStarted !== null && <li>{fill(C.activity.notes, { n: d.activity.notesStarted })}</li>}
        {d.activity.coursesStarted.length
          ? d.activity.coursesStarted.map((c) => <li key={c.courseId}>{fill(C.activity.courseStarted, { title: c.course, date: dayText(c.date) })}</li>)
          : <li>{V.coursesStartedNone}</li>}
      </ul>

      <h2>{V.timeHead}</h2>
      {d.timeBySubject.length ? (
        <table>
          <thead><tr><th>{P.cover.columns.name}</th><th>{P.cover.columns.time}</th></tr></thead>
          <tbody>
            {d.timeBySubject.map((g) => [
              <tr key={g.subject ?? "none"}><td><b>{g.subject ?? C.noSubject}</b></td><td><b>{`${fill(V.about, { time: durationText(g.minutes) })} (${V.approxPill})`}</b></td></tr>,
              ...g.courses.map((c) => (
                <tr key={`${g.subject}-${c.courseId}`}><td className="rec-dim" style={{ paddingLeft: 14 }}>{c.course}</td><td className="rec-dim">{`${approxTimeText({ minutes: c.minutes, sittings: c.sittings })} (${V.approxPill})`}</td></tr>
              )),
            ])}
          </tbody>
        </table>
      ) : <p className="rec-dim">{V.timeNone}</p>}

      <h2>{V.withoutHead}</h2>
      {d.withoutProof.length ? (
        <table>
          <colgroup><col style={{ width: "28%" }} /><col style={{ width: "20%" }} /><col style={{ width: "8%" }} /><col style={{ width: "44%" }} /></colgroup>
          <thead><tr><th>{P.columns.skill}</th><th>{P.columns.course}</th><th>{P.columns.level}</th><th>{P.columns.reason}</th></tr></thead>
          <tbody>
            {d.withoutProof.map((w) => {
              const { pill, why } = withoutProofText(w);
              return (
                <tr key={`${w.courseId}-${w.level}-${w.skillId}`}>
                  <td>{w.skill}</td><td className="rec-dim">{w.course}</td><td>{w.level}</td>
                  <td><Tag pill={pill}>{C.pills[pill]}</Tag><div className="rec-small">{why}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="rec-dim">{V.withoutNone}</p>}

      <h2>{V.howHead}</h2>
      <dl className="rec-how">
        {([
          [C.tiles.mastered, T.mastered], [V.howDays, T.days], [V.howTimeApprox, T.time_approx], [V.howTimeCounted, T.time_counted],
          [V.recheckedHead, S.rechecked], [V.hardHead, S.hard_ones], [V.howLessons, S.lessons],
        ] as Array<[string, string]>).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {/* One unbreakable block, so the disclaimer never ends up alone on the last sheet. */}
      <div className="rec-end">
        <h3>{V.labelsHead}</h3>
        <dl className="rec-how rec-legend">
          {(Object.keys(C.pills) as PillKey[]).map((p) => <div key={p}><dt><Tag pill={p}>{C.pills[p]}</Tag></dt><dd>{RECORD_RULES.pills[p]}</dd></div>)}
        </dl>
        <p className="rec-dim">{C.authorship}</p>
        <div className="rec-disclaimer">{d.disclaimer}</div>
      </div>
    </div>
  );
}

function CourseDetail({ c, record: r, subject }: { c: CourseStanding; record: LearningRecord; subject: string | null }) {
  const n = standingCounts(c);
  const upTo = c.level ?? 0;
  const shown = c.skills.filter((s) => s.level <= upTo);
  const learning = r.learning.filter((l) => l.courseId === c.courseId);
  const finished = c.status === "completed" || c.status === "archived";
  return (
    <div className={subject ? "rec-block rec-first" : "rec-block"}>
      <div className="rec-block-head">
        {subject && <div className="rec-subject-head">{subject}</div>}
        <h3>{c.course}{finished && <> <Tag pill="mastered">{C.levels.finished}</Tag></>}</h3>
        <div className="rec-dim">
          {c.legacy ? C.levels.legacy
            : c.level === null ? C.levels.notRecorded
            : c.levelTitle ? fill(V.levelLine, { level: c.level, title: c.levelTitle }) : fill(V.levelOnly, { level: c.level })}
        </div>
        {!c.legacy && c.level !== null && shown.length > 0 && (
          <div>
            {[
              fill(V.skillsLine, { mastered: n.mastered, total: n.total }),
              ...(n.early ? [fill(V.earlySigns, { n: n.early })] : []),
              ...(n.learning ? [fill(V.learningCount, { n: n.learning })] : []),
            ].join(" · ")}
          </div>
        )}
        {c.reconciliation && c.reconciliation.shown > 0 && c.reconciliation.shown !== c.reconciliation.checked && (
          <div className="rec-small">{fill(C.reconciliation, c.reconciliation)}</div>
        )}
      </div>
      {c.objectives.length > 0 && (
        <div>
          <div className="rec-small">{C.levels.objectives}</div>
          <ul>{c.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
      {shown.length > 0 && (
        <table>
          <colgroup><col style={{ width: "62%" }} /><col style={{ width: "10%" }} /><col style={{ width: "28%" }} /></colgroup>
          <thead><tr><th>{P.columns.skill}</th><th>{P.columns.level}</th><th>{P.columns.status}</th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={`${s.level}-${s.skillId}`}>
                <td>{s.skill}</td><td>{s.level}</td>
                <td><Tag pill={s.status}>{C.pills[s.status]}</Tag>{s.reviewAgain && <> <Tag pill="review_again">{C.pills.review_again}</Tag></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {learning.length > 0 && (
        <div>
          <div className="rec-small">{V.learningHead}</div>
          <ul>{learning.map((l) => <li key={`${l.level}-${l.skillId}`}>{fill(C.learning, { skill: l.skill, correct: l.correct, total: l.total })}</li>)}</ul>
        </div>
      )}
      {!c.legacy && c.level !== null && c.level < 6 && !finished && (
        <div className="rec-small">{c.level === 5 ? fill(V.laterOne, { n: 6 }) : fill(C.levels.later, { from: c.level + 1, to: 6 })}</div>
      )}
    </div>
  );
}
