# v2 Admin Page — PR 1 Implementation Plan (Foundation + People + Households + Appeals)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation of the v2 admin page plus the three daily-use sections (People, Households, Appeals) per `docs/superpowers/specs/2026-05-24-admin-page-design.md` (commit `ef13283`). Feedback + Audit Search are deferred to PR 2.

**Architecture:** Single `/admin/*` SPA section gated on `User.isAdmin` (sourced from Authentik group `two-cents-admins`, resynced on every login). API surface lives under `/api/admin/*` behind a `requireAdmin` Fastify preHandler in a single admin route plugin. Web uses an `AdminLayout` with sidebar + nested routes. Shared primitives: `DataTable` (paginated/filterable table) and `DetailDrawer` (slide-over wrapper around shadcn `Sheet`). No generic CRUD factory — each section is purpose-built per the spec's job-to-be-done framing.

**Tech Stack:** Fastify 5, Prisma 5 (postgres), Zod (in `@two-cents/shared`), iron-session, React 18 + Vite, react-router 6, @tanstack/react-query, shadcn/ui (Sheet to be added; rest exist), Tailwind, vitest + @testing-library/react.

**Reference patterns to mimic exactly:**
- Route module shape: `apps/api/src/routes/feedback.ts`
- Route test shape: `apps/api/src/routes/feedback.test.ts`
- Session/auth hook: `apps/api/src/plugins/auth.ts`
- Shared schema style: `packages/shared/src/schemas.ts` (`CommentInputSchema`, `ResolveAppealInputSchema`)
- Web data fetching: `apps/web/src/pages/RequestDetailPage.tsx` (`useQuery` + `request()` from `@/lib/api`)
- Web component test: `apps/web/src/pages/AppealsPage.test.tsx` (`vi.hoisted` request mock + `MemoryRouter` wrap)

**Test seed pattern:**
```ts
const adminUser = await prisma.user.create({
  data: { oidcSubject: 'admin-x', name: 'Admin', isAdmin: true },
});
const { app, sessionCookie } = await buildTestApp(adminUser.id);
```
(non-admin sessions return 403; no session returns 401)

---

## File map

**API (apps/api/src/):**
- Create `routes/admin/index.ts` — admin route plugin + requireAdmin preHandler
- Create `routes/admin/users.ts` — People endpoints
- Create `routes/admin/households.ts` — Household + household-member + buyer-approver endpoints
- Create `routes/admin/appeals.ts` — admin appeal list + resolve
- Create `routes/admin/*.test.ts` — one per route file
- Modify `buildApp.ts` — register admin route plugin

**Shared (packages/shared/src/):**
- Modify `schemas.ts` — append admin Zod schemas (`AdminListUsersQuerySchema`, `AdminUpdateHouseholdSchema`, etc.)

**Web (apps/web/src/):**
- Create `components/ui/sheet.tsx` — added via shadcn CLI
- Create `pages/admin/AdminLayout.tsx` — sidebar + outlet
- Create `pages/admin/PeoplePage.tsx`, `PeopleDetail.tsx`
- Create `pages/admin/HouseholdsPage.tsx`, `HouseholdDetail.tsx`, `BuyerApproverMatrix.tsx`
- Create `pages/admin/AdminAppealsPage.tsx`
- Create `pages/admin/components/DataTable.tsx`, `DetailDrawer.tsx`
- Create `pages/admin/RequireAdmin.tsx` — route guard
- Create `pages/admin/*.test.tsx` — one per page
- Modify `App.tsx` — replace `/admin` stub with nested routes

---

## Phase A — Foundation

### Task A1: Install shadcn Sheet component

**Files:**
- Create: `apps/web/src/components/ui/sheet.tsx`

- [ ] **Step 1: Run shadcn CLI to add Sheet**

```bash
cd apps/web && pnpm dlx shadcn@latest add sheet
```

Expected: `apps/web/src/components/ui/sheet.tsx` is created. CLI will also add `@radix-ui/react-dialog` to deps if not present (Sheet builds on Dialog).

- [ ] **Step 2: Verify the file exists and exports the expected components**

```bash
grep -E "^export" apps/web/src/components/ui/sheet.tsx
```

Expected output includes: `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`, `SheetClose`.

- [ ] **Step 3: Run web build to confirm nothing else broke**

```bash
cd apps/web && pnpm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/sheet.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add shadcn Sheet component for admin detail drawers"
```

---

