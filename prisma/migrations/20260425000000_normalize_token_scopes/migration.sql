-- Normalize RestrictedToken.scopes onto the new preset vocabulary
-- (`apis.all` / `apis.read`). Two cases need rewriting:
--
--   1. Legacy tokens with NULL scopes — issued before the scope system
--      shipped, treated as full-access by the auth layer's null-bypass.
--   2. Tokens whose scope string contains the legacy `full-access` literal
--      (either standalone or whitespace/comma-separated). The auth layer
--      no longer bypasses on `full-access`; rewrite to `apis.all` so they
--      keep the same effective permissions.
--
-- After this migration, every row has an explicit, enforceable scope set.

UPDATE "RestrictedToken"
SET "scopes" = 'apis.all'
WHERE "scopes" IS NULL
   OR "scopes" = 'full-access'
   OR "scopes" ~ '(^|[[:space:],])full-access([[:space:],]|$)';
