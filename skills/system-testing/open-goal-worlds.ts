export { openGoalPersonalWorlds } from "./open-goal-personal-worlds.js";
export { openGoalRecoveryWorlds } from "./open-goal-recovery-worlds.js";
export { openGoalPdfVaultWorlds } from "./open-goal-pdf-vault-worlds.js";
export { openGoalPdfWorlds } from "./open-goal-pdf-worlds.js";
export { publicationGoalWorlds } from "./open-goal-publication-worlds.js";
export { operatorGoalWorlds, operatorGoalRequiresUnits } from "./open-goal-operator-worlds.js";
export { browserGoalWorlds } from "./open-goal-browser-worlds.js";
export { suiteGoalWorlds } from "./open-goal-suite-worlds.js";
export { newsGoalWorlds, newsGoalRequiresUnits, openNewsChecks } from "./open-goal-news-worlds.js";
export { spectroliteGoalWorlds } from "./open-goal-spectrolite-worlds.js";
export { openGoalGoogleWorlds } from "./open-goal-google-worlds.js";
export { openGoalGmailWorlds } from "./open-goal-gmail-worlds.js";
export { openGoalCalendarWorlds } from "./open-goal-calendar-worlds.js";
export { openPersonalArtifactWorlds, personalArtifactRequiresUnits } from "./open-goal-personal-artifacts-worlds.js";
export { openPersonalHistoryWorlds, personalHistoryRequiresUnits } from "./open-goal-personal-history-worlds.js";

