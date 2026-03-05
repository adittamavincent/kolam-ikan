import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";

// Load env vars from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function createTestUser() {
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

  console.log("\nTest User Credentials:");
  console.log("Email: test@kolamikan.local");
  console.log("Password: KolamTest2026!");
}

createTestUser().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
