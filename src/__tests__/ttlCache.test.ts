import { TTLCache } from "../ttlCache";

describe("TTLCache", () => {
  let cache: TTLCache<string, number>;
  const ttl = 100; // 100ms TTL for testing

  beforeEach(() => {
    cache = new TTLCache<string, number>(ttl);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("set", () => {
    it("should store a value in the cache", () => {
      // Arrange & Act
      cache.set("key1", 42);

      // Assert
      expect(cache.get("key1")).toBe(42);
    });
  });

  describe("get", () => {
    it("should return the value if key exists and not expired", () => {
      // Arrange
      cache.set("key1", 42);

      // Act
      const result = cache.get("key1");

      // Assert
      expect(result).toBe(42);
    });

    it("should return null if key does not exist", () => {
      // Act
      const result = cache.get("nonexistent");

      // Assert
      expect(result).toBeNull();
    });

    it("should return null and remove entry if expired", () => {
      // Arrange
      cache.set("key1", 42);

      // Advance time beyond TTL
      jest.advanceTimersByTime(ttl + 10);

      // Act
      const result = cache.get("key1");

      // Assert
      expect(result).toBeNull();

      // Verify the key was removed from the cache
      // We can't directly inspect the private cache, so we try to set it again
      cache.set("key1", 99);
      expect(cache.get("key1")).toBe(99);
    });
  });

  describe("delete", () => {
    it("should remove an entry from the cache", () => {
      // Arrange
      cache.set("key1", 42);

      // Act
      cache.delete("key1");

      // Assert
      expect(cache.get("key1")).toBeNull();
    });

    it("should do nothing if key does not exist", () => {
      // Arrange & Act
      cache.delete("nonexistent");

      // Assert - should not throw
      expect(cache.get("nonexistent")).toBeNull();
    });
  });

  describe("clear", () => {
    it("should remove all entries from the cache", () => {
      // Arrange
      cache.set("key1", 42);
      cache.set("key2", 24);

      // Act
      cache.clear();

      // Assert
      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBeNull();
    });
  });
});
