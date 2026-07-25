const CONFIG = {
  SCHOOL_NAME_FALLBACK: 'โรงเรียน'
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ระบบวิเคราะห์ข้อมูลนักเรียนรายบุคคล')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getDashboard() {
  return getInitialData();
}

function getInitialData() {
  const all = getAllDashboardData_();
  if (all.reports.length > 1) return buildCombinedDashboard_(all);
  if (all.reports.length === 1) return all.reports[0];
  throw new Error('ไม่พบชีตข้อมูลนักเรียน RT, NT หรือ O-NET ในไฟล์นี้ โปรดตรวจสอบว่าไฟล์ถูกแปลงเป็น Google Sheets แล้ว และมีชีต School04/R-School04 ที่มีหัวข้อชื่อ-สกุล');
}

function getReportDashboard(reportKey) {
  const all = getAllDashboardData_();
  const reports = Array.isArray(all.reports) ? all.reports : [];
  const found = safeFind_(reports, x => x && x.report && (x.report.key === reportKey || x.report.type === reportKey));
  if (!found) throw new Error('ไม่พบข้อมูลประเภทที่เลือก: ' + reportKey);
  return found;
}

function getStudentDetail(reportKey, studentId) {
  // รองรับโค้ดเก่าที่ส่งมาแค่ studentId
  if (typeof studentId === 'undefined') {
    studentId = reportKey;
    reportKey = '';
  }
  const all = getAllDashboardData_();
  const reports = Array.isArray(all.reports) ? all.reports : [];
  let data = reportKey ? safeFind_(reports, x => x && x.report && (x.report.key === reportKey || x.report.type === reportKey)) : reports[0];
  if (!data) throw new Error('ไม่พบข้อมูลรายงานสำหรับนักเรียนที่เลือก');
  const students = Array.isArray(data._rawStudents) ? data._rawStudents : (Array.isArray(data.students) ? data.students : []);
  const student = safeFind_(students, s => s && String(s.id) === String(studentId));
  if (!student) throw new Error('ไม่พบนักเรียนที่เลือก');

  // สำคัญ: กราฟรายบุคคลต้องมี 2 ชุดข้อมูลเสมอ คือคะแนนนักเรียนและค่าเฉลี่ยโรงเรียน
  // จึงคำนวณค่าเฉลี่ยโรงเรียนจากนักเรียนทุกคนอีกครั้ง โดยอิง label เดียวกับนักเรียนที่เลือก
  // วิธีนี้ช่วยแก้กรณีไฟล์ RT/NT รวมที่ชื่อหัวตารางหรือชื่อชีตไม่ตรงกัน 100%
  const studentRadar = buildStudentRadarRows_(student, students, data.report);

  return {
    report: data.report,
    profile: {
      id: student.id,
      no: student.no,
      seatNo: student.seatNo,
      maskedName: student.maskedName,
      type: student.type,
      mathAvg: student.mathAvg,
      thaiAvg: student.thaiAvg,
      totalAvg: student.totalAvg,
      quality: student.quality
    },
    radar: studentRadar,
    strengths: safeArray_(student.strands).filter(x => x && x.percent >= 70).sort((a,b)=>b.percent-a.percent),
    needs: safeArray_(student.strands).filter(x => x && x.percent < 50).sort((a,b)=>a.percent-b.percent),
    detailRows: student.detailRows,
    recommendations: buildStudentRecommendations_(student, data.report)
  };
}

function buildStudentRadarRows_(student, allStudents, report) {
  const rows = [];
  const studentStrands = safeArray_(student && student.strands).filter(x => x && x.label);
  const map = {};

  safeArray_(allStudents).forEach(st => {
    safeArray_(st && st.strands).forEach(x => {
      if (!x || !x.label) return;
      const key = radarKey_(x.subject, x.label);
      if (!map[key]) map[key] = { subject: x.subject, label: x.label, values: [] };
      const n = Number(x.percent);
      if (!isNaN(n)) map[key].values.push(n);
    });
  });

  studentStrands.forEach(x => {
    const key = radarKey_(x.subject, x.label);
    const schoolAvg = map[key] && map[key].values.length ? average_(map[key].values) : NaN;
    rows.push({
      label: shortenLabel_(x.subject, x.label, report),
      fullLabel: x.label,
      subject: x.subject,
      student: round2_(Number(x.percent) || 0),
      school: !isNaN(schoolAvg) ? round2_(schoolAvg) : 0,
      schoolAvg: !isNaN(schoolAvg) ? round2_(schoolAvg) : 0
    });
  });

  // กรณีบางไฟล์ไม่มี strand ย่อย ให้ fallback เป็น 2 ด้านหลัก เพื่อให้กราฟไม่ว่าง
  if (!rows.length) {
    const firstValues = safeArray_(allStudents).map(s => Number(s && s.mathAvg)).filter(x => !isNaN(x));
    const secondValues = safeArray_(allStudents).map(s => Number(s && s.thaiAvg)).filter(x => !isNaN(x));
    rows.push({ label: report && report.firstShort || 'ด้านที่ 1', subject: report && report.firstLabel || '', student: round2_(Number(student.mathAvg) || 0), school: round2_(average_(firstValues)), schoolAvg: round2_(average_(firstValues)) });
    rows.push({ label: report && report.secondShort || 'ด้านที่ 2', subject: report && report.secondLabel || '', student: round2_(Number(student.thaiAvg) || 0), school: round2_(average_(secondValues)), schoolAvg: round2_(average_(secondValues)) });
  }

  return rows;
}

function radarKey_(subject, label) {
  return normalizeText_(subject) + '|' + normalizeText_(label);
}

function normalizeText_(text) {
  return String(text || '').replace(/\s+/g, '').replace(/[()（）]/g, '').trim();
}

function testGetInitialData() {
  const data = getInitialData();
  Logger.log(JSON.stringify({ mode: data.mode, report: data.report, reports: data.reports && data.reports.length, school: data.school }, null, 2));
}

function refreshData() {
  _cachedDashboardAll = null;
  return getInitialData();
}

let _cachedDashboardAll = null;
const RE_REPORT_NAME = /\(NT\)|\(RT\)|O-NET|ONET|คุณภาพผู้เรียน|ความสามารถด้านการอ่านออก|R-School/i;
const RE_STUDENT_HEADER = /ชื่อ-สกุล|เลขที่นั่งสอบ|ลำดับ/;

function getAllDashboardData_() {
  if (_cachedDashboardAll) return _cachedDashboardAll;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const reports = [];

  for (let index = 0; index < sheets.length; index++) {
    const sheet = sheets[index];
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 3 || lastCol < 2) continue;

    // Fast check: Inspect top 20 rows and 30 columns first without pulling full sheet values
    const topValues = sheet.getRange(1, 1, Math.min(20, lastRow), Math.min(30, lastCol)).getDisplayValues();
    if (!isReportSheet_(topValues)) continue;

    try {
      const values = sheet.getDataRange().getDisplayValues();
      const processed = processSheet_(sheet, values, index);
      if (processed && processed.students && processed.students.length) reports.push(processed);
    } catch (err) {
      Logger.log('ข้ามชีต ' + sheet.getName() + ': ' + err.message);
    }
  }
  reports.sort((a,b) => {
    const order = { RT: 1, NT: 2, ONET: 3 };
    return (order[a.report.type] || 9) - (order[b.report.type] || 9);
  });
  const result = { reports: reports, school: reports[0] ? reports[0].school : { name: CONFIG.SCHOOL_NAME_FALLBACK } };
  _cachedDashboardAll = result;
  return result;
}

