// scripts/generate-samples.js
// Generates standard sample files for testing file import functionality.

import ExcelJS from "exceljs";
import path from "node:path";
import fs from "node:fs";

async function generateSamples() {
  const samplesDir = path.resolve(process.cwd(), "data/samples");
  if (!fs.existsSync(samplesDir)) {
    fs.mkdirSync(samplesDir, { recursive: true });
  }

  // 1. Good Race File
  const goodWb = new ExcelJS.Workbook();
  const goodWs = goodWb.addWorksheet("Race Data");
  goodWs.columns = [
    { header: "Venue", key: "venue" },
    { header: "Race Date", key: "raceDate" },
    { header: "Race Category", key: "raceCategory" },
    { header: "Race No", key: "raceNo" },
    { header: "Distance", key: "distance" },
    { header: "Horse Name", key: "horseName" },
    { header: "Placing", key: "placing" },
    { header: "Current Rating", key: "currentRating" },
    { header: "Number of Previous Runs", key: "previousRuns" },
    { header: "Weight Carried", key: "weightCarried" },
    { header: "Jockey", key: "jockey" },
    { header: "Trainer", key: "trainer" },
    { header: "Timing", key: "timing" },
    { header: "Verdict", key: "verdict" },
  ];

  goodWs.addRow({
    venue: "BNG",
    raceDate: "07/11/2026",
    raceCategory: "60-85",
    raceNo: 1,
    distance: 1400,
    horseName: "Sample Runner Alpha",
    placing: 1,
    currentRating: 72,
    previousRuns: 6,
    weightCarried: 59.5,
    jockey: "P. Trevor",
    trainer: "S. Narredu",
    timing: "1:24.50",
    verdict: "1 1/2",
  });

  goodWs.addRow({
    venue: "BNG",
    raceDate: "07/11/2026",
    raceCategory: "60-85",
    raceNo: 1,
    distance: 1400,
    horseName: "Sample Runner Beta",
    placing: 2,
    currentRating: 68,
    previousRuns: 5,
    weightCarried: 57.0,
    jockey: "A. Sandesh",
    trainer: "D. Byramji",
    timing: "1:24.75",
    verdict: "1/2",
  });

  goodWs.addRow({
    venue: "BNG",
    raceDate: "07/11/2026",
    raceCategory: "60-85",
    raceNo: 1,
    distance: 1400,
    horseName: "Sample Runner Gamma",
    placing: 3,
    currentRating: 65,
    previousRuns: 4,
    weightCarried: 56.0,
    jockey: "S. John",
    trainer: "Neil Darashah",
    timing: "1:24.90",
    verdict: "NK",
  });

  await goodWb.xlsx.writeFile(path.join(samplesDir, "good_race.xlsx"));
  console.log("✓ Created good_race.xlsx");

  // 2. Missing Mandatory Field File (Row 2 missing Placing)
  const missingWb = new ExcelJS.Workbook();
  const missingWs = missingWb.addWorksheet("Defective Race");
  missingWs.columns = [
    { header: "Venue", key: "venue" },
    { header: "Race Date", key: "raceDate" },
    { header: "Race Category", key: "raceCategory" },
    { header: "Race No", key: "raceNo" },
    { header: "Distance", key: "distance" },
    { header: "Horse Name", key: "horseName" },
    { header: "Placing", key: "placing" },
    { header: "Current Rating", key: "currentRating" },
    { header: "Number of Previous Runs", key: "previousRuns" },
  ];

  missingWs.addRow({
    venue: "BNG",
    raceDate: "07/11/2026",
    raceCategory: "60-85",
    raceNo: 2,
    distance: 1200,
    horseName: "Valid Runner One",
    placing: 1,
    currentRating: 50,
    previousRuns: 4,
  });

  missingWs.addRow({
    venue: "BNG",
    raceDate: "07/11/2026",
    raceCategory: "60-85",
    raceNo: 2,
    distance: 1200,
    horseName: "Missing Placing Runner",
    placing: null, // MISSING MANDATORY FIELD
    currentRating: 48,
    previousRuns: 3,
  });

  await missingWb.xlsx.writeFile(path.join(samplesDir, "missing_mandatory.xlsx"));
  console.log("✓ Created missing_mandatory.xlsx");

  // 3. Report with One Unmatched Remark
  const reportWb = new ExcelJS.Workbook();
  const reportWs = reportWb.addWorksheet("Starter Report");
  reportWs.columns = [
    { header: "Race Date", key: "raceDate" },
    { header: "Race No", key: "raceNo" },
    { header: "Horse Name", key: "horseName" },
    { header: "Remark", key: "remark" },
  ];

  // Matched with Sample Runner Alpha
  reportWs.addRow({
    raceDate: "07/11/2026",
    raceNo: 1,
    horseName: "Sample Runner Alpha",
    remark: "Slowly away",
  });

  // Unmatched horse
  reportWs.addRow({
    raceDate: "07/11/2026",
    raceNo: 1,
    horseName: "Unregistered Mystery Horse",
    remark: "Lost few lengths",
  });

  await reportWb.xlsx.writeFile(path.join(samplesDir, "report_with_unmatched.xlsx"));
  console.log("✓ Created report_with_unmatched.xlsx");
}

generateSamples().catch(console.error);
