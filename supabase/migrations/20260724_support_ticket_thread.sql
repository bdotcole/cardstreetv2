-- Support ticket threads: replace the single-shot admin_reply model with a
-- back-and-forth message thread per ticket. The legacy admin_reply/replied_at
-- columns stay (older app builds still render them; the PATCH route keeps them
-- mirrored to the latest admin message).

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user', 'admin')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
  ON support_ticket_messages(ticket_id, created_at);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- Users can read the thread on their own tickets.
DROP POLICY IF EXISTS "Users read own ticket messages" ON support_ticket_messages;
CREATE POLICY "Users read own ticket messages"
  ON support_ticket_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM support_tickets t
    WHERE t.id = ticket_id AND t.user_id = auth.uid()
  ));

-- Users can reply on their own tickets, only as themselves. Admin messages
-- are written via the service-role key (bypasses RLS), same as ticket updates.
DROP POLICY IF EXISTS "Users reply to own tickets" ON support_ticket_messages;
CREATE POLICY "Users reply to own tickets"
  ON support_ticket_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND sender_role = 'user'
    AND EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

-- Backfill: surface each legacy one-shot admin_reply as the ticket's first
-- admin thread message. Idempotent — skips tickets that already have one.
INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_role, body, created_at)
SELECT t.id, t.replied_by, 'admin', t.admin_reply, COALESCE(t.replied_at, t.updated_at, NOW())
FROM support_tickets t
WHERE t.admin_reply IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM support_ticket_messages m
    WHERE m.ticket_id = t.id AND m.sender_role = 'admin'
  );
