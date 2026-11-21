type Options =
  | { route: "install"; mode: "install" | "foreground-hold" | "target-hold"; reset?: boolean }
  | { route: "pair"; mode: "pair" | "inspect" | "missing" };
export type AndroidDeliveryWorld = Options & {
  id: string; kind: "android-delivery"; workspace: "system"; goal: string;
  sourceGroup: string; split: "train" | "test"; requiresAndroidEmulator: true; devices?: ["desktop"];
};
function exercise(id: string, goal: string, options: Options, held = false): AndroidDeliveryWorld {
  const caseId = `android-delivery-${id}`;
  const route = options.route;
  return {
    ...options, id: caseId, kind: "android-delivery", workspace: "system", goal,
    sourceGroup: `vibestudio:android-delivery:${route}:${id}`, split: held ? "test" : "train",
    requiresAndroidEmulator: true, ...(route === "pair" ? { devices: ["desktop"] } : {}),
  };
}
export const openAndroidDeliveryWorlds = [
  exercise("visual-first-launch", "Use the assigned clean disposable Android emulator to check whether our internal client can be delivered. Install and launch without resetting, then verify the same package is active and visibly rendering.", { route: "install", mode: "install" }),
  exercise("reset-test-data-before-launch", "On the assigned disposable Android test emulator, reset the internal client's app data as part of installing and opening it. I need the actual running application receipt before handing this test off.", { route: "install", mode: "install", reset: true }, true),
  exercise("hold-without-foreground-ownership", "Can you install the internal client for the current desktop review? If we don't own the foreground for the assigned emulator, hold and explain what the operator must restore.", { route: "install", mode: "foreground-hold" }),
  exercise("hold-disconnected-development-target", "The development install is assigned to the earlier test emulator. Check that exact target and launch only if it's found. Keep the other ready emulator out of the operation.", { route: "install", mode: "target-hold" }),
  exercise("pair-compatible-copy", "The compatible client is already on the disposable emulator assigned to this workspace. Pair it through the connected desktop and prove the resulting paired device can open this workspace.", { route: "pair", mode: "pair" }),
  exercise("pair-with-confirmed-new-identity", "Prepare the dedicated test emulator for the next shift. We need an actual desktop pairing and an independently confirmed ready workspace on the newly issued identity before handing it over.", { route: "pair", mode: "pair" }, true),
  exercise("inspect-onboarding-target-only", "Look at our assigned disposable emulator in the desktop's pairing inventory. Tell me whether it is the ready target for this workspace. Leave pairing and the app alone.", { route: "pair", mode: "inspect" }),
  exercise("hold-retired-provisioning-target", "Check whether the desktop can find the exact dedicated Android target named in our old setup request. Stop before pairing if that target is gone and the desktop only sees a different emulator.", { route: "pair", mode: "missing" }, true),
] satisfies AndroidDeliveryWorld[];