function isReportSheet_(values) {
  let text = '';
  const maxR = Math.min(values.length, 20);
  for (let r = 0; r < maxR; r++) {
    const row = values[r];
    if (!row) continue;
    const maxC = Math.min(row.length, 30);
    for (let c = 0; c < maxC; c++) {
      if (row[c]) text += row[c] + ' | ';
    }
  }
  return RE_REPORT_NAME.test(text) && RE_STUDENT_HEADER.test(text);
}

function processSheet_(sheet, values, sheetIndex) {
  const school = extractSchoolInfo_(values);
  const report = detectReport_(values);
  report.sheetName = sheet.getName();
  report.key = report.type + '_' + (sheetIndex + 1);

  if (report.type === 'ONET') {
    return processOnetSheet_(sheet, values, sheetIndex, school, report);
  }

  const sections = safeArray_(report.sections).map(sub => parseSubjectSection_(values, sub, report)).filter(Boolean);
  const totalSection = report.totalSection ? parseSubjectSection_(values, report.totalSection, report) : null;
  const studentsMap = {};

  sections.forEach(section => {
    safeArray_(section.rows).forEach(row => {
      const id = row.cid || row.seatNo || row.no;
      if (!studentsMap[id]) {
        studentsMap[id] = {
          id: id,
          no: row.no,
          seatNo: row.seatNo,
          cid: row.cid,
          name: row.name,
          maskedName: maskSurname_(row.name),
          type: row.type,
          subjects: {},
          totals: null,
          detailRows: []
        };
      }
      studentsMap[id].subjects[section.key] = row;
      safeArray_(row.metrics).forEach(m => {
        studentsMap[id].detailRows.push({
          subject: section.title,
          group: m.group,
          label: m.label,
          score: m.score,
          percent: m.percent,
          level: qualityLevel_(m.percent, section.qualityType)
        });
      });
    });
  });

  if (totalSection) {
    safeArray_(totalSection.rows).forEach(row => {
      const id = row.cid || row.seatNo || row.no;
      if (!studentsMap[id]) return;
      studentsMap[id].totals = row;
    });
  }

  const students = Object.values(studentsMap).map(s => {
    const firstStrands = getStrandMetrics_(s.subjects && s.subjects.first ? s.subjects.first.metrics : [], report.firstLabel, report.type, report.firstQualityType);
    const secondStrands = getStrandMetrics_(s.subjects && s.subjects.second ? s.subjects.second.metrics : [], report.secondLabel, report.type, report.secondQualityType);
    s.strands = firstStrands.concat(secondStrands);
    s.mathAvg = round2_(subjectAverage_(s.subjects.first));
    s.thaiAvg = round2_(subjectAverage_(s.subjects.second));
    const totalFromReport = s.totals ? totalAverageFromRow_(s.totals) : NaN;
    s.totalAvg = !isNaN(totalFromReport) ? round2_(totalFromReport) : round2_(average_([s.mathAvg, s.thaiAvg].filter(x => !isNaN(x))));
    s.quality = qualityLevel_(s.totalAvg, report.totalQualityType);
    return s;
  }).sort((a,b)=> Number(a.no || 0) - Number(b.no || 0));

  const strandAverages = [];
  const allKeys = {};
  students.forEach(st => st.strands.forEach(x => {
    const key = x.subject + '|' + x.label;
    if (!allKeys[key]) allKeys[key] = { subject: x.subject, label: x.label, values: [], shortLabel: shortenLabel_(x.subject, x.label, report) };
    allKeys[key].values.push(x.percent);
  }));
  Object.values(allKeys).forEach(x => strandAverages.push({
    subject: x.subject,
    label: x.label,
    shortLabel: x.shortLabel,
    avg: round2_(average_(x.values)),
    level: qualityLevel_(average_(x.values), x.subject === report.firstLabel ? report.firstQualityType : report.secondQualityType)
  }));

  const summary = {
    totalStudents: students.length,
    mathAvg: round2_(average_(students.map(s => s.mathAvg))),
    thaiAvg: round2_(average_(students.map(s => s.thaiAvg))),
    totalAvg: round2_(average_(students.map(s => s.totalAvg))),
    veryGoodCount: safeArray_(students).filter(s => s && s.quality === 'ดีมาก').length,
    goodCount: safeArray_(students).filter(s => s && s.quality === 'ดี').length,
    fairCount: safeArray_(students).filter(s => s && s.quality === 'พอใช้').length,
    improveCount: safeArray_(students).filter(s => s && s.quality === 'ปรับปรุง').length
  };

  const data = { report, school, sections, totalSection, students, strandAverages, summary };
  return {
    mode: 'REPORT',
    report: data.report,
    school: data.school,
    summary: data.summary,
    strandAverages: data.strandAverages,
    analysis: buildSchoolAnalysis_(data),
    overviewTables: buildOverviewTables_(data),
    students: data.students.map(s => ({
      id: s.id,
      no: s.no,
      seatNo: s.seatNo,
      name: s.name,
      maskedName: s.maskedName,
      type: s.type,
      mathAvg: s.mathAvg,
      thaiAvg: s.thaiAvg,
      totalAvg: s.totalAvg,
      quality: s.quality
    })),
    _rawStudents: data.students,
    _rawData: data
  };
}


