---
id: arts-music-cs/logic-gate-truth-tables
title: Logic Gates & Truth Tables
aliases: [logic gates, truth tables, AND OR NOT, boolean logic, NAND NOR XOR]
tags: [computer science, logic, boolean, gates, digital]
subject: arts-music-cs
summary: The seven basic logic gates with their boolean expressions and truth tables.
asset: assets/arts-music-cs/logic-gate-truth-tables.svg
---

# Logic Gates & Truth Tables

Digital circuits combine binary inputs (0 = false, 1 = true) with **logic gates**. Output Q for inputs A, B:

| Gate | Expression | Output Q is 1 when… |
|---|---|---|
| **AND** | A · B | both A and B are 1 |
| **OR** | A + B | at least one input is 1 |
| **NOT** | ¬A | the single input is 0 (it inverts) |
| **NAND** | ¬(A · B) | NOT of AND (0 only when both are 1) |
| **NOR** | ¬(A + B) | NOT of OR (1 only when both are 0) |
| **XOR** | A ⊕ B | the inputs differ (exactly one is 1) |
| **XNOR** | ¬(A ⊕ B) | the inputs are the same |

## AND vs OR truth tables
```
A B | AND  OR  XOR
0 0 |  0    0    0
0 1 |  0    1    1
1 0 |  0    1    1
1 1 |  1    1    0
```

**NAND and NOR are "universal"** — any logic circuit can be built from only NAND gates (or only NOR gates). De Morgan's laws: ¬(A·B) = ¬A + ¬B and ¬(A+B) = ¬A · ¬B.
