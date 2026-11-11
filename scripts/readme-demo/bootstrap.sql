-- Folders and AI settings for a fresh demo profile, applied once after the
-- first launch has created the schema and, from env.sh's .env.local, the
-- account (id 1). No mail server answers on 127.0.0.1:3993; sync fails quietly
-- and rec.cjs keeps that toast out of frame.
INSERT OR REPLACE INTO folders (id, account_id, name, path, role) VALUES
  (1, 1, NULL, 'INBOX', 'inbox'),
  (2, 1, NULL, 'Sent', 'sent'),
  (3, 1, NULL, 'Archive', 'archive'),
  (4, 1, NULL, 'Trash', 'trash'),
  (50, 1, NULL, 'Drafts', 'drafts');
INSERT OR REPLACE INTO settings (key, value) VALUES
  ('ai_provider', 'deepseek'),
  ('ai_sort_engine', 'provider'),
  ('ai_classify', '1'), ('ai_write', '1'), ('ai_replies', '1'), ('ai_summary', '1'), ('ai_ask', '1'),
  ('full_history', '0'),
  ('account.1.name', 'Maya Chen'),
  ('signature:1', '<div>Maya Chen</div><div style="color: rgb(120, 120, 128)">Head of Product, Fieldnote</div>');
