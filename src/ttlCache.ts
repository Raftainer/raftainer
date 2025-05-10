export class TTLCache<K, V> {
  private cache: Map<K, { value: V; expiresAt: number }> = new Map();
  private ttl: number;

  constructor(ttl: number) {
    this.ttl = ttl;
  }

  /**
   * Stores a value in the cache with the specified key
   * @param key The key to store the value under
   * @param value The value to store
   */
  set(key: K, value: V) {
    const expiresAt = Date.now() + this.ttl;
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Retrieves a value from the cache by key
   * @param key The key to look up
   * @returns The stored value if found and not expired, null otherwise
   */
  get(key: K): V | null {
    const entry = this.cache.get(key);
    if (entry) {
      if (Date.now() < entry.expiresAt) {
        return entry.value;
      } else {
        this.cache.delete(key); // Remove expired entry
      }
    }
    return null;
  }

  /**
   * Removes an entry from the cache
   * @param key The key to remove
   */
  delete(key: K) {
    this.cache.delete(key);
  }

  /**
   * Removes all entries from the cache
   */
  clear() {
    this.cache.clear();
  }
}
