import { describe, it, expect } from "vitest";
import providerModels from "../views/settings/sections/ProviderModels.tsx?raw";
import modelImport from "../components/ModelImport.tsx?raw";

// The screens that pick a provider or a model, read as source: each may save a choice that sends the
// learner's chats off this computer only after the one-time confirm (privacy.ts, #293). The confirm's logic
// is tested in privacy.test.ts; these tests fail if a pick path goes back to saving straight away, e.g. a
// provider button calling pickProvider directly or a model chip calling setChatModel.

const src = (s: string) => s.replace(/\r\n?/g, "\n");
const pm = src(providerModels);
const mi = src(modelImport);

/** The arrow function that starts at `marker` (e.g. `const save = `), up to its closing brace. */
function block(text: string, marker: string): { start: number; end: number; text: string } {
  const decl = text.indexOf(marker);
  expect(decl, marker).toBeGreaterThan(-1);
  expect(text.indexOf(marker, decl + 1), `${marker} appears once`).toBe(-1);
  const open = text.indexOf("{", text.indexOf("=>", decl));
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { start: decl, end: i, text: text.slice(decl, i + 1) };
  }
  throw new Error(`unclosed ${marker}`);
}
const body = (text: string, name: string) => block(text, `const ${name} = `);
const callsOf = (text: string, fn: string) => [...text.matchAll(new RegExp(`\\b${fn}\\(`, "g"))].map((m) => m.index!);
const inside = (at: number, b: { start: number; end: number }) => at > b.start && at < b.end;

