---
id: arts-music-cs/boolean-and-de-morgan
title: Boolean Logic & De Morgan's Laws
aliases: [boolean logic, de morgan's laws, and or not xor, boolean algebra, logical operators, truth table]
tags: [computer science, logic, boolean, de morgan, operators, math]
subject: computer-science
summary: The boolean operators, their truth tables, precedence, and De Morgan's laws.
asset: assets/arts-music-cs/boolean-and-de-morgan.svg
---

# Boolean Logic & De Morgan's Laws

**Boolean** values are **true (1)** or **false (0)**. Operators combine them.

| Operator | Symbols | True when… |
|---|---|---|
| **NOT** A | ¬A, !A, Ā | A is false (it inverts) |
| A **AND** B | A∧B, A·B, && | **both** are true |
| A **OR** B | A∨B, A+B, \|\| | **at least one** is true |
| A **XOR** B | A⊕B | **exactly one** is true (they differ) |

## Truth values
- AND: only 1·1 = 1. OR: only 0+0 = 0. XOR: 1 when inputs **differ**.

## Precedence (highest → lowest)
**NOT → AND → OR.** Use parentheses to override (like × before + in math).

## De Morgan's Laws
- **¬(A ∧ B) = ¬A ∨ ¬B** — "not (A and B)" = "not A or not B."
- **¬(A ∨ B) = ¬A ∧ ¬B** — "not (A or B)" = "not A and not B."

To negate a compound condition: **flip each term and swap AND↔OR.** Example: `!(x > 0 && y > 0)` becomes `x <= 0 || y <= 0`. (See the logic-gate-truth-tables card for the gate symbols.)
