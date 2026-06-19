# User Tier System - Implementation Guide

## Overview

The Marketoir application now supports a role-based access control (RBAC) system with four user tiers, each with distinct permissions.

## Tier Definitions

### 1. **SuperAdmin** (System Wide)
- **Permissions:**
  - Full system access including all configuration
  - User management (create, edit, delete users)
  - Can assign tiers to other users
  - Access to all organization data
  - Can access Settings pages
  - Highest privilege level

- **Access:**
  - Everything including `/admin/users` management page
  - All IMS, Inventory, Marketing features
  - Settings & Setup
  - User Management UI

### 2. **Admin** (Organisation Wide Full Access)
- **Permissions:**
  - Organization-wide full access
  - Can access all modules and settings
  - Can modify business configuration
  - **CAN** manage users (create, edit, delete users within org)
  - **Cannot** create SuperAdmin users or promote others to SuperAdmin
  - Can assign tiers: Admin, StandardUser, PosUser

- **Access:**
  - All IMS, Inventory, Marketing features
  - Settings & Setup pages
  - User Management UI (`/admin/users`)
  - Cannot access `/admin/users` to manage SuperAdmin users

### 3. **StandardUser** (Default - Access Everything Except Settings)
- **Permissions:**
  - Access all core application features
  - Can view and manage IMS, Inventory, Marketing
  - Cannot modify settings or system configuration
  - Cannot manage users
  - Cannot access Setup pages

- **Access:**
  - IMS, Inventory Management
  - Marketing Activities
  - Website Management
  - Customer Service
  - Business Intelligence (read-only)
  - POS System (if applicable)
  - **Cannot access:** Settings, Setup, User Management

### 4. **PosUser** (POS Only)
- **Permissions:**
  - Limited to POS (Point of Sale) system only
  - Cannot access any other modules
  - No access to reporting or settings

- **Access:**
  - `/pos` page only
  - **Cannot access:** Dashboard, IMS, Settings, Setup, or any other modules

## Database Schema

### Users Table

```sql
ALTER TABLE users ADD COLUMN tier ENUM('SuperAdmin', 'Admin', 'StandardUser', 'PosUser') 
DEFAULT 'StandardUser' NOT NULL AFTER role;
```

**Column Details:**
- `tier` - Enum field for tier assignment
- Default: 'StandardUser'
- Migration script: `scripts/migrate-user-tiers.mjs`

## Session Data Structure

The session cookie now includes tier information:

```typescript
interface AdminSession {
  name: string;
  company: string;
  email: string;
  userSpreadsheetId: string;
  role: string;
  tier: 'SuperAdmin' | 'Admin' | 'StandardUser' | 'PosUser';
  userId: number;
}
```

## API Endpoints

### User Management (Admin & SuperAdmin)

**GET /api/admin/users**
- List all users with tier information
- Returns: `{ users: User[] }`

**POST /api/admin/users**
- Create new user
- SuperAdmin can create any tier; Admin can create Admin/StandardUser/PosUser
- Body: `{ email, password, name?, company?, tier? }`
- Returns: `{ userId, message }`

**PATCH /api/admin/users?userId=[id]**
- Update user tier and properties
- SuperAdmin can assign any tier; Admin can assign Admin/StandardUser/PosUser
- Body: `{ tier?, name?, company? }`
- Returns: `{ success: true, message }`

**DELETE /api/admin/users?userId=[id]**
- Soft-delete user
- Returns: `{ success: true, message }`

## Frontend Access Control

### Tier Utils (`src/lib/tierUtils.ts`)

```typescript
// Check if user has permission
hasTierAccess(userTier, requiredTier): boolean

// Get tier-based permissions
getTierPermissions(tier): TierPermissions

// Get tier label/description for UI
getTierLabel(tier): string
getTierDescription(tier): string
```

### Permission Matrix

| Feature | SuperAdmin | Admin | StandardUser | PosUser |
|---------|-----------|-------|--------------|---------|
| Dashboard | ✅ | ✅ | ✅ | ❌ |
| IMS/Inventory | ✅ | ✅ | ✅ | ❌ |
| Marketing | ✅ | ✅ | ✅ | ❌ |
| Website Management | ✅ | ✅ | ✅ | ❌ |
| Customer Service | ✅ | ✅ | ✅ | ❌ |
| POS System | ✅ | ✅ | ✅ | ✅ |
| Settings | ✅ | ✅ | ❌ | ❌ |
| Setup | ✅ | ✅ | ❌ | ❌ |
| User Management | ✅ | ✅ | ❌ | ❌ |
| Business Intelligence | ✅ | ✅ | ✅ | ❌ |

