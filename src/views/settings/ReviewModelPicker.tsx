import { useEffect, useState } from "react";
import type { LLMProvider } from "../../types";
import { getApiKey, getCloudNoticesSeen, getLLMProvider, getReviewModel, markCloudNoticeSeen, setReviewModel } from "../../lib/store";
import { getOllamaModels } from "../../lib/llm";
import { reviewChoiceNotice, reviewModelChoices, type ReviewChoice } from "../../lib/content-review";
import type { CloudFeature } from "../../lib/privacy";
import { CloudNoticePanel } from "./CloudNotice";
import { useSettings } from "./primitives";

const GROUP_LABEL: Record<ReviewChoice["group"], string> = {
  default: "", ollama: "On this computer (Ollama)", openai: "OpenAI", anthropic: "Anthropic",
};

// Settings › Models › Checking model: which model reads each new lesson and batch of questions before the
// learner sees them (review_model, content-review.ts). Choices come from reviewModelChoices; a cloud one
// is saved only after its one-time notice (reviewChoiceNotice, CloudNoticePanel), like the other pickers.
// `provider` and `discovered` (the Ollama models the section found at the saved URL) come from the Models
// section; a change of either re-reads the saved keys, and with none discovered, asks Ollama at the saved URL.
export default function ReviewModelPicker({ provider, discovered }: { provider: LLMProvider; discovered: string[] }) {
  const { markSaved } = useSettings();
  const [value, setValue] = useState("");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [cloudKeys, setCloudKeys] = useState<Partial<Record<"openai" | "anthropic", boolean>>>({});
  const [pending, setPending] = useState<{ value: string; feature: CloudFeature } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [stored, openai, anthropic] = await Promise.all([getReviewModel(), getApiKey("openai"), getApiKey("anthropic")]);
      const models = discovered.length > 0 ? discovered : (await getOllamaModels((await getLLMProvider()).ollamaUrl)).models;
      if (!live) return;
      setValue(stored);
      setOllamaModels(models);
      setCloudKeys({ openai: !!openai, anthropic: !!anthropic });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, discovered.join(",")]);

  const save = async (v: string) => {
    setValue(v);
    await setReviewModel(v);
    markSaved();
  };
  const choose = async (v: string) => {
    if (v === value) { setPending(null); return; }
    const feature = reviewChoiceNotice(v, await getCloudNoticesSeen());
    if (feature) { setPending({ value: v, feature }); return; }
    setPending(null);
    await save(v);
  };
  const confirm = async () => {
    if (!pending) return;
    const { value: v, feature } = pending;
    setPending(null);
    await markCloudNoticeSeen(feature);
    await save(v);
  };

  const choices = reviewModelChoices({ ollamaModels, cloudKeys, stored: value });
  const groups = [...new Set(choices.map((c) => c.group))];
  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g} className="space-y-1.5">
          {GROUP_LABEL[g] && <p className="text-xs text-[var(--ink-faint)]">{GROUP_LABEL[g]}</p>}
          <div className="flex flex-wrap gap-1.5">
            {choices.filter((c) => c.group === g).map((c) => (
              <button
                key={c.value || "default"}
                type="button"
                onClick={() => choose(c.value)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  (pending ? pending.value : value) === c.value ? "btn-primary btn" : "bg-panel-lite text-[var(--ink-dim)] hover:bg-lcd border border-[var(--rule)]"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!cloudKeys.openai && !cloudKeys.anthropic && (
        <p className="text-xs text-[var(--ink-faint)]">To check with a cloud model, save an OpenAI or Anthropic key first (pick that provider above).</p>
      )}
      {pending && <CloudNoticePanel feature={pending.feature} onConfirm={confirm} onCancel={() => setPending(null)} />}
    </div>
  );
}
