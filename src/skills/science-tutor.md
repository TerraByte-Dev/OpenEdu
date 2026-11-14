---
name: science-tutor
description: Science domain support — diagrams for cycles, processes, and the parts of a system.
trigger:
  course_subject: [science, scientific, biology, biological, chemistry, chemical, astronomy, geology, ecology, ecosystem, anatomy, physiology, botany, zoology, photosynthesis, water cycle, life cycle, food chain, food web, solar system, planet, outer space, weather, climate, states of matter, mineral, fossil, dinosaur, volcano, earthquake, plate tectonics, ocean, cell, plant, habitat, insect, magnet, magnetism, electricity, energy, gravity, atom, molecule, periodic table, genetics, dna, microbe, bacteria, human body, five senses, simple machine, biome, rainforest, natural selection]
  course_subject_exclude: [political science, social science, computer science, library science]
tools_required: [diagram.render]
model_tier_min: tiny
---

## Science tools
Use `diagram.render` (Mermaid) when a cycle, a process, a food chain, a life cycle, or the parts of a system are clearer drawn than described (for example `graph LR; A[Evaporation] --> B[Condensation] --> C[Precipitation] --> A`). Start from something the student can see or try, then name the idea behind it. Keep cause and effect in order, and give measurements with their units.
