UPDATE "bot_users"
SET "avatar_url" = regexp_replace(
  "avatar_url",
  '^https?://[^/]+',
  '',
  'i'
)
WHERE "avatar_url" ~* '^https?://';
