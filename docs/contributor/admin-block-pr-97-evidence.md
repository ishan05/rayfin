# Fabric App AdminBlock embed evidence

This is the public before/after validation record for
[microsoft/rayfin#97](https://github.com/microsoft/rayfin/pull/97).

## Final validation stack

The final live matrix excluded FabricAppDev-UX PR 1124779 completely. Its
worktree was at the base commit, and no UX source or package was built or
deployed. The exercised path was Shared, WCL, BaaS, and Rayfin.

## Two-commit delivery

- [`a729bbc7dbe7456be1b2b90f3a9115250092686d`](https://github.com/microsoft/rayfin/commit/a729bbc7dbe7456be1b2b90f3a9115250092686d)
  preserves administrator-block service rejections instead of collapsing them
  into a generic permission failure.
- **[`a2d667ce7c64b9f2247f0e555ff5db8035eb5acf`](https://github.com/microsoft/rayfin/commit/a2d667ce7c64b9f2247f0e555ff5db8035eb5acf)
  adds `initEmbeddedAuthWithResult()` and `EmbeddedAuthResult`.**

## Before the fix

![Before fix: network returns insufficient_permissions and the legacy embedded API exposes no typed app code](https://github.com/user-attachments/assets/bd382343-1fc7-4b5c-bf72-9da611066313)

The blocked brokered authorization request returned HTTP 403 with service code
`insufficient_permissions`. The legacy `initEmbeddedAuth()` path did not expose
a useful typed application error.

## After the fix

![After fix: network and embedded result expose ArtifactBlockedByAdmin](https://github.com/user-attachments/assets/a845bdc4-129e-42a4-aac0-bce1213ad4ae)

The same blocked request returned HTTP 403 with service code
`ArtifactBlockedByAdmin`. `initEmbeddedAuthWithResult()` returned:

```json
{
  "status": "error",
  "error": {
    "code": "ArtifactBlockedByAdmin"
  }
}
```

The network panel proves the HTTP status. The embedded result deliberately
reports the typed service code without inventing an application-side HTTP
status.

## Live recovery

After clearing the AdminBlock restriction and synchronizing permissions, the
same non-owner user recovered successfully: brokered authorize and token
requests returned HTTP 200, the iframe established an authenticated session
for `Testuser1`, and the protected GraphQL read returned HTTP 200.

## Validation

- 336 changed Rayfin tests passed.
- The coordinated Shared, WCL, BaaS, Rayfin, and 76-test research harness
  focused suites passed without FabricAppDev-UX.
- The live runtime and test fixture were restored to their original unblocked
  state after capture.
