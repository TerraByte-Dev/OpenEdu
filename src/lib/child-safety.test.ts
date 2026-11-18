import { describe, it, expect } from "vitest";
import { isSafetyDisclosure, pregnancyShape, SAFETY_NOTICE, CHILD_SAFETY_RULES } from "./child-safety";
import { GRADES } from "./grade";
import { fs, path, cwd } from "./eval/headless/node-io";
import {
  STRONG_PREGNANCY, REVIEW_342_STRONG, NOT_STRONG_PREGNANCY, REVIEW7_CLASS_A, REVIEW8_CLASS_A, REVIEW8_STILL_STRONG,
  PREGNANCY_CORPUS, BABY_WITH_STRONG, BABY_WITH_QUIET,
} from "./child-safety-pregnancy.fixtures";
import { speakableText } from "./speech";
import chatTabSource from "../components/ChatTab.tsx?raw";

describe("isSafetyDisclosure", () => {
  it("fires on suicide and self-harm disclosures", () => {
    for (const m of [
      "I want to kill myself", "i wanna die", "Sometimes I wish I was dead", "I'm suicidal",
      "I've been thinking about suicide", "I don't want to live anymore", "I dont want to be alive",
      "I don’t want to live", "I cut myself last night", "I keep hurting myself", "is self-harm bad",
      "I want to end my life", "everyone would be better off without me",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  // The review of #282 found every one of these returned false.
  it("fires on the suicide and self-harm wordings the first list missed", () => {
    for (const m of [
      "I do not want to live", "I don't wanna live", "I wanna be dead", "I wish I could die",
      "I wish I had never been born", "nobody would care if I died", "I want to end it all",
      "no reason to live", "I want to hurt my self", "I cut my wrists", "kms", "unalive myself",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  it("fires on abuse disclosures", () => {
    for (const m of [
      "my dad hits me when he's angry", "my uncle touched me and told me not to tell",
      "someone is hurting me", "my mom's boyfriend abuses me", "I'm scared to go home",
      "I am not safe at home", "he beat me up after school", "I was molested",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  // The review of #282 found every one of these returned false. Past-tense "hit me" is the likeliest.
  it("fires on the abuse wordings the first list missed", () => {
    for (const m of [
      "my dad hit me", "he hit me", "my dad beat me", "my dad beats me", "my mom hits us",
      "my mom slaps me", "he punches me", "my mom hurt me", "I am being abused",
      "he touches my private parts", "my stepdad hurts my sister",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  // The round-2 review of #282 found the " at "/" in " games exclusion dropped these, and the old
  // fixed "to kms"/"gonna kms" phrases missed the chat forms of "kms".
  it("fires on hits followed by at/in, more subjects and fillers, and chat kms", () => {
    for (const m of [
      "my dad hit me in the face", "he punched me in the stomach", "my dad hits me at night",
      "he touches me in bed", "he hit me at home", "my dad hit me in front of my friends",
      "my dad has been hitting me", "my dad's hitting me", "my step-dad hits me", "my dad smacks me",
      "my dad hits my little sister", "i wanna kms", "kms lol",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  it("fires on the low-priority recall additions: selfharm, backtick and acute apostrophes", () => {
    for (const m of ["is selfharm bad", "i don`t want to live", "i don´t want to live"])
      expect(isSafetyDisclosure(m), m).toBe(true);
  });

  it("does not fire on schoolwork", () => {
    for (const m of [
      "How do I kill the process in Linux?", "Why did the character died at the end of the story?",
      "the character died in chapter 3", "how do I cut the fraction in half", "Can you cut this sentence shorter?",
      "my brother beats me at chess", "What is substance abuse?", "What was the abuse of power in Watergate?",
      "Explain how a hurricane hits the coast", "Hit me with another question!", "How do plants die in winter?",
      "What is 3/4 + 1/8?", "", "   ",
      // From the review of #282: the old unanchored "touched me", "hits me", "hurts me" entries fired on these.
      "the story really touched me", "that poem touched me deeply", "what happens when a wave hits me",
      "if a baseball hits me how much force is it", "it hurts me to read this much", "my hand hurts me when I write",
      "they beat us in the finals", "The race is 5 kms long",
      // From the round-2 review of #282: unit conversion and the other games and sports wordings.
      "how do I convert miles to kms", "they beat us by 3 points", "they beat us 3-0",
      "she beat me to the answer", "my coach kicked me off the team",
    ]) expect(isSafetyDisclosure(m), m).toBe(false);
  });

  // Known, accepted false positives: each shows the notice on an ordinary message. They stay because
  // the matcher that would skip them would also skip real disclosures, and a wrong notice costs one
  // kind line of text. Pinned here so a change to that trade is a deliberate one.
  it("fires on these known, accepted false positives", () => {
    for (const m of [
      "Why did Romeo commit suicide?", "he hit me with a great idea", "I cut myself on the paper",
      "I hurt myself at recess", "why do the characters want to die in Romeo and Juliet",
      "women were raped during the war", "what does molest mean",
      "he hit me in dodgeball", "my brother hit me", "my teacher hit us with a pop quiz",
      "what would happen if i died my hair blue", "how does the author end it all",
      // TerraTutor #125's "sextort*" and "sexual assault*" are bare topic words like "suicid*" (review of #372).
      "what does sextortion mean", "the article was about sexual assault on campus",
      "the me too movement fought sexual assault",
      // Everyday, not schoolwork, wordings of the ported patterns (review of #372): the cheap side of the trade.
      "the doctor told me to take my shirt off", "mom told me to get undressed for my bath",
      "my mom took pictures of me in the bath when i was a baby", "i got hurt at home when i fell off my bike",
      "i don't feel safe in my room when there is a storm", "my little brother pulled down my pants",
      "he took off his shirt in front of us to show the scar",
      // A negative below plus "unless": SHARE_PICS_RE with THREAT_RE.
      "my teacher will post my pictures on the bulletin board unless my mom says no",
      // TerraTutor #223: a stranger's kindness told in the first person (TOUCHED_BY with a stranger as AGENT).
      "i was touched by a stranger who gave me food",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  // Ported from TerraTutor #125 (its cycle-3 and cycle-5 reviews, parent-topics.test.ts there): sexual abuse in
  // a child's words. Before the port OpenEdu showed no notice for any of these. With no grade and at every grade:
  // the harm half does not read the grade.
  it("fires on sexual abuse in a child's words, with or without a grade", () => {
    for (const m of [
      "my uncle touched my genitals", "he touches my private parts and talks about sex", "I was sexually abused",
      "my uncle sexually assaulted me", "I was sexually assaulted", "he made me have sex with him",
      "my stepdad makes me have sex", "someone did sexual things to me", "my cousin forced me to do sexual stuff",
      "my coach sends me sexy pictures", "a man online asked me for sexy pics", "my babysitter showed me porn",
      "someone online sent me a sext", "he sent me a sext",
      "my uncle had sex with me", "my stepdad has sex with me", "my brother showed me his penis",
      "my uncle makes me touch his penis", "he does sex stuff to me", "a stranger online sent me porn",
      "he had sex with me", "my step brother has sex with me at night", "he wants to have sex with me",
      "my coach asked me to have sex", "someone sent me a picture of his penis", "my stepdad does sex things to me",
      "my cousin makes me do sex stuff", "he put his penis on me", "he makes me suck his penis",
      "he rubs his penis on me", "he showed me his genitals",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
  });

  // TerraTutor #125's cycle-6 review: common sexual-abuse, grooming and online-exploitation wordings that
  // reached the model with no notice. Each pattern in DISCLOSURE_RES is pinned by at least one.
  it("fires on the cycle-6 disclosure wordings, with or without a grade", () => {
    for (const m of [
      // A person, words between, then touches me (or a part of the body, or him / her / them).
      "my stepdad comes into my room at night and touches me", "my stepdad sleeps in my bed and touches me",
      "my coach said it's our secret and touched me", "my coach said it's our secret, and touched me",
      "a big kid at school pulls down my pants and touches me", "the older boys at school touch me in the locker room",
      "a kid in my class says her dad touches her at night", "i got touched by my uncle", "i was touched by my uncle",
      "a teacher at school touches kids",
      // Touches / rubs / grabs my body, butt, chest, boobs, private area, singular private.
      "he touches my body", "my cousin touches my butt", "my friend's dad touched my boobs", "my uncle touches my chest",
      "he rubs my private area", "my dad touches my private", "a man at the store grabbed my butt",
      "he asked me to touch his private", "my uncle put his mouth on my private",
      // Down there.
      "my babysitter touches me down there", "he touched my down there",
      // Hands in or down clothes; pants pulled down.
      "he put his hand in my pants", "he put his hands down my shirt", "she put her hand up my shirt",
      "he puts his hand in my underwear", "he pulled down my pants", "an older kid pulled my pants down in the bathroom",
      "a guy at the park pulled down his pants in front of me",
      // Made to touch or suck.
      "he makes me touch him", "my cousin made me touch his thing", "my cousin made me touch him down there",
      "he made me suck his thing", "he made me suck on his thing",
      // Clothes off, naked.
      "he made me take my clothes off", "she made me get naked", "my babysitter makes me take off my clothes",
      "he told me to take my pants off", "my step dad took my clothes off", "she made me get undressed and took pictures",
      // Nudes, pictures, video.
      "he asked for nudes", "someone asked me for nudes", "a boy online sent me nudes", "someone dmed me a dick pic",
      "a guy on snapchat sent me a dick pic", "he has pictures of me naked", "he wants naked pictures of me",
      "he wants a picture with no clothes on", "he recorded me naked", "he wants pictures of myself without clothes",
      "a stranger on roblox wants me to send pictures without clothes", "my coach asked me to send a pic without my shirt",
      "a grown up online asked for pictures of me in my underwear", "a man sent me a picture of his private parts",
      "my uncle showed me videos of people with no clothes", "someone online wants me to video chat with no clothes",
      // Sextortion.
      "he will share my pictures if i dont send more", "he is blackmailing me with my pictures",
      "he threatened to share my nudes", "he says he'll post my pics unless i send more", "someone tried to sextort me",
      // Humps, watches in the shower, fingers in me, his thing in my.
      "he humps me", "he humped me", "my stepdad watches me in the shower", "my moms boyfriend watches me when i change",
      "my cousin put his fingers in me", "he puts his fingers in me", "he stuck his thing in my butt",
      // And the plainest ways to say home is not safe.
      "i don't feel safe at my dad's house", "i get hurt at home",
      // The audit's four (2026-11-18): each showed no notice before the port.
      "someone online keeps asking for my nudes", "he'll post my pics unless i send more",
      // The narrowed patterns of the review of #372 still fire on each disclosure form they kept.
      "he touched my private", "my uncle touches my private and says it's a secret", "he touches my private, it hurts",
      "he showed me his private", "he made me touch his private parts", "he touched my privates",
      "my brother showed me his privates", "my dad touches my private with his hand", "his coach touched him",
      "their uncle touches them at night", "i was touched by him", "i was touched by her at the sleepover",
      "i got touched by a stranger", "i got touched by a man at the park", "i was touched by my uncle's friend",
      "i was touched by my mom's boyfriend", "the man touches kids at the park", "my coach touches the boys",
      "a stranger touched me",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
  });

  // The other side of the cycle-6 patterns (TerraTutor #125): school and everyday sentences with the same words.
  it("does not fire on school and everyday sentences that use the cycle-6 words", () => {
    for (const m of [
      "my teacher touched my shoulder to wake me up", "the doctor touched my chest with the stethoscope",
      "my brother kicked my butt at chess", "my teacher will post my pictures on the class bulletin board",
      "can i send my pictures to the class page", "he showed me his thing he built in minecraft",
      "my private school has uniforms", "i sent a private message to my friend", "my brother goes to his private school",
      "the emperor had no clothes on in the story", "my mom told me to take my shoes off", "i took my shirt off because it was hot",
      "my grandma's letter touched my heart", "she touched the hot stove and burned her finger",
      "my sister touched my stuff without asking", "he grabbed my pencil", "my friend touched my arm in tag",
      "the kids touched the snake at the zoo", "my dog licked my face", "the cat watches me when i eat",
      "they filmed the play in the gym", "i feel safe at home", "i got hurt at recess",
      "blackmail is a crime in the story we read", "the hump of a camel stores fat", "my teacher touched on that topic",
      "i was touched by the ending of the book", "my mom said the story touched me", "the fish live down there",
      "we took pictures of the sunset", "my sister touched her toes",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
  });

  // The review of #372: TerraTutor #125's patterns as ported fired on each of these (TerraTutor still does). In
  // OpenEdu a hit also passes a written answer with no mark and refuses a course topic, so each is pinned.
  it("does not fire on schoolwork that tripped the patterns as first ported", () => {
    for (const m of [
      // "private" before a noun is the adjective, not the body.
      "she kept her private feelings to herself", "he went to his private quarters",
      "she wrote in her private notebook every night", "he had his private reasons for leaving",
      "the paparazzi take pictures of their private lives", "she shared her private thoughts",
      "he went to his private office", "the private parts of the castle were locked", "he led his privates into battle",
      // Touching him, her or them after people, kids, a woman or a boy.
      "sea anemones sting people who touch them", "mimosa leaves fold up when people touch them",
      "pill bugs roll up when kids touch them", "the woman reached out and touched him",
      "in the story, the old woman touched him on the shoulder", "in the story the boy touched her and she turned to gold",
      "his mother touched his face", "her grandma touched her cheek", "her teacher touched her shoulder",
      "the knight touched her with his sword",
      // "get touched" with no one doing it.
      "a venus flytrap closes when its hairs get touched twice", "the leaves of the mimosa fold when they get touched",
      "he gets touched by the story every time",
      // Touching the children with no grown-up doing it.
      "her kindness touched the children", "the movie touched children all over the world",
      "jesus touched the children and blessed them", "he touched the children and blessed them",
      "the soldiers touched the children's hearts", "the man's story touched the children",
      "my mom said her kindness touched the children",
      // Touched by someone's words: the apostrophe is not a person.
      "i was touched by my teacher's words", "i was touched by my mom's letter", "i was touched by her kindness",
      "my teacher was touched by my card",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
  });

  // Ported from TerraTutor #223 (its #221, from the review of #372), each list verbatim. TerraTutor's check takes
  // no grade; OpenEdu's harm half does not read one, so each sentence is checked with no grade and at every grade.
  it("does not fire on the schoolwork TerraTutor #221 lists, at every grade", () => {
    for (const m of [
      // "private" before a noun is the adjective, not the body.
      "she kept her private feelings to herself", "he went to his private quarters",
      "she wrote in her private notebook every night", "he had his private reasons for leaving",
      "the paparazzi take pictures of their private lives", "she shared her private thoughts",
      "he went to his private office", "the private parts of the castle were locked", "he led his privates into battle",
      "he kept his private and public life separate", "she went to her private place in the garden to read",
      "he hid the map in his private spot",
      // Touching him, her or them after people, kids, a woman or a boy, or in a story.
      "sea anemones sting people who touch them", "mimosa leaves fold up when people touch them",
      "pill bugs roll up when kids touch them", "the woman reached out and touched him",
      "in the story, the old woman touched him on the shoulder", "in the story the boy touched her and she turned to gold",
      "his mother touched his face", "her grandma touched her cheek", "her teacher touched her shoulder",
      "the knight touched her with his sword", "his mother touched him when he cried",
      "in the story his grandma touched him and he felt better",
      // "get touched" with no one doing it, and "touched by" said of someone else, which is a feeling.
      "a venus flytrap closes when its hairs get touched twice", "the leaves of the mimosa fold when they get touched",
      "he gets touched by the story every time", "the old woman was touched by a stranger who gave her food",
      "she was touched by them",
      // Touching the children with no grown-up doing it, or a grown-up's poem or speech doing it.
      "her kindness touched the children", "the movie touched children all over the world",
      "jesus touched the children and blessed them", "he touched the children and blessed them",
      "the soldiers touched the children's hearts", "the man's story touched the children",
      "my mom said her kindness touched the children", "the teacher read a poem which touched the children",
      "the coach gave a speech that really touched the kids",
      // Touched by someone's words: the apostrophe is not a person.
      "i was touched by my teacher's words", "i was touched by my mom's letter", "i was touched by her kindness",
      "my teacher was touched by my card",
      // A thing that moved the child, with an adverb or a clause before the verb; static electricity.
      "the story about the old man really touched me", "the poem my teacher read today really touched me",
      "my grandma's letter really touched me", "she said the movie deeply touched me",
      "the ending where the boy finds his dog really touched me",
      "when a person touches me after walking on carpet i get a shock",
      // Touching down is landing; "her down there" is where she is.
      "the lunar module had to touch down there safely", "apollo 11 touched down there in 1969",
      "the plane will touch down there at noon", "the rabbit hole was so deep that nobody could see her down there",
      "we saw her down there by the river",
      // Fingers on a wrist or neck, a thing on a desk.
      "the nurse put her fingers on my wrist to feel my pulse", "to find my pulse she put her fingers on my neck",
      "he left his thing on my desk",
      // A threat to send an army or show force.
      "the king threatened to send his army", "britain threatened to send more troops to boston",
      "the president threatened to show force",
      // Getting hurt at home in a health lesson.
      "many kids get hurt at home from falls", "keep medicine locked up so little kids don't get hurt at home",
      "most people get hurt at home in the kitchen",
      // A remedy rubbed on.
      "my mom rubs my chest with vapor rub when i am sick",
      // Someone else's suicide stated as history or a story's plot.
      "in the story the character commits suicide", "Romeo and Juliet both commit suicide", "suicide rates rose after the war",
      // A thing that touched the child, given or not, and a plant's "get touched" (TerraTutor #223's reviews).
      "i got touched by the story", "i've been touched by your kindness", "its hairs get touched", "they get touched",
      "my teacher gave me a book that really touched me", "my teacher read us a story which touched me",
      "she gave me a letter that touched me", "when its hairs get touched twice",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
  });

  it("still fires on the disclosure forms TerraTutor #221 and #223 kept, at every grade", () => {
    for (const m of [
      // The forms the narrowing kept: the child, or a named family member or grown-up doing it to them.
      "he touched my private", "my uncle touches my private and says it's a secret", "he touches my private, it hurts",
      "he showed me his private", "he made me touch his private parts", "he touched my privates",
      "my brother showed me his privates", "my dad touches my private with his hand", "his coach touched him",
      "their uncle touches them at night", "i was touched by him", "i was touched by her at the sleepover",
      "i got touched by a stranger", "i got touched by a man at the park", "i was touched by my uncle's friend",
      "i was touched by my mom's boyfriend", "i've been touched by him", "my sister got touched by our uncle",
      "the man touches kids at the park", "my coach touches the boys", "a stranger touched me",
      "a person at the park touched me", "when he touches me i feel scared", "when we play he touches me",
      "my uncle read me a story and then touched me", "during the movie the man next to me touched me",
      "after the movie a man touched me", "he touched her down there", "he put his thing on my butt",
      "he put his fingers on me", "my uncle rubs my chest", "he threatened to post my pictures",
      "he has my pics and threatened to post them", "i keep getting hurt at home", "im getting hurt at home",
      "i think about suicide", "my brother committed suicide", "the character commits suicide and i want to too",
      // First-person forms the first narrowing missed: no one named, the subject dropped, a gift before the
      // touching (grooming), the child's own family member touching a brother or sister.
      "i got touched", "i got touched at school", "i get touched at night", "we got touched", "I Got Touched",
      "i've been touched", "i keep getting touched",
      "got touched by my uncle", "got touched by my coach last year", "we went to the park and got touched by a man",
      "the man who gave me gifts touched me", "my coach who sends me messages touches me",
      "my teacher who writes me letters touched me", "the man who gave me a gift touched me",
      "my stepdad touches her at night", "my stepdad touches them at night", "my stepdad touches him",
      "got touched at school", "got touched last night", "and then got touched", "i went home and got touched",
      "getting touched at night", "Got touched at school.",
      "the man who gave me a gift that i liked touched me", "my coach who wrote me a letter that was nice touched me",
      "my uncle who sends me videos which are funny touched me",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
  });

  // Ported from TerraTutor #223's third review, each list verbatim: the child's own family member or grown-up
  // ("my uncle", "my mom's boyfriend") touching him, her or them, followed by when, while, and, gently and the
  // like. The harm half does not read the grade, so each sentence is checked with no grade and at every grade.
  it("still fires on my family member or grown-up touching him, her or them, whatever follows (TerraTutor #223)", () => {
    for (const m of [
      "my uncle touches her when she sleeps", "my stepdad touches them when mom is gone", "my uncle touches her gently",
      "my stepdad touches them while mom is at work", "my uncle touches her and she cries",
      "my mom's boyfriend touches her when nobody is home", "My uncle touches her when she sleeps.",
      "my uncle touches her too", "my stepdad touches him at night when mom sleeps",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
  });

  // His, her, their or our family member keeps the narrower rule (a story, a class), and "my" needs no other
  // subject in between and no noun after him / her / them.
  it("keeps stories, a class and someone else's touching out of the first-person rule (TerraTutor #223)", () => {
    for (const m of [
      "his mother touched him when he cried", "in the story his grandma touched him and he felt better",
      "the woman reached out and touched him", "our teacher touches them gently with the brush",
      "in the book my dad touches her hand", "my teacher read us how the prince touched her and she woke up",
      "my mom said the girl touched her and she cried", "my dad touches her belly",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
  });

  // The cheap side of that trade: a parent comforting a sibling reads the same as the disclosure.
  it("fires on a parent comforting a brother or sister, known and accepted (TerraTutor #223)", () => {
    for (const m of ["my mom touches her when she cries", "my mom touches them when they cry"])
      for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
  });

  // TerraTutor #125's curious questions and school wording about sex, sexuality and gender (parent-topics.test.ts
  // there): none is a safety disclosure. OpenEdu has no parents'-topics screen, so these reach the tutor as before.
  it("does not fire on curious questions or school wording about sex", () => {
    for (const m of [
      "what does sexy mean, my friend said it", "my friend said a word, sex, what is it", "I think I'm trans",
      "am i bi", "my sister says she is a lesbian, what does that mean", "can I ask what gay means",
      "is my teacher trans?", "Make me a flashcard about transgender people",
      "is the teacher trans?", "why are boys attracted to the opposite sex", "can a boy change sex when he grows up?",
      "is her mom trans", "what does gay mean, they said it at school", "do girls like drag shows",
      "what's sex?", "Mom, what's sex?", "what does gay mean", "is Sam trans?", "is there a drag show this weekend?",
      "are you bi", "what does bi mean", "does the US census count people by sex?", "is it ok to be trans?",
      "what is sex", "Like fish, can people change sex?", "what are sex cells?", "Can a clownfish change sex?",
      "what is sexual selection", "Sex-linked traits", "Sexual reproduction in plants",
    ]) for (const g of [null, ...GRADES]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
  });

  // Known misses. TerraTutor hands each of these to its parents'-topics reply, which names Childhelp; OpenEdu has
  // no such screen, so they get no notice. Third-person reports and wording the lists do not know. Pinned so a
  // widening is a deliberate change, with its own negatives.
  it("misses these known disclosures that TerraTutor leaves to its parents'-topics reply", () => {
    for (const m of [
      "a man showed me his penis", "he does bad stuff to me and says it's sexy", "someone keeps asking me about sex",
      "they made me watch them have sex", "his dad makes him watch porn", "her uncle had sex with her",
      "a girl at church says the pastor touches her vagina", "THE BUS DRIVER MADE US WATCH PORN",
      // First-person wordings the lists do not know (review of #372); open vocabulary, left to a follow-up.
      "my babysitter shows me sexy videos", "a man at the park showed me his genitals",
      "my neighbor talks about sex to me", "i saw my uncle's porn", "he says we are going to have sex",
    ]) expect(isSafetyDisclosure(m), m).toBe(false);
  });

  it("matches whole words only", () => {
    expect(isSafetyDisclosure("cut myselfie")).toBe(false);
    expect(isSafetyDisclosure("rapeseed oil")).toBe(false);
    expect(isSafetyDisclosure("grapes")).toBe(false);
  });
});

describe("SAFETY_NOTICE", () => {
  it("names the US crisis lines and a trusted grown-up", () => {
    expect(SAFETY_NOTICE).toContain("988");
    expect(SAFETY_NOTICE).toContain("Suicide & Crisis Lifeline");
    expect(SAFETY_NOTICE).toContain("1-800-422-4453");
    expect(SAFETY_NOTICE).toContain("Childhelp National Child Abuse Hotline");
    expect(SAFETY_NOTICE.toLowerCase()).toContain("tell a grown-up you trust");
    expect(SAFETY_NOTICE).toContain("If you are in danger right now, call 911.");
  });

  it("reads aloud in full, numbers included", () => {
    const spoken = speakableText(SAFETY_NOTICE);
    for (const w of ["911", "988", "1-800-422-4453", "grown-up you trust"]) expect(spoken, w).toContain(w);
  });
});

describe("CHILD_SAFETY_RULES", () => {
  it("covers the required rules", () => {
    const t = CHILD_SAFETY_RULES.toLowerCase();
    for (const w of ["sexual", "hurt yourself", "weapons", "drugs", "dangerous", "violence", "schoolwork", "grown-up they trust"])
      expect(t, w).toContain(w);
  });

  it("stays short for small models", () => {
    expect(Math.ceil(CHILD_SAFETY_RULES.length / 4)).toBeLessThan(110);
  });
});

// ChatTab is DOM-coupled and the repo has no jsdom, so it is not rendered in vitest. These are source
// matches, not a production-path test: they pin that the chat calls the functions above, which are
// the parts tested through the code production runs.
describe("ChatTab wiring", () => {
  it("screens each student message with isSafetyDisclosure and the learner's grade, and shows SAFETY_NOTICE", () => {
    expect(chatTabSource).toContain('from "../lib/child-safety"');
    expect(chatTabSource).toMatch(/msg\.role === "user" && isSafetyDisclosure\(msg\.content, grade\) && \(/);
    expect(chatTabSource).toContain("{SAFETY_NOTICE}");
  });

  it("shows the notice at K-2's chat text size, with a speaker button that reads it", () => {
    expect(chatTabSource).toMatch(/role="note" className="chat-msg [^"]*text-sm[^"]*"/);
    expect(chatTabSource).not.toMatch(/role="note" className="[^"]*text-xs/);
    expect(chatTabSource).toContain("readAloud.toggle(safetyId, SAFETY_NOTICE)");
  });

  it("builds the tutor's system prompt with gradePromptLayer(grade, userText), not the reading level alone", () => {
    expect(chatTabSource).toMatch(/personaIdentityLayer\(persona\),\s*gradePromptLayer\(grade, userText\),\s*\)/);
    expect(chatTabSource).not.toContain("readingLevelLayer(");
  });

  // Ported from TerraTutor #165. The kernel side runs through tutorEngine.run in answerCheckTurn.test.ts.
  it("gives the kernel the same grade, and sends a disclosure typed into a card as the child's own message", () => {
    expect(chatTabSource).toMatch(/retrieval: await getRetrievalMode\(\),[^}]*\sgrade,\s+onText:/);
    // Saved as the child's own message straight after the turn's reply, before the thread-switch return and
    // before the effect that runs the reply: closing the chat (tab, course or level) loses that state, never the words.
    const at = (code: string) => { const i = chatTabSource.indexOf(code); expect(i, code).toBeGreaterThan(0); return i; };
    const saveWords = at('saveChatMessage(courseId, "user", result.cardMessage, level, activeThread)');
    expect(at('saveChatMessage(courseId, "assistant", persisted, level, activeThread)')).toBeLessThan(saveWords);
    expect(saveWords).toBeLessThan(at("// Abandoned by a thread switch: its chips and notices belong to a thread no longer shown."));
    expect(chatTabSource).toContain("handedBack = { thread, saved: cardMsg };");
    expect(chatTabSource).toContain("if (handedBack) { setCardMessage(handedBack); return; }");
    // The effect only asks for the reply: runTurn takes the saved message and does not save it again.
    expect(chatTabSource).toContain("if (cardMessage.thread === threadId) void sendMessage(cardMessage.saved.content, cardMessage.saved);");
    expect(chatTabSource).toContain('userMsg = saved ?? await saveChatMessage(courseId, "user", userText, level, activeThread);');
    expect(chatTabSource).toContain("const history = saved ? messages.filter((m) => m.id !== saved.id) : messages;");
  });
});

// A K-12 learner who says they may be pregnant (ported from TerraTutor #158). With a K-12 grade set, a strong
// self-disclosure in the message is a safety disclosure: ChatTab shows SAFETY_NOTICE under it, and the tutor
// already has CHILD_SAFETY_RULES for every K-12 learner. Nothing blocks on it. With no grade (an adult, or a
// learner who never set one), isSafetyDisclosure answers exactly as before. These call isSafetyDisclosure the
// way ChatTab does, with the message and the grade (ChatTab wiring, above).
describe("a strong self-disclosure of a pregnancy", () => {
  it("is a safety disclosure for a learner with any K-12 grade", () => {
    for (const g of GRADES) {
      for (const m of [...STRONG_PREGNANCY, ...REVIEW_342_STRONG, ...REVIEW8_STILL_STRONG]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
    }
  });

  it("is not one with no grade set, so an adult sees exactly what they saw before", () => {
    for (const m of [...STRONG_PREGNANCY, ...REVIEW_342_STRONG, ...REVIEW8_STILL_STRONG]) {
      expect(isSafetyDisclosure(m, null), m).toBe(false);
      expect(isSafetyDisclosure(m), m).toBe(false);
    }
  });

  it("leaves a harm disclosure a disclosure with or without a grade", () => {
    const m = "my stepdad touches me at night and im scared im pregnant";
    expect(isSafetyDisclosure(m, null)).toBe(true);
    expect(isSafetyDisclosure(m, 7)).toBe(true);
    for (const g of [null, 0, 12] as const) {
      expect(isSafetyDisclosure("what is 9 x 9?", g)).toBe(false);
      expect(isSafetyDisclosure("", g)).toBe(false);
    }
  });

  it("stays quiet on anyone else, a baby one day, grade, Bible, story, game, joke, language and pretend forms", () => {
    for (const g of [null, ...GRADES]) {
      for (const m of NOT_STRONG_PREGNANCY) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
    }
  });

  // The corpus shared with TerraTutor #161 (every review input and fixture, tagged by source), through the call
  // ChatTab and grade.ts make: the notice on every strong input at every K-12 grade, none on any not-strong
  // input, and none at all with no grade. The accepted extra notices (lead decision after TerraTutor #161's
  // second final review: the notice never blocks, so a missed disclosure costs more) get the notice at every
  // K-12 grade too, pinned so a change to them shows here, and none with no grade.
  it("decides every input of the shared corpus as the reviews ruled", () => {
    const { strong, notStrong, acceptedExtraNotice } = PREGNANCY_CORPUS;
    expect(strong.length).toBe(85);
    expect(notStrong.length).toBe(144);
    expect(acceptedExtraNotice.length).toBe(10);
    const texts = [...strong, ...notStrong, ...acceptedExtraNotice].map((e) => e.text);
    expect(new Set(texts).size).toBe(texts.length);
    const wrong: string[] = [];
    for (const g of [null, ...GRADES]) {
      for (const e of [...strong, ...acceptedExtraNotice])
        if (isSafetyDisclosure(e.text, g) !== (g !== null)) wrong.push(`${g} notice: ${e.text} (${e.source})`);
      for (const e of notStrong) if (isSafetyDisclosure(e.text, g)) wrong.push(`${g} not strong: ${e.text} (${e.source})`);
    }
    expect(wrong).toEqual([]);
  });

  // TerraTutor #161's second final review, must-fix 1: "pregnant with" a partner, "nobody", "no money" or
  // "nowhere" is a disclosure, so there is no "pregnant with <thing>" guard. A laughing emoji and "food baby"
  // still make it a joke.
  it("gives the notice on \"pregnant with\" anything but a laughed-off joke or a food baby", () => {
    for (const m of [
      "im pregnant with my boyfriend", "i'm pregnant with my ex", "im pregnant with my bf's", "im pregnant with nobody to help me",
      "i'm pregnant with nobody to talk to", "im pregnant with no money and no job", "im pregnant with nowhere to go",
      "im pregnant with tacos",
    ]) {
      expect(isSafetyDisclosure(m, 8), m).toBe(true);
      expect(isSafetyDisclosure(m, null), m).toBe(false);
    }
    for (const m of ["im pregnant with tacos 😂", "im pregnant with a food baby"]) expect(isSafetyDisclosure(m, 8), m).toBe(false);
  });

  // Having a baby "with" someone next to the learner's own age, in either order (TerraTutor's same fix): the
  // notice at every K-12 grade, none with no grade. Someone else's baby, a sibling, family news, an age under 10
  // and pretend play stay quiet.
  it("gives the notice on having a baby with someone next to the learner's own age", () => {
    for (const g of GRADES) {
      for (const m of BABY_WITH_STRONG) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
    }
    for (const m of BABY_WITH_STRONG) expect(isSafetyDisclosure(m, null), m).toBe(false);
    for (const g of [null, ...GRADES]) {
      for (const m of BABY_WITH_QUIET) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
    }
  });

  it("keeps the guarded jokes, play and language-lesson forms as with no grade, at every grade", () => {
    for (const m of [...REVIEW7_CLASS_A, ...REVIEW8_CLASS_A]) {
      for (const g of GRADES) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(isSafetyDisclosure(m, null));
    }
  });

  it("stays strong where the narrowing must not reach: a length of time, a might-be, the test's own words, a verb", () => {
    for (const m of [
      "i missed my period for 2 months", "i missed my period for a while now", "i feel like i might be pregnant",
      "my pregnancy test says positive", "i think im pregnant can you show me what to do", "im pregnant and i cant play soccer",
      "im pregnant and my mom said to ask you",
    ]) {
      expect(isSafetyDisclosure(m, 8), m).toBe(true);
      expect(isSafetyDisclosure(m, null), m).toBe(false);
    }
  });

  // An adult who got a K-12 learner pregnant is also an abuse disclosure; with a grade set it gets the notice
  // here. (With no grade, ABUSE_RE decides it, as on master.)
  it("counts someone else who got the learner pregnant, at every grade", () => {
    for (const g of GRADES) expect(isSafetyDisclosure("my stepdad got me pregnant", g), `${g}`).toBe(true);
  });

  it("reads the pregnancy word by its shape", () => {
    for (const w of ["prenant", "pragnent", "pregrant", "pregnat", "pregnet", "pregnint", "pergnant", "preganant", "pregnent", "pregant", "pregnantly"])
      expect(pregnancyShape(w), w).toBe("pregnant");
    for (const w of ["preg", "prego", "preggo", "preggy", "preggie", "preggers", "pregers"]) expect(pregnancyShape(w), w).toBe("pregnant");
    for (const w of ["pregnancy", "pregnancies", "pregnacy", "pregancy", "pregnency", "pregnance"]) expect(pregnancyShape(w), w).toBe("pregnancy");
    for (const w of ["pennant", "remnant", "poignant", "regnant", "poignancy", "present", "prevent", "prenatal", "pregame", "pre", "pig"])
      expect(pregnancyShape(w), w).toBe(null);
  });

  // The whole bundled English word list (public/wordlist/): every real word pregnancyShape accepts is a
  // pregnancy word. A word list update that adds a new neighbour fails here until it is excluded.
  it("accepts no ordinary English word", { timeout: 60_000 }, async () => {
    const [f, p] = await Promise.all([fs(), path()]);
    const dir = p.join(cwd(), "public", "wordlist");
    const files = (await f.readdir(dir, { withFileTypes: true })).map((d) => d.name).filter((n) => /^[a-z]{2}\.json$/.test(n));
    const accepted: string[] = [];
    for (const n of files) {
      for (const w of (JSON.parse(await f.readFile(p.join(dir, n), "utf8")) as string).split(" ")) if (pregnancyShape(w)) accepted.push(w);
    }
    expect(accepted.sort()).toEqual([
      "impregnant", "preggers", "preggy", "pregnance", "pregnances", "pregnancies", "pregnancy", "pregnant", "pregnantly", "unpregnant",
    ]);
  });
});
