/** The permission catalogue and the roles shipped by default. */

export const PERMISSION_GROUPS = [
  {
    label: 'Selling',
    items: [
      { key: 'pos', label: 'Use the point of sale', hint: 'Take sales at an exhibition' },
      { key: 'sales.own', label: 'See their own sales' },
      { key: 'refund', label: 'Process returns and refunds' },
    ],
  },
  {
    label: 'Admin areas',
    items: [
      { key: 'admin.dashboard', label: 'Dashboard' },
      { key: 'admin.sales', label: 'All sales', hint: 'Not just their own' },
      { key: 'admin.products', label: 'Products' },
      { key: 'admin.inventory', label: 'Inventory' },
      { key: 'admin.exhibitions', label: 'Exhibitions' },
      { key: 'admin.customers', label: 'Customers' },
      { key: 'admin.staff', label: 'Staff performance' },
      { key: 'admin.reports', label: 'Reports' },
      { key: 'admin.settings', label: 'Settings, roles & activity log', hint: 'Full control of the system' },
    ],
  },
  {
    label: 'Sensitive',
    items: [
      { key: 'view.cost', label: 'See cost prices and margins' },
      { key: 'stock.adjust', label: 'Adjust stock levels' },
      {
        key: 'stock.oversell',
        label: 'Authorise selling past available stock',
        hint: 'Approve a sale when the shelf count says there is not enough',
      },
      { key: 'promo.manage', label: 'Create and edit promo codes' },
      {
        key: 'records.delete',
        label: 'Delete records permanently',
        hint: 'Sales, products, customers and exhibitions',
      },
    ],
  },
]

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.key))

export function permissionLabel(key) {
  for (const group of PERMISSION_GROUPS) {
    const found = group.items.find((item) => item.key === key)
    if (found) return found.label
  }
  return key
}

export const DEFAULT_ROLES = [
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full control, including settings, roles and permanent deletion.',
    system: true,
    permissions: ['*'],
    maxDiscountPercent: 100,
  },
  {
    id: 'manager',
    name: 'Manager',
    description: 'Runs the floor: sales, stock, customers and reporting — but not system settings.',
    system: true,
    permissions: [
      'pos',
      'sales.own',
      'refund',
      'admin.dashboard',
      'admin.sales',
      'admin.products',
      'admin.inventory',
      'admin.exhibitions',
      'admin.customers',
      'admin.staff',
      'admin.reports',
      'view.cost',
      'stock.adjust',
      'stock.oversell',
      'promo.manage',
    ],
    maxDiscountPercent: 30,
  },
  {
    id: 'salesperson',
    name: 'Salesperson',
    description: 'Sells at the stall and manages customers. No cost prices or reports.',
    system: true,
    permissions: ['pos', 'sales.own', 'admin.customers'],
    maxDiscountPercent: 10,
  },
]

/** Resolves a permission for a user against the editable role list. */
export function userCan(user, roles, permission) {
  if (!user) return false
  const role = (roles || DEFAULT_ROLES).find((entry) => entry.id === user.role)
  if (!role) return false
  return role.permissions.includes('*') || role.permissions.includes(permission)
}

/** Expands the wildcard so the roles editor can show real checkboxes. */
export function effectivePermissions(role) {
  return role.permissions.includes('*') ? ALL_PERMISSIONS : role.permissions
}

/**
 * Guards against locking everyone out: at least one active user must keep
 * access to settings.
 */
export function wouldLoseAdminAccess(users, roles) {
  return !users.some((user) => user.active && userCan(user, roles, 'admin.settings'))
}
