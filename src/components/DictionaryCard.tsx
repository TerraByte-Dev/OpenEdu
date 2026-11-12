import { useId, useState } from "react";
import { CARD_SOURCE, cardToggleLabel, type DictionaryCard as Card } from "../lib/dictionary-card";

// The dictionary card under a tutor reply (#251 PR 3): the entry the tutor was given, as
// lib/dictionary-card.ts lays it out. Session-only and never part of the request (see that file).
// `startsOpen` is the grade rule (cardStartsOpen); `onReadAloud` is set when the webview can speak.
export function DictionaryCard({ card, startsOpen, reading, onReadAloud }: {
  card: Card;
  startsOpen: boolean;
  reading: boolean;
  onReadAloud?: () => void;
}) {
  const [open, setOpen] = useState(startsOpen);
  const bodyId = useId();
  return (
    <section className={open ? "dict-card" : "dict-card dict-card-closed"} aria-label={`Dictionary entry for ${card.word}`}>
      <div className="dict-card-bar">
        <BookIcon />
        <button
          type="button"
          className="dict-card-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          {cardToggleLabel(open)}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? "rotate-180" : ""}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {open && onReadAloud && (
          <button
            type="button"
            className="speak-btn ml-auto"
            onClick={onReadAloud}
            aria-label={reading ? "Stop reading" : "Read the dictionary entry aloud"}
            aria-pressed={reading}
            title={reading ? "Stop reading" : "Read the dictionary entry aloud"}
          >
            {reading ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.5 5.5a9 9 0 0 1 0 13" />
              </svg>
            )}
          </button>
        )}
      </div>
      {open && (
        <div id={bodyId} className="dict-card-body">
          {card.headwords.map((h) => (
            <div key={h.headword} className="dict-card-entry">
              <h3 className="dict-card-headword">{h.headword}</h3>
              {h.formOf && <p className="dict-card-formof">{h.formOf}</p>}
              {h.groups.map((g, gi) => (
                <div key={`${g.partOfSpeech}-${gi}`} className="dict-card-group">
                  <p className="dict-card-pos">{g.partOfSpeech}</p>
                  <ol className="dict-card-senses">
                    {g.senses.map((s) => (
                      <li key={s.n} className="dict-card-sense">
                        <span className="dict-card-num" aria-hidden="true">{s.n}</span>
                        <div className="min-w-0">
                          <p className="dict-card-def">
                            {s.form && <span className="dict-card-form">{s.form} </span>}
                            {s.definition}
                          </p>
                          {s.example && <p className="dict-card-example">“{s.example}”</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ))}
          <p className="dict-card-source">{CARD_SOURCE}</p>
        </div>
      )}
    </section>
  );
}

function BookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="dict-card-icon">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M9 7h7M9 10.5h5" />
    </svg>
  );
}
