declare module "natlang:services" {
  export const mobileInventory: { read(): Promise<import("./types.js").MobileInventory> };
  export const mobilePairing: {
    pair(deviceId: string): Promise<import("./types.js").PairReceipt | null>;
  };
  export const mobileWorkspace: {
    read(pairedDevice: string): Promise<import("./types.js").WorkspaceReadback | null>;
  };
  export const mobileDevelopment: {
    install(deviceId: string): Promise<import("./types.js").InstallReceipt | null>;
  };
  export const mobileApp: {
    verify(deviceId: string, packageName: string): Promise<import("./types.js").AppReadback | null>;
  };
}
