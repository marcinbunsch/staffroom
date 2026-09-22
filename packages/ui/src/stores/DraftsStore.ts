/**
 * Composer drafts, persisted to localStorage so an unsent message survives
 * leaving the page and coming back (and a reload). Keyed by conversation, so
 * every chat keeps its own draft independently.
 *
 * A persistence facade with no observable state: the composer seeds its local
 * text from here on mount and writes back on change, so there is no
 * cross-component reactivity to model — just one place that owns the namespacing
 * and the "unavailable localStorage is fine" handling.
 */
export class DraftsStore {
  readonly #prefix = "staffroom:draft:"

  /** The saved draft for a conversation key, or "" when there is none. */
  get(key: string): string {
    return this.#read(this.#prefix + key)
  }

  /** Save a draft; an empty value clears it rather than leaving a blank key. */
  save(key: string, value: string): void {
    if (value) this.#write(this.#prefix + key, value)
    else this.#remove(this.#prefix + key)
  }

  clear(key: string): void {
    this.#remove(this.#prefix + key)
  }

  #read(fullKey: string): string {
    try {
      return globalThis.localStorage?.getItem(fullKey) ?? ""
    } catch {
      // Private mode / disabled storage: drafts just don't persist.
      return ""
    }
  }
  #write(fullKey: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(fullKey, value)
    } catch {
      // Over quota or storage disabled — nothing we can (or should) do here.
    }
  }
  #remove(fullKey: string): void {
    try {
      globalThis.localStorage?.removeItem(fullKey)
    } catch {
      // Ignore: a draft that cannot be removed also cannot have been saved.
    }
  }
}
