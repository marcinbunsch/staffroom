import { action, makeObservable, observable } from "mobx"
import {
  type Binding,
  DEFAULT_BINDINGS,
  loadBindings,
  matchAction,
  saveBindings,
  type ShortcutAction,
} from "../lib/shortcuts.ts"

/**
 * The operator's keyboard-shortcut bindings, seeded from localStorage. Observable
 * so the Settings pane and the global key handler stay in lockstep: a rebind in
 * the pane takes effect on the very next keystroke without a reload. The map is
 * replaced wholesale on every change, so a single `.ref` observable is enough.
 */
export class ShortcutsStore {
  @observable.ref bindings: Record<ShortcutAction, Binding> = loadBindings()

  constructor() {
    makeObservable(this)
  }

  /** Which action a key event triggers, or undefined — read by the global handler. */
  match(event: KeyboardEvent): ShortcutAction | undefined {
    return matchAction(this.bindings, event)
  }

  @action.bound
  setBinding(action: ShortcutAction, binding: Binding): void {
    this.bindings = { ...this.bindings, [action]: binding }
    saveBindings(this.bindings)
  }

  @action.bound
  reset(): void {
    this.bindings = { ...DEFAULT_BINDINGS }
    saveBindings(this.bindings)
  }
}