## Session Guards (sessionUtils.ts)

### Backend Route Protection

```typescript
// Require SuperAdmin tier
const { user, response } = requireSuperAdminTier();
if (response) return response;

// Require Admin or higher
const { user, response } = requireAdminTier();
if (response) return response;

// Require StandardUser or higher (everyone except PosUser)
const { user, response } = requireStandardUserTier();
if (response) return response;

// Require any tier (authentication only)
const { user, response } = requireAnyTier();
if (response) return response;
```

## Implementation Workflow

### 1. Setup Database
```bash
node scripts/migrate-user-tiers.mjs
```
- Creates `tier` column
- Sets first admin as SuperAdmin
- Sets remaining admins as Admin

### 2. Update User Tiers
- Navigate to `/admin/users` (Admin and SuperAdmin only)
- Click "+ Create User" to add new users with specific tiers
- Edit existing users to change their tier
- **Admin users:** Can manage Admin, StandardUser, and PosUser tiers
- **SuperAdmin users:** Can manage all tiers including SuperAdmin

### 3. Frontend Navigation
- Components automatically hide/show based on user tier
- Dashboard shows appropriate sidebar items
- Settings/Setup/Admin pages check tier before rendering

### 4. API Protection
- All sensitive routes require tier checks
- Invalid tier = 403 Forbidden response
- Unauthenticated = 401 Unauthorized response

## Pages & Routes

### Public Routes
- `/login` - Login page (no tier check)
- `/register` - Registration page (new users default to StandardUser)

### Protected Routes

| Route | Required Tier | Purpose |
|-------|---------------|---------|
| `/dashboard` | StandardUser | Main dashboard |
| `/ims` | StandardUser | Inventory Management |
| `/pos` | PosUser | POS system |
| `/setup` | Admin | Setup/Configuration |
| `/connections` | StandardUser | Business connections |
| `/business-info` | StandardUser | Business information |
| `/admin/users` | SuperAdmin | User management |

## Migration & Rollout

### For Existing Installations

1. **Run migration script:**
   ```bash
   node scripts/migrate-user-tiers.mjs
   ```

2. **Verify tier assignments:**
   - First admin user → SuperAdmin
   - Other admin users → Admin
   - Regular users → StandardUser

3. **Update user tiers as needed:**
   - Log in as SuperAdmin user
   - Go to `/admin/users`
   - Edit users and assign appropriate tiers

### For New Installations

1. First user created via registration → StandardUser
2. Can be promoted to SuperAdmin via `/admin/users` by existing SuperAdmin
3. Or manually set in database: `UPDATE users SET tier='SuperAdmin' WHERE id=1;`

## Testing

### Test Case 1: SuperAdmin Access
- Create user with SuperAdmin tier
- Log in as SuperAdmin
- Verify access to `/admin/users`
- Verify can create/edit/delete other users

### Test Case 2: Admin Restrictions
- Create user with Admin tier
- Log in as Admin
- Verify no access to `/admin/users` (403)
- Verify full access to other features

### Test Case 3: StandardUser Restrictions
- Create user with StandardUser tier
- Log in as StandardUser
- Verify no access to Settings (403)
- Verify full access to Dashboard, IMS, Marketing

### Test Case 4: PosUser Restrictions
- Create user with PosUser tier
- Log in as PosUser
- Verify access only to `/pos` page
- Verify redirected from `/dashboard` or other pages

## Files Modified/Created

### New Files
- `scripts/migrate-user-tiers.mjs` - Database migration
- `src/lib/tierUtils.ts` - Tier utility functions
- `src/app/admin/users/page.tsx` - User management UI
- `src/app/api/admin/users/route.ts` - User management API

### Modified Files
- `src/lib/db/UsersRepository.ts` - Added tier field
- `src/lib/sessionUtils.ts` - Added tier-based guards
- `src/app/api/auth/login/route.ts` - Include tier in session
- `src/app/api/auth/me/route.ts` - Return tier
- `src/app/api/user/me/route.ts` - Return tier

## Security Considerations

1. **Session Validation:** Tier is stored in session cookie and verified on each request
2. **Hierarchical Access:** Tier hierarchy prevents privilege escalation
3. **API Protection:** All sensitive endpoints validate tier before executing
4. **Frontend Hiding:** UI elements hidden based on tier (but backend always validates)
5. **Audit Ready:** Can track user actions by tier in logs

## Future Enhancements

- [ ] Audit logging for tier changes
- [ ] Activity logging by tier
- [ ] Custom tier creation
- [ ] Per-module tier assignments
- [ ] Role-based API token scoping
- [ ] Tier-based API rate limiting
