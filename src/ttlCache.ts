export class TTLCache<K, V> {
  private cache: Map<K, { value: V; expiresAt: number }> = new Map();
  private ttl: number;

  constructor(ttl: number) {
    this.ttl = ttl;
  }

  set(key: K, value: V) {
    const expiresAt = Date.now() + this.ttl;
    this.cache.set(key, { value, expiresAt });
  }

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

  delete(key: K) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}
