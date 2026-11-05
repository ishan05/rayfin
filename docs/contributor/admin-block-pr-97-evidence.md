# Fabric App AdminBlock embed evidence

This is the public before/after validation record for
[microsoft/rayfin#97](https://github.com/microsoft/rayfin/pull/97).

## Two-commit delivery

- [`a729bbc7dbe7456be1b2b90f3a9115250092686d`](https://github.com/microsoft/rayfin/commit/a729bbc7dbe7456be1b2b90f3a9115250092686d)
  preserves administrator-block service rejections instead of collapsing them
  into a generic permission failure.
- **[`a2d667ce7c64b9f2247f0e555ff5db8035eb5acf`](https://github.com/microsoft/rayfin/commit/a2d667ce7c64b9f2247f0e555ff5db8035eb5acf)
  adds `initEmbeddedAuthWithResult()` and `EmbeddedAuthResult`.**

## Before the fix

![Before fix: network returns insufficient_permissions and the legacy embedded API exposes no typed app code](https://github.com/user-attachments/assets/68c733a0-cf36-48fa-ae8e-912d846b09c6)

The blocked brokered authorization request returned HTTP 403 with service code
`insufficient_permissions`. The legacy `initEmbeddedAuth()` path did not expose
a useful typed application error.

## After the fix

![After fix: network and embedded result expose ArtifactBlockedByAdmin](https://github.com/user-attachments/assets/843f53e3-cd5a-415c-a11a-e6d24b5bdd74)

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
- The coordinated Shared, WCL, BaaS, UI, and research harness focused suites
  passed.
- The live runtime and test fixture were restored to their original unblocked
  state after capture.
