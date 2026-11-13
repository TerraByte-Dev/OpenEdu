import { useId, useState } from "react";
import { CARD_SOURCE, cardToggleLabel, type DictionaryCard as Card } from "../lib/dictionary-card";
import { IconBook2, IconChevronDown, IconMediaStop, IconVolumeUp } from "./icons";

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
          <IconChevronDown size={14} className={open ? "rotate-180" : ""} />
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
              <IconMediaStop size={16} />
            ) : (
              <IconVolumeUp size={18} />
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
    <IconBook2 size={18} className="dict-card-icon" />
  );
}