function processOnetSheet_(sheet, values, sheetIndex, school, report) {
  const headerRow = findOnetHeaderRow_(values);
  if (headerRow < 0) throw new Error('ไม่พบหัวตารางรายบุคคล O-NET');
  const students = [];
  const subjects = safeArray_(report.onetSubjects);

  for (let r = headerRow + 3; r < values.length; r++) {
    const row = values[r] || [];
    const no = row[0];
    const name = row[3];
    if (!name || String(name).indexOf('หมายเหตุ') >= 0) break;
    if (!no || isNaN(Number(no))) {
      if (students.length && row.join('').trim() === '') break;
      continue;
    }
    const st = {
      id: row[2] || row[1] || no,
      no: Number(no),
      seatNo: row[1] || '',
      cid: row[2] || '',
      name: name,
      maskedName: maskSurname_(name),
      type: report.typeLabel || ('O-NET ' + (report.grade || '')),
      subjects: {},
      detailRows: [],
      strands: []
    };
    subjects.forEach(sub => {
      const score = toNumber_(row[sub.scoreCol]);
      const levelScore = toNumber_(row[sub.levelCol]);
      const level = onetLevelFromScore_(levelScore, score, sub.qualityType);
      st.subjects[sub.key] = {
        key: sub.key,
        title: sub.label,
        metrics: [{ label: sub.label, group: 'O-NET', score: score, percent: score, levelScore: levelScore }]
      };
      st.detailRows.push({ subject: sub.label, group: 'O-NET', label: sub.label, score: score, percent: score, level: level, levelScore: levelScore });
      st.strands.push({ subject: 'O-NET', label: sub.label, percent: score, level: level, levelScore: levelScore });
    });
    st.mathAvg = round2_(st.subjects.thai ? st.subjects.thai.metrics[0].percent : 0); // ช่องแรกของ UI ใช้ภาษาไทย
    st.thaiAvg = round2_(st.subjects.math ? st.subjects.math.metrics[0].percent : 0); // ช่องที่สองของ UI ใช้คณิตศาสตร์
    st.scienceAvg = round2_(st.subjects.science ? st.subjects.science.metrics[0].percent : 0);
    st.englishAvg = round2_(st.subjects.english ? st.subjects.english.metrics[0].percent : 0);
    st.totalAvg = round2_(average_(subjects.map(sub => st.subjects[sub.key] ? st.subjects[sub.key].metrics[0].percent : NaN)));
    st.weighted30 = toNumber_(row[14]);
    st.quality = qualityLevel_(st.totalAvg, report.totalQualityType);
    students.push(st);
  }

  const strandAverages = subjects.map(sub => {
    const vals = students.map(s => s.subjects[sub.key] ? s.subjects[sub.key].metrics[0].percent : NaN).filter(x => !isNaN(Number(x)));
    const avg = round2_(average_(vals));
    return { subject: 'O-NET', label: sub.label, shortLabel: sub.short, avg: avg, level: qualityLevel_(avg, sub.qualityType) };
  });

  const summary = {
    totalStudents: students.length,
    mathAvg: round2_(average_(students.map(s => s.mathAvg))),
    thaiAvg: round2_(average_(students.map(s => s.thaiAvg))),
    scienceAvg: round2_(average_(students.map(s => s.scienceAvg))),
    englishAvg: round2_(average_(students.map(s => s.englishAvg))),
    totalAvg: round2_(average_(students.map(s => s.totalAvg))),
    veryGoodCount: safeArray_(students).filter(s => s && s.quality === 'ดีมาก').length,
    goodCount: safeArray_(students).filter(s => s && s.quality === 'ดี').length,
    fairCount: safeArray_(students).filter(s => s && s.quality === 'พอใช้').length,
    improveCount: safeArray_(students).filter(s => s && s.quality === 'ปรับปรุง').length
  };

  const data = { report, school, sections: [], totalSection: null, students, strandAverages, summary };
  return {
    mode: 'REPORT',
    report: data.report,
    school: data.school,
    summary: data.summary,
    strandAverages: data.strandAverages,
    analysis: buildSchoolAnalysis_(data),
    overviewTables: buildOverviewTables_(data),
    students: data.students.map(s => ({
      id: s.id,
      no: s.no,
      seatNo: s.seatNo,
      name: s.name,
      maskedName: s.maskedName,
      type: s.type,
      mathAvg: s.mathAvg,
      thaiAvg: s.thaiAvg,
      scienceAvg: s.scienceAvg,
      englishAvg: s.englishAvg,
      totalAvg: s.totalAvg,
      quality: s.quality
    })),
    _rawStudents: data.students,
    _rawData: data
  };
}

function findOnetHeaderRow_(values) {
  for (let r = 0; r < values.length; r++) {
    const text = (values[r] || []).join(' ').replace(/\s+/g, ' ');
    if (/ลำดับ/.test(text) && /ชื่อ\s*-\s*สกุล|ชื่อ/.test(text) && /O-NET|ผลคะแนน/.test(text)) return r;
  }
  return -1;
}

function onetLevelFromScore_(levelScore, percent, qualityType) {
  const n = Number(levelScore);
  if (!isNaN(n) && n > 0) {
    if (n >= 3.5) return 'ดีมาก';
    if (n >= 2.5) return 'ดี';
    if (n >= 1.5) return 'พอใช้';
    return 'ปรับปรุง';
  }
  return qualityLevel_(percent, qualityType);
}

function buildCombinedDashboard_(all) {
  const reports = all.reports.map(d => ({
    key: d.report.key,
    type: d.report.type,
    shortName: d.report.shortName,
    grade: d.report.grade,
    title: d.report.headerTitle,
    sheetName: d.report.sheetName,
    firstShort: d.report.firstShort,
    secondShort: d.report.secondShort,
    academicYear: d.report.academicYear,
    onetSubjects: d.report.onetSubjects || [],
    summary: d.summary,
    school: d.school,
    analysis: d.analysis,
    overviewTables: d.overviewTables,
    strandAverages: d.strandAverages,
    students: d.students,
    _rawStudents: d._rawStudents,
    report: d.report
  }));
  const school = all.school || (reports[0] && reports[0].school) || { name: CONFIG.SCHOOL_NAME_FALLBACK };
  const totalStudents = reports.reduce((sum, r) => sum + ((r.summary && r.summary.totalStudents) || 0), 0);
  const overallAvg = reports.length ? round2_(average_(reports.map(r => r.summary ? r.summary.totalAvg : 0))) : 0;
  const rtReport = safeFind_(reports, r => r && r.type === 'RT');
  const ntReport = safeFind_(reports, r => r && r.type === 'NT');
  return {
    mode: 'COMBINED',
    report: {
      type: 'COMBINED',
      shortName: 'RT + NT + O-NET',
      grade: 'ภาพรวม',
      headerTitle: 'แผนยกระดับคุณภาพผู้เรียนโดยใช้ผลการประเมินเป็นฐาน ด้วยกระบวนการ PLC ปีการศึกษา 2569',
      firstShort: 'RT',
      secondShort: 'NT'
    },
    school: school,
    summary: {
      totalStudents: totalStudents,
      mathAvg: rtReport && rtReport.summary ? rtReport.summary.totalAvg : 0,
      thaiAvg: ntReport && ntReport.summary ? ntReport.summary.totalAvg : 0,
      totalAvg: overallAvg,
      improveCount: reports.reduce((sum, r) => sum + (r.summary.improveCount || 0), 0)
    },
    reports: reports,
    students: [],
    strandAverages: [],
    analysis: {
      overview: `พบข้อมูลรายงาน ${reports.map(r => r.type).join(' และ ')} รวม ${totalStudents} รายการนักเรียน ค่าเฉลี่ยรวมรายงานเฉลี่ย ${overallAvg}%`,
      strengths: reports.map(r => `${r.type} ${r.grade}: ค่าเฉลี่ยรวม ${r.summary.totalAvg}%`),
      development: reports.map(r => `${r.type}: นักเรียนระดับปรับปรุง ${r.summary.improveCount} คน`),
      activities: ['เลือกแท็บ RT, NT หรือ O-NET เพื่อดูตารางภาพรวม กราฟ การวิเคราะห์ และรายบุคคลของแต่ละประเภท']
    }
  };
}

