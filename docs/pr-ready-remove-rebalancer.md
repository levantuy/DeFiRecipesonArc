# PR-ready Package: Remove Legacy Rebalancer Flow

## 1. Draft PR Summary (Team Format)

## 📝 Mục đích PR
Loại bỏ hoàn toàn luồng legacy Rebalancer khỏi toàn bộ hệ thống để chuẩn hóa phạm vi MVP hiện tại về đúng 2 trọng tâm sản phẩm:
- USDC Yield Auto-Compounder
- USDC -> EURC Recurring DCA

PR này dọn đồng bộ theo chiều dọc: tài liệu, backend scheduler/call-path, frontend catalog/type, database enum/migration và test liên quan. Mục tiêu là không còn code chết, tham chiếu mồ côi, schema legacy hoặc UX copy cũ liên quan Rebalancer.

## 🔗 Issues liên quan
- Closes #<issue-id>

## 🛠 Thay đổi chính
- [x] contracts/: Không thay đổi logic contract cốt lõi; xác nhận không còn tham chiếu Rebalancer trong source contracts tracked.
- [x] keeper/:
  - Xóa recipe type legacy khỏi runtime type map.
  - Gỡ call-path scheduler cho recipe type legacy.
  - Gỡ payload builder legacy trong simulation helpers.
  - Cập nhật test enum tương ứng.
- [x] db/:
  - Loại bỏ giá trị legacy khỏi RecipeType enum baseline migration.
  - Thêm migration cleanup idempotent để purge dữ liệu legacy và rebuild enum an toàn.
- [x] frontend/:
  - Xóa recipe card legacy trong catalog.
  - Cập nhật type union chỉ còn AUTO_COMPOUNDER + RECURRING_DCA.
  - Gỡ mapping hiển thị tên recipe legacy khỏi portfolio tracker.
- [x] docs/:
  - Cập nhật vision/spec/architecture/tech-stack/runbook/naming/ui-ux theo đúng 2 luồng trọng tâm.
  - Đồng bộ flow/diagram/checklist mô tả vận hành sau khi bỏ legacy flow.

## 📁 File thay đổi theo nhóm
Docs:
- docs/features-spec.md
- docs/project-vision.md
- docs/tech-stack.md
- docs/architecture-proposal.md
- docs/ui-ux-guidelines.md
- docs/naming-conventions.md
- docs/feature-x-production-runbook.md

Backend:
- keeper/src/db/types.ts
- keeper/src/schedulers/cronScheduler.ts
- keeper/src/simulation/recipePayloads.ts

Database:
- keeper/db-migrations/migrations/20260729010643_/migration.sql
- keeper/db-migrations/migrations/20260907120000_remove_legacy_recipe_type/migration.sql

Frontend:
- web/src/components/RecipeCatalog.tsx
- web/src/components/SimulationModal.tsx
- web/src/components/PortfolioTracker.tsx

Tests:
- keeper/src/__tests__/database.test.ts

## 🔌 API/Route impact
Không có endpoint public bị xóa. Ảnh hưởng chính là loại bỏ khả năng xử lý recipe type legacy ở tầng model/type và execution path nội bộ.

## 🧪 Bằng chứng Kiểm thử (Proof of Testing)
- Contracts: forge test -vv -> PASS (20/20)
- Keeper build: npm run build -> PASS
- Keeper tests: npm test -> PASS (63/63)
- Web build: npm run build -> PASS
- Repo scan: không còn match từ khóa legacy flow trong tracked files

## ⚠️ Risk & Rollback
Risk:
- Migration cleanup xóa dữ liệu recipe legacy và execution logs liên quan (chủ đích).
- Client/integration cũ còn gửi recipe type legacy sẽ bị reject bởi validation/type hiện tại.

Rollback:
1) Revert commit/PR này.
2) Restore DB từ snapshot trước migration cleanup.
3) Nếu cần mở lại legacy flow tạm thời, tạo migration mới để re-introduce enum value + re-enable call-path có kiểm soát.

## 📋 Checklist trước khi Merge
- [ ] CI pipeline xanh toàn bộ.
- [ ] Không còn tham chiếu legacy flow trong code/docs/schema/test (đã grep lại trên tracked files).
- [ ] Migration đã được review về an toàn dữ liệu và idempotency.
- [ ] Không có import dư, endpoint mồ côi, hoặc type mồ côi sau refactor.
- [ ] Reviewer xác nhận docs phản ánh đúng 2 trọng tâm: Auto-Compounder + Recurring DCA.


## 2. Conventional Commit Message (Recommended)

Option A (single squash commit):
refactor(keeper): remove legacy rebalancer execution path and align product scope

Body gợi ý:
- remove legacy recipe type from runtime enums and scheduler call path
- drop legacy payload builder and frontend catalog/type mappings
- add idempotent DB migration to purge legacy recipe data and rebuild RecipeType enum
- update architecture/spec/vision/runbook docs to focus on Auto-Compounder and Recurring DCA
- update keeper enum test and validate builds/tests across contracts, keeper, and web

Option B (split commits):
1) refactor(keeper): remove legacy recipe type and scheduler execution branch
2) refactor(frontend): remove legacy recipe card and type mappings
3) feat(db): add idempotent migration to purge legacy recipe records and enum value
4) docs: align product docs and runbook to Auto-Compounder and Recurring DCA
5) test(keeper): update enum assertions after legacy recipe removal


## 3. Reviewer Checklist (Fast Tick - DoD)

Functional scope:
- [ ] Chỉ còn 2 luồng được mô tả và hiển thị: Auto-Compounder, USDC -> EURC Recurring DCA.
- [ ] Không còn luồng legacy flow trong scheduler, simulation payloads, UI catalog, hoặc docs.

Code health:
- [ ] Không còn dead code/import/type liên quan legacy flow.
- [ ] Không có TODO/FIXME mơ hồ được thêm mới.

Database:
- [ ] Migration cleanup an toàn, có tính idempotent.
- [ ] Dữ liệu Auto-Compounder và Recurring DCA không bị ảnh hưởng ngoài phạm vi cleanup legacy.

Compatibility:
- [ ] Không có breaking change ngoài phạm vi chính thức loại bỏ legacy flow.
- [ ] Các route hiện hữu vẫn hoạt động cho 2 recipe còn lại.

Quality gates:
- [ ] Contracts tests PASS.
- [ ] Keeper build + tests PASS.
- [ ] Web build PASS.
- [ ] CI pass toàn bộ.

Definition of Done:
- [ ] Không còn tham chiếu legacy flow trong repository tracked files.
- [ ] Toàn bộ test pass.
- [ ] Pipeline build/deploy pass.
- [ ] Docs phản ánh đúng 2 trọng tâm sản phẩm còn lại.
