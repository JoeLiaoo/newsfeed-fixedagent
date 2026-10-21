ALTER TABLE admin_sessions ADD CONSTRAINT admin_sessions_auth_method_check_v2 CHECK (auth_method IN ('password', 'feishu')) NOT VALID;