### Task A2: Add admin Zod schemas to shared package

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append to end)
- Test: `packages/shared/src/schemas.test.ts` (append; if doesn't exist, create)

- [ ] **Step 1: Write failing tests for the new schemas**

Append to `packages/shared/src/schemas.test.ts` (create with imports if missing):

```ts
import { describe, it, expect } from 'vitest';
import {
  AdminListUsersQuerySchema,
  AdminUpdateHouseholdSchema,
  AdminAddHouseholdMemberSchema,
  AdminUpdateHouseholdMemberSchema,
  AdminUpsertBuyerApproverSchema,
  AdminListAppealsQuerySchema,
  AdminResolveAppealSchema,
} from './schemas';

describe('admin schemas', () => {
  it('AdminListUsersQuerySchema accepts empty query', () => {
    expect(AdminListUsersQuerySchema.parse({})).toEqual({});
  });

  it('AdminListUsersQuerySchema coerces isAdmin string to boolean', () => {
    expect(AdminListUsersQuerySchema.parse({ isAdmin: 'true' })).toEqual({ isAdmin: true });
    expect(AdminListUsersQuerySchema.parse({ isAdmin: 'false' })).toEqual({ isAdmin: false });
  });

  it('AdminUpdateHouseholdSchema accepts partial payload', () => {
    expect(AdminUpdateHouseholdSchema.parse({ name: 'Smith' })).toEqual({ name: 'Smith' });
    expect(AdminUpdateHouseholdSchema.parse({ appealQuotaCount: 5 })).toEqual({ appealQuotaCount: 5 });
  });

  it('AdminUpdateHouseholdSchema rejects empty object', () => {
    expect(() => AdminUpdateHouseholdSchema.parse({})).toThrow();
  });

  it('AdminAddHouseholdMemberSchema requires userId and approvalMode', () => {
    expect(AdminAddHouseholdMemberSchema.parse({ userId: 1, approvalMode: 'any' }))
      .toEqual({ userId: 1, approvalMode: 'any' });
    expect(() => AdminAddHouseholdMemberSchema.parse({ userId: 1 })).toThrow();
  });

  it('AdminUpdateHouseholdMemberSchema requires approvalMode', () => {
    expect(AdminUpdateHouseholdMemberSchema.parse({ approvalMode: 'all' }))
      .toEqual({ approvalMode: 'all' });
    expect(() => AdminUpdateHouseholdMemberSchema.parse({})).toThrow();
  });

  it('AdminUpsertBuyerApproverSchema requires both ids', () => {
    expect(AdminUpsertBuyerApproverSchema.parse({ buyerId: 1, approverId: 2 }))
      .toEqual({ buyerId: 1, approverId: 2 });
  });

  it('AdminUpsertBuyerApproverSchema rejects buyer === approver', () => {
    expect(() => AdminUpsertBuyerApproverSchema.parse({ buyerId: 1, approverId: 1 })).toThrow();
  });

  it('AdminListAppealsQuerySchema accepts status and householdId', () => {
    expect(AdminListAppealsQuerySchema.parse({ status: 'pending', householdId: 3 }))
      .toEqual({ status: 'pending', householdId: 3 });
  });

  it('AdminResolveAppealSchema accepts overturn or uphold', () => {
    expect(AdminResolveAppealSchema.parse({ decision: 'overturn' })).toEqual({ decision: 'overturn' });
    expect(() => AdminResolveAppealSchema.parse({ decision: 'unsure' })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/shared && pnpm test
```

Expected: FAIL — `AdminListUsersQuerySchema` is not exported / not defined.

- [ ] **Step 3: Implement the schemas**

Append to `packages/shared/src/schemas.ts`:

```ts
// ─── Admin schemas ─────────────────────────────────────────────────────────

const stringBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const intLike = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]);

export const AdminListUsersQuerySchema = z.object({
  q: z.string().min(1).optional(),
  isAdmin: stringBool.optional(),
  cursor: intLike.optional(),
  limit: intLike.default(50).optional(),
});
export type AdminListUsersQuery = z.infer<typeof AdminListUsersQuerySchema>;

export const AdminUpdateHouseholdSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    appealQuotaCount: z.number().int().min(0).max(1000).optional(),
    appealQuotaPeriod: z.enum(['monthly', 'quarterly']).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.appealQuotaCount !== undefined ||
      v.appealQuotaPeriod !== undefined,
    { message: 'at least one field required' },
  );
export type AdminUpdateHousehold = z.infer<typeof AdminUpdateHouseholdSchema>;

export const AdminAddHouseholdMemberSchema = z.object({
  userId: z.number().int().positive(),
  approvalMode: z.enum(['any', 'all']),
});
export type AdminAddHouseholdMember = z.infer<typeof AdminAddHouseholdMemberSchema>;

export const AdminUpdateHouseholdMemberSchema = z.object({
  approvalMode: z.enum(['any', 'all']),
});
export type AdminUpdateHouseholdMember = z.infer<typeof AdminUpdateHouseholdMemberSchema>;

export const AdminUpsertBuyerApproverSchema = z
  .object({
    buyerId: z.number().int().positive(),
    approverId: z.number().int().positive(),
  })
  .refine((v) => v.buyerId !== v.approverId, {
    message: 'buyer and approver must differ',
  });
export type AdminUpsertBuyerApprover = z.infer<typeof AdminUpsertBuyerApproverSchema>;

export const AdminListAppealsQuerySchema = z.object({
  status: z.enum(['pending', 'upheld', 'overturned']).optional(),
  householdId: intLike.optional(),
  periodKey: z.string().min(1).max(50).optional(),
  cursor: intLike.optional(),
  limit: intLike.default(50).optional(),
});
export type AdminListAppealsQuery = z.infer<typeof AdminListAppealsQuerySchema>;

export const AdminResolveAppealSchema = z.object({
  decision: z.enum(['overturn', 'uphold']),
});
export type AdminResolveAppeal = z.infer<typeof AdminResolveAppealSchema>;
```

If `packages/shared/src/schemas.ts` does not already import `zod` as `z`, add `import { z } from 'zod';` at the top.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/shared && pnpm test
```

Expected: PASS — all 10 new admin-schema tests green; existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat(shared): zod schemas for admin endpoints"
```

---

### Task A3: requireAdmin Fastify hook + admin route plugin shell

**Files:**
- Create: `apps/api/src/routes/admin/index.ts`
- Create: `apps/api/src/routes/admin/index.test.ts`
- Modify: `apps/api/src/buildApp.ts` (add `await app.register(adminRoutes);`)

- [ ] **Step 1: Write the failing test for requireAdmin**

Create `apps/api/src/routes/admin/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

describe('admin requireAdmin gate', () => {
  it('returns 401 without session on a placeholder admin route', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/_ping' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'not_authenticated' });
    } finally {
      await app.close();
    }
  });

  it('returns 403 for non-admin session', async () => {
    const user = await prisma.user.create({
      data: { oidcSubject: 'non-admin', name: 'Joe', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(user.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/_ping',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  it('returns 200 for admin session and exposes adminUser on request', async () => {
    const admin = await prisma.user.create({
      data: { oidcSubject: 'admin-1', name: 'Admin', isAdmin: true },
    });
    const { app, sessionCookie } = await buildTestApp(admin.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/_ping',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, adminId: admin.id });
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && pnpm test src/routes/admin/index.test.ts
```

Expected: FAIL — 404 on `/api/admin/_ping` because the admin plugin isn't registered yet.

- [ ] **Step 3: Implement the admin route plugin shell with the requireAdmin preHandler and a temporary `_ping` route**

Create `apps/api/src/routes/admin/index.ts`:

```ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface AdminUser {
  id: number;
  name: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    adminUser?: AdminUser;
  }
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    reply.code(401).send({ error: 'not_authenticated' });
    return;
  }
  const user = await req.server.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, isAdmin: true },
  });
  if (!user?.isAdmin) {
    reply.code(403).send({ error: 'forbidden' });
    return;
  }
  req.adminUser = user;
}

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // Temporary smoke endpoint, kept for monitoring. Returns the admin's id.
  app.get('/api/admin/_ping', async (req) => {
    return { ok: true, adminId: req.adminUser!.id };
  });

  // Sub-route registrations are added in subsequent tasks.
}
```

- [ ] **Step 4: Register adminRoutes in buildApp**

Modify `apps/api/src/buildApp.ts`. Find the block where existing routes are registered (e.g. `await app.register(feedbackRoutes);`) and add:

```ts
import adminRoutes from './routes/admin/index.js';
// ...
await app.register(adminRoutes);
```

Place the `await app.register(adminRoutes);` call AFTER the auth plugin registration and AFTER the other route registrations (order: plugins → routes → adminRoutes is fine).

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/index.test.ts
```

Expected: PASS — all 3 tests green.

- [ ] **Step 6: Run the full api test suite to ensure no regressions**

```bash
cd apps/api && pnpm test
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/index.ts apps/api/src/routes/admin/index.test.ts apps/api/src/buildApp.ts
git commit -m "feat(api): admin route plugin + requireAdmin preHandler"
```

---

### Task A4: AdminLayout + nested admin routes + RequireAdmin web guard

**Files:**
- Create: `apps/web/src/pages/admin/AdminLayout.tsx`
- Create: `apps/web/src/pages/admin/RequireAdmin.tsx`
- Create: `apps/web/src/pages/admin/AdminLayout.test.tsx`
- Modify: `apps/web/src/App.tsx` (replace the `/admin` stub)

- [ ] **Step 1: Write the failing test for AdminLayout + RequireAdmin behavior**

Create `apps/web/src/pages/admin/AdminLayout.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import RequireAdmin from './RequireAdmin';
import * as auth from '@/lib/auth';

vi.mock('@/lib/auth');
const useUserMock = vi.mocked(auth.useUser);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>Home</div>} />
        <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route path="people" element={<div>People Stub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAdmin + AdminLayout', () => {
  beforeEach(() => useUserMock.mockReset());

  it('redirects non-admin to home', () => {
    useUserMock.mockReturnValue({
      user: { id: 1, name: 'Joe', isAdmin: false },
      isLoading: false,
      error: null,
    });
    renderAt('/admin/people');
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('People Stub')).toBeNull();
  });

  it('shows sidebar links and child route when user is admin', () => {
    useUserMock.mockReturnValue({
      user: { id: 2, name: 'Admin', isAdmin: true },
      isLoading: false,
      error: null,
    });
    renderAt('/admin/people');
    expect(screen.getByText('People Stub')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /people/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /households/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /appeals/i })).toBeInTheDocument();
  });

  it('shows nothing (loading state) while user is loading', () => {
    useUserMock.mockReturnValue({ user: null, isLoading: true, error: null });
    renderAt('/admin/people');
    expect(screen.queryByText('Home')).toBeNull();
    expect(screen.queryByText('People Stub')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/AdminLayout.test.tsx
```

Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement RequireAdmin**

Create `apps/web/src/pages/admin/RequireAdmin.tsx`:

```tsx
import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useUser } from '@/lib/auth';

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser();
  if (isLoading) return null;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Implement AdminLayout**

Create `apps/web/src/pages/admin/AdminLayout.tsx`:

```tsx
import { NavLink, Outlet } from 'react-router-dom';

const sections = [
  { to: 'people', label: 'People' },
  { to: 'households', label: 'Households' },
  { to: 'appeals', label: 'Appeals' },
  // Feedback + Search added in PR 2
];

export default function AdminLayout() {
  return (
    <div className="flex gap-6 p-6">
      <nav className="w-48 shrink-0">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Admin
        </h2>
        <ul className="space-y-1">
          {sections.map((s) => (
            <li key={s.to}>
              <NavLink
                to={s.to}
                className={({ isActive }) =>
                  `block rounded px-2 py-1 text-sm ${
                    isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  }`
                }
              >
                {s.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Wire the nested routes in App.tsx**

Modify `apps/web/src/App.tsx`. Replace the existing single line:

```tsx
<Route path="admin" element={<div className="p-6">Admin (coming soon)</div>} />
```

with:

```tsx
<Route path="admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
  <Route index element={<Navigate to="people" replace />} />
  <Route path="people" element={<PeoplePage />} />
  <Route path="households" element={<HouseholdsPage />} />
  <Route path="appeals" element={<AdminAppealsPage />} />
</Route>
```

Add the corresponding imports at the top:

```tsx
import { Navigate } from 'react-router-dom';
import RequireAdmin from './pages/admin/RequireAdmin';
import AdminLayout from './pages/admin/AdminLayout';
import PeoplePage from './pages/admin/PeoplePage';
import HouseholdsPage from './pages/admin/HouseholdsPage';
import AdminAppealsPage from './pages/admin/AdminAppealsPage';
```

(The three page components are created later in this plan. The TypeScript compiler will error until those exist. The build will be broken between this task and Task B5 — that's intentional and OK because tests for AdminLayout don't import App.tsx. If you need to keep `pnpm build` passing on every commit, instead create minimal stub files for `PeoplePage.tsx`, `HouseholdsPage.tsx`, `AdminAppealsPage.tsx` here that just export a `() => <div>stub</div>` and overwrite them in their respective tasks.)

Recommended: create stubs now to keep CI green:

```tsx
// apps/web/src/pages/admin/PeoplePage.tsx
export default function PeoplePage() {
  return <div>People (stub)</div>;
}
```

Same for `HouseholdsPage.tsx` and `AdminAppealsPage.tsx`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/web && pnpm test src/pages/admin/AdminLayout.test.tsx
```

Expected: PASS — all 3 tests green.

- [ ] **Step 7: Run web build + full web tests**

```bash
cd apps/web && pnpm run build && pnpm test
```

Expected: build succeeds; all tests green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/admin/AdminLayout.tsx \
        apps/web/src/pages/admin/RequireAdmin.tsx \
        apps/web/src/pages/admin/AdminLayout.test.tsx \
        apps/web/src/pages/admin/PeoplePage.tsx \
        apps/web/src/pages/admin/HouseholdsPage.tsx \
        apps/web/src/pages/admin/AdminAppealsPage.tsx \
        apps/web/src/App.tsx
git commit -m "feat(web): admin layout + nested routes + RequireAdmin guard"
```

---

### Task A5: Shared DataTable component

**Files:**
- Create: `apps/web/src/pages/admin/components/DataTable.tsx`
- Create: `apps/web/src/pages/admin/components/DataTable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/admin/components/DataTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable, { type Column } from './DataTable';

type Row = { id: number; name: string; count: number };

const sample: Row[] = [
  { id: 1, name: 'Alpha', count: 3 },
  { id: 2, name: 'Beta', count: 7 },
];

const cols: Column<Row>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name },
  { key: 'count', header: 'Count', render: (r) => String(r.count) },
];

