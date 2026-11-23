# SmartKirana Pro — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Single-Owner Tenant Isolation**: All store data lives under `/stores/{userId}` and its typed subcollections (`customers`, `customerTransactions`, `suppliers`, `supplierTransactions`, `sales`, `expenses`, `cashbookEntries`, `products`, `backupManifests`).
2. **Verified Authentication Required**: Every cloud read and write requires `request.auth != null && request.auth.token.email_verified == true` and `request.auth.uid == userId`.
3. **Master Gate Relational Integrity**: Subcollection writes (`create`, `update`, `delete`) and single-document `get` verify that the parent `/stores/{userId}` document exists and its `ownerId == request.auth.uid`. (`allow list` avoids `get()`/`exists()` to prevent O(n) read amplification and evaluates `resource.data.ownerId == request.auth.uid` directly.)
4. **Strict Keys & Schema Bounds**: Every entity enforces required/allowed keys (`hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update), bounded string lengths matching `firebase-blueprint.json`, bounded array lengths (`items.size() <= 100`), immutable `ownerId` / `id` / `createdAt`, and server timestamps (`createdAt == request.time`, `updatedAt == request.time`).
5. **Offline-First Safety**: Local IndexedDB operations never depend on Firestore. Sync errors or permission denials never block or delete local records.

## 2. "Dirty Dozen" Adversarial Payloads (Must All Be Denied)
1. **Unauthenticated Write**: `request.auth == null` creating `/stores/uid1`. -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `request.auth.uid == 'uid1'` with `email_verified: false`. -> `PERMISSION_DENIED`.
3. **Cross-Tenant Read/Write**: Signed-in `uid2` reading/writing `/stores/uid1/customers/c1`. -> `PERMISSION_DENIED`.
4. **Shadow / Ghost Field Injection**: Valid payload on `/stores/uid1/customers/c1` with extra `isAdmin: true`. -> `PERMISSION_DENIED` (`hasOnly` check).
5. **OwnerId Hijack on Create**: `uid1` creating `/stores/uid1/sales/s1` with `ownerId: 'uid2'`. -> `PERMISSION_DENIED`.
6. **Immutable OwnerId Tamper on Update**: `uid1` updating `/stores/uid1/sales/s1` changing `ownerId`. -> `PERMISSION_DENIED`.
7. **Immutable CreatedAt / Client Timestamp Spoof**: Creating record with `createdAt: '2020-01-01'` instead of `request.time`. -> `PERMISSION_DENIED`.
8. **ID Poisoning**: Creating `/stores/uid1/products/bad..id$script` or >128 chars. -> `PERMISSION_DENIED` (`isValidId`).
9. **Resource Exhaustion / 1MB String Attack**: Setting `customer.name` or `sale.notes` to >500 chars. -> `PERMISSION_DENIED`.
10. **Unbounded Array Attack on Sale**: Sending `sale.items` with >100 line items. -> `PERMISSION_DENIED`.
11. **Orphaned Subcollection Write**: Creating `/stores/uid1/products/p1` before parent `/stores/uid1` exists. -> `PERMISSION_DENIED` (Master Gate `exists`/`get`).
12. **Blanket List Query Scraping**: Listing `/stores/{otherUser}/customers` even if signed in. -> `PERMISSION_DENIED` (`resource.data.ownerId == request.auth.uid`).
