import { action, makeObservable, observable } from "mobx"

/**
 * Whether the command palette (⌘K) is open. A one-field UI store, not a piece of
 * domain data — it lives here so the global key handler in `use-shortcuts` and
 * the overlay mounted in the shell share a single toggle rather than threading a
 * callback through the tree.
 */
export class PaletteStore {
  @observable isOpen = false

  constructor() {
    makeObservable(this)
  }

  @action.bound
  open(): void {
    this.isOpen = true
  }

  @action.bound
  close(): void {
    this.isOpen = false
  }

  @action.bound
  toggle(): void {
    this.isOpen = !this.isOpen
  }
}
