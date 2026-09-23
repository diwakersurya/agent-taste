const FINANCIAL = { title: "Financial", hint: "preferences only (risk appetite, budgeting style, tools); never account numbers, balances, credentials or tax IDs" };
const PERSONAL = { title: "Personal", hint: "lifestyle, interests, learning style, values; no health, ID or address details" };

export const PRESETS = {
  developer: [
    { title: "Code style", hint: "coding conventions, naming, patterns, commit style" },
    { title: "Architecture & design choices", hint: "how systems should be shaped, trade-offs they favour" },
    { title: "UI / visual design", hint: "visual and interaction taste" },
    { title: "Tooling & workflow", hint: "tools, stack, dev loop, how they like agents to work" },
    { title: "Communication", hint: "how they want answers written and questions asked" },
    FINANCIAL, PERSONAL,
  ],
  designer: [
    { title: "Visual language", hint: "type, colour, spacing, motion taste" },
    { title: "Interaction & UX", hint: "flows, states, feedback, accessibility stances" },
    { title: "Tools & workflow", hint: "design tools, handoff, review habits" },
    { title: "Communication", hint: "how they want answers written and questions asked" },
    FINANCIAL, PERSONAL,
  ],
  general: [
    { title: "Work style", hint: "how they plan, decide and prioritise" },
    { title: "Communication", hint: "how they want answers written and questions asked" },
    { title: "Tools", hint: "apps and services they prefer" },
    FINANCIAL, PERSONAL,
  ],
};

export const presetMarkdown = (sections: { title: string; hint: string }[]) =>
  "# Taste & Preferences\n\nLiving profile read by your AI tools. Edit freely — your edits win.\n\n" +
  sections.map((s) => `## ${s.title}\n<!-- hint: ${s.hint} -->\n`).join("\n") +
  "\n## Decision log\n<!-- newest first: `- YYYY-MM-DD [tool] [folder] choice — why` -->\n";