describe("Settings › Provider switches to OpenAI or Anthropic only through the confirm", () => {
  const pick = body(pm, "pickProvider");
  const choose = body(pm, "chooseProvider");
  const confirm = body(pm, "confirmCloud");

  it("saves the provider only inside pickProvider", () => {
    const calls = callsOf(pm, "setLLMProvider");
    expect(calls).toHaveLength(1);
    expect(inside(calls[0], pick)).toBe(true);
  });

  it("reaches pickProvider only from chooseProvider (after the gate) and confirmCloud (after remembering it)", () => {
    const calls = callsOf(pm, "pickProvider");
    expect(calls.length).toBeGreaterThan(0);
    for (const at of calls) expect(inside(at, choose) || inside(at, confirm), pm.slice(at - 40, at + 20)).toBe(true);
    expect(choose.text.indexOf("needsCloudNotice(")).toBeGreaterThan(-1);
    expect(choose.text.indexOf("needsCloudNotice(")).toBeLessThan(choose.text.indexOf("pickProvider("));
    expect(confirm.text.indexOf("markCloudNoticeSeen(")).toBeGreaterThan(-1);
    expect(confirm.text.indexOf("markCloudNoticeSeen(")).toBeLessThan(confirm.text.indexOf("pickProvider("));
  });

  it("has the provider buttons call chooseProvider, and Not now leave the provider as it was", () => {
    expect(pm).toContain("onClick={() => chooseProvider(p.id)}");
    expect(pm).not.toMatch(/onClick=\{\(\) => pickProvider\(/);
    expect(pm).toContain("<CloudNoticePanel feature={pendingCloud} onConfirm={confirmCloud} onCancel={() => setPendingCloud(null)} />");
  });
});

describe("Settings › Models saves an Ollama cloud model for chat or generation only through the confirm", () => {
  const save = body(pm, "saveModel");
  const commit = body(pm, "commitModel");
  const confirm = body(pm, "confirmModel");
  const cancel = body(pm, "cancelModel");

  it("writes the chat and generation models only inside saveModel", () => {
    for (const setter of ["setChatModel", "setGenerationModel"]) {
      const calls = callsOf(pm, setter);
      expect(calls, setter).toHaveLength(1);
      expect(inside(calls[0], save), setter).toBe(true);
    }
  });

  it("reaches saveModel only from commitModel (after the gate) and confirmModel (after remembering it)", () => {
    const calls = callsOf(pm, "saveModel");
    expect(calls.length).toBeGreaterThan(0);
    for (const at of calls) expect(inside(at, commit) || inside(at, confirm), pm.slice(at - 40, at + 20)).toBe(true);
    expect(commit.text.indexOf("modelNeedsCloudNotice(provider, m, seen.current)")).toBeGreaterThan(-1);
    expect(commit.text.indexOf("modelNeedsCloudNotice(")).toBeLessThan(commit.text.indexOf("saveModel("));
    expect(confirm.text.indexOf('markCloudNoticeSeen("ollama-cloud")')).toBeGreaterThan(-1);
    expect(confirm.text.indexOf('markCloudNoticeSeen("ollama-cloud")')).toBeLessThan(confirm.text.indexOf("saveModel("));
  });

  it("sends both pickers, Ollama and cloud chips, through commitModel", () => {
    expect(pm).toContain('const commitGen = (m: string) => commitModel("gen", m);');
    expect(pm).toContain('const commitChat = (m: string) => commitModel("chat", m);');
    expect(pm.match(/onCommit=\{commitGen\}/g)).toHaveLength(1);
    expect(pm.match(/onCommit=\{commitChat\}/g)).toHaveLength(1);
    expect(pm.match(/onChange=\{commitGen\}/g)).toHaveLength(1);
    expect(pm.match(/onChange=\{commitChat\}/g)).toHaveLength(1);
    expect(pm).toContain('{modelNotice("gen")}');
    expect(pm).toContain('{modelNotice("chat")}');
  });

  it("puts back the saved model on Not now, without saving", () => {
    expect(cancel.text).toContain("showModel(pendingModel.job, saved.current[pendingModel.job])");
    expect(cancel.text).not.toContain("saveModel(");
    expect(pm).toContain('<CloudNoticePanel feature="ollama-cloud" onConfirm={confirmModel} onCancel={cancelModel} />');
  });
});

describe("Model import makes an Ollama cloud model the tutor only through the confirm", () => {
  const use = body(mi, "useModel");
  const become = body(mi, "becomeTutor");
  const confirm = body(mi, "confirmCloud");
  const decline = body(mi, "declineCloud");

  it("writes the chat and generation models only inside useModel", () => {
    for (const setter of ["setChatModel", "setGenerationModel"]) {
      const calls = callsOf(mi, setter);
      expect(calls, setter).toHaveLength(1);
      expect(inside(calls[0], use), setter).toBe(true);
    }
  });

  it("reaches useModel only from becomeTutor (after the gate) and confirmCloud (after remembering it)", () => {
    const calls = callsOf(mi, "useModel");
    expect(calls.length).toBeGreaterThan(0);
    for (const at of calls) expect(inside(at, become) || inside(at, confirm), mi.slice(at - 40, at + 20)).toBe(true);
    expect(become.text.indexOf('modelNeedsCloudNotice("ollama", model, await getCloudNoticesSeen())')).toBeGreaterThan(-1);
    expect(become.text.indexOf("modelNeedsCloudNotice(")).toBeLessThan(become.text.indexOf("useModel("));
    expect(confirm.text.indexOf('markCloudNoticeSeen("ollama-cloud")')).toBeLessThan(confirm.text.indexOf("useModel("));
    expect(decline.text).not.toContain("useModel(");
  });

  it("sends both a fresh import and an already-installed model through becomeTutor", () => {
    expect(callsOf(mi, "becomeTutor")).toHaveLength(2);
    expect(mi).toContain("const useExisting = (model: string) => becomeTutor(model, true);");
    expect(mi).toContain("await becomeTutor(done, built.checked && unchecked === 0);");
    expect(mi).toContain('<CloudNoticePanel feature="ollama-cloud" onConfirm={confirmCloud} onCancel={declineCloud} />');
  });
});
