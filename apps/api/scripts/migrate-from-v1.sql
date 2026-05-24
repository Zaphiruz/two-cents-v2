-- migrate-from-v1.sql
--
-- One-shot data migration: copies all rows from v1's Django Postgres database
-- into v2's Prisma schema. Run from the **v2** database after:
--   1. `prisma migrate deploy` has created all v2 tables empty
--   2. The v1 DB is reachable from the v2 DB host (same Postgres server is ideal)
--
-- Usage:
--   psql -h <host> -U two_cents_v2 -d two_cents_v2 \
--     -v v1_conn="dbname=two_cents host=<v1-host> port=5432 user=two_cents password=<pw>" \
--     -f migrate-from-v1.sql
--
-- The script is wrapped in a transaction. If any step fails, nothing is committed.
-- IDs are preserved across the copy; sequences are reset to MAX(id)+1 at the end.
--
-- Schema differences handled here:
--   * Table renames (e.g. accounts_user → users) — done in the dblink SELECTs.
--   * Enum casts (e.g. status text → "RequestStatus") — Postgres needs explicit ::"Enum".
--   * NotificationPreference.quiet_hours_*: v1 = TIME, v2 = text "HH:MM".
--     Converted via to_char(..., 'HH24:MI').
--   * v1's accounts_user has a password column (unused via set_unusable_password());
--     we don't select it. All other columns map 1:1.

BEGIN;

CREATE EXTENSION IF NOT EXISTS dblink;

