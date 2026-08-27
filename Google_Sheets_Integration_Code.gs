/**
 * =========================================================================
 * BAFS Group Scholarship Assessment - Google Sheets Integration Script (Code.gs)
 * ระบบเชื่อมต่อและซิงค์ข้อมูลผลการประเมินการสัมภาษณ์ทุนศึกษา BAFS Group 2569 แบบ 2 ทาง (2-Way Sync)
 * Spreadsheet ID: 1lPD0rCDg8uLP2JlBMRnaYYa35e-OtkQWf_MwLULIzp4
 * =========================================================================
 * 
 * 📌 ขั้นตอนการติดตั้งและเปิดใช้งาน (Setup Instructions):
 * 1. เปิด Google Sheets: https://docs.google.com/spreadsheets/d/1lPD0rCDg8uLP2JlBMRnaYYa35e-OtkQWf_MwLULIzp4/edit
 * 2. ไปที่เมนู ส่วนขยาย (Extensions) > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมดใน Code.gs แล้ววางโค้ดไฟล์นี้ลงไปแทนที่
 * 4. กดปุ่ม "บันทึก" (Save) รูปแผ่นดิสก์ 💾
 * 5. กดปุ่ม "การทำให้ใช้งานได้" (Deploy) > "การทำให้ใช้งานได้ใหม่" (New deployment)
 *    - เลือกประเภทเป็น "เว็บแอป" (Web app)
 *    - คำอธิบาย (Description): BAFS 2-Way Assessment Sync
 *    - ปฏิบัติการในฐานะ (Execute as): ฉัน (Me)
 *    - ผู้มีสิทธิ์เข้าถึง (Who has access): ทุกคน (Anyone)  <-- สำคัญมาก เพื่อให้เว็บเรียก API ได้
 *    - กด "ทำให้ใช้งานได้" (Deploy) และให้สิทธิ์เข้าถึง (Authorize Access)
 * 6. คัดลอก "URL ของเว็บแอป" (Web App URL) ที่ได้ (ลงท้ายด้วย /exec)
 *    นำไปวางในช่อง "Google Apps Script Web App URL" บนหน้าต่างซิงค์ในเว็บไซต์
 * =========================================================================
 */

var SPREADSHEET_ID = "1lPD0rCDg8uLP2JlBMRnaYYa35e-OtkQWf_MwLULIzp4";

var COMMITTEES_DEF = [
  { id: 'EM', name: 'EM', fullName: 'กรรมการ EM' },
  { id: 'MD-BPT', name: 'MD-BPT', fullName: 'กรรมการ MD-BPT' },
  { id: 'MD-TARCO', name: 'MD-TARCO', fullName: 'กรรมการ MD-TARCO' },
  { id: 'MD-BPS', name: 'MD-BPS', fullName: 'กรรมการ MD-BPS' },
  { id: 'HZ', name: 'HZ', fullName: 'กรรมการ HZ' }
];

var CRITERIA_DEF = [
  { id: 1, title: '1. ความสอดคล้อง สนับสนุนต่อกลยุทธ์องค์กร', weight: 25 },
  { id: 2, title: '2. ความผูกพัน และตั้งใจพัฒนาองค์กรในระยะยาว', weight: 25 },
  { id: 3, title: '3. แรงจูงใจและเป้าหมายการศึกษา', weight: 15 },
  { id: 4, title: '4. ภาวะผู้นำและบทบาทแบบอย่างที่ดีในการทำงาน', weight: 15 },
  { id: 5, title: '5. การวางแผน ความรับผิดชอบ (ไม่กระทบงาน/ทีม)', weight: 10 },
  { id: 6, title: '6. การมีส่วนร่วมในกิจกรรมและโครงการขององค์กร', weight: 10 }
];

/**
 * เมนูคำสั่งอัตโนมัติเมื่อเปิด Google Sheets
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🎯 BAFS Assessment')
    .addItem('📜 รีเฟรชชีทบันทึกประวัติ (Refresh Evaluation Logs)', 'refreshLogsSheetOnly')
    .addItem('📊 จัดโครงสร้างชีททั้งหมด (Format All Sheets)', 'setupAllAssessmentSheets')
    .addItem('🔄 ซิงค์ข้อมูลล่าสุดจาก _DATA_STORE (Refresh Sheets)', 'refreshSheetsFromDataStore')
    .addSeparator()
    .addItem('📥 นำเข้าข้อมูล JSON แบบ Manual', 'promptImportData')
    .addItem('📤 ส่งออกข้อมูล JSON', 'promptExportData')
    .addSeparator()
    .addItem('ℹ️ วิธีการเชื่อมต่อระบบ', 'showHelpDialog')
    .addToUi();
}

function refreshLogsSheetOnly() {
  var ss = getSpreadsheet();
  var storeSheet = ss.getSheetByName("_DATA_STORE");
  if (!storeSheet) {
    SpreadsheetApp.getUi().alert("ไม่พบชีท _DATA_STORE");
    return;
  }
  var data = {};
  try {
    data = JSON.parse(storeSheet.getRange("A1").getValue() || "{}");
  } catch (e) {}
  renderLogsSheet(ss, data.candidates || getDefaultCandidatesList(), data.committees || COMMITTEES_DEF, data.evaluations || {});
  SpreadsheetApp.getUi().alert("✅ อัปเดตชีท 📜 Evaluation_Logs เรียบร้อยแล้ว");
}

/**
 * Webhook รับข้อมูล POST จาก Web Application (Web -> Google Sheets)
 */