export const openGoalWorlds = [
  {
    kind: "research",
    id: "explain-reserved-example-domains",
    goal: "I'm writing a tutorial and want to use a domain name readers won't mistake for a real customer. Which domains are reserved for examples, and can I register them? Cite the authority.",
    required: [{ host: "iana.org", phrase: "not available for registration or transfer" }],
    conclusions: [/\bexample\.com\b/iu, /\bexample\.net\b/iu, /\bexample\.org\b/iu, /(?:cannot (?:be )?register|not (?:available|eligible) for registration)/iu],
    referenceAnswer: "Use example.com, example.net, or example.org. These domains are not available for registration or transfer.",
    sourceGroup: "vibestudio:web-research:public-reserved-domain-sources",
  },
  {
    kind: "research",
    id: "check-special-use-subdomains",
    goal: "Does special-use designation apply just to the domain names in the registry or to their subdomains too? I need a sentence I can quote from the authority.",
    required: [{ host: "iana.org", phrase: "applies to both the listed domains and their subdomains" }],
    conclusions: [/(?:appl(?:y|ies)|covers?|includes?).{0,100}subdomains/iu],
    referenceAnswer: "The special-use designation applies to both the listed domains and their subdomains.",
    sourceGroup: "vibestudio:web-research:public-reserved-domain-sources",
  },
  {
    kind: "workspace-edit",
    id: "reconcile-workshop-update",
    goal: "I need to send the workshop update already in this workspace. Bring it in line with the approved operations notes and keep the rest of the update intact.",
    sourceGroup: "vibestudio:workspace-edit:operations-document-recovery",
    files: {
      "workshop-update.md": "# Workshop update\n\nDoors are at 08:30. Use the east entrance.\n\nBring a laptop if you have one.\n",
      "operations-approved.md": "# Approved by event operations\n\nDoors are at 09:15. Use the north entrance.\n",
      "planning-thread.md": "# Early planning ideas\n\nTentative: doors at 08:00 via the west entrance.\n",
    },
    destination: "workshop-update.md",
    source: "operations-approved.md",
    concurrentAddition: "\nCoffee will be available in the foyer.\n",
    expected: "# Workshop update\n\nDoors are at 09:15. Use the north entrance.\n\nBring a laptop if you have one.\n\nCoffee will be available in the foyer.\n",
  },
  {
    kind: "workspace-edit",
    id: "correct-library-notice",
    goal: "Please bring the library closure notice up to date using the confirmed decision in the workspace. People still need the return-slot information.",
    sourceGroup: "vibestudio:workspace-edit:operations-document-recovery",
    files: {
      "public-notice.md": "# Library closure\n\nThe library will close on Thursday.\n\nThe outdoor return slot stays open.\n",
      "decision-record.md": "# Confirmed facilities decision\n\nThe library will close on Friday.\n",
      "discussion.md": "# Proposal under discussion\n\nOne option was to close the library on Monday.\n",
    },
    destination: "public-notice.md",
    source: "decision-record.md",
    concurrentAddition: "\nThe bookmobile will operate as usual.\n",
    expected: "# Library closure\n\nThe library will close on Friday.\n\nThe outdoor return slot stays open.\n\nThe bookmobile will operate as usual.\n",
  },
  {
    kind: "research-and-edit",
    id: "verify-and-correct-tutorial",
    goal: "Before we publish our DNS tutorial, verify whether the tutorial's example domains can be registered using an authoritative public source. Correct the sentence about registration in the tutorial draft if it is wrong, keep the other paragraphs as they are, and tell me what source you used.",
    sourceGroup: "vibestudio:workspace-edit:dns-tutorial-research",
    relatedSourceGroup: "vibestudio:web-research:public-reserved-domain-sources",
    required: [{ host: "iana.org", phrase: "not available for registration or transfer" }],
    conclusions: [/(?:cannot (?:be )?register|not (?:available|eligible) for registration)/iu],
    referenceAnswer: "Reserved example domains are not available for registration or transfer.",
    files: {
      "tutorial-draft.md": "# DNS tutorial\n\nYou can register the reserved example domains.\n\nSet up the rest of the tutorial in a local environment.\n",
      "editor-notes.md": "# Editorial notes\n\nThe tutorial uses reserved example domains for documentation. Keep the setup paragraph intact.\n",
      "old-tutorial.md": "# Archived DNS tutorial\n\nWe used invented domain names in the original version.\n",
    },
    destination: "tutorial-draft.md",
    source: "editor-notes.md",
    concurrentAddition: "\nThe exercises are intended for beginners.\n",
    expected: "# DNS tutorial\n\nThe reserved example domains are not available for registration or transfer.\n\nSet up the rest of the tutorial in a local environment.\n\nThe exercises are intended for beginners.\n",
  },
  {
    kind: "workspace-edit",
    id: "correct-lending-renewal-instructions",
    split: "test",
    goal: "Bring the equipment lending instructions in line with the committee's signed decision on renewals. Preserve the collection instructions and anything added by the equipment desk.",
    sourceGroup: "vibestudio:workspace-edit:lending-committee-decisions",
    files: {
      "equipment-lending.md": "# Equipment lending\n\nLoans cannot be renewed.\n\nCollect reserved items from the south desk.\n",
      "signed-renewal-decision.md": "# Signed decision of the lending committee\n\nEach equipment loan may be renewed once if there are no waiting reservations.\n",
      "staff-agenda.md": "# Staff discussion agenda\n\nUnapproved draft proposal: allow two renewals regardless of reservations.\n",
    },
    destination: "equipment-lending.md",
    source: "signed-renewal-decision.md",
    concurrentAddition: "\nBring the reservation receipt when you collect the item.\n",
    expected: "# Equipment lending\n\nEach equipment loan may be renewed once if there are no waiting reservations.\n\nCollect reserved items from the south desk.\n\nBring the reservation receipt when you collect the item.\n",
  },
  {
    kind: "research",
    id: "settle-decorative-thumbnail-alt-text",
    split: "test",
    goal: "Our book list has a decorative thumbnail next to every title. The thumbnail adds no information. Should I leave the alt attribute out or set it to an empty string? Give the HTML to use and cite W3C guidance.",
    sourceGroup: "vibestudio:web-research:decorative-thumbnails",
    required: [{ host: "w3.org", phrase: "so that they can be ignored by assistive technologies" }],
    conclusions: [/alt\s*=\s*(?:""|'')/iu],
    referenceAnswer: 'Include alt="" on each purely decorative thumbnail.',
  },
  {
    kind: "research-and-edit",
    id: "correct-catalog-accent-comparison-guide",
    split: "test",
    goal: "Customers can type the same accented book title with a single accented character or with an accent mark after the letter. Check the Unicode Consortium's guidance, then fix the comparison advice in our catalog import guide. Keep the advice about storing display titles.",
    sourceGroup: "vibestudio:workspace-edit:unicode-catalog-import",
    required: [{ host: "unicode.org", phrase: "compare canonical-equivalent unicode strings as equal" }],
    conclusions: [/\bcanonical(?:ly)?[ -]equivalent\b/iu, /(?:compare|compari|equal)/iu],
    referenceAnswer: "Compare canonically equivalent strings as equal by comparing normalized forms.",
    files: {
      "catalog-import.md": "# Catalog import\n\nCompare raw title bytes to decide whether two titles are canonically equivalent.\n\nKeep the original title for display.\n",
      "editorial-notes.md": "# Catalog notes\n\nMatch the same title irrespective of the accent encoding. Keep display text as entered.\n",
      "old-migration.md": "# Old migration\n\nDo not use the old title cleanup job.\n",
    },
    destination: "catalog-import.md",
    source: "editorial-notes.md",
    concurrentAddition: "\nLog the import batch number in the audit record.\n",
    expected: "# Catalog import\n\nNormalize titles to the same Unicode normalization form before comparing for canonical equality.\n\nKeep the original title for display.\n\nLog the import batch number in the audit record.\n",
  },
] as const;

export type PublicResearchWorld = Extract<(typeof openGoalWorlds)[number], { kind: "research" | "research-and-edit" }>;

export function publicSourceOrigins(world: PublicResearchWorld): string[] {
  return [...new Set(world.required.flatMap(({ host }) => [`https://${host}`, `https://www.${host}`]))];
}
