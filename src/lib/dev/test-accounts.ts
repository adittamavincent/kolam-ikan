export const devTestAccounts: { label: string; email: string; pass: string; role: string; fullName?: string }[] = [
  {
    label: "Default Test User",
    email: "test@kolamikan.local",
    pass: "KolamTest2026!",
    role: "User",
  },
  {
    label: "Admin Account",
    email: "admin@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Admin",
  },
  {
    label: "Empty Account",
    email: "new@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Demo",
  },
  {
    label: "Editor Account",
    email: "editor@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Editor",
  },
  {
    label: "Viewer Account",
    email: "viewer@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Viewer",
  },
  {
    label: "Manager Account",
    email: "manager@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Manager",
  },
  {
    label: "Support Account",
    email: "support@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Support",
  },
  {
    label: "QA Account",
    email: "qa@kolamikan.local",
    pass: "KolamTest2026!",
    role: "QA",
  },
  {
    label: "Integration Bot",
    email: "bot@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Bot",
  },
  {
    label: "Super Admin",
    email: "superadmin@kolamikan.local",
    pass: "KolamTest2026!",
    role: "SuperAdmin",
  },
  {
    label: "Guest Demo",
    email: "guest@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Demo",
  },
  {
    label: "Analytics",
    email: "analytics@kolamikan.local",
    pass: "KolamTest2026!",
    role: "Analytics",
  },
];

export type DevTestAccount = (typeof devTestAccounts)[0];
