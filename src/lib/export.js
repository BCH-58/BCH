// Using the browser build directly avoids exceljs pulling in Node-only
// modules (fs, stream) that don't exist in a Vite/browser bundle.
import ExcelJS from 'exceljs/dist/exceljs.min.js';

const BRAND = 'FF0E5C55';
const GREEN = 'FF3E8F72';
const AMBER = 'FFDE9A34';
const RED = 'FFC64B4B';
const WHITE = 'FFFFFFFF';

// Custom weight per rating, out of 100 for a single rating (not evenly
// spaced) — must stay identical to RATING_WEIGHT in src/App.jsx so the
// exported percentages always match what the dashboard shows.
const RATING_WEIGHT = { 4: 100, 3: 85, 2: 45, 1: 0 };

function scoreOf(r, criteria) {
  const vals = criteria.map((c) => r.ratings[c.id]);
  const sum = vals.reduce((a, b) => a + RATING_WEIGHT[b], 0);
  return Math.round(sum / vals.length);
}

function colorForPct(pct) {
  if (pct >= 85) return BRAND;
  if (pct >= 70) return GREEN;
  if (pct >= 55) return AMBER;
  return RED;
}

// Draws a simple horizontal bar chart (per-supervisor score) on an offscreen
// canvas and returns it as PNG bytes — no external chart library or network
// call needed, so the export works fully offline.
function drawSupervisorChart(rows) {
  const width = 640;
  const rowH = 34;
  const height = 70 + rows.length * rowH;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#16302D';
  ctx.font = 'bold 17px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('نسبة الرضا حسب المشرف', width - 20, 32);

  const barAreaX = 20;
  const barMaxWidth = width - 240;
  const barHeight = 18;

  rows.forEach((s, i) => {
    const y = 55 + i * rowH;
    const pct = s.pct ?? 0;
    const pctColor = pct >= 85 ? '#0E5C55' : pct >= 70 ? '#3E8F72' : pct >= 55 ? '#DE9A34' : '#C64B4B';

    ctx.fillStyle = '#F4F8F7';
    ctx.fillRect(barAreaX, y, barMaxWidth, barHeight);

    ctx.fillStyle = pctColor;
    ctx.fillRect(barAreaX, y, (pct / 100) * barMaxWidth, barHeight);

    ctx.fillStyle = '#16302D';
    ctx.font = '13px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${s.name} — ${Math.round(pct)}%`, width - 20, y + barHeight - 4);
  });

  return canvas;
}

function canvasToArrayBuffer(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      blob.arrayBuffer().then(resolve);
    }, 'image/png');
  });
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFDCE8E5' } } };
  });
  row.height = 20;
}

function styleDataRow(row) {
  row.eachCell((cell) => {
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFEAEFEE' } } };
  });
}

export async function exportMonthlyReport({ responses, supervisors, criteria, scale, month }) {
  const monthResponses = responses
    .filter((r) => r.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'لوحة متابعة النظافة';
  wb.created = new Date();

  // ------------------------- Summary sheet -------------------------
  const supStats = supervisors
    .map((s) => {
      const rs = monthResponses.filter((r) => r.supervisorId === s.id);
      if (!rs.length) return { name: s.name, department: s.department, count: 0, pct: null };
      const vals = [];
      rs.forEach((r) => criteria.forEach((c) => vals.push(r.ratings[c.id])));
      const sum = vals.reduce((a, b) => a + RATING_WEIGHT[b], 0);
      const pct = Math.round(sum / vals.length);
      return { name: s.name, department: s.department, count: rs.length, pct };
    })
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  const critStats = criteria.map((c) => {
    const vals = monthResponses.map((r) => r.ratings[c.id]);
    const pct = vals.length ? Math.round(vals.reduce((a, b) => a + RATING_WEIGHT[b], 0) / vals.length) : null;
    return { label: c.label, pct };
  });

  const summarySheet = wb.addWorksheet('الملخص', { views: [{ rightToLeft: true }] });
  summarySheet.mergeCells('A1:D1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = `تقرير النظافة الشهري — ${month}`;
  titleCell.font = { bold: true, size: 15, color: { argb: BRAND } };
  titleCell.alignment = { horizontal: 'right' };
  summarySheet.getRow(1).height = 26;
  summarySheet.addRow([]);

  styleHeaderRow(summarySheet.addRow(['المشرف', 'القسم', 'عدد الاستبيانات', 'النسبة العامة']));
  supStats.forEach((s) => {
    const row = summarySheet.addRow([s.name, s.department, s.count, s.pct !== null ? `${s.pct}%` : '—']);
    styleDataRow(row);
    if (s.pct !== null) {
      row.getCell(4).font = { bold: true, color: { argb: colorForPct(s.pct) } };
    }
  });

  summarySheet.addRow([]);
  styleHeaderRow(summarySheet.addRow(['بند الاستبيان', 'النسبة']));
  critStats.forEach((c) => {
    const row = summarySheet.addRow([c.label, c.pct !== null ? `${c.pct}%` : '—']);
    styleDataRow(row);
  });

  summarySheet.columns = [{ width: 22 }, { width: 18 }, { width: 16 }, { width: 14 }];
  summarySheet.views = [{ rightToLeft: true }];

  const chartRows = supStats.filter((s) => s.pct !== null);
  if (chartRows.length > 0) {
    const canvas = drawSupervisorChart(chartRows);
    const buffer = await canvasToArrayBuffer(canvas);
    const imageId = wb.addImage({ buffer, extension: 'png' });
    summarySheet.addImage(imageId, {
      tl: { col: 5, row: 1 },
      ext: { width: canvas.width * 0.62, height: canvas.height * 0.62 },
    });
  }

  // -------------------------- Data sheet ----------------------------
  const dataSheet = wb.addWorksheet('البيانات', { views: [{ rightToLeft: true }] });
  const headers = [
    'التاريخ', 'المشرف', 'القسم', 'رقم الغرفة', 'اسم المريض',
    ...criteria.map((c) => c.short), 'النسبة العامة', 'أسباب التقييم المنخفض', 'ملاحظة', 'الجهاز', 'IP',
  ];
  styleHeaderRow(dataSheet.addRow(headers));

  monthResponses.forEach((r) => {
    const sup = supervisors.find((s) => s.id === r.supervisorId);
    const reasonsText = criteria
      .filter((c) => r.reasons && r.reasons[c.id])
      .map((c) => `${c.short}: ${r.reasons[c.id]}`)
      .join(' | ');
    const row = dataSheet.addRow([
      r.date,
      sup ? sup.name : '—',
      sup ? sup.department : '—',
      r.room || '',
      r.patientName || '',
      ...criteria.map((c) => {
        const item = scale.find((s) => s.value === r.ratings[c.id]);
        return item ? item.label : '';
      }),
      `${scoreOf(r, criteria)}%`,
      reasonsText,
      r.comment || '',
      r.device || '',
      r.ip || '',
    ]);
    styleDataRow(row);
  });

  dataSheet.columns = [
    { width: 12 }, { width: 18 }, { width: 16 }, { width: 10 }, { width: 16 },
    ...criteria.map(() => ({ width: 14 })),
    { width: 12 }, { width: 55 }, { width: 28 }, { width: 20 }, { width: 15 },
  ];
  dataSheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  const lastColLetter = String.fromCharCode(64 + headers.length); // headers.length <= 26
  dataSheet.autoFilter = { from: 'A1', to: `${lastColLetter}1` };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `تقرير-النظافة-${month}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return monthResponses.length;
}
