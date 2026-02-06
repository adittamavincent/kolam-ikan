import * as fs from "fs";
import * as path from "path";

async function validate() {
  console.log("🔍 Validating seed files...");

  const files = [
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

  let hasError = false;

  for (const file of files) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Missing file: ${file}`);
      hasError = true;
    } else {
      console.log(`✅ Found: ${file}`);
    }
  }

  if (hasError) {
    console.error("\n❌ Validation failed. Some seed files are missing.");
    process.exit(1);
  } else {
    console.log("\n✅ Validation passed. All seed files are present.");
  }
}

validate().catch((e) => {
  console.error(e);
  process.exit(1);
});