function getProcessedData_() {
  const all = getAllDashboardData_();
  if (!all.reports.length) throw new Error('ไม่พบชีตข้อมูล RT, NT หรือ O-NET');
  return all.reports[0]._rawData;
}

function detectReport_(values) {
  const text = values.slice(0, 12).flat().filter(Boolean).join(' | ');
  if (/O-NET|ONET|ผลการทดสอบทางการศึกษาระดับชาติขั้นพื้นฐาน/i.test(text)) {
    const isM3 = /มัธยมศึกษาปีที่\s*3|ม\.?\s*3/i.test(text);
    const isP6 = /ประถมศึกษาปีที่\s*6|ป\.?\s*6/i.test(text);
    const grade = isM3 ? 'ม.3' : (isP6 ? 'ป.6' : (matchText_(text, /ชั้น([^|]+?)\s*ปีการศึกษา/) || 'O-NET'));
    const gradeTitle = isM3 ? 'ชั้นมัธยมศึกษาปีที่ 3' : (isP6 ? 'ชั้นประถมศึกษาปีที่ 6' : ('ชั้น' + grade));
    return {
      type: 'ONET',
      shortName: 'O-NET',
      grade: grade,
      typeLabel: 'O-NET ' + grade,
      academicYear: matchText_(text, /ปีการศึกษา\s*(\d{4})/) || '2568',
      headerTitle: gradeTitle + ' ผลการทดสอบ O-NET',
      overallLabel: 'O-NET',
      firstLabel: 'ภาษาไทย',
      firstShort: 'ภาษาไทย',
      firstQualityType: 'onet_thai',
      secondLabel: 'คณิตศาสตร์',
      secondShort: 'คณิตศาสตร์',
      secondQualityType: 'onet_math',
      totalQualityType: 'onet_total',
      sections: [],
      totalSection: null,
      onetSubjects: [
        { key: 'thai', label: 'ภาษาไทย', short: 'ภาษาไทย', scoreCol: 6, levelCol: 10, qualityType: 'onet_thai' },
        { key: 'math', label: 'คณิตศาสตร์', short: 'คณิตศาสตร์', scoreCol: 7, levelCol: 11, qualityType: 'onet_math' },
        { key: 'science', label: 'วิทยาศาสตร์', short: 'วิทยาศาสตร์', scoreCol: 8, levelCol: 12, qualityType: 'onet_science' },
        { key: 'english', label: 'ภาษาอังกฤษ', short: 'ภาษาอังกฤษ', scoreCol: 9, levelCol: 13, qualityType: 'onet_english' }
      ]
    };
  }
  if (/\(RT\)|ความสามารถด้านการอ่านออก|R-School/i.test(text)) {
    return {
      type: 'RT',
      shortName: 'RT',
      grade: 'ป.1',
      academicYear: matchText_(text, /ปีการศึกษา\s*(\d{4})/) || '2568',
      headerTitle: 'ชั้นประถมศึกษาปีที่ 1 ความสามารถด้านการอ่าน (RT)',
      overallLabel: 'RT',
      firstLabel: 'การอ่านออกเสียง',
      firstShort: 'อ่านออกเสียง',
      firstQualityType: 'rt_read_aloud',
      secondLabel: 'การอ่านรู้เรื่อง',
      secondShort: 'อ่านรู้เรื่อง',
      secondQualityType: 'rt_reading',
      totalQualityType: 'rt_total',
      sections: [
        { key: 'first', title: 'การอ่านออกเสียง', text: '1. การอ่านออกเสียง', qualityType: 'rt_read_aloud' },
        { key: 'second', title: 'การอ่านรู้เรื่อง', text: '2. การอ่านรู้เรื่อง', qualityType: 'rt_reading' }
      ],
      totalSection: { key: 'total', title: 'รวม 2 ด้าน', text: '3. รวม 2 ด้าน', qualityType: 'rt_total' }
    };
  }
  return {
    type: 'NT',
    shortName: 'NT',
    grade: 'ป.3',
    academicYear: matchText_(text, /ปีการศึกษา\s*(\d{4})/) || '2568',
    headerTitle: 'ชั้นประถมศึกษาปีที่ 3 การประเมินคุณภาพผู้เรียน (NT)',
    overallLabel: 'NT',
    firstLabel: 'ด้านคณิตศาสตร์',
    firstShort: 'คณิตศาสตร์',
    firstQualityType: 'math',
    secondLabel: 'ด้านภาษาไทย',
    secondShort: 'ภาษาไทย',
    secondQualityType: 'thai',
    totalQualityType: 'total',
    sections: [
      { key: 'first', title: 'ด้านคณิตศาสตร์', text: '1. ด้านคณิตศาสตร์', qualityType: 'math' },
      { key: 'second', title: 'ด้านภาษาไทย', text: '2. ด้านภาษาไทย', qualityType: 'thai' }
    ],
    totalSection: null
  };
}

function parseSubjectSection_(values, subject, report) {
  const sectionRow = findRowContains_(values, subject.text);
  if (sectionRow < 0) return null;
  const headerRow = findHeaderRow_(values, sectionRow);
  if (headerRow < 0) return null;

  const headerInfo = getStudentHeaderInfo_(values, headerRow);
  if (!headerInfo || headerInfo.noCol < 0 || headerInfo.nameCol < 0) return null;

  const dataStart = findDataStart_(values, headerRow, headerInfo);
  if (dataStart < 0) return null;

  const metricDefs = [];
  const metricStartCol = Math.max(0, (headerInfo.typeCol >= 0 ? headerInfo.typeCol + 1 : headerInfo.nameCol + 1));
  for (let r = headerRow; r < dataStart; r++) {
    const row = values[r] || [];
    for (let c = metricStartCol + 1; c < row.length; c++) {
      if (String(row[c] || '').replace(/\s+/g, '').trim() === 'ร้อยละ') {
        const labelCol = c - 1;
        if (labelCol <= headerInfo.typeCol) continue;
        const label = findLabelForMetric_(values, headerRow, r, labelCol);
        if (!label) continue;
        // ไม่เอาคอลัมน์ระดับคุณภาพที่อยู่ท้ายตาราง และไม่เอาค่าที่ไม่ใช่คะแนน/ร้อยละ
        const key = label + '|' + labelCol + '|' + c;
        if (safeFind_(metricDefs, x => x && x.key === key)) continue;
        metricDefs.push({
          key: key,
          label: label.replace(/\s+/g, ' ').trim(),
          group: fillLeft_(values[headerRow] || [], labelCol).replace(/\s+/g, ' ').trim(),
          scoreCol: labelCol,
          percentCol: c
        });
      }
    }
  }

  const rows = [];
  for (let r = dataStart; r < values.length; r++) {
    const row = values[r] || [];
    const no = row[headerInfo.noCol];
    const name = row[headerInfo.nameCol];
    if (!name || String(name).indexOf('หมายเหตุ') >= 0 || String(name).indexOf('เกณฑ์') >= 0) break;
    if (!no || isNaN(Number(no))) {
      // ถ้าเจอบรรทัดว่างหลังจากเริ่มข้อมูลแล้ว ให้หยุด เพื่อไม่ให้ไหลไปอ่านหัวข้อถัดไป
      if (rows.length && row.join('').trim() === '') break;
      continue;
    }
    const metrics = metricDefs.map(def => ({
      label: def.label,
      group: def.group,
      score: toNumber_(row[def.scoreCol]),
      percent: toNumber_(row[def.percentCol])
    }));
    rows.push({
      no: Number(no),
      seatNo: headerInfo.seatNoCol >= 0 ? row[headerInfo.seatNoCol] : '',
      cid: headerInfo.cidCol >= 0 ? row[headerInfo.cidCol] : '',
      name: row[headerInfo.nameCol],
      type: headerInfo.typeCol >= 0 ? row[headerInfo.typeCol] : '',
      metrics: metrics
    });
  }

  return {
    key: subject.key,
    title: subject.title,
    qualityType: subject.qualityType,
    metricDefs: metricDefs,
    rows: rows
  };
}

