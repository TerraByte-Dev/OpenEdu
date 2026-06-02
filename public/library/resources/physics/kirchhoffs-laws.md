---
id: physics/kirchhoffs-laws
title: Kirchhoff's Laws
aliases: [kirchhoffs laws, kirchhoff, junction rule, loop rule, KCL, KVL, circuit analysis]
tags: [physics, circuits, kirchhoff, current, voltage]
subject: physics
summary: Kirchhoff's current (junction) and voltage (loop) laws for analyzing circuits.
asset: assets/physics/kirchhoffs-laws.svg
---

# Kirchhoff's Laws

Two conservation rules for analyzing any circuit. Use them with **Ohm's law (V = I·R)**.

## KCL — current (junction) law
At any **node**, the current flowing **in** equals the current flowing **out**:

  **Σ I_in = Σ I_out**

This is **conservation of charge**. Example: if a current I splits into two branches, I = I₁ + I₂.

## KVL — voltage (loop) law
Around any **closed loop**, the voltage changes sum to **zero**:

  **Σ ε = Σ I·R**   (energy gained from sources = energy dropped across resistors)

This is **conservation of energy**.

## Series vs parallel
- **Series:** same **current** through each part; voltages add; R = R₁ + R₂ + …
- **Parallel:** same **voltage** across each branch; currents add (KCL); 1/R = 1/R₁ + 1/R₂ + …
