import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { devTestAccounts } from "../src/lib/dev/test-accounts";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const TEST_EMAILS = devTestAccounts.map((a) => a.email);

const RESET_STATEMENTS = [
  `TRUNCATE TABLE
        sections,
        entries,
        canvases,
        canvas_versions,
        streams,
        cabinets,
        domains,
        personas,
        audit_logs
    CASCADE`,
  ...TEST_EMAILS.map((e) => `DELETE FROM auth.users WHERE email = '${e}'`),
];

const TEST_ACCOUNTS = devTestAccounts.map((a) => ({
  email: a.email,
  password: a.pass,
  name: a.fullName ?? a.label,
}));

async function globalSetup() {
  console.log("\n🧹 E2E Global Setup: Resetting database...\n");

  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    throw new Error(
      "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and key are required for e2e setup",
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey,
  );

  for (const statement of RESET_STATEMENTS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.rpc("exec_sql" as any, { sql: statement });
    if (error) {
      console.error("❌ Reset error:", error.message);
      throw error;
    }
  }
  console.log("✅ Database tables truncated");

  for (const account of TEST_ACCOUNTS) {
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp(
      {
        email: account.email,
        password: account.password,
        options: {
          data: { full_name: account.name, is_seed_user: true },
        },
      },
    );
    if (signUpError) {
      console.error(
        `❌ Sign-up error for ${account.email}:`,
        signUpError.message,
      );
      throw signUpError;
    }
    console.log(`✅ ${account.email} ready (${signUpData.user?.id})`);
  }

  const authDir = path.resolve(process.cwd(), ".auth");
  if (fs.existsSync(authDir)) {
    for (const f of fs.readdirSync(authDir)) {
      fs.unlinkSync(path.join(authDir, f));
    }
    console.log("✅ Stale auth states cleared");
  }

  console.log("\n🟢 Global setup complete — database is clean and seeded\n");
}

export default globalSetup;