function getStudentHeaderInfo_(values, headerRow) {
  // บางไฟล์ข้อมูลเริ่มคอลัมน์ A บางเวอร์ชันมีช่องว่างนำหน้า จึงค้นหาตำแหน่งหัวตารางจริงจากข้อความ
  const rows = [];
  for (let r = headerRow; r < Math.min(values.length, headerRow + 3); r++) rows.push(values[r] || []);
  const maxCols = Math.max.apply(null, rows.map(row => row.length || 0));
  const info = { noCol: -1, seatNoCol: -1, cidCol: -1, nameCol: -1, typeCol: -1 };
  for (let c = 0; c < maxCols; c++) {
    const text = rows.map(row => String(row[c] || '')).join(' ').replace(/\s+/g, ' ').trim();
    if (info.noCol < 0 && /ลำดับ/.test(text)) info.noCol = c;
    if (info.seatNoCol < 0 && /เลขที่นั่งสอบ/.test(text)) info.seatNoCol = c;
    if (info.cidCol < 0 && /เลขที่ประจำตัว|ประชาชน/.test(text)) info.cidCol = c;
    if (info.nameCol < 0 && /ชื่อ-สกุล/.test(text)) info.nameCol = c;
    if (info.typeCol < 0 && /ประเภท/.test(text)) info.typeCol = c;
  }
  return info;
}

function findHeaderRow_(values, sectionRow) {
  for (let r = sectionRow + 1; r < Math.min(values.length, sectionRow + 8); r++) {
    if (values[r].join(' ').indexOf('ลำดับ') >= 0 && values[r].join(' ').indexOf('ชื่อ-สกุล') >= 0) return r;
  }
  return -1;
}

function findDataStart_(values, headerRow, headerInfo) {
  const noCol = headerInfo && headerInfo.noCol >= 0 ? headerInfo.noCol : 0;
  const nameCol = headerInfo && headerInfo.nameCol >= 0 ? headerInfo.nameCol : 3;
  for (let r = headerRow + 1; r < Math.min(values.length, headerRow + 10); r++) {
    if (!isNaN(Number((values[r] || [])[noCol])) && (values[r] || [])[nameCol]) return r;
  }
  return -1;
}

function findLabelForMetric_(values, headerRow, percentLabelRow, labelCol) {
  for (let r = percentLabelRow; r >= headerRow; r--) {
    const v = String(values[r][labelCol] || '').trim();
    if (v && v !== 'คะแนน' && v !== 'ร้อยละ') return v;
  }
  for (let c = labelCol; c >= 6; c--) {
    for (let r = percentLabelRow; r >= headerRow; r--) {
      const v = String(values[r][c] || '').trim();
      if (v && v !== 'คะแนน' && v !== 'ร้อยละ') return v;
    }
  }
  return '';
}

function extractSchoolInfo_(values) {
  const text = values.slice(0, 12).flat().filter(Boolean).join(' | ');
  return {
    code: matchText_(text, /รหัสโรงเรียน\s*:?\s*([^|]+)/),
    name: matchText_(text, /ชื่อโรงเรียน\s*:?\s*([^|]+)/) || CONFIG.SCHOOL_NAME_FALLBACK,
    region: matchText_(text, /ภาค\s*:?\s*([^|]+)/),
    size: matchText_(text, /ขนาดโรงเรียน\s*:?\s*([^|]+)/),
    office: matchText_(text, /สังกัด(?:ย่อย)?\s*:?\s*([^|]+)/),
    studentText: matchText_(text, /จำนวนนักเรียนที่เข้าสอบ\s*:?\s*([^|]+)/)
  };
}

function getStrandMetrics_(metrics, subjectName, reportType, qualityType) {
  if (reportType === 'RT') {
    return metrics
      .filter(m => m.label && !/^รวม/.test(m.label))
      .map(m => ({ subject: subjectName, label: m.label, percent: m.percent, level: qualityLevel_(m.percent, qualityType) }));
  }
  return metrics
    .filter(m => /^สาระที่/.test(m.label))
    .map(m => ({ subject: subjectName, label: m.label, percent: m.percent, level: qualityLevel_(m.percent, qualityType) }));
}

function subjectAverage_(row) {
  const metrics = row && Array.isArray(row.metrics) ? row.metrics : [];
  if (!metrics.length) return 0;
  const totalMetric = safeFind_(metrics, m => m && /^รวม/.test(m.label));
  if (totalMetric) return totalMetric.percent;
  return average_(metrics.map(m => m.percent));
}

function totalAverageFromRow_(row) {
  const metrics = row && Array.isArray(row.metrics) ? row.metrics : [];
  if (!metrics.length) return NaN;
  const totalMetric = safeFind_(metrics, m => m && /^รวม/.test(m.label));
  return totalMetric ? totalMetric.percent : average_(metrics.map(m => m.percent));
}

