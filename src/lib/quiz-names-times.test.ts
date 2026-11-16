import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Names and clock times on the app's path (review of #333): gradeAnswersBatch reads the bundled
// dictionary and English word list (public/ on disk, as the webview serves it) and settles in code what
// it can. With no grader (config null) an answer code leaves alone is passed as `fallback`, so `by`
// says whether code took it.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { gradeAnswersBatch } from "./quiz";
import { resetDictionaryCache } from "./dictionary";
import { resetWordListCache } from "./wordlist";
import { installAppOrigin } from "./eval/headless/origin";

const original = globalThis.fetch;

async function byOf(cases: Array<[string, string, string]>): Promise<string[]> {
  const out = await gradeAnswersBatch(cases.map(([question, expected, student], index) => ({ index, question, expected, student, type: "short_answer" })), null);
  return cases.map((_, i) => out.get(i)!.by);
}

// Each case is [question, key, answer]; none may be settled by code.
async function expectUnsettled(cases: Array<[string, string, string]>): Promise<void> {
  const by = await byOf(cases);
  expect(cases.filter((_, i) => by[i] === "exact")).toEqual([]);
}

describe("gradeAnswersBatch: names and clock times code must leave to the model", () => {
  beforeEach(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });

  it("takes a misspelt name the dictionary and word list do not have", async () => {
    expect(await byOf([
      ["Which ancient Roman city was buried by Mount Vesuvius?", "Pompeii", "pompei"],
      ["What is the largest hot desert in the world?", "the Sahara Desert", "the sahera desert"],
    ])).toEqual(["exact", "exact"]);
  }, 30_000);

  it("leaves a misspelt name to the model when the word list cannot be read", async () => {
    const served = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      String(input).includes("wordlist/") ? Promise.resolve(new Response("not found", { status: 404 })) : served(input, init)) as typeof fetch;
    expect(await byOf([
      ["Which ancient Roman city was buried by Mount Vesuvius?", "Pompeii", "pompei"],
      ["What is the largest hot desert in the world?", "the Sahara Desert", "the sahera desert"],
    ])).toEqual(["fallback", "fallback"]);
  }, 30_000);

  it("never reads the half of the day from the question when the answer says one and the key does not", async () => {
    await expectUnsettled([
      ["A movie starts at 11:30 a.m. and lasts 2 hours. What time does it end?", "1:30", "1:30 a.m."],
      ["A movie starts at 11:30 a.m. and lasts 2 hours. What time does it end?", "1:30", "half past one in the morning"],
      ["The party started at 9 p.m. and lasted 3 hours. What time did it end?", "12:00", "noon"],
      ["The party started at 9 p.m. and lasted 3 hours. What time did it end?", "12:00", "12:00 p.m."],
      ["The store opens at 9 a.m. and is open for 9 hours. When does it close?", "6:00", "6:00 a.m."],
      ["The store opens at 9 a.m. and is open for 9 hours. When does it close?", "6:00", "six in the morning"],
      ["The train leaves at 11:50 p.m. and the trip takes 25 minutes. When does it arrive?", "12:15", "12:15 pm"],
      ["The train leaves at 11:50 p.m. and the trip takes 25 minutes. When does it arrive?", "12:15", "quarter past twelve in the afternoon"],
      ["Sam went to bed at 9:00 p.m. and slept 10 hours. What time did he wake up?", "7:00", "7 pm"],
      ["Sam went to bed at 9:00 p.m. and slept 10 hours. What time did he wake up?", "7:00", "7:00 p.m."],
      ["Sam went to bed at 9:00 p.m. and slept 10 hours. What time did he wake up?", "7:00", "seven at night"],
      ["What time is 2 hours after 11:00 a.m.?", "1:00", "1:00 a.m."],
      ["What time is 2 hours after 11:00 a.m.?", "1:00", "one in the morning"],
      ["What time is 3 hours after 10:00 p.m.?", "1:00", "1 pm"],
      ["What time is 3 hours after 10:00 p.m.?", "1:00", "one in the afternoon"],
      ["The sun rose at 6:30 in the morning and set 12 hours later. What time did it set?", "6:30", "6:30 am"],
    ]);
  }, 30_000);

  it("leaves a bare or worded time to the model on a question that asks for 12-hour or 24-hour time", async () => {
    await expectUnsettled([
      ["Write 4:15 p.m. in 24-hour time.", "16:15", "4:15"],
      ["Write 4:15 p.m. in 24-hour time.", "16:15", "quarter past four"],
      ["Write 4:15 p.m. in 24-hour time.", "16:15", "quarter past four in the afternoon"],
      ["Write 12:30 a.m. in 24-hour time.", "00:30", "12:30"],
      ["Write 12:30 a.m. in 24-hour time.", "00:30", "half past twelve"],
      ["Write 16:15 as a 12-hour time.", "4:15 p.m.", "sixteen fifteen"],
    ]);
  }, 30_000);

  // Review of #333: other wordings of the form, and a question that gives the key's time in another form,
  // are conversions too; an answer that skips the conversion (or echoes the question) is the model's.
  it("leaves a time that skips the conversion to the model, however the form is worded", async () => {
    await expectUnsettled([
      ["Write 4:15 p.m. using the 24 hour system.", "16:15", "4:15"],
      ["Write 4:15 p.m. using the 24 hour system.", "16:15", "quarter past four"],
      ["A clock in a train station uses the 24-hour system. How would it show 4:15 p.m.?", "16:15", "4:15"],
      ["Write 4:15 p.m. in 24 hour system time.", "16:15", "quarter past four in the afternoon"],
      ["Write 4:15 p.m. in twenty four hour time.", "16:15", "4:15"],
      ["Write 16:15 in standard time.", "4:15 p.m.", "sixteen fifteen"],
      ["Change 16:15 to standard time.", "4:15 p.m.", "sixteen fifteen"],
      ["Write 16:15 using a.m. or p.m.", "4:15 p.m.", "sixteen fifteen"],
      // No form named: the question's time is the key's, written another way.
      ["What is 16:15 on a clock with a.m. and p.m.?", "4:15 p.m.", "sixteen fifteen"],
      ["What is 16:15 on a clock with a.m. and p.m.?", "4:15 p.m.", "4:15"],
      ["What is 16:15 on a clock with a.m. and p.m.?", "4:15 p.m.", "16:15"],
      ["How does a station clock show 4:15 p.m.?", "16:15", "4:15"],
      ["How does a station clock show 4:15 p.m.?", "16:15", "quarter past four"],
      ["How does a station clock show 4:15 p.m.?", "16:15", "4:15 p.m."],
      ["Write 4:15 p.m. in 24-hour time.", "16:15", "4:15 p.m."],
      ["Write 16:15 in standard time.", "4:15 p.m.", "16:15"],
      // Verification of the conversion fix: any word about the answer's form leaves a worded or bare time
      // to the model ("24-hr", "24h", "railway time", "in digits", "as a digital time").
      ["Write quarter to six in the evening in 24-hr time.", "17:45", "5:45"],
      ["How would a 24h clock show quarter to six in the evening?", "17:45", "5:45"],
      ["How would a 24h clock show quarter to six in the evening?", "17:45", "quarter to six in the evening"],
      ["Write quarter to six in the evening in 24-hr format.", "17:45", "quarter to six in the evening"],
      ["Write quarter to six in the evening as railway time.", "17:45", "5:45"],
      ["Write quarter past four in the afternoon in digits.", "4:15 p.m.", "quarter past four in the afternoon"],
      ["Write the time in digits: quarter past four in the afternoon.", "4:15 p.m.", "quarter past four in the afternoon"],
      ["Write a quarter to nine in the morning in digits.", "8:45 a.m.", "quarter to nine in the morning"],
      ["Write twenty past three as a digital time.", "3:20", "twenty past three"],
    ]);
  }, 30_000);

  it("still takes the converted time and marks a.m. for p.m. wrong on a conversion", async () => {
    const cases: Array<[string, string, string]> = [
      ["Write 4:15 p.m. using the 24 hour system.", "16:15", "16:15"],
      ["A clock in a train station uses the 24-hour system. How would it show 4:15 p.m.?", "16:15", "16:15"],
      ["Write 16:15 in standard time.", "4:15 p.m.", "4:15 pm"],
      ["Write 16:15 using a.m. or p.m.", "4:15 p.m.", "4:15 p.m."],
      ["How does a station clock show 4:15 p.m.?", "16:15", "16:15"],
      ["What time is 15:00 on a 12-hour clock?", "3 PM", "3 p.m."],
      ["Write 16:15 in standard time.", "4:15 p.m.", "4:15 a.m."],
    ];
    const out = await gradeAnswersBatch(cases.map(([question, expected, student], index) => ({ index, question, expected, student, type: "short_answer" })), null);
    expect(cases.map((_, i) => `${out.get(i)!.by} ${out.get(i)!.isCorrect}`)).toEqual([...cases.slice(0, 6).map(() => "exact true"), "exact false"]);
  }, 30_000);

  it("never takes a two-word surname that starts with an initial", async () => {
    await expectUnsettled([
      ["Who was the 41st president of the United States?", "George H. W. Bush", "w bush"],
      ["Who was the 41st president of the United States?", "George H. W. Bush", "W. Bush"],
      ["Who was the 35th president of the United States?", "John F. Kennedy", "f kennedy"],
      ["Who led the Union army at the end of the Civil War?", "Ulysses S. Grant", "s grant"],
    ]);
  }, 30_000);

  it("never takes the last words of a place or a thing as a person's surname", async () => {
    await expectUnsettled([
      ["Which country's president was Nelson Mandela?", "South Africa", "africa"],
      ["What nation did President Nelson Mandela lead?", "South Africa", "africa"],
      ["Which state's senator was Robert Byrd for 51 years?", "West Virginia", "virginia"],
      ["Which state's governor was Lew Wallace when he wrote Ben-Hur?", "New Mexico", "mexico"],
      ["Which country's leader was Joseph Stalin?", "Soviet Union", "union"],
      ["Which country's leader was Joseph Stalin?", "Soviet Union", "the union"],
      ["Which country's leader was Erich Honecker?", "East Germany", "germany"],
      ["What did the emperor Charlemagne rule?", "Holy Roman Empire", "roman empire"],
      ["What did the emperor Charlemagne rule?", "Holy Roman Empire", "the roman empire"],
      ["What did President Truman end by using atomic bombs?", "World War II", "the war"],
      ["Nelson Mandela was the leader who ended apartheid. Which country did he lead?", "South Africa", "africa"],
      ["Robert Byrd was a senator who served for 51 years. Which state did he represent?", "West Virginia", "virginia"],
      ["Who was the main rival of the United States in the Cold War?", "Soviet Union", "the union"],
    ]);
  }, 30_000);

  // A surname that is an everyday word ("bell", "cook") or a place ("washington") after a first name that
  // is no adjective is still a person's.
  it("still takes a surname and a time the review did not object to", async () => {
    const cases: Array<[string, string, string]> = [
      ["Who discovered penicillin?", "Alexander Fleming", "fleming"],
      ["Who wrote the Sherlock Holmes stories?", "Arthur Conan Doyle", "conan doyle"],
      ["Which scientist discovered penicillin?", "Alexander Fleming", "fleming"],
      ["Who was the 16th president of the United States?", "Abraham Lincoln", "lincoln"],
      ["Who was granted the first patent for the telephone?", "Alexander Graham Bell", "bell"],
      ["Who was granted the first patent for the telephone?", "Alexander Graham Bell", "graham bell"],
      ["Which explorer charted the east coast of Australia in 1770?", "James Cook", "cook"],
      ["Who was the first President of the United States?", "George Washington", "washington"],
      ["Which nurse was called the Lady with the Lamp?", "Florence Nightingale", "nightingale"],
      ["Who flew a kite in a thunderstorm to study lightning?", "Benjamin Franklin", "franklin"],
      ["Who was the 35th president of the United States?", "John F. Kennedy", "kennedy"],
      ["Which country's president was Nelson Mandela?", "South Africa", "South Africa"],
      ["What time is it when the clock shows 11:15?", "11:15", "quarter after eleven"],
      ["A film starts at 2:45 p.m. and lasts 90 minutes. What time does it end?", "4:15 p.m.", "4:15"],
      ["Write 4:15 p.m. in 24-hour time.", "16:15", "16:15"],
    ];
    expect(await byOf(cases)).toEqual(cases.map(() => "exact"));
  }, 30_000);
});