describe('DataTable', () => {
  it('renders headers and rows', () => {
    render(<DataTable<Row> rows={sample} columns={cols} rowKey={(r) => r.id} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows empty state when rows is empty', () => {
    render(<DataTable<Row> rows={[]} columns={cols} rowKey={(r) => r.id} />);
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('shows loading state when isLoading', () => {
    render(<DataTable<Row> rows={[]} columns={cols} rowKey={(r) => r.id} isLoading />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('calls onRowClick when a row is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <DataTable<Row>
        rows={sample}
        columns={cols}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Alpha'));
    expect(onRowClick).toHaveBeenCalledWith(sample[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/components/DataTable.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement DataTable**

Create `apps/web/src/pages/admin/components/DataTable.tsx`:

```tsx
import { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  isLoading,
  emptyMessage = 'No results.',
  onRowClick,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="rounded border border-border p-8 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded border border-border p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="px-3 py-2 text-left font-medium text-muted-foreground"
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={
                onRowClick
                  ? 'cursor-pointer border-t border-border hover:bg-accent/30'
                  : 'border-t border-border'
              }
            >
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 align-top">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm test src/pages/admin/components/DataTable.test.tsx
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/components/DataTable.tsx apps/web/src/pages/admin/components/DataTable.test.tsx
git commit -m "feat(web): shared DataTable component for admin lists"
```

---

### Task A6: Shared DetailDrawer component (wraps shadcn Sheet)

**Files:**
- Create: `apps/web/src/pages/admin/components/DetailDrawer.tsx`
- Create: `apps/web/src/pages/admin/components/DetailDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/admin/components/DetailDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailDrawer from './DetailDrawer';

describe('DetailDrawer', () => {
  it('renders nothing when not open', () => {
    render(
      <DetailDrawer open={false} onClose={() => {}} title="X">
        <div>Body</div>
      </DetailDrawer>,
    );
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('renders title and body when open', () => {
    render(
      <DetailDrawer open onClose={() => {}} title="Profile">
        <div>Body content</div>
      </DetailDrawer>,
    );
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <DetailDrawer open onClose={onClose} title="X">
        <div>Body</div>
      </DetailDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/components/DetailDrawer.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement DetailDrawer**

Create `apps/web/src/pages/admin/components/DetailDrawer.tsx`:

```tsx
import { ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function DetailDrawer({ open, onClose, title, children }: DetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="mt-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm test src/pages/admin/components/DetailDrawer.test.tsx
```

Expected: PASS — all 3 tests green. (shadcn Sheet renders an accessible "Close" button via the bundled SheetClose; `getByRole('button', { name: /close/i })` should find it.)

If the close button name doesn't match, adjust the test selector to whatever shadcn's Sheet exposes (inspect via `screen.debug()`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/components/DetailDrawer.tsx apps/web/src/pages/admin/components/DetailDrawer.test.tsx
git commit -m "feat(web): DetailDrawer (shadcn Sheet wrapper) for admin drawers"
```

---

## Phase B — People section

### Task B1: GET /api/admin/users (list endpoint)

**Files:**
- Create: `apps/api/src/routes/admin/users.ts`
- Create: `apps/api/src/routes/admin/users.test.ts`
- Modify: `apps/api/src/routes/admin/index.ts` (register users sub-routes)

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/routes/admin/users.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'admin-x', name: 'Admin User', isAdmin: true },
  });
  const session = await buildTestApp(admin.id);
  return { admin, ...session };
}

describe('GET /api/admin/users', () => {
  it('returns 401 without session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 for non-admin caller', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'u', name: 'Plain', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('lists all users with household name and isAdmin flag', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const household = await prisma.household.create({
        data: { name: 'The Smiths', appealQuotaCount: 3, appealQuotaPeriod: 'monthly' },
      });
      const userA = await prisma.user.create({
        data: { oidcSubject: 'a', name: 'Alice', isAdmin: false },
      });
      await prisma.householdMember.create({
        data: { userId: userA.id, householdId: household.id, approvalMode: 'any' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.users).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Alice', isAdmin: false, householdName: 'The Smiths' }),
          expect.objectContaining({ name: 'Admin User', isAdmin: true, householdName: null }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('filters by isAdmin=true', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      await prisma.user.create({ data: { oidcSubject: 'x', name: 'X', isAdmin: false } });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users?isAdmin=true',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.users.every((u: { isAdmin: boolean }) => u.isAdmin)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('searches by name (case-insensitive substring)', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      await prisma.user.create({ data: { oidcSubject: 'g', name: 'Gladis Nevarez', isAdmin: false } });
      await prisma.user.create({ data: { oidcSubject: 'l', name: 'Luke Jones-Thomas', isAdmin: false } });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users?q=gladis',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.users).toHaveLength(1);
      expect(body.users[0].name).toBe('Gladis Nevarez');
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: FAIL — `/api/admin/users` not registered.

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/admin/users.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { AdminListUsersQuerySchema } from '@two-cents/shared';

export default async function adminUsersRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', async (req) => {
    const query = AdminListUsersQuerySchema.parse(req.query ?? {});
    const limit = query.limit ?? 50;

    const where = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      ...(query.isAdmin !== undefined ? { isAdmin: query.isAdmin } : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };

    const users = await app.prisma.user.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        oidcSubject: true,
        name: true,
        isAdmin: true,
        createdAt: true,
        memberships: {
          select: {
            household: { select: { id: true, name: true } },
          },
          take: 1,
        },
      },
    });

    const hasMore = users.length > limit;
    const slice = hasMore ? users.slice(0, limit) : users;
    return {
      users: slice.map((u) => ({
        id: u.id,
        oidcSubject: u.oidcSubject,
        name: u.name,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt,
        householdId: u.memberships[0]?.household.id ?? null,
        householdName: u.memberships[0]?.household.name ?? null,
      })),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  });
}
```

- [ ] **Step 4: Register adminUsersRoutes inside the admin plugin**

Modify `apps/api/src/routes/admin/index.ts`. Add the import and register call inside `adminRoutes`:

```ts
import adminUsersRoutes from './users.js';
// ... at end of adminRoutes function body, after the _ping route:
await app.register(adminUsersRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/users.ts apps/api/src/routes/admin/users.test.ts apps/api/src/routes/admin/index.ts
git commit -m "feat(api): GET /api/admin/users list endpoint"
```

---

### Task B2: GET /api/admin/users/:id/detail

**Files:**
- Modify: `apps/api/src/routes/admin/users.ts` (add handler)
- Modify: `apps/api/src/routes/admin/users.test.ts` (add tests)

- [ ] **Step 1: Append failing tests**

Add to `apps/api/src/routes/admin/users.test.ts`:

```ts
describe('GET /api/admin/users/:id/detail', () => {
  it('returns 404 for unknown user id', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users/99999/detail',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  it('returns user profile + household + recent requests/comments/push/log', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const household = await prisma.household.create({
        data: { name: 'Casa', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const user = await prisma.user.create({
        data: { oidcSubject: 'u-detail', name: 'Detail User', isAdmin: false },
      });
      const member = await prisma.householdMember.create({
        data: { userId: user.id, householdId: household.id, approvalMode: 'any' },
      });
      const req1 = await prisma.request.create({
        data: {
          householdId: household.id,
          buyerId: member.id,
          title: 'A request',
          status: 'pending',
          priceCents: 5000,
        },
      });
      await prisma.comment.create({
        data: { requestId: req1.id, authorMemberId: member.id, body: 'a comment' },
      });
      await prisma.pushSubscription.create({
        data: { userId: user.id, endpoint: 'https://x/1', p256dh: 'p', auth: 'a' },
      });
      await prisma.notificationLog.create({
        data: { userId: user.id, eventKey: 'request.created' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${user.id}/detail`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user).toMatchObject({ id: user.id, name: 'Detail User', isAdmin: false });
      expect(body.household).toMatchObject({ id: household.id, name: 'Casa', approvalMode: 'any' });
      expect(body.requests).toHaveLength(1);
      expect(body.requests[0]).toMatchObject({ title: 'A request' });
      expect(body.comments).toHaveLength(1);
      expect(body.pushSubscriptions).toHaveLength(1);
      expect(body.notificationLogs).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: FAIL — `/api/admin/users/:id/detail` not registered (404 on the second test will pass coincidentally, but the third test fails).

- [ ] **Step 3: Add the detail handler**

Append to the `adminUsersRoutes` function body in `apps/api/src/routes/admin/users.ts`:

```ts
app.get<{ Params: { id: string } }>('/api/admin/users/:id/detail', async (req, reply) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) {
    return reply.code(400).send({ error: 'invalid_id' });
  }

  const user = await app.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, oidcSubject: true, name: true, isAdmin: true, createdAt: true },
  });
  if (!user) {
    return reply.code(404).send({ error: 'not_found' });
  }

  const membership = await app.prisma.householdMember.findFirst({
    where: { userId },
    select: {
      id: true,
      approvalMode: true,
      joinedAt: true,
      household: { select: { id: true, name: true } },
    },
  });

  const [requests, comments, pushSubs, logs] = await Promise.all([
    membership
      ? app.prisma.request.findMany({
          where: { buyerId: membership.id },
          orderBy: { id: 'desc' },
          take: 20,
          select: { id: true, title: true, status: true, priceCents: true, createdAt: true },
        })
      : Promise.resolve([]),
    membership
      ? app.prisma.comment.findMany({
          where: { authorMemberId: membership.id },
          orderBy: { id: 'desc' },
          take: 20,
          select: { id: true, requestId: true, body: true, createdAt: true },
        })
      : Promise.resolve([]),
    app.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      select: { id: true, endpoint: true, createdAt: true },
    }),
    app.prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      take: 50,
      select: { id: true, eventKey: true, sentAt: true },
    }),
  ]);

  return {
    user,
    household: membership
      ? {
          id: membership.household.id,
          name: membership.household.name,
          memberId: membership.id,
          approvalMode: membership.approvalMode,
          joinedAt: membership.joinedAt,
        }
      : null,
    requests,
    comments,
    pushSubscriptions: pushSubs,
    notificationLogs: logs,
  };
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/users.ts apps/api/src/routes/admin/users.test.ts
git commit -m "feat(api): GET /api/admin/users/:id/detail (drawer payload)"
```

---

### Task B3: POST /api/admin/users/:id/test-push

**Files:**
- Modify: `apps/api/src/routes/admin/users.ts`
- Modify: `apps/api/src/routes/admin/users.test.ts`

This task assumes the existing push-send helper lives somewhere like `apps/api/src/services/push.ts` exporting `sendPushToUser(userId, payload)`. If a different helper exists (e.g. `webpush.sendNotification`), substitute the actual path/function in step 3 and use the same mock pattern.

- [ ] **Step 1: Find the existing push-send helper**

```bash
grep -rEn "web-push|sendNotification|sendPush" apps/api/src --include="*.ts" | head -10
```

Note the helper module and exported function. Use those names below.

- [ ] **Step 2: Append failing tests**

Add to `apps/api/src/routes/admin/users.test.ts` (adjust the mocked module path to match step 1):

```ts
import { vi } from 'vitest';

// Adjust the path to the push-send module discovered in step 1.
vi.mock('../../services/push.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/push.js')>();
  return { ...actual, sendPushToUser: vi.fn() };
});
import { sendPushToUser } from '../../services/push.js';
const sendPushMock = vi.mocked(sendPushToUser);

describe('POST /api/admin/users/:id/test-push', () => {
  it('returns 404 if user does not exist', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/99999/test-push',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with delivery counts when user has subscriptions', async () => {
    sendPushMock.mockReset();
    sendPushMock.mockResolvedValue({ sent: 2, failed: 1, errors: ['410 Gone'] });
    const { app, sessionCookie } = await seedAdmin();
    try {
      const user = await prisma.user.create({
        data: { oidcSubject: 'p', name: 'Push', isAdmin: false },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${user.id}/test-push`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ sent: 2, failed: 1, errors: ['410 Gone'] });
      expect(sendPushMock).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ title: expect.any(String), body: expect.any(String) }),
      );
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: FAIL — test-push endpoint not registered.

- [ ] **Step 4: Add the handler**

Append to the `adminUsersRoutes` function body in `apps/api/src/routes/admin/users.ts`:

```ts
import { sendPushToUser } from '../../services/push.js'; // adjust import path
```

```ts
app.post<{ Params: { id: string } }>(
  '/api/admin/users/:id/test-push',
  async (req, reply) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'invalid_id' });
    const user = await app.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return reply.code(404).send({ error: 'not_found' });

    const result = await sendPushToUser(userId, {
      title: 'Test push from admin',
      body: 'If you can see this, push delivery is working.',
    });
    return result;
  },
);
```

If the existing push-send function has a different signature, adapt: the result should always include `sent: number; failed: number; errors?: string[]`. If the helper doesn't return that shape, wrap the call: collect `Promise.allSettled` over the user's subscriptions, build the counts here.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/users.ts apps/api/src/routes/admin/users.test.ts
git commit -m "feat(api): POST /api/admin/users/:id/test-push"
```

---

### Task B4: DELETE /api/admin/users/:id/push-subscriptions

**Files:**
- Modify: `apps/api/src/routes/admin/users.ts`
- Modify: `apps/api/src/routes/admin/users.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('DELETE /api/admin/users/:id/push-subscriptions', () => {
  it('returns 404 for unknown user', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/users/99999/push-subscriptions',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('deletes all push subscriptions for the user and returns count', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const user = await prisma.user.create({
        data: { oidcSubject: 'd', name: 'Del', isAdmin: false },
      });
      await prisma.pushSubscription.createMany({
        data: [
          { userId: user.id, endpoint: 'https://x/1', p256dh: 'p', auth: 'a' },
          { userId: user.id, endpoint: 'https://x/2', p256dh: 'p', auth: 'a' },
        ],
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${user.id}/push-subscriptions`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ deleted: 2 });
      const remaining = await prisma.pushSubscription.count({ where: { userId: user.id } });
      expect(remaining).toBe(0);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: FAIL — endpoint not registered.

- [ ] **Step 3: Add the handler**

Append to the `adminUsersRoutes` function body:

```ts
app.delete<{ Params: { id: string } }>(
  '/api/admin/users/:id/push-subscriptions',
  async (req, reply) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'invalid_id' });
    const user = await app.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    const { count } = await app.prisma.pushSubscription.deleteMany({ where: { userId } });
    return { deleted: count };
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/users.ts apps/api/src/routes/admin/users.test.ts
git commit -m "feat(api): DELETE /api/admin/users/:id/push-subscriptions"
```

---

### Task B5: Web — PeoplePage list + PeopleDetail drawer

**Files:**
- Overwrite: `apps/web/src/pages/admin/PeoplePage.tsx` (replacing stub from A4)
- Create: `apps/web/src/pages/admin/PeopleDetail.tsx`
- Create: `apps/web/src/pages/admin/PeoplePage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/admin/PeoplePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PeoplePage from './PeoplePage';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: requestMock };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PeoplePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('PeoplePage', () => {
  it('renders fetched users in a table', async () => {
    requestMock.mockResolvedValueOnce({
      users: [
        { id: 1, name: 'Alice', isAdmin: false, householdName: 'Casa', createdAt: '2026-01-01' },
        { id: 2, name: 'Bob', isAdmin: true, householdName: null, createdAt: '2026-01-02' },
      ],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Casa')).toBeInTheDocument();
  });

  it('opens detail drawer with second fetch when a row is clicked', async () => {
    requestMock
      .mockResolvedValueOnce({
        users: [{ id: 1, name: 'Alice', isAdmin: false, householdName: null, createdAt: '2026-01-01' }],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        user: { id: 1, name: 'Alice', oidcSubject: 'a', isAdmin: false, createdAt: '2026-01-01' },
        household: null,
        requests: [],
        comments: [],
        pushSubscriptions: [],
        notificationLogs: [],
      });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alice'));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/api/admin/users/1/detail');
    });
  });

  it('filters by name via the search input', async () => {
    requestMock.mockResolvedValue({ users: [], nextCursor: null });
    renderPage();
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'gladis' } });
    await waitFor(() => {
      expect(requestMock).toHaveBeenLastCalledWith(
        expect.stringContaining('q=gladis'),
      );
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/PeoplePage.test.tsx
```

Expected: FAIL — module doesn't yet do the real thing (it's still the stub from A4).

- [ ] **Step 3: Implement PeoplePage**

Overwrite `apps/web/src/pages/admin/PeoplePage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import DataTable, { type Column } from './components/DataTable';
import PeopleDetail from './PeopleDetail';

interface UserRow {
  id: number;
  name: string;
  isAdmin: boolean;
  householdName: string | null;
  createdAt: string;
}

interface ListResponse {
  users: UserRow[];
  nextCursor: number | null;
}

export default function PeoplePage() {
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: () => request<ListResponse>(`/api/admin/users?${params.toString()}`),
  });

  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'household', header: 'Household', render: (r) => r.householdName ?? '—' },
    {
      key: 'isAdmin',
      header: 'Role',
      render: (r) => (r.isAdmin ? <Badge>Admin</Badge> : <span className="text-muted-foreground">user</span>),
    },
    {
      key: 'createdAt',
      header: 'Joined',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">People</h1>
      <Input
        type="search"
        placeholder="Search by name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-sm"
      />
      <DataTable<UserRow>
        rows={data?.users ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => setSelectedId(r.id)}
      />
      <PeopleDetail userId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Implement PeopleDetail**

Create `apps/web/src/pages/admin/PeopleDetail.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DetailDrawer from './components/DetailDrawer';

interface DetailResponse {
  user: { id: number; name: string; oidcSubject: string; isAdmin: boolean; createdAt: string };
  household: { id: number; name: string; memberId: number; approvalMode: string; joinedAt: string } | null;
  requests: Array<{ id: number; title: string; status: string; createdAt: string }>;
  comments: Array<{ id: number; requestId: number; body: string; createdAt: string }>;
  pushSubscriptions: Array<{ id: number; endpoint: string; createdAt: string }>;
  notificationLogs: Array<{ id: number; eventKey: string; sentAt: string }>;
}

export default function PeopleDetail({
  userId,
  onClose,
}: {
  userId: number | null;
  onClose: () => void;
}) {
  const open = userId !== null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'detail'],
    queryFn: () => request<DetailResponse>(`/api/admin/users/${userId}/detail`),
    enabled: open,
  });

  const testPush = useMutation({
    mutationFn: () => request(`/api/admin/users/${userId}/test-push`, { method: 'POST' }),
  });

  const deletePush = useMutation({
    mutationFn: () => request(`/api/admin/users/${userId}/push-subscriptions`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'detail'] });
    },
  });

  const title = data?.user?.name ?? (open ? 'Loading…' : '');

  return (
    <DetailDrawer open={open} onClose={onClose} title={title}>
      {isLoading || !data ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6 text-sm">
          <section>
            <div className="text-muted-foreground">Profile</div>
            <div className="mt-1">
              <span className="font-medium">{data.user.name}</span>{' '}
              {data.user.isAdmin && <Badge>Admin</Badge>}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              oidc: {data.user.oidcSubject}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Name + admin status are synced from Authentik on each login.
            </p>
          </section>

          <section>
            <div className="mb-1 text-muted-foreground">Household</div>
            {data.household ? (
              <div>
                {data.household.name} <Badge variant="outline">{data.household.approvalMode}</Badge>
              </div>
            ) : (
              <div className="text-muted-foreground">No household</div>
            )}
          </section>

          <section>
            <div className="mb-1 text-muted-foreground">Recent requests ({data.requests.length})</div>
            <ul className="space-y-1">
              {data.requests.map((r) => (
                <li key={r.id}>
                  #{r.id} — {r.title} <Badge variant="outline">{r.status}</Badge>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="mb-1 text-muted-foreground">
              Push subscriptions ({data.pushSubscriptions.length})
            </div>
            <ul className="space-y-1">
              {data.pushSubscriptions.map((s) => (
                <li key={s.id} className="truncate text-xs">{s.endpoint}</li>
              ))}
            </ul>
          </section>

          <section>
            <div className="mb-1 text-muted-foreground">
              Notification log (last {data.notificationLogs.length})
            </div>
            <ul className="space-y-1 text-xs">
              {data.notificationLogs.map((l) => (
                <li key={l.id}>
                  {l.eventKey} — {new Date(l.sentAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-wrap gap-2 border-t pt-4">
            <Button size="sm" onClick={() => testPush.mutate()} disabled={testPush.isPending}>
              {testPush.isPending ? 'Sending…' : 'Send test push'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deletePush.mutate()}
              disabled={deletePush.isPending || data.pushSubscriptions.length === 0}
            >
              Delete all push subs
            </Button>
          </section>
        </div>
      )}
    </DetailDrawer>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/web && pnpm test src/pages/admin/PeoplePage.test.tsx
```

Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/PeoplePage.tsx \
        apps/web/src/pages/admin/PeopleDetail.tsx \
        apps/web/src/pages/admin/PeoplePage.test.tsx
git commit -m "feat(web): admin People page + detail drawer with test push + delete subs"
```

---

## Phase C — Households section

### Task C1: GET /api/admin/households

**Files:**
- Create: `apps/api/src/routes/admin/households.ts`
- Create: `apps/api/src/routes/admin/households.test.ts`
- Modify: `apps/api/src/routes/admin/index.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/routes/admin/households.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'a', name: 'A', isAdmin: true },
  });
  return { admin, ...(await buildTestApp(admin.id)) };
}

describe('GET /api/admin/households', () => {
  it('returns 403 for non-admin', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'u', name: 'U', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/households',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns households with member counts', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'A House', appealQuotaCount: 2, appealQuotaPeriod: 'monthly' },
      });
      const u = await prisma.user.create({
        data: { oidcSubject: 'x', name: 'X', isAdmin: false },
      });
      await prisma.householdMember.create({
        data: { userId: u.id, householdId: h.id, approvalMode: 'any' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/households',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.households).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: h.id,
            name: 'A House',
            appealQuotaCount: 2,
            appealQuotaPeriod: 'monthly',
            memberCount: 1,
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/admin/households.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import {
  AdminUpdateHouseholdSchema,
  AdminAddHouseholdMemberSchema,
  AdminUpdateHouseholdMemberSchema,
  AdminUpsertBuyerApproverSchema,
} from '@two-cents/shared';

export default async function adminHouseholdsRoutes(app: FastifyInstance) {
  app.get('/api/admin/households', async () => {
    const households = await app.prisma.household.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        appealQuotaCount: true,
        appealQuotaPeriod: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
    });
    return {
      households: households.map((h) => ({
        id: h.id,
        name: h.name,
        appealQuotaCount: h.appealQuotaCount,
        appealQuotaPeriod: h.appealQuotaPeriod,
        createdAt: h.createdAt,
        memberCount: h._count.members,
      })),
    };
  });
}
```

If your Prisma `Household` model's members relation isn't named `members`, adjust the `_count` selector to match.

- [ ] **Step 4: Register adminHouseholdsRoutes in the admin plugin**

Modify `apps/api/src/routes/admin/index.ts` — add after the users registration:

```ts
import adminHouseholdsRoutes from './households.js';
// ...
await app.register(adminHouseholdsRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/households.ts apps/api/src/routes/admin/households.test.ts apps/api/src/routes/admin/index.ts
git commit -m "feat(api): GET /api/admin/households"
```

---

### Task C2: PATCH /api/admin/households/:id

**Files:**
- Modify: `apps/api/src/routes/admin/households.ts`
- Modify: `apps/api/src/routes/admin/households.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('PATCH /api/admin/households/:id', () => {
  it('updates name, quota count, and period', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'Old', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/households/${h.id}`,
        headers: { cookie: sessionCookie },
        payload: { name: 'New', appealQuotaCount: 5, appealQuotaPeriod: 'quarterly' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().household).toMatchObject({
        name: 'New',
        appealQuotaCount: 5,
        appealQuotaPeriod: 'quarterly',
      });
    } finally {
      await app.close();
    }
  });

  it('returns 400 when no fields supplied', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'X', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/households/${h.id}`,
        headers: { cookie: sessionCookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 404 for unknown id', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/households/99999',
        headers: { cookie: sessionCookie },
        payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the PATCH handler**

Append to `adminHouseholdsRoutes`:

```ts
app.patch<{ Params: { id: string } }>('/api/admin/households/:id', async (req, reply) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
  const body = AdminUpdateHouseholdSchema.parse(req.body);
  const existing = await app.prisma.household.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return reply.code(404).send({ error: 'not_found' });
  const household = await app.prisma.household.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.appealQuotaCount !== undefined ? { appealQuotaCount: body.appealQuotaCount } : {}),
      ...(body.appealQuotaPeriod !== undefined ? { appealQuotaPeriod: body.appealQuotaPeriod } : {}),
    },
    select: {
      id: true,
      name: true,
      appealQuotaCount: true,
      appealQuotaPeriod: true,
      createdAt: true,
    },
  });
  return { household };
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/households.ts apps/api/src/routes/admin/households.test.ts
git commit -m "feat(api): PATCH /api/admin/households/:id (edit name + quota)"
```

---

### Task C3: POST /api/admin/households/:id/members

**Files:**
- Modify: `apps/api/src/routes/admin/households.ts`
- Modify: `apps/api/src/routes/admin/households.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('POST /api/admin/households/:id/members', () => {
  it('adds a user to a household with the given approval mode', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u = await prisma.user.create({
        data: { oidcSubject: 'new', name: 'New', isAdmin: false },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/households/${h.id}/members`,
        headers: { cookie: sessionCookie },
        payload: { userId: u.id, approvalMode: 'all' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().member).toMatchObject({
        userId: u.id,
        householdId: h.id,
        approvalMode: 'all',
      });
    } finally {
      await app.close();
    }
  });

  it('returns 409 if the user is already a member of any household', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h1 = await prisma.household.create({
        data: { name: 'H1', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const h2 = await prisma.household.create({
        data: { name: 'H2', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u = await prisma.user.create({
        data: { oidcSubject: 'dup', name: 'Dup', isAdmin: false },
      });
      await prisma.householdMember.create({
        data: { userId: u.id, householdId: h1.id, approvalMode: 'any' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/households/${h2.id}/members`,
        headers: { cookie: sessionCookie },
        payload: { userId: u.id, approvalMode: 'any' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'already_member' });
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the POST handler**

Append:

```ts
app.post<{ Params: { id: string } }>(
  '/api/admin/households/:id/members',
  async (req, reply) => {
    const householdId = Number(req.params.id);
    if (!Number.isFinite(householdId)) return reply.code(400).send({ error: 'invalid_id' });
    const body = AdminAddHouseholdMemberSchema.parse(req.body);

    const household = await app.prisma.household.findUnique({
      where: { id: householdId },
      select: { id: true },
    });
    if (!household) return reply.code(404).send({ error: 'not_found' });

    const existing = await app.prisma.householdMember.findFirst({
      where: { userId: body.userId },
      select: { id: true },
    });
    if (existing) return reply.code(409).send({ error: 'already_member' });

    const member = await app.prisma.householdMember.create({
      data: {
        householdId,
        userId: body.userId,
        approvalMode: body.approvalMode,
      },
      select: {
        id: true,
        userId: true,
        householdId: true,
        approvalMode: true,
        joinedAt: true,
      },
    });
    return reply.code(201).send({ member });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/households.ts apps/api/src/routes/admin/households.test.ts
git commit -m "feat(api): POST /api/admin/households/:id/members"
```

---

### Task C4: PATCH /api/admin/household-members/:id and DELETE /api/admin/household-members/:id

**Files:**
- Modify: `apps/api/src/routes/admin/households.ts`
- Modify: `apps/api/src/routes/admin/households.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('PATCH /api/admin/household-members/:id', () => {
  it('updates approvalMode', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u = await prisma.user.create({
        data: { oidcSubject: 'u', name: 'U', isAdmin: false },
      });
      const m = await prisma.householdMember.create({
        data: { userId: u.id, householdId: h.id, approvalMode: 'any' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/household-members/${m.id}`,
        headers: { cookie: sessionCookie },
        payload: { approvalMode: 'all' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().member.approvalMode).toBe('all');
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /api/admin/household-members/:id', () => {
  it('removes the member and cascades buyer-approver rows', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u1 = await prisma.user.create({ data: { oidcSubject: 'a', name: 'A', isAdmin: false } });
      const u2 = await prisma.user.create({ data: { oidcSubject: 'b', name: 'B', isAdmin: false } });
      const m1 = await prisma.householdMember.create({
        data: { userId: u1.id, householdId: h.id, approvalMode: 'any' },
      });
      const m2 = await prisma.householdMember.create({
        data: { userId: u2.id, householdId: h.id, approvalMode: 'any' },
      });
      await prisma.buyerApprover.create({ data: { buyerId: m1.id, approverId: m2.id } });
      await prisma.buyerApprover.create({ data: { buyerId: m2.id, approverId: m1.id } });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/household-members/${m1.id}`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ deleted: 1 });
      const remainingMembers = await prisma.householdMember.count({ where: { id: m1.id } });
      expect(remainingMembers).toBe(0);
      const remainingPairs = await prisma.buyerApprover.count({
        where: { OR: [{ buyerId: m1.id }, { approverId: m1.id }] },
      });
      expect(remainingPairs).toBe(0);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the handlers**

Append to `adminHouseholdsRoutes`:

```ts
app.patch<{ Params: { id: string } }>(
  '/api/admin/household-members/:id',
  async (req, reply) => {
    const memberId = Number(req.params.id);
    if (!Number.isFinite(memberId)) return reply.code(400).send({ error: 'invalid_id' });
    const body = AdminUpdateHouseholdMemberSchema.parse(req.body);
    const existing = await app.prisma.householdMember.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const member = await app.prisma.householdMember.update({
      where: { id: memberId },
      data: { approvalMode: body.approvalMode },
      select: { id: true, userId: true, householdId: true, approvalMode: true, joinedAt: true },
    });
    return { member };
  },
);

app.delete<{ Params: { id: string } }>(
  '/api/admin/household-members/:id',
  async (req, reply) => {
    const memberId = Number(req.params.id);
    if (!Number.isFinite(memberId)) return reply.code(400).send({ error: 'invalid_id' });
    const existing = await app.prisma.householdMember.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await app.prisma.$transaction([
      app.prisma.buyerApprover.deleteMany({
        where: { OR: [{ buyerId: memberId }, { approverId: memberId }] },
      }),
      app.prisma.householdMember.delete({ where: { id: memberId } }),
    ]);
    return { deleted: 1 };
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/households.ts apps/api/src/routes/admin/households.test.ts
git commit -m "feat(api): PATCH+DELETE /api/admin/household-members/:id"
```

---

### Task C5: PUT /api/admin/buyer-approvers and DELETE /api/admin/buyer-approvers/:id

**Files:**
- Modify: `apps/api/src/routes/admin/households.ts`
- Modify: `apps/api/src/routes/admin/households.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('PUT /api/admin/buyer-approvers', () => {
  it('creates a buyer-approver pair', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u1 = await prisma.user.create({ data: { oidcSubject: 'a', name: 'A', isAdmin: false } });
      const u2 = await prisma.user.create({ data: { oidcSubject: 'b', name: 'B', isAdmin: false } });
      const m1 = await prisma.householdMember.create({
        data: { userId: u1.id, householdId: h.id, approvalMode: 'any' },
      });
      const m2 = await prisma.householdMember.create({
        data: { userId: u2.id, householdId: h.id, approvalMode: 'any' },
      });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/buyer-approvers',
        headers: { cookie: sessionCookie },
        payload: { buyerId: m1.id, approverId: m2.id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().buyerApprover).toMatchObject({ buyerId: m1.id, approverId: m2.id });
    } finally {
      await app.close();
    }
  });

  it('is idempotent — returns the existing row when pair exists', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u1 = await prisma.user.create({ data: { oidcSubject: 'a', name: 'A', isAdmin: false } });
      const u2 = await prisma.user.create({ data: { oidcSubject: 'b', name: 'B', isAdmin: false } });
      const m1 = await prisma.householdMember.create({
        data: { userId: u1.id, householdId: h.id, approvalMode: 'any' },
      });
      const m2 = await prisma.householdMember.create({
        data: { userId: u2.id, householdId: h.id, approvalMode: 'any' },
      });
      const existing = await prisma.buyerApprover.create({
        data: { buyerId: m1.id, approverId: m2.id },
      });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/buyer-approvers',
        headers: { cookie: sessionCookie },
        payload: { buyerId: m1.id, approverId: m2.id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().buyerApprover.id).toBe(existing.id);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when buyerId === approverId', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/buyer-approvers',
        headers: { cookie: sessionCookie },
        payload: { buyerId: 1, approverId: 1 },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /api/admin/buyer-approvers/:id', () => {
  it('removes the row', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const u1 = await prisma.user.create({ data: { oidcSubject: 'a', name: 'A', isAdmin: false } });
      const u2 = await prisma.user.create({ data: { oidcSubject: 'b', name: 'B', isAdmin: false } });
      const m1 = await prisma.householdMember.create({
        data: { userId: u1.id, householdId: h.id, approvalMode: 'any' },
      });
      const m2 = await prisma.householdMember.create({
        data: { userId: u2.id, householdId: h.id, approvalMode: 'any' },
      });
      const ba = await prisma.buyerApprover.create({
        data: { buyerId: m1.id, approverId: m2.id },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/buyer-approvers/${ba.id}`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const remaining = await prisma.buyerApprover.count({ where: { id: ba.id } });
      expect(remaining).toBe(0);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the handlers**

Append to `adminHouseholdsRoutes`:

```ts
app.put('/api/admin/buyer-approvers', async (req, reply) => {
  const body = AdminUpsertBuyerApproverSchema.parse(req.body);
  const existing = await app.prisma.buyerApprover.findFirst({
    where: { buyerId: body.buyerId, approverId: body.approverId },
    select: { id: true, buyerId: true, approverId: true },
  });
  if (existing) return { buyerApprover: existing };
  const created = await app.prisma.buyerApprover.create({
    data: { buyerId: body.buyerId, approverId: body.approverId },
    select: { id: true, buyerId: true, approverId: true },
  });
  return { buyerApprover: created };
});

app.delete<{ Params: { id: string } }>(
  '/api/admin/buyer-approvers/:id',
  async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const existing = await app.prisma.buyerApprover.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await app.prisma.buyerApprover.delete({ where: { id } });
    return { deleted: 1 };
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/households.ts apps/api/src/routes/admin/households.test.ts
git commit -m "feat(api): PUT/DELETE /api/admin/buyer-approvers"
```

---

### Task C6: Web — HouseholdsPage list

**Files:**
- Overwrite: `apps/web/src/pages/admin/HouseholdsPage.tsx`
- Create: `apps/web/src/pages/admin/HouseholdsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/admin/HouseholdsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HouseholdsPage from './HouseholdsPage';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: requestMock };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HouseholdsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('HouseholdsPage', () => {
  it('lists households with member counts', async () => {
    requestMock.mockResolvedValueOnce({
      households: [
        {
          id: 1,
          name: 'Casa',
          appealQuotaCount: 3,
          appealQuotaPeriod: 'monthly',
          memberCount: 4,
          createdAt: '2026-01-01',
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/3 \/ monthly/)).toBeInTheDocument();
  });

  it('opens drawer on row click', async () => {
    requestMock
      .mockResolvedValueOnce({
        households: [{
          id: 1, name: 'Casa', appealQuotaCount: 3, appealQuotaPeriod: 'monthly',
          memberCount: 1, createdAt: '2026-01-01',
        }],
      })
      .mockResolvedValueOnce({
        // detail response — see HouseholdDetail in next task
        household: {
          id: 1, name: 'Casa', appealQuotaCount: 3, appealQuotaPeriod: 'monthly',
        },
        members: [],
        buyerApprovers: [],
      });
    renderPage();
    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Casa'));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/api/admin/households/1/detail');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/HouseholdsPage.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement HouseholdsPage**

Overwrite `apps/web/src/pages/admin/HouseholdsPage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import DataTable, { type Column } from './components/DataTable';
import HouseholdDetail from './HouseholdDetail';

interface HouseholdRow {
  id: number;
  name: string;
  appealQuotaCount: number;
  appealQuotaPeriod: 'monthly' | 'quarterly';
  memberCount: number;
  createdAt: string;
}

interface ListResponse {
  households: HouseholdRow[];
}

export default function HouseholdsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'households'],
    queryFn: () => request<ListResponse>('/api/admin/households'),
  });

  const columns: Column<HouseholdRow>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'members', header: 'Members', render: (r) => r.memberCount },
    {
      key: 'quota',
      header: 'Appeal quota',
      render: (r) => `${r.appealQuotaCount} / ${r.appealQuotaPeriod}`,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Households</h1>
      <DataTable<HouseholdRow>
        rows={data?.households ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => setSelectedId(r.id)}
      />
      <HouseholdDetail householdId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Create a minimal HouseholdDetail stub so the page compiles (real impl in next task)**

Create `apps/web/src/pages/admin/HouseholdDetail.tsx`:

```tsx
import DetailDrawer from './components/DetailDrawer';

export default function HouseholdDetail({
  householdId,
  onClose,
}: {
  householdId: number | null;
  onClose: () => void;
}) {
  return (
    <DetailDrawer open={householdId !== null} onClose={onClose} title="Household (stub)">
      <div>Detail UI added in next task.</div>
    </DetailDrawer>
  );
}
```

- [ ] **Step 5: Run the test**

```bash
cd apps/web && pnpm test src/pages/admin/HouseholdsPage.test.tsx
```

Expected: PASS. (Second test calls /api/admin/households/1/detail — that endpoint doesn't exist yet on the backend, but the test only verifies the URL passed to `request`, which is mocked. So the test should pass.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/HouseholdsPage.tsx \
        apps/web/src/pages/admin/HouseholdDetail.tsx \
        apps/web/src/pages/admin/HouseholdsPage.test.tsx
git commit -m "feat(web): admin Households list page"
```

---

### Task C7: GET /api/admin/households/:id/detail (drawer payload)

**Files:**
- Modify: `apps/api/src/routes/admin/households.ts`
- Modify: `apps/api/src/routes/admin/households.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('GET /api/admin/households/:id/detail', () => {
  it('returns 404 for unknown id', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/households/99999/detail',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns household, members, and buyerApprover pairs', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 2, appealQuotaPeriod: 'monthly' },
      });
      const ua = await prisma.user.create({ data: { oidcSubject: 'a', name: 'A', isAdmin: false } });
      const ub = await prisma.user.create({ data: { oidcSubject: 'b', name: 'B', isAdmin: false } });
      const ma = await prisma.householdMember.create({
        data: { userId: ua.id, householdId: h.id, approvalMode: 'any' },
      });
      const mb = await prisma.householdMember.create({
        data: { userId: ub.id, householdId: h.id, approvalMode: 'all' },
      });
      await prisma.buyerApprover.create({ data: { buyerId: ma.id, approverId: mb.id } });

      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/households/${h.id}/detail`,
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.household).toMatchObject({ id: h.id, name: 'H' });
      expect(body.members).toHaveLength(2);
      expect(body.members.map((m: { userName: string }) => m.userName)).toEqual(
        expect.arrayContaining(['A', 'B']),
      );
      expect(body.buyerApprovers).toHaveLength(1);
      expect(body.buyerApprovers[0]).toMatchObject({ buyerId: ma.id, approverId: mb.id });
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the handler**

Append to `adminHouseholdsRoutes`:

```ts
app.get<{ Params: { id: string } }>(
  '/api/admin/households/:id/detail',
  async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });

    const household = await app.prisma.household.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        appealQuotaCount: true,
        appealQuotaPeriod: true,
        createdAt: true,
      },
    });
    if (!household) return reply.code(404).send({ error: 'not_found' });

    const members = await app.prisma.householdMember.findMany({
      where: { householdId: id },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        approvalMode: true,
        joinedAt: true,
        user: { select: { name: true } },
      },
    });

    const memberIds = members.map((m) => m.id);
    const buyerApprovers = memberIds.length
      ? await app.prisma.buyerApprover.findMany({
          where: { buyerId: { in: memberIds } },
          select: { id: true, buyerId: true, approverId: true },
        })
      : [];

    return {
      household,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        userName: m.user.name,
        approvalMode: m.approvalMode,
        joinedAt: m.joinedAt,
      })),
      buyerApprovers,
    };
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/households.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/households.ts apps/api/src/routes/admin/households.test.ts
git commit -m "feat(api): GET /api/admin/households/:id/detail"
```

---

### Task C8: GET /api/admin/users/unassigned (for member picker)

**Files:**
- Modify: `apps/api/src/routes/admin/users.ts`
- Modify: `apps/api/src/routes/admin/users.test.ts`

The HouseholdDetail needs to pick from users who aren't already in any household. Adding a dedicated list endpoint keeps the picker fast and obvious.

- [ ] **Step 1: Append failing tests**

```ts
describe('GET /api/admin/users/unassigned', () => {
  it('returns users with no household membership', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const h = await prisma.household.create({
        data: { name: 'H', appealQuotaCount: 1, appealQuotaPeriod: 'monthly' },
      });
      const inHh = await prisma.user.create({
        data: { oidcSubject: 'in', name: 'In', isAdmin: false },
      });
      await prisma.householdMember.create({
        data: { userId: inHh.id, householdId: h.id, approvalMode: 'any' },
      });
      await prisma.user.create({
        data: { oidcSubject: 'free', name: 'Free', isAdmin: false },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users/unassigned',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const names = body.users.map((u: { name: string }) => u.name);
      expect(names).toContain('Free');
      expect(names).not.toContain('In');
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the handler**

Append to `adminUsersRoutes` in `apps/api/src/routes/admin/users.ts`:

```ts
app.get('/api/admin/users/unassigned', async () => {
  const users = await app.prisma.user.findMany({
    where: { memberships: { none: {} } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, oidcSubject: true },
  });
  return { users };
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/users.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/users.ts apps/api/src/routes/admin/users.test.ts
git commit -m "feat(api): GET /api/admin/users/unassigned (for household member picker)"
```

---

### Task C9: Web — full HouseholdDetail drawer (edit + members + approver matrix)

**Files:**
- Overwrite: `apps/web/src/pages/admin/HouseholdDetail.tsx`
- Create: `apps/web/src/pages/admin/BuyerApproverMatrix.tsx`
- Create: `apps/web/src/pages/admin/HouseholdDetail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/admin/HouseholdDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HouseholdDetail from './HouseholdDetail';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: requestMock };
});

function renderDrawer(householdId: number | null = 1) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HouseholdDetail householdId={householdId} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('HouseholdDetail', () => {
  it('shows household name, members, and approver matrix when loaded', async () => {
    requestMock.mockResolvedValue({
      household: { id: 1, name: 'Casa', appealQuotaCount: 3, appealQuotaPeriod: 'monthly' },
      members: [
        { id: 10, userId: 100, userName: 'Alice', approvalMode: 'any', joinedAt: '2026-01-01' },
        { id: 11, userId: 101, userName: 'Bob', approvalMode: 'all', joinedAt: '2026-01-02' },
      ],
      buyerApprovers: [{ id: 50, buyerId: 10, approverId: 11 }],
    });
    renderDrawer(1);
    await waitFor(() => expect(screen.getByDisplayValue('Casa')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // Matrix toggle for buyerId=10/approverId=11 should be checked
    const checkbox = screen.getByLabelText('Alice→Bob');
    expect(checkbox).toBeChecked();
  });

  it('PATCHes the household when Save is clicked', async () => {
    requestMock
      .mockResolvedValueOnce({
        household: { id: 1, name: 'Casa', appealQuotaCount: 3, appealQuotaPeriod: 'monthly' },
        members: [],
        buyerApprovers: [],
      })
      .mockResolvedValueOnce({
        household: { id: 1, name: 'New Casa', appealQuotaCount: 5, appealQuotaPeriod: 'monthly' },
      });
    renderDrawer(1);
    const nameInput = await screen.findByDisplayValue('Casa');
    fireEvent.change(nameInput, { target: { value: 'New Casa' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      const call = requestMock.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('/api/admin/households/1') && c[1]?.method === 'PATCH');
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toMatchObject({ name: 'New Casa' });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/HouseholdDetail.test.tsx
```

Expected: FAIL — the stub HouseholdDetail from Task C6 doesn't implement any of this.

- [ ] **Step 3: Implement BuyerApproverMatrix**

Create `apps/web/src/pages/admin/BuyerApproverMatrix.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';

interface Member {
  id: number;
  userName: string;
}

interface BA {
  id: number;
  buyerId: number;
  approverId: number;
}

interface Props {
  householdId: number;
  members: Member[];
  pairs: BA[];
}

export default function BuyerApproverMatrix({ householdId, members, pairs }: Props) {
  const queryClient = useQueryClient();
  const pairsByKey = new Map<string, BA>(pairs.map((p) => [`${p.buyerId}-${p.approverId}`, p]));

  const add = useMutation({
    mutationFn: (vars: { buyerId: number; approverId: number }) =>
      request('/api/admin/buyer-approvers', { method: 'PUT', body: vars }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['admin', 'households', householdId, 'detail'],
      }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      request(`/api/admin/buyer-approvers/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['admin', 'households', householdId, 'detail'],
      }),
  });

  function toggle(buyer: Member, approver: Member, existing: BA | undefined) {
    if (existing) remove.mutate(existing.id);
    else add.mutate({ buyerId: buyer.id, approverId: approver.id });
  }

  if (members.length === 0) {
    return <div className="text-sm text-muted-foreground">Add members first.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="p-1 text-left text-muted-foreground">buyer ↓ / approver →</th>
            {members.map((m) => (
              <th key={m.id} className="p-1 text-left text-muted-foreground">
                {m.userName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((buyer) => (
            <tr key={buyer.id} className="border-t border-border">
              <td className="p-1 font-medium">{buyer.userName}</td>
              {members.map((approver) => {
                const key = `${buyer.id}-${approver.id}`;
                const existing = pairsByKey.get(key);
                const isSelf = buyer.id === approver.id;
                return (
                  <td key={approver.id} className="p-1">
                    <input
                      type="checkbox"
                      disabled={isSelf}
                      checked={!!existing}
                      onChange={() => toggle(buyer, approver, existing)}
                      aria-label={`${buyer.userName}→${approver.userName}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Implement the full HouseholdDetail**

Overwrite `apps/web/src/pages/admin/HouseholdDetail.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DetailDrawer from './components/DetailDrawer';
import BuyerApproverMatrix from './BuyerApproverMatrix';

interface DetailResponse {
  household: {
    id: number;
    name: string;
    appealQuotaCount: number;
    appealQuotaPeriod: 'monthly' | 'quarterly';
  };
  members: Array<{
    id: number;
    userId: number;
    userName: string;
    approvalMode: 'any' | 'all';
    joinedAt: string;
  }>;
  buyerApprovers: Array<{ id: number; buyerId: number; approverId: number }>;
}

interface UnassignedResponse {
  users: Array<{ id: number; name: string }>;
}

export default function HouseholdDetail({
  householdId,
  onClose,
}: {
  householdId: number | null;
  onClose: () => void;
}) {
  const open = householdId !== null;
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin', 'households', householdId, 'detail'],
    queryFn: () => request<DetailResponse>(`/api/admin/households/${householdId}/detail`),
    enabled: open,
  });

  const { data: unassigned } = useQuery({
    queryKey: ['admin', 'users', 'unassigned'],
    queryFn: () => request<UnassignedResponse>('/api/admin/users/unassigned'),
    enabled: open,
  });

  const [name, setName] = useState('');
  const [quotaCount, setQuotaCount] = useState(0);
  const [quotaPeriod, setQuotaPeriod] = useState<'monthly' | 'quarterly'>('monthly');

  useEffect(() => {
    if (data?.household) {
      setName(data.household.name);
      setQuotaCount(data.household.appealQuotaCount);
      setQuotaPeriod(data.household.appealQuotaPeriod);
    }
  }, [data?.household]);

  const saveMutation = useMutation({
    mutationFn: () =>
      request(`/api/admin/households/${householdId}`, {
        method: 'PATCH',
        body: { name, appealQuotaCount: quotaCount, appealQuotaPeriod: quotaPeriod },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'households'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'households', householdId, 'detail'] });
    },
  });

  const addMember = useMutation({
    mutationFn: (vars: { userId: number; approvalMode: 'any' | 'all' }) =>
      request(`/api/admin/households/${householdId}/members`, {
        method: 'POST',
        body: vars,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'households', householdId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'unassigned'] });
    },
  });

  const updateMember = useMutation({
    mutationFn: (vars: { memberId: number; approvalMode: 'any' | 'all' }) =>
      request(`/api/admin/household-members/${vars.memberId}`, {
        method: 'PATCH',
        body: { approvalMode: vars.approvalMode },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['admin', 'households', householdId, 'detail'],
      }),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: number) =>
      request(`/api/admin/household-members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'households', householdId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'unassigned'] });
    },
  });

  const [newUserId, setNewUserId] = useState<string>('');
  const [newApprovalMode, setNewApprovalMode] = useState<'any' | 'all'>('any');

  return (
    <DetailDrawer open={open} onClose={onClose} title={data?.household.name ?? 'Household'}>
      {!data ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6 text-sm">
          <section className="space-y-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs uppercase text-muted-foreground">
                  Appeal quota count
                </label>
                <Input
                  type="number"
                  value={quotaCount}
                  onChange={(e) => setQuotaCount(Number(e.target.value))}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs uppercase text-muted-foreground">Period</label>
                <Select value={quotaPeriod} onValueChange={(v) => setQuotaPeriod(v as 'monthly' | 'quarterly')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">monthly</SelectItem>
                    <SelectItem value="quarterly">quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </section>

          <section>
            <h3 className="mb-2 font-medium">Members</h3>
            <table className="w-full text-xs">
              <thead><tr>
                <th className="p-1 text-left text-muted-foreground">Name</th>
                <th className="p-1 text-left text-muted-foreground">Approval mode</th>
                <th className="p-1"></th>
              </tr></thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="p-1">{m.userName}</td>
                    <td className="p-1">
                      <Select
                        value={m.approvalMode}
                        onValueChange={(v) =>
                          updateMember.mutate({ memberId: m.id, approvalMode: v as 'any' | 'all' })
                        }
                      >
                        <SelectTrigger className="h-7 w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">any</SelectItem>
                          <SelectItem value="all">all</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeMember.mutate(m.id)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs uppercase text-muted-foreground">
                  Add member
                </label>
                <Select value={newUserId} onValueChange={setNewUserId}>
                  <SelectTrigger><SelectValue placeholder="Pick a user…" /></SelectTrigger>
                  <SelectContent>
                    {(unassigned?.users ?? []).map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs uppercase text-muted-foreground">Mode</label>
                <Select value={newApprovalMode} onValueChange={(v) => setNewApprovalMode(v as 'any' | 'all')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">any</SelectItem>
                    <SelectItem value="all">all</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!newUserId || addMember.isPending}
                onClick={() => {
                  addMember.mutate({ userId: Number(newUserId), approvalMode: newApprovalMode });
                  setNewUserId('');
                }}
              >
                Add
              </Button>
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-medium">Buyer → Approver matrix</h3>
            <BuyerApproverMatrix
              householdId={data.household.id}
              members={data.members}
              pairs={data.buyerApprovers}
            />
          </section>
        </div>
      )}
    </DetailDrawer>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/web && pnpm test src/pages/admin/HouseholdDetail.test.tsx
```

Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/HouseholdDetail.tsx \
        apps/web/src/pages/admin/BuyerApproverMatrix.tsx \
        apps/web/src/pages/admin/HouseholdDetail.test.tsx
git commit -m "feat(web): household admin detail drawer with member + approver matrix"
```

---

## Phase D — Appeals section

### Task D1: GET /api/admin/appeals (cross-household list)

**Files:**
- Create: `apps/api/src/routes/admin/appeals.ts`
- Create: `apps/api/src/routes/admin/appeals.test.ts`
- Modify: `apps/api/src/routes/admin/index.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/routes/admin/appeals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../buildApp.js';
import { prisma } from '../../test-helpers/db.js';
import { buildTestApp } from '../../test-helpers/session.js';

async function seedAdmin() {
  const admin = await prisma.user.create({
    data: { oidcSubject: 'a', name: 'A', isAdmin: true },
  });
  return { admin, ...(await buildTestApp(admin.id)) };
}

async function seedHouseholdWithAppeal() {
  const h = await prisma.household.create({
    data: { name: 'H', appealQuotaCount: 5, appealQuotaPeriod: 'monthly' },
  });
  const u = await prisma.user.create({
    data: { oidcSubject: 'b', name: 'Buyer', isAdmin: false },
  });
  const m = await prisma.householdMember.create({
    data: { userId: u.id, householdId: h.id, approvalMode: 'any' },
  });
  const r = await prisma.request.create({
    data: {
      householdId: h.id,
      buyerId: m.id,
      title: 'Disputed buy',
      status: 'rejected',
      priceCents: 1000,
    },
  });
  const a = await prisma.appeal.create({
    data: {
      requestId: r.id,
      buyerId: m.id,
      status: 'pending',
      periodKey: '2026-05',
    },
  });
  return { household: h, request: r, appeal: a };
}

describe('GET /api/admin/appeals', () => {
  it('returns 403 for non-admin', async () => {
    const u = await prisma.user.create({
      data: { oidcSubject: 'u', name: 'U', isAdmin: false },
    });
    const { app, sessionCookie } = await buildTestApp(u.id);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/appeals',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('lists cross-household appeals with request title and buyer name', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { appeal } = await seedHouseholdWithAppeal();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/appeals',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.appeals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: appeal.id,
            status: 'pending',
            requestTitle: 'Disputed buy',
            buyerName: 'Buyer',
            householdName: 'H',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('filters by status', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      await seedHouseholdWithAppeal();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/appeals?status=upheld',
        headers: { cookie: sessionCookie },
      });
      const body = res.json();
      expect(body.appeals).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/appeals.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the list handler**

Create `apps/api/src/routes/admin/appeals.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { AdminListAppealsQuerySchema, AdminResolveAppealSchema } from '@two-cents/shared';

export default async function adminAppealsRoutes(app: FastifyInstance) {
  app.get('/api/admin/appeals', async (req) => {
    const query = AdminListAppealsQuerySchema.parse(req.query ?? {});
    const limit = query.limit ?? 50;

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.periodKey ? { periodKey: query.periodKey } : {}),
      ...(query.householdId
        ? { request: { householdId: query.householdId } }
        : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };

    const appeals = await app.prisma.appeal.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        status: true,
        periodKey: true,
        createdAt: true,
        resolvedAt: true,
        request: {
          select: {
            id: true,
            title: true,
            household: { select: { id: true, name: true } },
          },
        },
        buyer: {
          select: { id: true, user: { select: { name: true } } },
        },
      },
    });

    const hasMore = appeals.length > limit;
    const slice = hasMore ? appeals.slice(0, limit) : appeals;
    return {
      appeals: slice.map((a) => ({
        id: a.id,
        status: a.status,
        periodKey: a.periodKey,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        requestId: a.request.id,
        requestTitle: a.request.title,
        householdId: a.request.household.id,
        householdName: a.request.household.name,
        buyerMemberId: a.buyer.id,
        buyerName: a.buyer.user.name,
      })),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  });
}
```

- [ ] **Step 4: Register adminAppealsRoutes in the admin plugin**

Modify `apps/api/src/routes/admin/index.ts` — append:

```ts
import adminAppealsRoutes from './appeals.js';
// ...
await app.register(adminAppealsRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/appeals.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/appeals.ts apps/api/src/routes/admin/appeals.test.ts apps/api/src/routes/admin/index.ts
git commit -m "feat(api): GET /api/admin/appeals (cross-household)"
```

---

### Task D2: POST /api/admin/appeals/:id/resolve

We add a separate admin-scoped resolve handler (per spec's "Risks / open questions" — lean toward separate handler for clarity, since the existing `/api/appeals/:id/resolve` checks the caller is an approver for that appeal). The admin variant skips the membership check and reuses the same status-transition logic.

**Files:**
- Modify: `apps/api/src/routes/admin/appeals.ts`
- Modify: `apps/api/src/routes/admin/appeals.test.ts`

- [ ] **Step 1: Read the existing resolve logic**

```bash
grep -n -E "resolve|transition|overturn|upheld" apps/api/src/routes/appeals.ts
```

Locate the function that performs the transition. If it lives in a service helper (`apps/api/src/services/appeals.ts` or similar), the admin endpoint should call that helper directly. If it's inline in the route, copy the transaction body into the admin handler — do NOT call the existing HTTP route.

- [ ] **Step 2: Append failing tests**

Add to `apps/api/src/routes/admin/appeals.test.ts`:

```ts
describe('POST /api/admin/appeals/:id/resolve', () => {
  it('returns 404 for unknown appeal id', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/appeals/99999/resolve',
        headers: { cookie: sessionCookie },
        payload: { decision: 'overturn' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns 409 if appeal is already resolved', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { appeal } = await seedHouseholdWithAppeal();
      await prisma.appeal.update({
        where: { id: appeal.id },
        data: { status: 'upheld', resolvedAt: new Date() },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'overturn' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'already_resolved' });
    } finally {
      await app.close();
    }
  });

  it('overturns the appeal and sets request status to approved', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { appeal, request } = await seedHouseholdWithAppeal();
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'overturn' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.appeal).toMatchObject({ id: appeal.id, status: 'overturned' });
      const updatedReq = await prisma.request.findUnique({ where: { id: request.id } });
      expect(updatedReq?.status).toBe('approved');
    } finally {
      await app.close();
    }
  });

  it('upholds the appeal and leaves request status unchanged', async () => {
    const { app, sessionCookie } = await seedAdmin();
    try {
      const { appeal, request } = await seedHouseholdWithAppeal();
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/appeals/${appeal.id}/resolve`,
        headers: { cookie: sessionCookie },
        payload: { decision: 'uphold' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().appeal.status).toBe('upheld');
      const updatedReq = await prisma.request.findUnique({ where: { id: request.id } });
      expect(updatedReq?.status).toBe('rejected');
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/routes/admin/appeals.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Add the resolve handler**

The exact import + code depends on where the transition helper lives (step 1). The template below uses the in-route transaction pattern. Adjust if a service helper exists.

Append to `adminAppealsRoutes` in `apps/api/src/routes/admin/appeals.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { transitionOnTx } from '../../services/request-state.js'; // adjust if the helper lives elsewhere — verify via the grep in step 1

app.post<{ Params: { id: string } }>(
  '/api/admin/appeals/:id/resolve',
  async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const body = AdminResolveAppealSchema.parse(req.body);

    const appeal = await app.prisma.appeal.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        requestId: true,
        buyerId: true,
      },
    });
    if (!appeal) return reply.code(404).send({ error: 'not_found' });
    if (appeal.status !== 'pending') {
      return reply.code(409).send({ error: 'already_resolved' });
    }

    const newStatus = body.decision === 'overturn' ? 'overturned' : 'upheld';
    const updated = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedAppeal = await tx.appeal.update({
        where: { id },
        data: { status: newStatus, resolvedAt: new Date() },
      });
      if (body.decision === 'overturn') {
        // Reuse the same state-transition helper as the user-facing endpoint.
        await transitionOnTx(tx, appeal.requestId, 'appeal_overturned', {
          actorId: req.adminUser!.id,
        });
      }
      return updatedAppeal;
    });

    return { appeal: updated };
  },
);
```

If the helper isn't `transitionOnTx` or doesn't accept that signature, mirror exactly what `apps/api/src/routes/appeals.ts`'s resolve handler does (copy-paste the transaction body) — but pass `actorId: req.adminUser!.id` instead of the household member id.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/routes/admin/appeals.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/appeals.ts apps/api/src/routes/admin/appeals.test.ts
git commit -m "feat(api): POST /api/admin/appeals/:id/resolve"
```

---

### Task D3: Web — AdminAppealsPage

**Files:**
- Overwrite: `apps/web/src/pages/admin/AdminAppealsPage.tsx`
- Create: `apps/web/src/pages/admin/AdminAppealsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/admin/AdminAppealsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminAppealsPage from './AdminAppealsPage';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: requestMock };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminAppealsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('AdminAppealsPage', () => {
  it('renders cross-household appeals', async () => {
    requestMock.mockResolvedValueOnce({
      appeals: [
        {
          id: 5,
          status: 'pending',
          periodKey: '2026-05',
          requestId: 100,
          requestTitle: 'A buy',
          householdId: 1,
          householdName: 'Casa',
          buyerName: 'Alice',
          createdAt: '2026-05-01',
          resolvedAt: null,
        },
      ],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('A buy')).toBeInTheDocument());
    expect(screen.getByText('Casa')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('opens resolve dialog and submits decision', async () => {
    requestMock
      .mockResolvedValueOnce({
        appeals: [
          {
            id: 5, status: 'pending', periodKey: '2026-05',
            requestId: 100, requestTitle: 'A buy',
            householdId: 1, householdName: 'Casa', buyerName: 'Alice',
            createdAt: '2026-05-01', resolvedAt: null,
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        appeal: { id: 5, status: 'overturned' },
      });
    renderPage();
    await waitFor(() => expect(screen.getByText('A buy')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    fireEvent.click(screen.getByRole('button', { name: /overturn/i }));
    await waitFor(() => {
      const call = requestMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0] === '/api/admin/appeals/5/resolve',
      );
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toEqual({ decision: 'overturn' });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm test src/pages/admin/AdminAppealsPage.test.tsx
```

Expected: FAIL — stub from A4 doesn't implement this.

- [ ] **Step 3: Implement AdminAppealsPage**

Overwrite `apps/web/src/pages/admin/AdminAppealsPage.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DataTable, { type Column } from './components/DataTable';

interface AppealRow {
  id: number;
  status: 'pending' | 'upheld' | 'overturned';
  periodKey: string;
  requestId: number;
  requestTitle: string;
  householdId: number;
  householdName: string;
  buyerName: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface ListResponse {
  appeals: AppealRow[];
  nextCursor: number | null;
}

export default function AdminAppealsPage() {
  const [status, setStatus] = useState<string>('');
  const [resolveTarget, setResolveTarget] = useState<AppealRow | null>(null);
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  if (status) params.set('status', status);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'appeals', status],
    queryFn: () => request<ListResponse>(`/api/admin/appeals?${params.toString()}`),
  });

  const resolve = useMutation({
    mutationFn: (vars: { id: number; decision: 'overturn' | 'uphold' }) =>
      request(`/api/admin/appeals/${vars.id}/resolve`, {
        method: 'POST',
        body: { decision: vars.decision },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'appeals'] });
      setResolveTarget(null);
    },
  });

  const columns: Column<AppealRow>[] = [
    { key: 'request', header: 'Request', render: (r) => r.requestTitle },
    { key: 'buyer', header: 'Buyer', render: (r) => r.buyerName },
    { key: 'household', header: 'Household', render: (r) => r.householdName },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge variant={r.status === 'pending' ? 'default' : 'outline'}>{r.status}</Badge>,
    },
    { key: 'period', header: 'Period', render: (r) => r.periodKey },
    {
      key: 'created',
      header: 'Filed',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'pending' ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setResolveTarget(r);
            }}
          >
            Resolve
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Appeals</h1>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Status</span>
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
            <SelectItem value="upheld">upheld</SelectItem>
            <SelectItem value="overturned">overturned</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable<AppealRow>
        rows={data?.appeals ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        isLoading={isLoading}
      />
      <Dialog open={resolveTarget !== null} onOpenChange={(o) => { if (!o) setResolveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve appeal #{resolveTarget?.id}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Request: <span className="text-foreground">{resolveTarget?.requestTitle}</span>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() =>
                resolveTarget && resolve.mutate({ id: resolveTarget.id, decision: 'uphold' })
              }
              disabled={resolve.isPending}
            >
              Uphold (deny)
            </Button>
            <Button
              onClick={() =>
                resolveTarget && resolve.mutate({ id: resolveTarget.id, decision: 'overturn' })
              }
              disabled={resolve.isPending}
            >
              Overturn (approve)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm test src/pages/admin/AdminAppealsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run all web tests for regressions**

```bash
cd apps/web && pnpm test
```

Expected: all green.

- [ ] **Step 6: Run all api tests for regressions**

```bash
cd apps/api && pnpm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/admin/AdminAppealsPage.tsx apps/web/src/pages/admin/AdminAppealsPage.test.tsx
git commit -m "feat(web): admin Appeals page with cross-household list + resolve dialog"
```

---

## Phase E — End-to-end smoke + housekeeping

### Task E1: Remove the temporary _ping admin endpoint

Now that real admin endpoints are registered, the smoke `_ping` route from Task A3 is no longer needed.

**Files:**
- Modify: `apps/api/src/routes/admin/index.ts`
- Modify: `apps/api/src/routes/admin/index.test.ts`

- [ ] **Step 1: Update tests to use a real admin endpoint instead of _ping**

In `apps/api/src/routes/admin/index.test.ts`, replace every `'/api/admin/_ping'` with `'/api/admin/users'`. The 401/403/200 semantics are identical (and 200 still passes — the GET /api/admin/users returns 200 with `users: []` when DB is empty).

For the "returns 200" test, update the expected body assertion: `expect(res.json()).toMatchObject({ users: [] })` (replacing the old `{ ok: true, adminId: admin.id }`).

- [ ] **Step 2: Run tests to verify they still pass**

```bash
cd apps/api && pnpm test src/routes/admin/index.test.ts
```

Expected: PASS.

- [ ] **Step 3: Remove the _ping route from `apps/api/src/routes/admin/index.ts`**

Delete the `app.get('/api/admin/_ping', ...)` block.

- [ ] **Step 4: Run tests to verify they still pass**

```bash
cd apps/api && pnpm test src/routes/admin/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full api + web suite**

```bash
cd apps/api && pnpm test && cd ../web && pnpm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/index.ts apps/api/src/routes/admin/index.test.ts
git commit -m "refactor(api): drop temporary /api/admin/_ping smoke route"
```

---

### Task E2: Manual smoke against the running deploy (post-merge)

After the PR merges to `main` and the GH Actions deploy completes:

- [ ] **Step 1: Open `https://two-cents.wispy-nook.casa/admin` in a browser, signed in as a `two-cents-admins` user**
- [ ] **Step 2: Verify each section loads without errors:** People, Households, Appeals
- [ ] **Step 3: People — click a user, verify the drawer opens with their household/requests/comments/push subs/log**
- [ ] **Step 4: People — click "Send test push" on a user with active subscriptions; verify a push arrives**
- [ ] **Step 5: Households — click a household, change the appeal quota count, click Save, verify the list reflects the change**
- [ ] **Step 6: Households — add a member to a household, toggle a buyer-approver matrix cell, remove a member**
- [ ] **Step 7: Appeals — verify pending appeals are listed cross-household; resolve one (overturn) and verify the request status changes**
- [ ] **Step 8: As a NON-admin user, navigate to `/admin` — verify you're redirected to `/`. Verify `curl https://two-cents.wispy-nook.casa/api/admin/users -b <non-admin-cookie>` returns 403**

No commit for E2 — it's pure verification.

---

## Plan self-review

(Items below are the writing-plans skill's required self-check. Each was confirmed before publishing this plan.)

**1. Spec coverage:**
- People section (spec §People) → Tasks B1-B5 + C8 ✓
- Households section (spec §Households) → Tasks C1-C9 ✓
- Appeals section (spec §Appeals) → Tasks D1-D3 ✓
- Auth gate `requireAdmin` (spec §Auth model) → Task A3 ✓
- Shared web primitives `DataTable` + `DetailDrawer` (spec §Web shared primitives) → Tasks A5, A6 ✓
- AdminLayout + sidebar + nested routes (spec §1-5 navigation) → Task A4 ✓
- Out-of-scope items explicitly NOT in the plan: User.isAdmin/name edits, other-user notification prefs, immutable audit edits, bulk actions, Playwright E2E ✓
- Deferred to PR 2 per spec: Feedback section, Audit Search ✓

**2. Placeholder scan:** every step contains either an exact command, an exact file path, or a complete code block. The one item with conditional language ("if the helper isn't `transitionOnTx`") in D2 is explicit about how to handle the alternative — there's a fallback path documented inline.

**3. Type consistency:** `AdminUser`, `Column<T>`, `DetailDrawerProps`, all schema names, all endpoint paths, and all query-key arrays were spot-checked across the plan for consistent naming. `request()` from `@/lib/api` is used uniformly; mutation method passed as `{ method: 'POST' }` etc. consistently.

**4. Risks called out in the spec are addressed:**
- Audit search performance: deferred to PR 2 plan, not this one.
- Test push delivery / 410 stales: handled in B3's expected response shape (`sent`, `failed`, `errors`).
- Matrix UX with large households: out of scope; small-household assumption documented in spec.
- Existing `/api/appeals/queue` vs new admin endpoint: D1+D2 add a separate admin handler per the spec's "lean toward separate handler for clarity" — also documented inline in D2.

---

## What's deferred to PR 2

A separate plan document `docs/superpowers/plans/2026-05-Z-admin-page-pr2.md` will cover:

- Feedback section: `GET /api/admin/feedback` + AdminFeedbackPage (read-only list, opens GH issue in new tab)
- Audit Search: `GET /api/admin/search?q=&type=` + AdminSearchPage (unified results across Request / Comment / NotificationLog / PushSubscription / ConsumedJWTJti)
- Sidebar entries for Feedback + Search added to `AdminLayout.tsx`

PR 2 builds on the PR 1 foundation; no schema or route-plugin restructuring needed.
