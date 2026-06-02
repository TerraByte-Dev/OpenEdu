---
id: arts-music-cs/units-of-digital-data
title: Units of Digital Data
aliases: [units of digital data, bit byte kilobyte, data units, KB MB GB TB, KiB vs KB, file sizes]
tags: [computer science, data, units, bit, byte, storage]
subject: computer-science
summary: From bit to petabyte, plus the powers-of-2 (KiB) vs powers-of-10 (KB) distinction.
asset: assets/arts-music-cs/units-of-digital-data.svg
---

# Units of Digital Data

The smallest unit is the **bit** (b) — a single **0 or 1**. Eight bits make one **byte** (B), enough for one character.

- 1 **nibble** = 4 bits · 1 **byte (B)** = 8 bits.

## Decimal (SI) — powers of 1000
| Unit | Size |
|---|---|
| kilobyte (KB) | 1,000 B = 10³ |
| megabyte (MB) | 10⁶ B |
| gigabyte (GB) | 10⁹ B |
| terabyte (TB) | 10¹² B |
| petabyte (PB) | 10¹⁵ B |

## Binary (IEC) — powers of 1024
| Unit | Size |
|---|---|
| kibibyte (KiB) | 1,024 B = 2¹⁰ |
| mebibyte (MiB) | 2²⁰ B |
| gibibyte (GiB) | 2³⁰ B |
| tebibyte (TiB) | 2⁴⁰ B |

## Why two systems
Storage is often sold in **decimal** (a "1 TB" drive = 10¹² bytes), but operating systems frequently measure in **binary** (1024-based). That's why a 1 TB drive shows as ~931 GiB. Capital **B** = byte, lowercase **b** = bit (so "100 Mb/s" internet ≈ 12.5 MB/s).
