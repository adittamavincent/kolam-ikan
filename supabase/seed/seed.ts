import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { Database } from "../../src/lib/types/database.types";

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

  const scripts = [
    "00_reset.sql",
    "01_test_user.sql",
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
