# 2026-10-25 · PR #75 CI 圆角刻度修复

- 对应任务：PR #75 的架构检查修复；P5 真实员工材料验收状态不变。

## 做了什么与修改文件

- 将 `modules/membership/pages/knowledge-detail-skeleton.tsx` 中七处骨架文字条的裸 `rounded` 改为 `rounded-mark`。文字条是卡片内的小元素，沿用小圆角并小于外层卡片的 `rounded-card`。
- 更新 `docs/IMPLEMENTATION.md` 和 `docs/README.md`，记录本次修复和日志入口。

## 验证

- `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13/13 通过，含 `corners use the radius scale`。
- `node --test apps/web/tests/prod-smoke-remainders.test.ts`：4/4 通过。
- `node scripts/check-doc-links.ts`、`git diff --check`：通过。

## 未验证事项、风险与下一步

- 本次只更换骨架条圆角 class，未做真实浏览器慢网视觉复测或生产部署。PR #75 仍需 CI、评审与独立部署；员工试用与 P5 真实材料验收未完成。
