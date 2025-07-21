import { syncPods } from "../pod-sync";
import { TTLCache } from "../ttlCache";
import { PodLock, getPods, releasePod } from "../consul";

jest.mock("../consul", () => ({
  getPods: jest.fn(),
  releasePod: jest.fn(),
}));

const mockGetPods = getPods as jest.Mock;
const mockReleasePod = releasePod as jest.Mock;

jest.mock("../pod-locking", () => ({ lockPods: jest.fn() }));
import { lockPods } from "../pod-locking";
const mockLockPods = lockPods as jest.Mock;

jest.mock("../pod-launcher", () => ({ launchPods: jest.fn() }));
import { launchPods } from "../pod-launcher";
const mockLaunchPods = launchPods as jest.Mock;

jest.mock("../pod-registration", () => ({ registerPods: jest.fn() }));
import { registerPods } from "../pod-registration";
const mockRegisterPods = registerPods as jest.Mock;

jest.mock("../containers", () => ({ stopOrphanedContainers: jest.fn() }));
import { stopOrphanedContainers } from "../containers";
const mockStopOrphanedContainers = stopOrphanedContainers as jest.Mock;

jest.mock("../networks", () => ({ stopOrphanedNetworks: jest.fn() }));
import { stopOrphanedNetworks } from "../networks";
const mockStopOrphanedNetworks = stopOrphanedNetworks as jest.Mock;

jest.mock("../logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe("syncPods", () => {
  let consul: any;
  let docker: any;
  let session: string;
  let podLocks: PodLock;
  let failedPods: TTLCache<string, string>;
  let constraintMatcher: any;
  let vault: any;

  beforeEach(() => {
    jest.clearAllMocks();
    consul = {};
    docker = {};
    session = "test-session";
    podLocks = {} as PodLock;
    failedPods = new TTLCache<string, string>(1000);
    constraintMatcher = {};
    vault = {};
  });

  it("should orchestrate pods successfully", async () => {
    const podEntries = [
      { key: "pods/pod1", pod: { name: "pod1", containers: [] } },
    ];
    const lockedPods = [
      { pod: { name: "pod1" }, podEntry: podEntries[0], lockKey: "lock1" },
    ];
    const launchedPods = [
      { podEntry: podEntries[0], launchedContainers: [], networks: {}, error: undefined },
    ];

    mockGetPods.mockResolvedValue(podEntries);
    mockLockPods.mockResolvedValue(lockedPods);
    mockLaunchPods.mockResolvedValue(launchedPods);
    mockRegisterPods.mockResolvedValue(["svc1"]);

    await syncPods(
      consul as any,
      docker as any,
      session,
      podLocks,
      failedPods,
      constraintMatcher as any,
      vault as any,
    );

    expect(mockGetPods).toHaveBeenCalledWith(consul);
    expect(mockLockPods).toHaveBeenCalledWith(
      podEntries,
      consul,
      session,
      podLocks,
      failedPods,
      constraintMatcher,
    );
    expect(mockLaunchPods).toHaveBeenCalledWith(
      lockedPods,
      docker,
      vault,
      failedPods,
    );
    expect(mockRegisterPods).toHaveBeenCalledWith(consul, launchedPods);
    expect(mockStopOrphanedContainers).toHaveBeenCalledWith(
      docker,
      new Set(["pod1"]),
    );
    expect(mockStopOrphanedNetworks).toHaveBeenCalledWith(
      docker,
      new Set(["pod1"]),
    );
    expect(mockReleasePod).not.toHaveBeenCalled();
  });

  it("should release failed pods and continue", async () => {
    const podEntries = [
      { key: "pods/pod1", pod: { name: "pod1", containers: [] } },
      { key: "pods/pod2", pod: { name: "pod2", containers: [] } },
    ];
    const lockedPods = [
      { pod: { name: "pod1" }, podEntry: podEntries[0], lockKey: "lock1" },
      { pod: { name: "pod2" }, podEntry: podEntries[1], lockKey: "lock2" },
    ];
    const error = new Error("fail");
    const launchedPods = [
      { podEntry: podEntries[0], launchedContainers: [], networks: {}, error: undefined },
      { podEntry: podEntries[1], error },
    ];

    mockGetPods.mockResolvedValue(podEntries);
    mockLockPods.mockResolvedValue(lockedPods);
    mockLaunchPods.mockResolvedValue(launchedPods);
    mockRegisterPods.mockResolvedValue(["svc1"]);

    await syncPods(
      consul as any,
      docker as any,
      session,
      podLocks,
      failedPods,
      constraintMatcher as any,
      vault as any,
    );

    expect(mockReleasePod).toHaveBeenCalledWith(consul, session, podEntries[1], error);
    expect(mockRegisterPods).toHaveBeenCalledWith(consul, [launchedPods[0]]);
    expect(mockStopOrphanedContainers).toHaveBeenCalledWith(
      docker,
      new Set(["pod1"]),
    );
    expect(mockStopOrphanedNetworks).toHaveBeenCalledWith(
      docker,
      new Set(["pod1"]),
    );
  });
});
