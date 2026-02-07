import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { Database } from "../../src/lib/types/database.types";

// Load env vars from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function runSeedScript(filename: string) {
  console.log(`🌱 Running ${filename}...`);

  const sql = fs.readFileSync(path.join(__dirname, filename), "utf-8");

  // Split on semicolons and execute each statement
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.rpc("exec_sql" as any, {
      sql: statement,
    });

    if (error) {
      console.error(`❌ Error in ${filename}:`, error);
      throw error;
    }
  }

  console.log(`✅ ${filename} completed`);
}

async function seed() {
  console.log("🌱 Starting seed process...\n");

  // 1. Reset Database
  await runSeedScript("00_reset.sql");

  // 2. Create Test User via Auth Admin API
  console.log("🌱 Creating test user...");
  const { error: userError } = await supabase.auth.admin.createUser({
    email: "test@kolamikan.local",
    password: "KolamTest2026!",
    email_confirm: true,
    user_metadata: { full_name: "Test User", is_seed_user: true },
    id: "00000000-0000-0000-0000-000000000001",
  });

  if (userError) {
    console.warn("⚠️  Test user creation warning (might already exist):", userError.message);
  } else {
    console.log("✅ Test user created successfully");
  }

  // 3. Run remaining seed scripts
  const scripts = [
    // "01_test_user.sql", // Skipped
    "02_personas.sql",
    "03_domains.sql",
    "04_cabinets.sql",
    "05_streams.sql",
    "06_canvases.sql",
    "07_entries.sql",
    "08_sections.sql",
  ];

  for (const script of scripts) {
    await runSeedScript(script);
  }

  console.log("\n✅ Seed process completed!");
  console.log("\nTest User Credentials:");
  console.log("Email: test@kolamikan.local");
  console.log("Password: KolamTest2026!");
}

seed().catch((error) => {
  console.error("Fatal error during seeding:", error);
  process.exit(1);
});
