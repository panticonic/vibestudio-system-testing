import type {
  AppReadback,
  InstallReceipt,
  MobileInventory,
  PairReceipt,
  WorkspaceReadback,
} from "./types.js";
declare module "natlang:services" {
  export const mobileInventory: { read(): Promise<MobileInventory> };
  export const mobilePairing: {
    pair(deviceId: string): Promise<PairReceipt | null>;
  };
  export const mobileWorkspace: {
    read(pairedDevice: string): Promise<WorkspaceReadback | null>;
  };
  export const mobileDevelopment: {
    install(deviceId: string): Promise<InstallReceipt | null>;
  };
  export const mobileApp: {
    verify(deviceId: string, packageName: string): Promise<AppReadback | null>;
  };
}
