CREATE TABLE member_expert_task_materials (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES member_expert_tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  format text NOT NULL CHECK (format IN ('pdf', 'docx', 'pptx', 'markdown')),
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 text NOT NULL,
  body bytea NOT NULL,
  extraction_status text NOT NULL DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'available', 'unavailable')),
  extraction_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  UNIQUE (task_id, sha256)
);