function buildOverviewTables_(data) {
  const students = safeArray_(data && data.students);
  const summary = data.summary;
  const report = data.report;
  const totalScores = students.map(s => s.totalAvg).filter(x => !isNaN(Number(x)));
  const topTable = [{
    item: report.overallLabel,
    academicYear: report.academicYear || '2568',
    fullScore: 100,
    max: max_(totalScores),
    min: min_(totalScores),
    avg: round2_(average_(totalScores)),
    sd: round2_(sd_(totalScores)),
    veryGood: percentOf_(summary.veryGoodCount, summary.totalStudents),
    good: percentOf_(summary.goodCount, summary.totalStudents),
    fair: percentOf_(summary.fairCount, summary.totalStudents),
    improve: percentOf_(summary.improveCount, summary.totalStudents)
  }];

  const detailMap = {};
  const order = [];
  function addValues(key, label, values, displayLabel) {
    if (!detailMap[key]) {
      detailMap[key] = { key: key, label: displayLabel || label, rawLabel: label, fullScore: 100, values: [] };
      order.push(key);
    }
    detailMap[key].values = detailMap[key].values.concat(values.filter(x => !isNaN(Number(x))));
  }

  if (report.type === 'ONET') {
    safeArray_(report.onetSubjects).forEach(sub => {
      addValues('onet_' + sub.key, sub.label, students.map(s => s.subjects && s.subjects[sub.key] && s.subjects[sub.key].metrics[0] ? s.subjects[sub.key].metrics[0].percent : NaN));
    });
  } else if (report.type === 'RT') {
    addValues('subject_first', 'การอ่านออกเสียง', students.map(s => s.mathAvg), '1. การอ่านออกเสียง');
    safeArray_(students).forEach(st => {
      safeArray_(st.detailRows).filter(r => r && r.subject === report.firstLabel && detailRowForOverview_(r.label, report.type, r.subject)).forEach(r => {
        addValues('first_' + r.label, r.label, [r.percent], rtOverviewLabel_(report.firstLabel, r.label));
      });
    });

    addValues('subject_second', 'การอ่านรู้เรื่อง', students.map(s => s.thaiAvg), '2. การอ่านรู้เรื่อง');
    safeArray_(students).forEach(st => {
      safeArray_(st.detailRows).filter(r => r && r.subject === report.secondLabel && detailRowForOverview_(r.label, report.type, r.subject)).forEach(r => {
        addValues('second_' + r.label, r.label, [r.percent], rtOverviewLabel_(report.secondLabel, r.label));
      });
    });

    // แสดงแถวตามแบบฟอร์ม RT แม้ไฟล์ต้นทางไม่มีองค์ประกอบแยกบางรายการ เพื่อให้รูปแบบตรงตามเอกสาร
    if (!detailMap['second_sentence_choice']) {
      detailMap['second_sentence_choice'] = { key: 'second_sentence_choice', label: '- อ่านรู้เรื่องประโยค (เลือกตอบ)', rawLabel: 'อ่านรู้เรื่องประโยค (เลือกตอบ)', fullScore: 100, values: [], isPlaceholder: true };
      order.push('second_sentence_choice');
    }
  } else {
    addValues('subject_first', report.firstLabel, students.map(s => s.mathAvg));
    safeArray_(students).forEach(st => {
      safeArray_(st.detailRows).filter(r => r && r.subject === report.firstLabel && detailRowForOverview_(r.label, report.type, r.subject)).forEach(r => {
        addValues('first_' + r.label, r.label, [r.percent]);
      });
    });

    addValues('subject_second', report.secondLabel, students.map(s => s.thaiAvg));
    safeArray_(students).forEach(st => {
      safeArray_(st.detailRows).filter(r => r && r.subject === report.secondLabel && detailRowForOverview_(r.label, report.type, r.subject)).forEach(r => {
        addValues('second_' + r.label, r.label, [r.percent]);
      });
    });
  }

  const detailRows = order.map(key => {
    const row = detailMap[key];
    const vals = row.values;
    const avg = average_(vals);
    const sd = sd_(vals);
    return {
      item: row.label,
      rawLabel: row.rawLabel,
      isPlaceholder: !!row.isPlaceholder,
      fullScore: row.fullScore,
      max: vals.length ? max_(vals) : '',
      min: vals.length ? min_(vals) : '',
      avg: vals.length ? round2_(avg) : '',
      sd: vals.length ? round2_(sd) : '',
      cv: vals.length && avg ? round2_((sd / avg) * 100) : (vals.length ? 0 : '')
    };
  });

  const rtProblemRows = report.type === 'RT'
    ? detailRows.filter(r => /^-/.test(String(r.item)) && r.avg !== '' && Number(r.avg) < 60).map(r => String(r.item).replace(/^[-\s]+/, ''))
    : [];

  return {
    improveText: 'นักเรียนระดับปรับปรุง จำนวน ' + summary.improveCount + ' คน',
    topTable: topTable,
    detailRows: detailRows,
    rtProblemText: rtProblemRows.length ? rtProblemRows.join(', ') : 'ไม่มีความสามารถที่ต่ำกว่าเกณฑ์เร่งด่วน'
  };
}

function detailRowForOverview_(label, reportType, subject) {
  if (reportType === 'RT') {
    if (!label || /^รวม/.test(label)) return false;
    // ด้านการอ่านออกเสียงของไฟล์ RT มีองค์ประกอบที่ไม่มีคะแนนจริงในบางปี จึงตัดแถวว่างออกจากภาพรวม
    if (/อ่านออกเสียง/.test(subject || '') && /ประโยค/.test(label)) return false;
    return true;
  }
  return /^สาระที่|^มาตรฐาน/.test(label);
}

function rtOverviewLabel_(subject, label) {
  if (/อ่านออกเสียง/.test(subject || '')) {
    if (/คำ/.test(label)) return '- อ่านเป็นคำ';
    if (/ข้อความ/.test(label)) return '- อ่านเป็นข้อความ';
    return '- ' + label.replace(/^การ/, '');
  }
  if (/อ่านรู้เรื่อง/.test(subject || '')) {
    if (/คำ/.test(label)) return '- อ่านรู้เรื่องคำ (จับภาพ)';
    if (/ข้อความ/.test(label)) return '- อ่านรู้เรื่องข้อความ';
    if (/ประโยค/.test(label)) return '- อ่านรู้เรื่องประโยค (เล่าเรื่องจากภาพ)';
    return '- ' + label.replace(/^การ/, '');
  }
  return label;
}

function buildSchoolAnalysis_(data) {
  const r = data.report;
  const sorted = safeArray_(data && data.strandAverages).slice().sort((a,b)=> b.avg - a.avg);
  const strengths = sorted.filter(x => x.avg >= 70).slice(0, 5);
  const needs = sorted.slice().sort((a,b)=> a.avg - b.avg).filter(x => x.avg < 60).slice(0, 5);
  return {
    overview: schoolOverviewText_(data),
    strengths: strengths.length ? strengths.map(x => `${x.subject} ${x.label} เฉลี่ย ${x.avg}% อยู่ระดับ${x.level}`) : ['ยังไม่พบองค์ประกอบที่มีค่าเฉลี่ยตั้งแต่ 70% ควรใช้การสอนเสริมแบบทั้งชั้นเรียน'],
    development: needs.length ? needs.map(x => `${x.subject} ${x.label} เฉลี่ย ${x.avg}% ควรเร่งพัฒนา`) : ['ภาพรวมไม่มีองค์ประกอบต่ำกว่า 60% ควรรักษาคุณภาพและต่อยอดโจทย์ระดับสูง'],
    activities: buildActivitySuggestions_(needs.length ? needs : sorted.slice(-5), r)
  };
}