function doPost(e) {
  try {
    var contents = e.postData ? e.postData.contents : null;
    if (!contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No payload received' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var payload = JSON.parse(contents);
    var result = processIncomingAssessmentData(payload);

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Data successfully synced to Google Sheets',
      timestamp: Date.now(),
      serverTime: new Date().toLocaleString('th-TH')
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Webhook ส่งข้อมูล GET กลับไปยัง Web Application (Google Sheets -> Web 2-Way Sync)
 * Default: Fast Read mode (อ่านจาก _DATA_STORE เท่านั้น, < 0.5 วินาที)
 * ?mode=full: Full Scan mode (อ่านจาก _DATA_STORE + สแกนชีทรายบุคคล)
 */
function doGet(e) {
  try {
    var ss = getSpreadsheet();
    var storeSheet = ss.getSheetByName("_DATA_STORE");
    var stateData = null;

    if (storeSheet) {
      var cellVal = storeSheet.getRange("A1").getValue();
      if (cellVal) {
        try {
          stateData = JSON.parse(cellVal);
        } catch (e) {}
      }
    }

    if (!stateData) {
      stateData = {
        candidates: getDefaultCandidatesList(),
        evaluations: {},
        committees: COMMITTEES_DEF,
        timestamp: Date.now()
      };
    }

    // Only scan candidate sheets if explicitly requested (slow operation)
    var mode = (e && e.parameter && e.parameter.mode) ? e.parameter.mode : 'fast';
    if (mode === 'full') {
      var updatedEvals = scanCandidateSheetsForEdits(ss, stateData.candidates, stateData.evaluations);
      stateData.evaluations = updatedEvals;
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      data: stateData,
      timestamp: stateData.timestamp || Date.now(),
      serverTime: new Date().toLocaleString('th-TH')
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Event Trigger: ทำงานอัตโนมัติเมื่อมีการแก้ไขข้อความหรือตัวเลขในชีท
 */
function onEdit(e) {
  try {
    var range = e.range;
    var sheet = range.getSheet();
    var sheetName = sheet.getName();

    // Check if edited inside one of the candidate sheets (e.g. "1. ศิริราช")
    if (sheetName.match(/^\d+\./)) {
      var ss = sheet.getParent();
      var candidates = getDefaultCandidatesList();
      var storeSheet = getOrCreateStoreSheet(ss);
      var currentStore = {};
      try {
        currentStore = JSON.parse(storeSheet.getRange("A1").getValue() || "{}");
      } catch (err) {}

      var evals = currentStore.evaluations || {};
      var updatedEvals = scanCandidateSheetsForEdits(ss, candidates, evals);
      
      currentStore.evaluations = updatedEvals;
      currentStore.timestamp = Date.now();
      storeSheet.getRange("A1").setValue(JSON.stringify(currentStore));

      // Refresh Summary Sheet
      renderExecutiveSummarySheet(ss, candidates, COMMITTEES_DEF, updatedEvals);
    }
  } catch (err) {
    console.error("onEdit error:", err);
  }
}

/**
 * ประมวลผลข้อมูลที่ส่งมาจากเว็บไซต์
 * บันทึกลง _DATA_STORE และอัปเดตลงชีท 📜 Evaluation_Logs เท่านั้น (Ultra-Fast < 0.3s)
 */
function processIncomingAssessmentData(payload) {
  var ss = getSpreadsheet();
  var candidates = payload.candidates || getDefaultCandidatesList();
  var evaluations = payload.evaluations || {};
  var committees = payload.committees || COMMITTEES_DEF;

  // 1. บันทึกข้อมูล JSON ลง _DATA_STORE เพื่อการซิงค์แบบเรียลไทม์ระหว่างทุกเบราว์เซอร์
  var storeSheet = getOrCreateStoreSheet(ss);
  var storeData = {
    candidates: candidates,
    evaluations: evaluations,
    committees: committees,
    timestamp: payload.timestamp || Date.now()
  };
  storeSheet.getRange("A1").setValue(JSON.stringify(storeData));

  // 2. บันทึกข้อมูลลงชีท 📜 Evaluation_Logs เท่านั้น
  try {
    renderLogsSheet(ss, candidates, committees, evaluations);
  } catch (renderErr) {
    console.error('Logs render error:', renderErr);
  }

  return true;
}

/**
 * สร้างและจัดการชีทสรุปภาพรวม (Executive Summary)
 */
function renderExecutiveSummarySheet(ss, candidates, committees, evaluations) {
  var sheetName = "📊 สรุปผลภาพรวม (Summary)";
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName, 0);
  }
  sheet.clear();
  sheet.setTabColor("#1e3a8a");

  // Title Banner
  sheet.getRange("A1:Q1").merge()
    .setValue("BAFS Group - สรุปผลการประเมินการสัมภาษณ์ผู้ขอรับทุนศึกษา ประจำปี 2569")
    .setFontFamily("Prompt").setFontSize(14).setFontWeight("bold")
    .setBackground("#1e3a8a").setFontColor("#ffffff")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 44);

  // Subtitle
  sheet.getRange("A2:Q2").merge()
    .setValue("คะแนนเฉลี่ยถ่วงน้ำหนัก 100 คะแนน • เกณฑ์ผ่านต้องได้รับมติเอกฉันท์ 5/5 ท่าน • อัปเดตล่าสุด: " + Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss"))
    .setFontFamily("Sarabun").setFontSize(10).setFontStyle("italic")
    .setBackground("#f8fafc").setFontColor("#475569")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(2, 26);

  // Headers
  var headers = [
    ["ลำดับ", "ชื่อ - นามสกุล", "ตำแหน่ง / สังกัด", "ระดับ", "หลักสูตรที่สมัคร", "สถาบันการศึกษา", "9-Box Grid", "งบประมาณ (บาท)",
     "EM (100)", "MD-BPT (100)", "MD-TARCO (100)", "MD-BPS (100)", "HZ (100)",
     "คะแนนเฉลี่ยรวม (100)", "มติกรรมการ", "ผลการตัดสินชี้ขาด", "หมายเหตุ"]
  ];
  
  sheet.getRange("A4:Q4").setValues(headers)
    .setFontFamily("Prompt").setFontSize(10).setFontWeight("bold")
    .setBackground("#2563eb").setFontColor("#ffffff")
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setWrap(true);
  sheet.setRowHeight(4, 36);

  var rows = [];
  candidates.forEach(function (c, idx) {
    var candId = c.id;
    var cEvals = evaluations[candId] || evaluations[String(idx + 1)] || {};
    
    var commScores = [];
    var totalWeighted = 0;
    var passCount = 0;
    var failCount = 0;
    var submittedCount = 0;
    var evaluatedCount = 0;

    committees.forEach(function (comm) {
      var ev = cEvals[comm.id];
      if (ev && ev.scores) {
        var scoreVal = calculateWeightedTotalScore(ev.scores);
        commScores.push(scoreVal > 0 ? scoreVal.toFixed(2) : "-");
        totalWeighted += scoreVal;
        if (scoreVal > 0) evaluatedCount++;
        if (ev.verdict === 'PASS') passCount++;
        if (ev.verdict === 'FAIL') failCount++;
        if (ev.isSubmitted) submittedCount++;
      } else {
        commScores.push("-");
      }
    });

    var avgScore = (evaluatedCount > 0) ? (totalWeighted / evaluatedCount).toFixed(2) : "-";
    var isPassUnanimous = (passCount === 5);
    var finalDecisionText = isPassUnanimous
      ? "✓ ผ่านการคัดเลือก (มติเอกฉันท์ 5/5)"
      : (failCount > 0 ? "✕ ไม่ผ่านการคัดเลือก" : ("รอสรุปผล (" + submittedCount + "/5)"));

    rows.push([
      idx + 1,
      c.name || "-",
      (c.position || "-") + " " + (c.department || c.company || "-"),
      c.degreeLevel || "ปริญญาโท",
      c.programName || "-",
      c.institute || "-",
      c.nineBoxGrid || "Future Leader",
      c.tuitionNumber ? Number(c.tuitionNumber) : (c.tuitionFee || "-"),
      commScores[0],
      commScores[1],
      commScores[2],
      commScores[3],
      commScores[4],
      avgScore,
      "ผ่าน " + passCount + " / ไม่ผ่าน " + failCount,
      finalDecisionText,
      c.specialRecognition || "-"
    ]);
  });

  if (rows.length > 0) {
    var dataRange = sheet.getRange(5, 1, rows.length, 17);
    dataRange.setValues(rows)
      .setFontFamily("Sarabun").setFontSize(10)
      .setVerticalAlignment("middle");

    sheet.getRange(5, 1, rows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(5, 4, rows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(5, 7, rows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(5, 8, rows.length, 1).setNumberFormat("#,##0").setHorizontalAlignment("right");
    sheet.getRange(5, 9, rows.length, 6).setHorizontalAlignment("center");
    sheet.getRange(5, 15, rows.length, 2).setHorizontalAlignment("center").setFontWeight("bold");

    for (var r = 0; r < rows.length; r++) {
      sheet.setRowHeight(5 + r, 42);
      var rowRange = sheet.getRange(5 + r, 1, 1, 17);
      if (r % 2 === 1) {
        rowRange.setBackground("#f8fafc");
      }

      var avgCell = sheet.getRange(5 + r, 14);
      avgCell.setFontWeight("bold").setFontSize(11).setFontColor("#1d4ed8");

      var decisionCell = sheet.getRange(5 + r, 16);
      var textVal = String(rows[r][15]);
      if (textVal.indexOf("ผ่านการคัดเลือก") !== -1) {
        decisionCell.setBackground("#dcfce7").setFontColor("#166534");
      } else if (textVal.indexOf("ไม่ผ่าน") !== -1) {
        decisionCell.setBackground("#ffe4e6").setFontColor("#9f1239");
      }
    }

    sheet.getRange(4, 1, rows.length + 1, 17).setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  }

  // Column Widths
  sheet.setColumnWidth(1, 45);
  sheet.setColumnWidth(2, 170);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 85);
  sheet.setColumnWidth(5, 230);
  sheet.setColumnWidth(6, 170);
  sheet.setColumnWidth(7, 110);
  sheet.setColumnWidth(8, 120);
  sheet.setColumnWidth(9, 85);
  sheet.setColumnWidth(10, 85);
  sheet.setColumnWidth(11, 85);
  sheet.setColumnWidth(12, 85);
  sheet.setColumnWidth(13, 85);
  sheet.setColumnWidth(14, 110);
  sheet.setColumnWidth(15, 110);
  sheet.setColumnWidth(16, 220);
  sheet.setColumnWidth(17, 120);
}

/**
 * สร้างชีทสรุปผลประเมินรายบุคคล (Individual Candidate Summary Sheet)
 */
function renderCandidateSheet(ss, cand, idx, committees, criteria, evaluations) {
  var shortName = cand.name ? (cand.name.split(' ')[0] || cand.name) : ('Candidate_' + (idx + 1));
  var sheetName = ((idx + 1) + '. ' + shortName).substring(0, 31);

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clear();
  sheet.setTabColor("#3b82f6");

  // Title Header
  sheet.getRange("A1:H1").merge()
    .setValue("แบบสรุปผลการประเมินการสัมภาษณ์ผู้ขอรับทุนศึกษา (รายบุคคล)")
    .setFontFamily("Prompt").setFontSize(13).setFontWeight("bold")
    .setBackground("#1e293b").setFontColor("#ffffff")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 38);

  // Candidate Profile Info
  sheet.getRange("A3").setValue("ชื่อผู้ขอรับทุน:").setFontWeight("bold");
  sheet.getRange("B3:D3").merge().setValue(cand.name || "");
  sheet.getRange("E3").setValue("ตำแหน่ง / สังกัด:").setFontWeight("bold");
  sheet.getRange("F3:H3").merge().setValue((cand.position || "") + " " + (cand.department || cand.company || ""));

  sheet.getRange("A4").setValue("ขอรับทุนระดับ:").setFontWeight("bold");
  sheet.getRange("B4:D4").merge().setValue(cand.degreeLevel || "ปริญญาโท");
  sheet.getRange("E4").setValue("สถาบันที่ตอบรับ:").setFontWeight("bold");
  sheet.getRange("F4:H4").merge().setValue(cand.institute || "");

  sheet.getRange("A5").setValue("หลักสูตร:").setFontWeight("bold");
  sheet.getRange("B5:D5").merge().setValue(cand.programName || "");
  sheet.getRange("E5").setValue("9-Box Grid:").setFontWeight("bold");
  sheet.getRange("F5:H5").merge().setValue(cand.nineBoxGrid || "Future Leader");

  sheet.getRange("A6").setValue("รูปแบบการเรียน:").setFontWeight("bold");
  sheet.getRange("B6:D6").merge().setValue(cand.studyFormat || "-");
  sheet.getRange("E6").setValue("งบประมาณ:").setFontWeight("bold");
  sheet.getRange("F6:H6").merge().setValue(cand.tuitionFee || "-");

  sheet.getRange("A3:H6").setFontFamily("Sarabun").setFontSize(10).setBackground("#f8fafc");

  // Table Headers - now showing raw scores (1-5) per criterion
  var headers = [
    ["เกณฑ์การประเมิน", "น้ำหนัก (Weight)", "EM (1-5)", "MD-BPT (1-5)", "MD-TARCO (1-5)", "MD-BPS (1-5)", "HZ (1-5)", "คะแนนเฉลี่ย (1-5)"]
  ];
  sheet.getRange("A8:H8").setValues(headers)
    .setFontFamily("Prompt").setFontSize(10).setFontWeight("bold")
    .setBackground("#2563eb").setFontColor("#ffffff")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(8, 30);

  var candEvals = evaluations[cand.id] || evaluations[String(idx + 1)] || {};
  var scoreRows = [];

  criteria.forEach(function (crit) {
    // Write RAW scores (1-5) instead of weighted scores to eliminate ambiguity
    var commRawScores = committees.map(function (comm) {
      var ev = candEvals[comm.id] || { scores: {} };
      var raw = Number((ev.scores && ev.scores[crit.id]) || 0);
      return raw;
    });

    var nonZeroScores = commRawScores.filter(function (s) { return s > 0; });
    var avgCrit = nonZeroScores.length > 0 ? Number((nonZeroScores.reduce(function (a, b) { return a + b; }, 0) / nonZeroScores.length).toFixed(2)) : 0;

    scoreRows.push([
      crit.title,
      crit.weight + "%",
      commRawScores[0],
      commRawScores[1],
      commRawScores[2],
      commRawScores[3],
      commRawScores[4],
      avgCrit
    ]);
  });

  sheet.getRange(9, 1, scoreRows.length, 8).setValues(scoreRows)
    .setFontFamily("Sarabun").setFontSize(10)
    .setVerticalAlignment("middle");

  sheet.getRange(9, 1, scoreRows.length, 1).setHorizontalAlignment("left");
  sheet.getRange(9, 2, scoreRows.length, 7).setHorizontalAlignment("center");

  // Total Weighted Row
  var commTotals = committees.map(function (comm) {
    var ev = candEvals[comm.id] || { scores: {} };
    return calculateWeightedTotalScore(ev.scores || {});
  });
  var nonZeroTotals = commTotals.filter(function (t) { return t > 0; });
  var grandAvg = nonZeroTotals.length > 0 ? Number((nonZeroTotals.reduce(function (a, b) { return a + b; }, 0) / nonZeroTotals.length).toFixed(2)) : 0;

  var totalRowIdx = 9 + scoreRows.length;
  sheet.getRange(totalRowIdx, 1).setValue("ผลคะแนนคำนวณตามค่าน้ำหนัก (คะแนนเต็ม 100)").setFontWeight("bold");
  sheet.getRange(totalRowIdx, 2).setValue("100%").setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange(totalRowIdx, 3).setValue(commTotals[0]).setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange(totalRowIdx, 4).setValue(commTotals[1]).setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange(totalRowIdx, 5).setValue(commTotals[2]).setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange(totalRowIdx, 6).setValue(commTotals[3]).setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange(totalRowIdx, 7).setValue(commTotals[4]).setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange(totalRowIdx, 8).setValue(grandAvg).setHorizontalAlignment("center").setFontWeight("bold").setFontColor("#1d4ed8");

  sheet.getRange(totalRowIdx, 1, 1, 8).setBackground("#e0f2fe").setFontFamily("Prompt").setFontSize(10);
  sheet.getRange(8, 1, scoreRows.length + 1, 8).setBorder(true, true, true, true, true, true, "#94a3b8", SpreadsheetApp.BorderStyle.SOLID);

  // Qualitative Feedback Sections
  var curRow = totalRowIdx + 2;

  // 2. Strengths
  sheet.getRange(curRow, 1, 1, 8).merge().setValue("2. จุดเด่นหรือจุดแข็งของพนักงาน (ความคิดเห็นจากคณะกรรมการ 5 ท่าน)").setFontWeight("bold").setBackground("#f1f5f9");
  curRow++;
  committees.forEach(function (c) {
    var ev = candEvals[c.id];
    if (ev && ev.strengths) {
      sheet.getRange(curRow, 1, 1, 8).merge().setValue("• [" + c.name + "]: " + ev.strengths).setFontFamily("Sarabun").setFontSize(10).setWrap(true);
      curRow++;
    }
  });

  // 3. Weaknesses / Development
  curRow++;
  sheet.getRange(curRow, 1, 1, 8).merge().setValue("3. จุดอ่อน / จุดที่ควรพัฒนาของพนักงาน (ความคิดเห็นจากคณะกรรมการ 5 ท่าน)").setFontWeight("bold").setBackground("#f1f5f9");
  curRow++;
  committees.forEach(function (c) {
    var ev = candEvals[c.id];
    if (ev && ev.weaknesses) {
      sheet.getRange(curRow, 1, 1, 8).merge().setValue("• [" + c.name + "]: " + ev.weaknesses).setFontFamily("Sarabun").setFontSize(10).setWrap(true);
      curRow++;
    }
  });

  // 4. Commitment
  curRow++;
  sheet.getRange(curRow, 1, 1, 8).merge().setValue("4. ความคิดเห็นเกี่ยวกับความมุ่งมั่นที่จะกลับมาพัฒนาองค์กร").setFontWeight("bold").setBackground("#f1f5f9");
  curRow++;
  committees.forEach(function (c) {
    var ev = candEvals[c.id];
    if (ev && ev.commitment) {
      sheet.getRange(curRow, 1, 1, 8).merge().setValue("• [" + c.name + "]: " + ev.commitment).setFontFamily("Sarabun").setFontSize(10).setWrap(true);
      curRow++;
    }
  });

  // 5. Comments
  curRow++;
  sheet.getRange(curRow, 1, 1, 8).merge().setValue("5. ข้อคิดเห็นอื่นๆ").setFontWeight("bold").setBackground("#f1f5f9");
  curRow++;
  committees.forEach(function (c) {
    var ev = candEvals[c.id];
    if (ev && ev.comments) {
      sheet.getRange(curRow, 1, 1, 8).merge().setValue("• [" + c.name + "]: " + ev.comments).setFontFamily("Sarabun").setFontSize(10).setWrap(true);
      curRow++;
    }
  });

  // 6. Verdicts & Decision
  curRow++;
  var passCount = 0;
  var failCount = 0;
  var verdictSummary = committees.map(function (c) {
    var v = (candEvals[c.id] || {}).verdict;
    if (v === 'PASS') passCount++;
    if (v === 'FAIL') failCount++;
    return c.name + ": " + (v === 'PASS' ? 'ผ่าน' : v === 'FAIL' ? 'ไม่ผ่าน' : 'ยังไม่ลงมติ');
  }).join('  |  ');

  var finalDecision = (passCount === 5) ? '✓ ผ่านการคัดเลือก (มติเอกฉันท์ 5/5 ท่าน)' : (failCount > 0 ? '✕ ไม่ผ่านการคัดเลือก' : 'รอสรุปผล');

  sheet.getRange(curRow, 1, 1, 2).merge().setValue("6. มติของกรรมการสัมภาษณ์:").setFontWeight("bold");
  sheet.getRange(curRow, 3, 1, 6).merge().setValue(verdictSummary).setFontFamily("Sarabun").setFontSize(10);
  curRow++;

  sheet.getRange(curRow, 1, 1, 2).merge().setValue("7. ผลการตัดสินชี้ขาด:").setFontWeight("bold");
  var finalCell = sheet.getRange(curRow, 3, 1, 6).merge().setValue(finalDecision).setFontFamily("Prompt").setFontSize(11).setFontWeight("bold");
  if (passCount === 5) {
    finalCell.setBackground("#dcfce7").setFontColor("#166534");
  } else if (failCount > 0) {
    finalCell.setBackground("#ffe4e6").setFontColor("#9f1239");
  }

  // Column Widths
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 80);
  sheet.setColumnWidth(5, 90);
  sheet.setColumnWidth(6, 80);
  sheet.setColumnWidth(7, 80);
  sheet.setColumnWidth(8, 100);
}

/**
 * สร้างชีทบันทึกประวัติการประเมิน (Audit Trail / Logs Sheet)
 */
function renderLogsSheet(ss, candidates, committees, evaluations) {
  var sheetName = "📜 Evaluation_Logs";
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clear();
  sheet.setTabColor("#64748b");

  // Title Banner
  sheet.getRange("A1:P1").merge()
    .setValue("บันทึกประวัติการลงคะแนนและประเมินผลสัมภาษณ์ (Audit Trail & Evaluation Logs)")
    .setFontFamily("Prompt").setFontSize(13).setFontWeight("bold")
    .setBackground("#334155").setFontColor("#ffffff")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 38);

  var headers = [
    ["ลำดับ", "วัน-เวลาบันทึก (Timestamp)", "ชื่อผู้ขอรับทุน", "กรรมการผู้ประเมิน", "กลยุทธ์ (25%)", "ความผูกพัน (25%)", "เป้าหมาย (15%)", "ภาวะผู้นำ (15%)", "การวางแผน (10%)", "การมีส่วนร่วม (10%)", "คะแนนรวม (100)", "มติกรรมการ", "จุดเด่น / จุดแข็ง", "จุดที่ควรพัฒนา", "ความมุ่งมั่นพัฒนาองค์กร", "ข้อคิดเห็นอื่นๆ"]
  ];

  sheet.getRange("A3:P3").setValues(headers)
    .setFontFamily("Prompt").setFontSize(10).setFontWeight("bold")
    .setBackground("#475569").setFontColor("#ffffff")
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setWrap(true);
  sheet.setRowHeight(3, 30);

  var logRows = [];
  var logIdx = 1;

  candidates.forEach(function (cand) {
    var candEvals = evaluations[cand.id] || {};
    committees.forEach(function (comm) {
      var ev = candEvals[comm.id];
      // Record in logs sheet ONLY when evaluation is officially submitted
      if (ev && ev.isSubmitted) {
        var weightedTotal = calculateWeightedTotalScore(ev.scores || {});
        var timeStr = ev.updatedAt ? Utilities.formatDate(new Date(ev.updatedAt), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss") : Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

        logRows.push([
          logIdx++,
          timeStr,
          cand.name || "-",
          comm.name + " (" + comm.fullName + ")",
          Number(ev.scores[1]) || 0,
          Number(ev.scores[2]) || 0,
          Number(ev.scores[3]) || 0,
          Number(ev.scores[4]) || 0,
          Number(ev.scores[5]) || 0,
          Number(ev.scores[6]) || 0,
          weightedTotal,
          ev.verdict === 'PASS' ? 'ผ่าน (PASS)' : (ev.verdict === 'FAIL' ? 'ไม่ผ่าน (FAIL)' : 'ยังไม่ลงมติ'),
          ev.strengths || "-",
          ev.weaknesses || "-",
          ev.commitment || "-",
          ev.comments || "-"
        ]);
      }
    });
  });

  if (logRows.length > 0) {
    var range = sheet.getRange(4, 1, logRows.length, 16);
    range.setValues(logRows).setFontFamily("Sarabun").setFontSize(10).setVerticalAlignment("middle");
    sheet.getRange(4, 1, logRows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(4, 2, logRows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(4, 5, logRows.length, 8).setHorizontalAlignment("center");
    sheet.getRange(3, 1, logRows.length + 1, 16).setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  }

  sheet.setColumnWidth(1, 45);
  sheet.setColumnWidth(2, 140);
  sheet.setColumnWidth(3, 160);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 80);
  sheet.setColumnWidth(6, 80);
  sheet.setColumnWidth(7, 80);
  sheet.setColumnWidth(8, 80);
  sheet.setColumnWidth(9, 80);
  sheet.setColumnWidth(10, 80);
  sheet.setColumnWidth(11, 100);
  sheet.setColumnWidth(12, 100);
  sheet.setColumnWidth(13, 200);
  sheet.setColumnWidth(14, 200);
  sheet.setColumnWidth(15, 200);
  sheet.setColumnWidth(16, 200);
}

/**
 * สแกนชีทผู้สมัครเพื่อดึงคะแนนที่ผู้ใช้แก้ไขโดยตรงใน Google Sheets
 */
function scanCandidateSheetsForEdits(ss, candidates, currentEvals) {
  var evals = JSON.parse(JSON.stringify(currentEvals || {}));
  var commIds = ['EM', 'MD-BPT', 'MD-TARCO', 'MD-BPS', 'HZ'];

  candidates.forEach(function (cand, idx) {
    var shortName = cand.name ? (cand.name.split(' ')[0] || cand.name) : ('Candidate_' + (idx + 1));
    var sheetName = ((idx + 1) + '. ' + shortName).substring(0, 31);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    if (!evals[cand.id]) evals[cand.id] = {};

    // Read Raw Score Grid from Sheet (Rows 9..14, Columns C..G which correspond to EM, MD-BPT, MD-TARCO, MD-BPS, HZ)
    // Scores are now stored as raw 1-5 values in the sheet
    var scoreData = sheet.getRange("C9:G14").getValues();

    commIds.forEach(function (commId, colIdx) {
      if (!evals[cand.id][commId]) {
        evals[cand.id][commId] = { scores: {} };
      }
      var scoresObj = evals[cand.id][commId].scores || {};

      for (var critIdx = 0; critIdx < 6; critIdx++) {
        var val = Number(scoreData[critIdx][colIdx]) || 0;
        // Values in sheet are now raw scores (1-5), just read and clamp directly
        var rawScore = Math.round(val);
        if (rawScore > 0) {
          scoresObj[critIdx + 1] = Math.min(5, Math.max(1, rawScore));
        }
      }
      evals[cand.id][commId].scores = scoresObj;
    });
  });

  return evals;
}

/**
 * คำนวณคะแนนรวมถ่วงน้ำหนัก (เต็ม 100)
 */
function calculateWeightedTotalScore(scores) {
  if (!scores) return 0;
  var weights = { 1: 25, 2: 25, 3: 15, 4: 15, 5: 10, 6: 10 };
  var total = 0;
  for (var k = 1; k <= 6; k++) {
    var raw = Number(scores[k]) || 0;
    if (raw > 0) {
      total += (raw / 5) * weights[k];
    }
  }
  return Number(total.toFixed(2));
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getOrCreateStoreSheet(ss) {
  var sheet = ss.getSheetByName("_DATA_STORE");
  if (!sheet) {
    sheet = ss.insertSheet("_DATA_STORE");
    sheet.hideSheet();
  }
  return sheet;
}

function setupAllAssessmentSheets() {
  processIncomingAssessmentData({ candidates: getDefaultCandidatesList(), evaluations: {} });
}

function refreshSheetsFromDataStore() {
  var ss = getSpreadsheet();
  var storeSheet = ss.getSheetByName("_DATA_STORE");
  if (storeSheet) {
    var val = storeSheet.getRange("A1").getValue();
    if (val) {
      processIncomingAssessmentData(JSON.parse(val));
      SpreadsheetApp.getUi().alert("✅ ซิงค์ข้อมูลล่าสุดลงทุกชีทเรียบร้อยแล้ว");
      return;
    }
  }
  setupAllAssessmentSheets();
}

function promptImportData() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('📥 นำเข้าข้อมูล JSON', 'วาง JSON Payload จากเว็บไซต์เพื่ออัปเดตข้อมูลลงชีททันที:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() == ui.Button.OK) {
    var text = res.getResponseText().trim();
    if (text) {
      try {
        processIncomingAssessmentData(JSON.parse(text));
        ui.alert('✅ สำเร็จ', 'นำเข้าข้อมูลและอัปเดตทุกชีทเรียบร้อยแล้ว', ui.ButtonSet.OK);
      } catch (err) {
        ui.alert('❌ ผิดพลาด', 'JSON ไม่ถูกต้อง: ' + err.message, ui.ButtonSet.OK);
      }
    }
  }
}

function promptExportData() {
  var ss = getSpreadsheet();
  var storeSheet = ss.getSheetByName("_DATA_STORE");
  var val = storeSheet ? storeSheet.getRange("A1").getValue() : "{}";
  var ui = SpreadsheetApp.getUi();
  ui.prompt('📤 ส่งออกข้อมูล JSON (คัดลอกไปใช้งาน)', val, ui.ButtonSet.OK);
}

function showHelpDialog() {
  var ui = SpreadsheetApp.getUi();
  var msg = "📌 วิธีเชื่อมต่อระบบ 2-Way Sync กับเว็บไซต์:\n\n" +
            "1. กดเมนู 'การทำให้ใช้งานได้' (Deploy) > 'การทำให้ใช้งานได้ใหม่' (New deployment)\n" +
            "2. เลือกประเภทเป็น 'เว็บแอป' (Web app)\n" +
            "3. ผู้มีสิทธิ์เข้าถึง (Who has access) ให้เลือกเป็น 'ทุกคน' (Anyone)\n" +
            "4. กด Deploy แล้วคัดลอก Web App URL ไปใส่ในเว็บไซต์\n\n" +
            "ระบบจะซิงค์คะแนนอัตโนมัติเมื่อกรรมการลงคะแนน และหากแก้ไขในชีท ข้อมูลจะเด้งกลับไปที่เว็บทันที!";
  ui.alert('ℹ️ คำแนะนำการเชื่อมต่อ 2-Way Sync', msg, ui.ButtonSet.OK);
}

function getDefaultCandidatesList() {
  return [
    {
      id: "cand-1",
      name: "นายศิริราช นิ่มพิลา",
      position: "รักษาการผู้ช่วยผู้จัดการ คลังน้ำมันพิจิตร",
      department: "สังกัด BPT",
      degreeLevel: "ปริญญาโท",
      programName: "หลักสูตรบริหารธุรกิจมหาบัณฑิต",
      institute: "มหาวิทยาลัยนเรศวร",
      nineBoxGrid: "Future Leader",
      tuitionNumber: 210000,
      tuitionFee: "210,000.00 บาท",
      specialRecognition: "UL&YT 2024"
    },
    {
      id: "cand-2",
      name: "นางสาวพิมพ์พจี ภูริโภควินท์",
      position: "เจ้าหน้าที่นวัตกรรม แผนกนวัตกรรม ฝ่ายเทคนิค",
      department: "สังกัด BAFS",
      degreeLevel: "ปริญญาโท",
      programName: "หลักสูตรการจัดการมหาบัณฑิต (EI)",
      institute: "มหาวิทยาลัยมหิดล (CMMU)",
      nineBoxGrid: "Potential Star",
      tuitionNumber: 379000,
      tuitionFee: "379,000.00 บาท",
      specialRecognition: "-"
    },
    {
      id: "cand-3",
      name: "นายณัฐนิธิ กาญตชาติพิชัย",
      position: "วิศวกรบริหารงานอาคารสถานที่",
      department: "สังกัด BAFS",
      degreeLevel: "ปริญญาโท",
      programName: "หลักสูตรบริหารธุรกิจมหาบัณฑิต (MBA-POS)",
      institute: "สถาบันการจัดการปัญญาภิวัฒน์",
      nineBoxGrid: "Future Leader",
      tuitionNumber: 195000,
      tuitionFee: "195,000.00 บาท",
      specialRecognition: "-"
    },
    {
      id: "cand-4",
      name: "นางสาวนิสากร สุจริตพานิช",
      position: "เลขานุการผู้อำนวยการ ฝ่ายกลยุทธ์และความยั่งยืน",
      department: "สังกัด BAFS",
      degreeLevel: "ปริญญาโท",
      programName: "หลักสูตรศิลปศาสตรมหาบัณฑิต (นานาชาติ)",
      institute: "จุฬาลงกรณ์มหาวิทยาลัย",
      nineBoxGrid: "Potential Star",
      tuitionNumber: 298000,
      tuitionFee: "298,000.00 บาท",
      specialRecognition: "-"
    }
  ];
}