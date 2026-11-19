// The one-time confirm shown before the tutor's chats start leaving this computer (#293): picking OpenAI
// or Anthropic, or an Ollama model whose name ends in cloud. Pure, so the words and the rule are tested;
// the Settings screens and the model import only lay them out and ask before they save.
import type { LLMProvider } from "../types";

/**
 * The choices that send the learner's chats off this computer, each with its own one-time confirm.
 * "ollama-cloud" is an Ollama model whose name ends in cloud: Ollama forwards it to Ollama's servers.
 * The Checking model's confirm for the same company is stored apart, as `checking:<feature>` (NoticeMark).
 */
export type CloudFeature = "openai" | "anthropic" | "ollama-cloud";

const COMPANY: Record<CloudFeature, string> = { openai: "OpenAI", anthropic: "Anthropic", "ollama-cloud": "Ollama" };

export interface CloudNotice {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
}

/**
 * What the confirm is for: "chat" when the choice is the provider or the tutor's chat or course model,
 * which sends the learner's chats; "checking" when it is the Checking model (Settings › Models,
 * ReviewModelPicker.tsx), which reads only what the course model wrote, so the chat and courses stay
 * where they were (port of TerraTutor #243).
 */
export type CloudUse = "chat" | "checking";

/**
 * The mark a confirm leaves in cloud_notices_seen: the feature itself for the chat confirm, and
 * "checking:<feature>" for the Checking model's. The Checking confirm says the chat is not sent, so
 * accepting it must not skip the chat confirm when that company is later picked as the provider.
 */
export type NoticeMark = CloudFeature | `checking:${CloudFeature}`;

export function checkingNoticeMark(feature: CloudFeature): NoticeMark {
  return `checking:${feature}`;
}

/** What a Checking model in the cloud is sent. */
const CHECKING_SENDS = "the course topic as the learner typed it and the text the course model wrote";
const CHECKING_STAYS = "Courses and the tutor chat still use the models you picked above.";

function checkingNotice(feature: CloudFeature): CloudNotice {
  if (feature === "ollama-cloud") {
    return {
      title: "Before you check with an Ollama cloud model",
      body:
        "A model whose name ends in cloud doesn't run on this computer. To check each new lesson, its Raise hand help " +
        `and each set of quiz or test questions, Ollama sends ${CHECKING_SENDS} to Ollama's servers, and Ollama handles ` +
        "them under its own terms, not ours. Those terms have their own rules about use by children. " +
        `${CHECKING_STAYS} What the learner types, quiz answers and notes are never sent to Ollama's servers for this.`,
      confirm: "Use this cloud model",
      cancel: "Not now",
    };
  }
  const company = COMPANY[feature];
  return {
    title: `Before you check with ${company}`,
    body:
      `${company} checks each new lesson, its Raise hand help and each set of quiz or test questions, under your key. ` +
      `It is sent ${CHECKING_SENDS}, and ${company} handles them under its own terms, not ours. Those terms have ` +
      `their own rules about use by children. ${CHECKING_STAYS} What the learner types, quiz answers and notes are ` +
      `never sent to ${company} for this.`,
    confirm: `Check with ${company}`,
    cancel: "Not now",
  };
}

/** The confirm shown the first time a choice would send the learner's chats, or for `use` "checking" their course's text, to a company. */
export function cloudNotice(feature: CloudFeature, use: CloudUse = "chat"): CloudNotice {
  if (use === "checking") return checkingNotice(feature);
  if (feature === "ollama-cloud") {
    return {
      title: "Before you use an Ollama cloud model",
      body:
        "A model whose name ends in cloud doesn't run on this computer. Ollama sends what the learner types, quiz answers, " +
        "the notes the tutor reads and course topics to Ollama's servers, and Ollama handles them under its own terms, " +
        "not ours. Those terms have their own rules about use by children. With a model whose name doesn't end in cloud, " +
        "all of this stays on this computer.",
      confirm: "Use this cloud model",
      cancel: "Not now",
    };
  }
  const company = COMPANY[feature];
  return {
    title: `Before you switch to ${company}`,
    body:
      `With ${company}, what the learner types, quiz answers, the notes the tutor reads and course topics are sent to ` +
      `${company} under your key, and ${company} handles them under its own terms, not ours. Those terms have their own ` +
      "rules about use by children. With Ollama, all of this stays on this computer.",
    confirm: `Use ${company}`,
    cancel: "Not now",
  };
}

/** Whether choosing `choice` needs the one-time confirm: a cloud feature not confirmed before. */
export function needsCloudNotice(choice: LLMProvider | CloudFeature, seen: readonly string[]): choice is CloudFeature {
  return choice !== "ollama" && !seen.includes(choice);
}

/**
 * Whether a cloud Checking model of `feature` needs its one-time confirm: neither the chat confirm (which
 * covers more) nor the Checking confirm (checkingNoticeMark) was accepted here.
 */
export function needsCheckingNotice(feature: CloudFeature, seen: readonly string[]): boolean {
  return needsCloudNotice(feature, seen) && !seen.includes(checkingNoticeMark(feature));
}

/**
 * Whether choosing `model` for a job run by `provider` (the tutor's chat or course model) needs the
 * one-time confirm first: an Ollama cloud model, when no Ollama cloud model has been confirmed here
 * before. Every place a model is picked or imported asks this before saving it.
 */
export function modelNeedsCloudNotice(provider: LLMProvider, model: string, seen: readonly string[]): boolean {
  return provider === "ollama" && isOllamaCloudModel(model) && needsCloudNotice("ollama-cloud", seen);
}

/** The confirmed list after `feature` is confirmed, for the store. */
export function withNoticeSeen(seen: readonly string[], feature: NoticeMark): string[] {
  return seen.includes(feature) ? [...seen] : [...seen, feature];
}

/** The stored value as a list of confirm marks (NoticeMark); anything else counts as nothing confirmed. */
export function parseNoticesSeen(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** Ollama's own cloud models (names ending in `cloud`, tag or not) send their chats to Ollama's servers. */
export function isOllamaCloudModel(model: string): boolean {
  return /cloud$/i.test(model.trim());
}

/**
 * Whether a call on this provider and model stays on this computer: Ollama, with a model whose name
 * does not end in cloud. Work on data about the learner (which questions they missed) runs only here.
 */
export function isLocalModel(config: { provider: LLMProvider; model: string }): boolean {
  return config.provider === "ollama" && !isOllamaCloudModel(config.model);
}
