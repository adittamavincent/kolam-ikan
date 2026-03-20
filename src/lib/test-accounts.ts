export type TestAccount = {
  label: string;
  email: string;
  pass: string;
  role: string;
  fullName?: string;
};

export const testAccounts: TestAccount[] = [
  { label: "Default Test User", email: "test@kolamikan.local", pass: "KolamTest2026!", role: "User", fullName: "Test User" },
  { label: "Admin Account", email: "admin@kolamikan.local", pass: "KolamTest2026!", role: "Admin", fullName: "Admin User" },
  { label: "Empty Account", email: "new@kolamikan.local", pass: "KolamTest2026!", role: "Demo", fullName: "New User" },
  { label: "Demo One", email: "demo1@kolamikan.local", pass: "KolamTest2026!", role: "Demo", fullName: "Demo One" },
  { label: "Demo Two", email: "demo2@kolamikan.local", pass: "KolamTest2026!", role: "Demo", fullName: "Demo Two" },
  { label: "Demo Three", email: "demo3@kolamikan.local", pass: "KolamTest2026!", role: "Demo", fullName: "Demo Three" },
  { label: "QA One", email: "qa1@kolamikan.local", pass: "KolamTest2026!", role: "QA", fullName: "QA One" },
  { label: "QA Two", email: "qa2@kolamikan.local", pass: "KolamTest2026!", role: "QA", fullName: "QA Two" },
  { label: "QA Three", email: "qa3@kolamikan.local", pass: "KolamTest2026!", role: "QA", fullName: "QA Three" },
  { label: "User One", email: "user1@kolamikan.local", pass: "KolamTest2026!", role: "User", fullName: "User One" },
  { label: "User Two", email: "user2@kolamikan.local", pass: "KolamTest2026!", role: "User", fullName: "User Two" },
  { label: "User Three", email: "user3@kolamikan.local", pass: "KolamTest2026!", role: "User", fullName: "User Three" },
];

export const testEmails = testAccounts.map((a) => a.email);
