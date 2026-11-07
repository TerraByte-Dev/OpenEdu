// Headless stand-in for @tauri-apps/plugin-store: one in-memory map per store file. The headless
// entry seeds it with the eval's provider and model (seedStore); every other key reads as unset, so
// store.ts returns the same defaults a fresh install gets.

const files = new Map<string, Map<string, unknown>>();

function file(name: string): Map<string, unknown> {
  let m = files.get(name);
  if (!m) files.set(name, (m = new Map()));
  return m;
}

/** Replace a store file's contents. */
export function seedStore(name: string, values: Record<string, unknown>): void {
  files.set(name, new Map(Object.entries(values)));
}

/** Forget every store file. */
export function resetStores(): void {
  files.clear();
}

export class Store {
  private constructor(private readonly data: Map<string, unknown>) {}

  static async load(name: string): Promise<Store> {
    return new Store(file(name));
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
  async reset(): Promise<void> {
    this.data.clear();
  }
  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }
  async values(): Promise<unknown[]> {
    return [...this.data.values()];
  }
  async entries<T>(): Promise<Array<[string, T]>> {
    return [...this.data.entries()] as Array<[string, T]>;
  }
  async length(): Promise<number> {
    return this.data.size;
  }
  async save(): Promise<void> {}
  async reload(): Promise<void> {}
}

export const load = (name: string): Promise<Store> => Store.load(name);
