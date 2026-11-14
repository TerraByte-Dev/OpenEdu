// The one-time confirm shown before the tutor's chats start leaving this computer (#293): picking OpenAI
// or Anthropic, or an Ollama model whose name ends in cloud. Pure, so the words and the rule are tested;
// the Settings screens and the model import only lay them out and ask before they save.
import type { LLMProvider } from "../types";

/**
 * The choices that send the learner's chats off this computer, each with its own one-time confirm.
 * "ollama-cloud" is an Ollama model whose name ends in cloud: Ollama forwards it to Ollama's servers.
 */
export type CloudFeature = "openai" | "anthropic" | "ollama-cloud";

const COMPANY: Record<CloudFeature, string> = { openai: "OpenAI", anthropic: "Anthropic", "ollama-cloud": "Ollama" };

export interface CloudNotice {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
}

/** The confirm shown the first time a choice would send the learner's chats to a company. */
export function cloudNotice(feature: CloudFeature): CloudNotice {
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
 * Whether choosing `model` for a job run by `provider` (the tutor's chat or course model) needs the
 * one-time confirm first: an Ollama cloud model, when no Ollama cloud model has been confirmed here
 * before. Every place a model is picked or imported asks this before saving it.
 */
export function modelNeedsCloudNotice(provider: LLMProvider, model: string, seen: readonly string[]): boolean {
  return provider === "ollama" && isOllamaCloudModel(model) && needsCloudNotice("ollama-cloud", seen);
}

/** The confirmed list after `feature` is confirmed, for the store. */
export function withNoticeSeen(seen: readonly string[], feature: CloudFeature): string[] {
  return seen.includes(feature) ? [...seen] : [...seen, feature];
}

/** The stored value as a list of confirmed features; anything else counts as nothing confirmed. */
export function parseNoticesSeen(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** Ollama's own cloud models (names ending in `cloud`, tag or not) send their chats to Ollama's servers. */
export function isOllamaCloudModel(model: string): boolean {
  return /cloud$/i.test(model.trim());
}
