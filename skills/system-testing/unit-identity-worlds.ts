export const unitIdentityWorlds = [
  {
    id: "stage-workspace-index-icon",
    goal: "Prepare a folder-tree identity for the installed workspace index and verify the manifest and artwork in the working state.",
    repoPath: "about/workspace",
    unit: { name: "workspace", kind: "about", description: "An index of workspace repositories and folders represented with a folder tree (folder-tree)." },
    prepare: true,
    intent: { family: "lucide", term: "folder-tree" },
    outcome: "prepared",
  },
  {
    id: "retain-existing-git-brand",
    goal: "Retain the Git mark if the installed bridge already carries the exact catalog artwork. Prepare an edit only if it differs.",
    repoPath: "extensions/git-bridge",
    unit: { name: "git-bridge", kind: "extension", description: "Directly integrates Git repositories with the workspace." },
    prepare: true,
    intent: { family: "brand", term: "git" },
    outcome: "already-matches",
  },
  {
    id: "review-chat-icon-alternative",
    goal: "Review a single speech bubble alternative for the chat panel's identity without preparing any edit.",
    repoPath: "panels/chat",
    unit: { name: "chat", kind: "panel", description: "An agentic conversation panel. The proposed alternative is one simple speech bubble (message-square)." },
    prepare: false,
    intent: { family: "lucide", term: "message-square" },
    outcome: "design-only",
  },
] as const;
