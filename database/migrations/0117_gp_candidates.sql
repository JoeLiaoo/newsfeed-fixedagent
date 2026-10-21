-- Candidate names are transcribed from reference/母基金已投子基金管理人.md.
-- Source calls some entities managers or general partners; none is activated automatically.
INSERT INTO member_gp_watchlist (id,canonical_name,source_ref) VALUES
('candidate-001','元禾璞华同芯（苏州）投资管理有限公司','reference/母基金已投子基金管理人.md / 上交所 2026-02-26 募集说明书'),
('candidate-002','中油昆仑（北京）私募基金管理有限公司','reference/母基金已投子基金管理人.md / 天眼查'),
('candidate-003','上海孚腾私募基金管理有限公司','reference/母基金已投子基金管理人.md / chinamoney、基金报'),
('candidate-004','广东长石创业投资合伙企业（有限合伙）','reference/母基金已投子基金管理人.md / 深交所公告'),
('candidate-005','前海琥珀永裕股权投资（深圳）合伙企业（有限合伙）','reference/母基金已投子基金管理人.md / 深信服公告（原始出处标记普通合伙人）'),
('candidate-006','博原（上海）私募基金管理有限公司','reference/母基金已投子基金管理人.md / 无锡威孚公告'),
('candidate-007','深圳风投侠基金管理企业（有限合伙）','reference/母基金已投子基金管理人.md / 投资界报道'),
('candidate-008','西湖创新（杭州）私募基金管理有限公司','reference/母基金已投子基金管理人.md / 天眼查'),
('candidate-009','东莞市科创资本投资管理有限公司','reference/母基金已投子基金管理人.md / 基金设立信息')
ON CONFLICT(canonical_name) DO NOTHING;
