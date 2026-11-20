/** Mounts the installed welcome component with the owned read-only profile. */
export const openGoogleSetupRenderer = `import { useState } from "react";
import { panel } from "@workspace/runtime";
import { WelcomeView } from "@workspace-panels/welcome";
import { readOwnedOnboarding, type OwnedSetupProfile } from "@workspace-skills/google-drive/open-setup-profile";

export default function OwnedWelcome() {
  const [instance] = useState(() => crypto.randomUUID());
  const { setup } = panel.stateArgs.get<{setup: OwnedSetupProfile}>();
  if (!setup) throw new Error("The owned welcome profile is missing");
  return <main data-google-setup="" data-instance={instance} data-profile={setup.profileId}>
    <WelcomeView readOnlyOnboarding={async () => readOwnedOnboarding(panel.stateArgs.get<{setup:OwnedSetupProfile}>().setup)} />
  </main>;
}
`;
