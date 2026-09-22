import { describe, expect, it } from "vitest"

/**
 * The shared tenant-isolation contract, mirroring Flue's own
 * `define-store-contract-tests`.
 *
 * One `staffroom.db` holds every tenant's rows, so the failure this guards
 * against does not crash and does not show up in a log: a read that forgot its
 * `WHERE tenant_id = ?` simply returns a colleague's data. It cannot be caught
 * by inspection reliably, because the wrong version of the query looks exactly
 * like the right one minus five words.
 *
 * So every store imports this and every store's test file calls it. A store
 * whose test file does not is visible in review — that is the whole enforcement
 * mechanism, which is why this exists before the first store rather than after
 * the tenth.
 */
export interface TenantIsolationSubject<Id> {
  /** Insert a record owned by `tenantId` and return its id. */
  create(tenantId: string, seed: string): Id
  /** Read one record by id, scoped to `tenantId`. */
  read(tenantId: string, id: Id): unknown
  /** List every record `tenantId` owns. */
  list(tenantId: string): readonly unknown[]
  /** Attempt an update, scoped to `tenantId`. Return whether anything changed. */
  update?(tenantId: string, id: Id): boolean
  /** Attempt a delete, scoped to `tenantId`. Return whether anything was removed. */
  remove?(tenantId: string, id: Id): boolean
}

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

export function defineTenantIsolationTests<Id>(
  storeName: string,
  makeSubject: () => TenantIsolationSubject<Id> | Promise<TenantIsolationSubject<Id>>,
): void {
  describe(`${storeName}: tenant isolation`, () => {
    it("does not read another tenant's record by id", async () => {
      const subject = await makeSubject()
      subject.create(TENANT_A, "a-one")
      const theirs = subject.create(TENANT_B, "b-one")

      expect(subject.read(TENANT_B, theirs)).toBeTruthy()
      expect(subject.read(TENANT_A, theirs)).toBeUndefined()
    })

    it("does not list another tenant's records", async () => {
      const subject = await makeSubject()
      subject.create(TENANT_A, "a-one")
      subject.create(TENANT_B, "b-one")
      subject.create(TENANT_B, "b-two")

      expect(subject.list(TENANT_A)).toHaveLength(1)
      expect(subject.list(TENANT_B)).toHaveLength(2)
    })

    it("lists nothing for a tenant that owns nothing", async () => {
      const subject = await makeSubject()
      subject.create(TENANT_B, "b-one")

      expect(subject.list(TENANT_A)).toHaveLength(0)
    })

    it("keeps the same id in two tenants apart", async () => {
      const subject = await makeSubject()
      const mine = subject.create(TENANT_A, "shared-name")
      const theirs = subject.create(TENANT_B, "shared-name")

      expect(subject.read(TENANT_A, mine)).toBeTruthy()
      expect(subject.read(TENANT_B, theirs)).toBeTruthy()
      expect(subject.list(TENANT_A)).toHaveLength(1)
      expect(subject.list(TENANT_B)).toHaveLength(1)
    })

    it("does not update another tenant's record", async () => {
      const subject = await makeSubject()
      if (!subject.update) return
      const theirs = subject.create(TENANT_B, "b-one")
      const before = structuredClone(subject.read(TENANT_B, theirs))

      expect(subject.update(TENANT_A, theirs)).toBe(false)
      expect(subject.read(TENANT_B, theirs)).toEqual(before)
    })

    it("does not delete another tenant's record", async () => {
      const subject = await makeSubject()
      if (!subject.remove) return
      const theirs = subject.create(TENANT_B, "b-one")

      expect(subject.remove(TENANT_A, theirs)).toBe(false)
      expect(subject.read(TENANT_B, theirs)).toBeTruthy()
    })
  })
}