function schoolOverviewText_(data) {
  const r = data.report || {};
  if (r.type === 'ONET') {
    const parts = safeArray_(r.onetSubjects).map(sub => `${sub.short || sub.label}เฉลี่ย ${subjectAvgFromSummary_(data.summary, sub.key)}%`);
    return `คะแนนเฉลี่ยรวม O-NET ของโรงเรียนอยู่ที่ ${data.summary.totalAvg}% (${qualityLevel_(data.summary.totalAvg, r.totalQualityType)}) ${parts.join(' • ')} จากนักเรียน ${data.summary.totalStudents} คน`;
  }
  return `คะแนนเฉลี่ยรวมของโรงเรียนอยู่ที่ ${data.summary.totalAvg}% (${qualityLevel_(data.summary.totalAvg, r.totalQualityType)}) ${r.firstShort}เฉลี่ย ${data.summary.mathAvg}% และ${r.secondShort}เฉลี่ย ${data.summary.thaiAvg}% จากนักเรียน ${data.summary.totalStudents} คน`;
}

function studentOverviewText_(student, report) {
  if (report && report.type === 'ONET') {
    const parts = safeArray_(report.onetSubjects).map(sub => {
      const row = student.subjects && student.subjects[sub.key] && student.subjects[sub.key].metrics[0];
      return `${sub.short || sub.label} ${row ? round2_(row.percent) : 0}%`;
    });
    return `${student.maskedName} ได้คะแนนเฉลี่ยรวม O-NET ${student.totalAvg}% อยู่ระดับ${student.quality} ${parts.join(' • ')}`;
  }
  return `${student.maskedName} ได้คะแนนเฉลี่ยรวม ${student.totalAvg}% อยู่ระดับ${student.quality} ${report.firstShort} ${student.mathAvg}% และ${report.secondShort} ${student.thaiAvg}%`;
}

function subjectAvgFromSummary_(summary, key) {
  if (key === 'thai') return summary.mathAvg;
  if (key === 'math') return summary.thaiAvg;
  if (key === 'science') return summary.scienceAvg;
  if (key === 'english') return summary.englishAvg;
  return summary.totalAvg;
}

function buildStudentRecommendations_(student, report) {
  const needs = safeArray_(student && student.strands).slice().sort((a,b)=>a.percent-b.percent).filter(x=>x && x.percent < 60).slice(0,4);
  const strengths = safeArray_(student && student.strands).slice().sort((a,b)=>b.percent-a.percent).filter(x=>x && x.percent >= 70).slice(0,3);
  return {
    overview: studentOverviewText_(student, report),
    strengths: strengths.length ? strengths.map(x=>`${x.subject} ${x.label} (${x.percent}%)`) : ['ยังไม่มีองค์ประกอบที่เด่นชัด ควรฝึกพื้นฐานแบบสั้นและต่อเนื่อง'],
    development: needs.length ? needs.map(x=>`${x.subject} ${x.label} (${x.percent}%)`) : ['ไม่มีองค์ประกอบที่ต่ำกว่า 60% ให้เสริมโจทย์ประยุกต์และโจทย์วิเคราะห์'],
    activities: buildActivitySuggestions_(needs, report)
  };
}

function buildActivitySuggestions_(items, report) {
  if (!items || items.length === 0) {
    return ['จัดกิจกรรมโจทย์ท้าทายรายสัปดาห์ แบ่งกลุ่มให้นักเรียนอธิบายวิธีคิด และใช้แบบฝึกสะสมแต้ม'];
  }
  const output = [];
  items.forEach(x => {
    const text = `${x.subject} ${x.label}`;
    if (report && report.type === 'RT') {
      if (/อ่านออกเสียง/.test(x.subject) && /อ่านคำ/.test(x.label)) output.push('การอ่านคำ: ฝึกอ่านคำพื้นฐานวันละ 10 นาที ใช้บัตรคำ เกมจับคู่คำกับภาพ และอ่านซ้ำเพื่อเพิ่มความคล่องแคล่ว');
      else if (/อ่านออกเสียง/.test(x.subject) && /ข้อความ/.test(x.label)) output.push('การอ่านข้อความ: ฝึกอ่านประโยคและข้อความสั้นแบบเป็นจังหวะ ครูอ่านนำ นักเรียนอ่านตาม แล้วจับเวลาอ่านอย่างเหมาะสม');
      else if (/อ่านรู้เรื่อง/.test(x.subject) && /อ่านคำ/.test(x.label)) output.push('อ่านรู้เรื่อง-การอ่านคำ: ฝึกจับคู่คำกับความหมาย เลือกภาพแทนคำ และใช้คำแต่งประโยคสั้น ๆ');
      else if (/อ่านรู้เรื่อง/.test(x.subject) && /ประโยค/.test(x.label)) output.push('อ่านรู้เรื่อง-การอ่านประโยค: ให้นักเรียนอ่านประโยคแล้วตอบคำถามสั้น ๆ เลือกภาพที่ตรงกับประโยค และเรียงลำดับเหตุการณ์');
      else if (/อ่านรู้เรื่อง/.test(x.subject) && /ข้อความ/.test(x.label)) output.push('อ่านรู้เรื่อง-การอ่านข้อความ: ใช้กิจกรรมอ่านนิทานสั้น ตอบคำถาม 5W1H และขีดเส้นใต้หลักฐานจากเรื่อง');
      else output.push(`${text}: จัดแบบฝึกอ่านรายกลุ่มและติดตามผลด้วยแบบทดสอบสั้นหลังเรียน`);
      return;
    }
    if (report && report.type === 'ONET') {
      if (/ภาษาไทย/.test(x.label)) output.push('O-NET ภาษาไทย: ฝึกอ่านจับใจความ วิเคราะห์คำถาม และเขียนสรุปใจความสำคัญจากบทอ่านสั้น ๆ');
      else if (/คณิตศาสตร์/.test(x.label)) output.push('O-NET คณิตศาสตร์: ฝึกโจทย์พื้นฐานและโจทย์สถานการณ์จริง พร้อมทบทวนวิธีคิดทีละขั้นตอน');
      else if (/วิทยาศาสตร์/.test(x.label)) output.push('O-NET วิทยาศาสตร์: ใช้กิจกรรมทดลองง่าย ๆ อ่านกราฟ/ตาราง และฝึกอธิบายเหตุผลจากหลักฐาน');
      else if (/อังกฤษ|ภาษาอังกฤษ/.test(x.label)) output.push('O-NET ภาษาอังกฤษ: ฝึกคำศัพท์พื้นฐาน โครงสร้างประโยค และอ่านบทสนทนาสั้นเพื่อจับใจความ');
      else output.push(`${text}: จัดแบบฝึก O-NET รายวิชาและติดตามผลด้วยแบบทดสอบสั้นหลังเรียน`);
      return;
    }
    if (/คณิตศาสตร์/.test(x.subject) && /สาระที่ 1/.test(x.label)) output.push('คณิตศาสตร์ สาระที่ 1: ใช้กิจกรรมบันไดจำนวน เกมจับคู่โจทย์กับวิธีคิด และฝึกโจทย์บวกลบคูณหารวันละ 10 นาที');
    else if (/คณิตศาสตร์/.test(x.subject) && /สาระที่ 2/.test(x.label)) output.push('คณิตศาสตร์ สาระที่ 2: ใช้สื่อของจริง เช่น ไม้บรรทัด นาฬิกา รูปเรขาคณิต และภารกิจวัดสิ่งของในห้องเรียน');
    else if (/คณิตศาสตร์/.test(x.subject) && /สาระที่ 3/.test(x.label)) output.push('คณิตศาสตร์ สาระที่ 3: ให้นักเรียนเก็บข้อมูลจริง ทำตาราง แผนภูมิแท่ง และตอบคำถามจากข้อมูล');
    else if (/ภาษาไทย/.test(x.subject) && /สาระที่ 1/.test(x.label)) output.push('ภาษาไทย สาระที่ 1: อ่านจับใจความจากเรื่องสั้น ใช้เทคนิค 5W1H และให้ขีดเส้นใต้หลักฐานจากเรื่อง');
    else if (/ภาษาไทย/.test(x.subject) && /สาระที่ 2/.test(x.label)) output.push('ภาษาไทย สาระที่ 2: ฝึกเขียนประโยคสั้น เขียนย่อหน้า 3 ส่วน และตรวจแก้คำผิดร่วมกัน');
    else if (/ภาษาไทย/.test(x.subject) && /สาระที่ 3/.test(x.label)) output.push('ภาษาไทย สาระที่ 3: กิจกรรมฟังแล้วเล่าใหม่ จับคู่สนทนา และสรุปสาระสำคัญด้วยคำของตนเอง');
    else if (/ภาษาไทย/.test(x.subject) && /สาระที่ 4/.test(x.label)) output.push('ภาษาไทย สาระที่ 4: เกมจัดหมวดคำ แต่งประโยคจากคำที่กำหนด และแบบฝึกหลักภาษาแบบสั้น');
    else if (/ภาษาไทย/.test(x.subject) && /สาระที่ 5/.test(x.label)) output.push('ภาษาไทย สาระที่ 5: อ่านนิทาน/วรรณคดีสั้น ระบุข้อคิด ตัวละคร และเชื่อมโยงกับชีวิตประจำวัน');
    else output.push(`${text}: จัดแบบฝึกเสริมรายกลุ่มและติดตามผลด้วยแบบทดสอบสั้นหลังเรียน`);
  });
  return Array.from(new Set(output)).slice(0, 6);
}