-- Sanity: make sure target tables are empty (we don't want to merge into an in-use DB).
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','households','household_members','buyer_approvers','pending_memberships',
    'requests','request_items','listing_versions','reviews','comments','appeals',
    'push_subscriptions','notification_preferences','consumed_jwt_jtis',
    'notification_logs','feedback_submissions'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'target table % is not empty (% rows) — aborting migration', t, n;
    END IF;
  END LOOP;
END $$;

-- ── 1. Users ────────────────────────────────────────────────────────────────
INSERT INTO users (id, oidc_subject, name, is_admin, created_at)
SELECT id, oidc_subject, name, is_admin, created_at
FROM dblink(:'v1_conn',
  'SELECT id, oidc_subject, name, is_admin, created_at FROM accounts_user')
  AS t(id int, oidc_subject text, name text, is_admin boolean, created_at timestamptz);

-- ── 2. Households ───────────────────────────────────────────────────────────
INSERT INTO households (id, name, appeal_quota_count, appeal_quota_period, created_at)
SELECT id, name, appeal_quota_count, appeal_quota_period::"AppealPeriod", created_at
FROM dblink(:'v1_conn',
  'SELECT id, name, appeal_quota_count, appeal_quota_period, created_at FROM households_household')
  AS t(id int, name text, appeal_quota_count int, appeal_quota_period text, created_at timestamptz);

-- ── 3. HouseholdMember ──────────────────────────────────────────────────────
INSERT INTO household_members (id, household_id, user_id, approval_mode, joined_at)
SELECT id, household_id, user_id, approval_mode::"ApprovalMode", joined_at
FROM dblink(:'v1_conn',
  'SELECT id, household_id, user_id, approval_mode, joined_at FROM households_householdmember')
  AS t(id int, household_id int, user_id int, approval_mode text, joined_at timestamptz);

-- ── 4. BuyerApprover ────────────────────────────────────────────────────────
INSERT INTO buyer_approvers (id, buyer_id, approver_id)
SELECT id, buyer_id, approver_id
FROM dblink(:'v1_conn',
  'SELECT id, buyer_id, approver_id FROM households_buyerapprover')
  AS t(id int, buyer_id int, approver_id int);

-- ── 5. PendingMembership ────────────────────────────────────────────────────
INSERT INTO pending_memberships (id, household_id, authentik_username, approval_mode, created_at)
SELECT id, household_id, authentik_username, approval_mode::"ApprovalMode", created_at
FROM dblink(:'v1_conn',
  'SELECT id, household_id, authentik_username, approval_mode, created_at FROM households_pendingmembership')
  AS t(id int, household_id int, authentik_username text, approval_mode text, created_at timestamptz);

-- ── 6. Request ──────────────────────────────────────────────────────────────
INSERT INTO requests (
  id, household_id, buyer_id, title, description, buyer_seriousness,
  status, status_expires_at, currency, created_at, updated_at
)
SELECT
  id, household_id, buyer_id, title, description,
  buyer_seriousness::"Seriousness",
  status::"RequestStatus",
  status_expires_at, currency, created_at, updated_at
FROM dblink(:'v1_conn',
  'SELECT id, household_id, buyer_id, title, description, buyer_seriousness, status,
          status_expires_at, currency, created_at, updated_at
   FROM requests_app_request')
  AS t(
    id int, household_id int, buyer_id int, title text, description text,
    buyer_seriousness text, status text, status_expires_at timestamptz,
    currency text, created_at timestamptz, updated_at timestamptz
  );

-- ── 7. RequestItem ──────────────────────────────────────────────────────────
INSERT INTO request_items (id, request_id, title, url, price_cents, notes, image_key, position, created_at)
SELECT id, request_id, title, url, price_cents, notes, image_key, position, created_at
FROM dblink(:'v1_conn',
  'SELECT id, request_id, title, url, price_cents, notes, image_key, position, created_at
   FROM requests_app_requestitem')
  AS t(id int, request_id int, title text, url text, price_cents int,
       notes text, image_key text, position int, created_at timestamptz);

-- ── 8. ListingVersion ───────────────────────────────────────────────────────
INSERT INTO listing_versions (id, request_id, items_snapshot, created_at)
SELECT id, request_id, items_snapshot, created_at
FROM dblink(:'v1_conn',
  'SELECT id, request_id, items_snapshot, created_at FROM requests_app_listingversion')
  AS t(id int, request_id int, items_snapshot jsonb, created_at timestamptz);

-- ── 9. Review ───────────────────────────────────────────────────────────────
INSERT INTO reviews (
  id, request_id, approver_id, action, approver_seriousness,
  delay_days, delay_expires_at, reconfirm_deadline, notes, created_at
)
SELECT
  id, request_id, approver_id,
  action::"ReviewAction",
  approver_seriousness::"Seriousness",
  delay_days, delay_expires_at, reconfirm_deadline, notes, created_at
FROM dblink(:'v1_conn',
  'SELECT id, request_id, approver_id, action, approver_seriousness,
          delay_days, delay_expires_at, reconfirm_deadline, notes, created_at
   FROM requests_app_review')
  AS t(
    id int, request_id int, approver_id int, action text, approver_seriousness text,
    delay_days int, delay_expires_at timestamptz, reconfirm_deadline timestamptz,
    notes text, created_at timestamptz
  );

-- ── 10. Comment ─────────────────────────────────────────────────────────────
INSERT INTO comments (id, request_id, author_id, body, created_at)
SELECT id, request_id, author_id, body, created_at
FROM dblink(:'v1_conn',
  'SELECT id, request_id, author_id, body, created_at FROM requests_app_comment')
  AS t(id int, request_id int, author_id int, body text, created_at timestamptz);

-- ── 11. Appeal ──────────────────────────────────────────────────────────────
INSERT INTO appeals (id, request_id, buyer_id, justification, period_key, status, created_at, resolved_at)
SELECT id, request_id, buyer_id, justification, period_key, status::"AppealStatus", created_at, resolved_at
FROM dblink(:'v1_conn',
  'SELECT id, request_id, buyer_id, justification, period_key, status, created_at, resolved_at
   FROM appeals_appeal')
  AS t(id int, request_id int, buyer_id int, justification text, period_key text,
       status text, created_at timestamptz, resolved_at timestamptz);

-- ── 12. PushSubscription ────────────────────────────────────────────────────
INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
SELECT id, user_id, endpoint, p256dh, auth, created_at
FROM dblink(:'v1_conn',
  'SELECT id, user_id, endpoint, p256dh, auth, created_at FROM notifications_pushsubscription')
  AS t(id int, user_id int, endpoint text, p256dh text, auth text, created_at timestamptz);

-- ── 13. NotificationPreference (TIME → text HH:MM) ──────────────────────────
INSERT INTO notification_preferences (id, user_id, event_type, enabled, quiet_hours_start, quiet_hours_end)
SELECT id, user_id, event_type, enabled, quiet_hours_start, quiet_hours_end
FROM dblink(:'v1_conn',
  'SELECT id, user_id, event_type, enabled,
          to_char(quiet_hours_start, ''HH24:MI'') AS quiet_hours_start,
          to_char(quiet_hours_end,   ''HH24:MI'') AS quiet_hours_end
   FROM notifications_notificationpreference')
  AS t(id int, user_id int, event_type text, enabled boolean,
       quiet_hours_start text, quiet_hours_end text);

-- ── 14. ConsumedJWTJti ──────────────────────────────────────────────────────
INSERT INTO consumed_jwt_jtis (jti, consumed_at)
SELECT jti, consumed_at
FROM dblink(:'v1_conn',
  'SELECT jti, consumed_at FROM notifications_consumedjwtjti')
  AS t(jti text, consumed_at timestamptz);

-- ── 15. NotificationLog ─────────────────────────────────────────────────────
INSERT INTO notification_logs (id, user_id, event_key, sent_at)
SELECT id, user_id, event_key, sent_at
FROM dblink(:'v1_conn',
  'SELECT id, user_id, event_key, sent_at FROM notifications_notificationlog')
  AS t(id int, user_id int, event_key text, sent_at timestamptz);

-- ── 16. FeedbackSubmission ──────────────────────────────────────────────────
INSERT INTO feedback_submissions (id, user_id, github_issue_number, github_issue_url, category, created_at)
SELECT id, user_id, github_issue_number, github_issue_url, category, created_at
FROM dblink(:'v1_conn',
  'SELECT id, user_id, github_issue_number, github_issue_url, category, created_at
   FROM feedback_feedbacksubmission')
  AS t(id int, user_id int, github_issue_number int, github_issue_url text,
       category text, created_at timestamptz);

-- ── Reset sequences so new inserts don't collide with migrated IDs ──────────
SELECT setval(pg_get_serial_sequence('users','id'),                 GREATEST((SELECT COALESCE(MAX(id),0) FROM users),                 1));
SELECT setval(pg_get_serial_sequence('households','id'),            GREATEST((SELECT COALESCE(MAX(id),0) FROM households),            1));
SELECT setval(pg_get_serial_sequence('household_members','id'),     GREATEST((SELECT COALESCE(MAX(id),0) FROM household_members),     1));
SELECT setval(pg_get_serial_sequence('buyer_approvers','id'),       GREATEST((SELECT COALESCE(MAX(id),0) FROM buyer_approvers),       1));
SELECT setval(pg_get_serial_sequence('pending_memberships','id'),   GREATEST((SELECT COALESCE(MAX(id),0) FROM pending_memberships),   1));
SELECT setval(pg_get_serial_sequence('requests','id'),              GREATEST((SELECT COALESCE(MAX(id),0) FROM requests),              1));
SELECT setval(pg_get_serial_sequence('request_items','id'),         GREATEST((SELECT COALESCE(MAX(id),0) FROM request_items),         1));
SELECT setval(pg_get_serial_sequence('listing_versions','id'),      GREATEST((SELECT COALESCE(MAX(id),0) FROM listing_versions),      1));
SELECT setval(pg_get_serial_sequence('reviews','id'),               GREATEST((SELECT COALESCE(MAX(id),0) FROM reviews),               1));
SELECT setval(pg_get_serial_sequence('comments','id'),              GREATEST((SELECT COALESCE(MAX(id),0) FROM comments),              1));
SELECT setval(pg_get_serial_sequence('appeals','id'),               GREATEST((SELECT COALESCE(MAX(id),0) FROM appeals),               1));
SELECT setval(pg_get_serial_sequence('push_subscriptions','id'),    GREATEST((SELECT COALESCE(MAX(id),0) FROM push_subscriptions),    1));
SELECT setval(pg_get_serial_sequence('notification_preferences','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM notification_preferences), 1));
SELECT setval(pg_get_serial_sequence('notification_logs','id'),     GREATEST((SELECT COALESCE(MAX(id),0) FROM notification_logs),     1));
SELECT setval(pg_get_serial_sequence('feedback_submissions','id'),  GREATEST((SELECT COALESCE(MAX(id),0) FROM feedback_submissions),  1));

-- ── Row count summary ───────────────────────────────────────────────────────
\echo ''
\echo 'Migration complete. Row counts:'
SELECT 'users' AS tbl, count(*) FROM users
UNION ALL SELECT 'households', count(*) FROM households
UNION ALL SELECT 'household_members', count(*) FROM household_members
UNION ALL SELECT 'buyer_approvers', count(*) FROM buyer_approvers
UNION ALL SELECT 'pending_memberships', count(*) FROM pending_memberships
UNION ALL SELECT 'requests', count(*) FROM requests
UNION ALL SELECT 'request_items', count(*) FROM request_items
UNION ALL SELECT 'listing_versions', count(*) FROM listing_versions
UNION ALL SELECT 'reviews', count(*) FROM reviews
UNION ALL SELECT 'comments', count(*) FROM comments
UNION ALL SELECT 'appeals', count(*) FROM appeals
UNION ALL SELECT 'push_subscriptions', count(*) FROM push_subscriptions
UNION ALL SELECT 'notification_preferences', count(*) FROM notification_preferences
UNION ALL SELECT 'consumed_jwt_jtis', count(*) FROM consumed_jwt_jtis
UNION ALL SELECT 'notification_logs', count(*) FROM notification_logs
UNION ALL SELECT 'feedback_submissions', count(*) FROM feedback_submissions
ORDER BY tbl;

COMMIT;
