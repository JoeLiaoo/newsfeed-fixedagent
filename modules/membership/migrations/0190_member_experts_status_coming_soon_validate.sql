-- Every existing row is `available`, `blocked` or `hidden`, so the wider check holds for the whole table.
ALTER TABLE member_experts VALIDATE CONSTRAINT member_experts_status_check;
