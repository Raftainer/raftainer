import { lockPods, LOCK_CONCURRENCY } from "../pod-locking";
import { TTLCache } from "../ttlCache";

jest.mock("../consul", () => ({
  tryLockPod: jest.fn(),
}));
import { tryLockPod } from "../consul";
const mockTryLockPod = tryLockPod as jest.Mock;

jest.mock("../logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("lockPods", () => {
  it("respects concurrency limits while locking pods", async () => {
    const podEntries = Array.from({ length: 10 }, (_, i) => ({
      key: `pods/pod${i}`,
      pod: { name: `pod${i}`, containers: [], maxInstances: 1 },
    }));

    let active = 0;
    let maxActive = 0;
    mockTryLockPod.mockImplementation(
      async (_consul, _session, _locks, podEntry) => {
        active++;
        if (active > maxActive) maxActive = active;
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return {
          pod: podEntry.pod,
          podEntry,
          lockKey: `lock-${podEntry.pod.name}`,
        };
      },
    );

    const constraintMatcher = {
      meetsConstraints: jest.fn().mockResolvedValue(true),
    };

    const locked = await lockPods(
      podEntries,
      {} as any,
      "session",
      {} as any,
      new TTLCache<string, string>(1000),
      constraintMatcher as any,
    );

    expect(locked).toHaveLength(podEntries.length);
    expect(mockTryLockPod).toHaveBeenCalledTimes(podEntries.length);
    expect(maxActive).toBeLessThanOrEqual(LOCK_CONCURRENCY);
  });
});