function qualityLevel_(percent, type) {
  const p = Number(percent) || 0;
  if (type === 'math') {
    if (p >= 67) return 'ดีมาก';
    if (p >= 44) return 'ดี';
    if (p >= 26) return 'พอใช้';
    return 'ปรับปรุง';
  }
  if (type === 'thai') {
    if (p >= 70) return 'ดีมาก';
    if (p >= 50) return 'ดี';
    if (p >= 29) return 'พอใช้';
    return 'ปรับปรุง';
  }
  if (/^onet/.test(type)) {
    if (p >= 70) return 'ดีมาก';
    if (p >= 50) return 'ดี';
    if (p >= 30) return 'พอใช้';
    return 'ปรับปรุง';
  }
  if (/^rt/.test(type)) {
    if (p >= 75) return 'ดีมาก';
    if (p >= 50) return 'ดี';
    if (p >= 25) return 'พอใช้';
    return 'ปรับปรุง';
  }
  if (p >= 68.5) return 'ดีมาก';
  if (p >= 47) return 'ดี';
  if (p >= 27.5) return 'พอใช้';
  return 'ปรับปรุง';
}

function maskSurname_(fullName) {
  const name = String(fullName || '').replace(/\s+/g, ' ').trim();
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const surname = parts.pop();
  const maskedSurname = surname.charAt(0) + '****';
  return parts.join(' ') + ' ' + maskedSurname;
}

function findRowContains_(values, text) {
  for (let r = 0; r < values.length; r++) {
    if (values[r].join(' ').indexOf(text) >= 0) return r;
  }
  return -1;
}

function fillLeft_(row, index) {
  for (let c = index; c >= 0; c--) {
    if (row[c]) return String(row[c]);
  }
  return '';
}

function toNumber_(value) {
  const n = parseFloat(String(value || '0').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function average_(arr) {
  const nums = arr.map(Number).filter(x => !isNaN(x));
  if (!nums.length) return 0;
  return nums.reduce((a,b)=>a+b,0) / nums.length;
}

function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sd_(arr) {
  const nums = arr.map(Number).filter(x => !isNaN(x));
  if (!nums.length) return 0;
  const avg = average_(nums);
  const variance = nums.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0) / nums.length;
  return Math.sqrt(variance);
}

function max_(arr) {
  const nums = arr.map(Number).filter(x => !isNaN(x));
  return nums.length ? round2_(Math.max.apply(null, nums)) : 0;
}

function min_(arr) {
  const nums = arr.map(Number).filter(x => !isNaN(x));
  return nums.length ? round2_(Math.min.apply(null, nums)) : 0;
}

function percentOf_(count, total) {
  if (!total) return 0;
  return round2_((Number(count) || 0) * 100 / total);
}

function matchText_(text, regex) {
  const m = String(text || '').match(regex);
  return m ? m[1].trim() : '';
}

function shortenLabel_(subject, label, report) {
  const cleanLabel = String(label || '').trim();
  const cleanSubject = String(subject || '').trim();

  // O-NET ต้องแสดงชื่อรายวิชาตรง ๆ ไม่เติมคำนำหน้า เช่น ไทย/คณิต
  // เพื่อไม่ให้กราฟใยแมงมุมแสดงเป็น "ไทย ภาษาไทย" หรือ "ไทย วิทยาศาสตร์"
  if (report && report.type === 'ONET') {
    return cleanLabel || cleanSubject || '-';
  }

  if (report && report.type === 'RT') {
    const prefix = cleanSubject === report.firstLabel ? 'ออกเสียง ' : 'รู้เรื่อง ';
    return prefix + cleanLabel.replace('การ', '');
  }

  // NT ใช้ชื่อย่อเพื่อไม่ให้ label ยาวเกินไปในกราฟ
  return (cleanSubject === 'ด้านคณิตศาสตร์' ? 'คณิต ' : 'ไทย ') + cleanLabel.replace('สาระที่ ', 'ส');
}


function safeFind_(arr, predicate) {
  const list = Array.isArray(arr) ? arr : [];
  for (let i = 0; i < list.length; i++) {
    if (predicate(list[i], i, list)) return list[i];
  }
  return null;
}

function safeArray_(value) {
  return Array.isArray(value) ? value : [];
}

function aiSuggest_(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) return '';
  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'คุณเป็นผู้ช่วยวิเคราะห์ผลการเรียนระดับประถม ให้คำแนะนำภาษาไทยที่กระชับ เป็นมิตร และนำไปจัดกิจกรรมได้จริง' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    }),
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  return json.choices && json.choices[0] ? json.choices[0].message.content : '';
}
