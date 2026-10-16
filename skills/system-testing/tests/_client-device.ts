import { rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type {
  ClientDeviceWire,
  ClientInstanceIdentity,
  DeviceKind,
  SurfaceInfo,
} from "@vibestudio/shared/deviceDriver";

export type {
  ClientDeviceWire,
  ClientInstanceIdentity,
  ClientIntentDeclLite,
  ClientListingLite,
  DeviceIdentities,
  IntegrationArtifact,
  IntentOutcome,
  LaunchOutcome,
  ShellResult,
  SurfaceInfo,
  WireMethod,
} from "@vibestudio/shared/deviceDriver";

/**
 * The person's device, as the client system tests drive it.
 *
 * A client runs on a device host (the terminal CLI, the desktop app), never in
 * the server and never in this runner. The device is reached through the
 * server's `deviceDriver` service: the host was started as a test driver
 * (`pnpm system-test run --device terminal|desktop ...`), paired BEFORE the
 * scenario's clients exist, in its own HOME and XDG directories, and answers
 * the operations of `ClientDeviceWire`. Every wait is answered by the host
 * from the event that settles it (`clients:changed`, terminal screen
 * revisions, window lifecycle, `supervision:changed`); a test never polls and
 * never sleeps. A call ends with the host's answer, the host's disconnect, or
 * the test's own cancellation.
 */

export type ClientDeviceKind = DeviceKind;

type WireMethodName = keyof ClientDeviceWire & string;

/** The runner's transport: one operation on the device for `kind`. */
export type ClientDeviceTransport = (method: string, args: unknown) => Promise<unknown>;

/** A launched client, as the host reports it. */
export class ClientSurface {
  constructor(
    private readonly device: ClientDevice,
    readonly surfaceId: string,
    readonly instance: ClientInstanceIdentity
  ) {}
  info(): Promise<SurfaceInfo> {
    return this.device.call("surfaceInfo", { surfaceId: this.surfaceId });
  }
  text(): Promise<string> {
    return this.device.call("surfaceText", { surfaceId: this.surfaceId });
  }
  waitForText(text: string): Promise<string> {
    return this.device.call("waitForText", { surfaceId: this.surfaceId, text });
  }
  sendKeys(keys: string): Promise<null> {
    return this.device.call("sendKeys", { surfaceId: this.surfaceId, keys });
  }
  waitForClosed(): Promise<{ reason: string }> {
    return this.device.call("waitForClosed", { surfaceId: this.surfaceId });
  }
  close(): Promise<null> {
    return this.device.call("closeSurface", { surfaceId: this.surfaceId });
  }
}

export class ClientDevice {
  constructor(
    readonly kind: ClientDeviceKind,
    private readonly transport: ClientDeviceTransport
  ) {}

  async call<M extends WireMethodName>(
    method: M,
    args: Parameters<ClientDeviceWire[M]>[0]
  ): Promise<ReturnType<ClientDeviceWire[M]>> {
    return (await this.transport(method, [args])) as ReturnType<ClientDeviceWire[M]>;
  }

  identities() {
    return this.call("identities", {});
  }
  list() {
    return this.call("list", {});
  }
  async launch(args: Parameters<ClientDeviceWire["launch"]>[0]) {
    const outcome = await this.call("launch", args);
    return outcome.state === "ready"
      ? { ...outcome, surface: new ClientSurface(this, outcome.surfaceId, outcome.instance) }
      : outcome;
  }
}

/**
 * The attached driver for `kind`. `signal` is the test's: cancelling it
 * cancels every outstanding operation on the device.
 */
export async function openClientDevice(
  kind: ClientDeviceKind,
  signal?: AbortSignal
): Promise<ClientDevice> {
  const drivers = await rpc.call("main", mainRpcMethods["deviceDriver.devices"], [], signal ? { signal } : undefined);
  if (!drivers.some((driver) => driver.deviceKind === kind)) {
    throw new Error(
      `No ${kind} device driver is attached to this instance; start the run with \`pnpm system-test run --device ${kind} ...\``
    );
  }
  return new ClientDevice(kind, async (op, args) => {
    const result = await rpc.call(
      "main",
      mainRpcMethods["deviceDriver.drive"],
      [{ deviceKind: kind, op, args }],
      signal ? { signal } : undefined
    );
    return result.value;
  });
}
