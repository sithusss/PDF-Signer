const express = require('express');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const pdf = require('pdf-parse');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Directory to store saved signatures
const SIGNATURES_DIR = path.join(__dirname, 'signatures');
if (!fs.existsSync(SIGNATURES_DIR)) fs.mkdirSync(SIGNATURES_DIR);
const SIGNATURE_LOG_PATH = path.join(__dirname, 'signature-log.json');

fs.writeFileSync(SIGNATURE_LOG_PATH, JSON.stringify([], null, 2));

const A4_PAGE_WIDTH = 595.28;
const A4_PAGE_HEIGHT = 841.89;

// Multer setup for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Hardcoded users
const users = [
  { employeeid: "EMP001", name: "Sandali Sithumani",  position: "Full-Stack Developer", stage: 1 },
  { employeeid: "EMP002", name: "Harini Dissanayake", position: "Finance Lead",          stage: 2 },
];

// ── GET /users ───────────────────────────────────────────────────────────────
app.get('/users', (req, res) => res.json(users));

// ── POST /save-signature ─────────────────────────────────────────────────────
app.post('/save-signature', (req, res) => {
  const { userId, signatureData } = req.body;
  const user = users.find(u => u.employeeid === userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!signatureData) return res.status(400).json({ error: "No signature data" });

  try {
    const base64 = signatureData.replace(/^data:image\/png;base64,/, '');
    const filePath = path.join(SIGNATURES_DIR, `${userId}.png`);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    res.json({ success: true, message: `Signature saved for ${user.name}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save signature" });
  }
});

// ── GET /has-signature/:userId ───────────────────────────────────────────────
app.get('/has-signature/:userId', (req, res) => {
  const filePath = path.join(SIGNATURES_DIR, `${req.params.userId}.png`);
  res.json({ exists: fs.existsSync(filePath) });
});

// ── GET /preview-pdf ─────────────────────────────────────────────────────────
app.get('/preview-pdf', (req, res) => {
  const templatePath = path.join(__dirname, 'preview.pdf');
  if (!fs.existsSync(templatePath)) return res.status(404).send("preview.pdf not found");
  res.contentType('application/pdf');
  res.send(fs.readFileSync(templatePath));
});

async function appendSignatureSummaryPage(pdfDoc, signatureRows) {
  const rows = Array.isArray(signatureRows) ? signatureRows : [];
  const pageWidth = A4_PAGE_WIDTH;
  const pageHeight = A4_PAGE_HEIGHT;
  const margin = 36;
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const headers = ['Stage', 'Employee ID', 'Name', 'Position', 'Signature'];
  const contentWidth = pageWidth - margin * 2;
  const colWidths = [50, 90, 140, 160, contentWidth - (50 + 90 + 140 + 160)];
  const headerHeight = 30;
  const tableTop = pageHeight - 140;
  const tableBottom = margin + 36;
  const availableHeight = Math.max(120, tableTop - tableBottom - headerHeight);
  const rowHeight = rows.length > 0 ? Math.max(18, Math.floor(availableHeight / rows.length)) : 48;
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  page.drawText('Signature Summary', {
    x: margin,
    y: pageHeight - 54,
    size: 20,
    font: titleFont,
    color: rgb(0.12, 0.18, 0.31),
  });

  page.drawText('Each signature placement is recorded in the same table below.', {
    x: margin,
    y: pageHeight - 76,
    size: 10,
    font: bodyFont,
    color: rgb(0.42, 0.45, 0.52),
  });

  if (rows.length === 0) {
    page.drawText('No signatures were captured before saving.', {
      x: margin,
      y: tableTop - 20,
      size: 11,
      font: bodyFont,
      color: rgb(0.18, 0.22, 0.28),
    });
    return;
  }

  let x = margin;
  for (let index = 0; index < headers.length; index += 1) {
    page.drawRectangle({
      x,
      y: tableTop - headerHeight,
      width: colWidths[index],
      height: headerHeight,
      borderColor: rgb(0.78, 0.82, 0.88),
      borderWidth: 1,
      color: rgb(0.93, 0.95, 0.98),
    });
    page.drawText(headers[index], {
      x: x + 6,
      y: tableTop - 20,
      size: 10,
      font: bodyFont,
      color: rgb(0.16, 0.2, 0.27),
    });
    x += colWidths[index];
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowTop = tableTop - headerHeight - (rowIndex * rowHeight);
    const cellTop = rowTop - rowHeight;
    const rowValues = [String(row.stage ?? ''), row.employeeId ?? row.userId ?? '', row.name ?? '', row.position ?? ''];

    x = margin;
    for (let index = 0; index < rowValues.length; index += 1) {
      page.drawRectangle({
        x,
        y: cellTop,
        width: colWidths[index],
        height: rowHeight,
        borderColor: rgb(0.78, 0.82, 0.88),
        borderWidth: 1,
        color: rgb(1, 1, 1),
      });

      page.drawText(rowValues[index], {
        x: x + 6,
        y: cellTop + rowHeight / 2 - 5,
        size: 10,
        font: bodyFont,
        color: rgb(0.12, 0.15, 0.2),
        maxWidth: colWidths[index] - 12,
      });

      x += colWidths[index];
    }

    page.drawRectangle({
      x,
      y: cellTop,
      width: colWidths[4],
      height: rowHeight,
      borderColor: rgb(0.78, 0.82, 0.88),
      borderWidth: 1,
      color: rgb(1, 1, 1),
    });

    const signatureBytes = resolveSignatureBytes(row.employeeId ?? row.userId, row.signatureData);
    if (signatureBytes) {
      const signatureImage = await pdfDoc.embedPng(signatureBytes);
      const signatureHeight = Math.max(16, Math.min(34, rowHeight - 10));
      page.drawImage(signatureImage, {
        x: x + 6,
        y: cellTop + Math.max(4, (rowHeight - signatureHeight) / 2),
        width: Math.min(colWidths[4] - 12, 110),
        height: signatureHeight,
      });
    } else {
      page.drawText('Missing signature', {
        x: x + 6,
        y: cellTop + rowHeight / 2 - 5,
        size: 9,
        font: bodyFont,
        color: rgb(0.6, 0.1, 0.1),
      });
    }
  }
}

function resolveSignatureBytes(userId, signatureData) {
  if (signatureData) {
    const base64 = signatureData.replace(/^data:image\/png;base64,/, '');
    return Buffer.from(base64, 'base64');
  }

  const sigPath = path.join(SIGNATURES_DIR, `${userId}.png`);
  if (fs.existsSync(sigPath)) {
    return fs.readFileSync(sigPath);
  }

  return null;
}

function readSignatureLog() {
  if (!fs.existsSync(SIGNATURE_LOG_PATH)) {
    console.log('📄 Signature log file does not exist yet at:', SIGNATURE_LOG_PATH);
    return [];
  }
  try {
    const raw = fs.readFileSync(SIGNATURE_LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    console.log('📖 Read signature log:', {
      path: SIGNATURE_LOG_PATH,
      exists: true,
      rowCount: Array.isArray(parsed) ? parsed.length : 0,
      employeeIds: Array.isArray(parsed) ? parsed.map(r => r.employeeId || r.userId) : 'invalid'
    });
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('❌ Error reading signature log:', err.message);
    return [];
  }
}

function writeSignatureLog(rows) {
  try {
    fs.writeFileSync(SIGNATURE_LOG_PATH, JSON.stringify(rows, null, 2));
    console.log('✅ Wrote signature log:', {
      path: SIGNATURE_LOG_PATH,
      rowCount: rows.length,
      employeeIds: rows.map(r => r.employeeId || r.userId)
    });
  } catch (err) {
    console.error('❌ Error writing signature log:', err.message);
  }
}

// ── POST /analyze-pdf ────────────────────────────────────────────────────────
app.post('/analyze-pdf', async (req, res) => {
  try {
    const templatePath = path.join(__dirname, 'preview.pdf');
    const data = await pdf(fs.readFileSync(templatePath));
    const textLines = data.text.split('\n');

    const dotLinePattern = /^[\s._\u2026\u00b7\-]{5,}$/;
    const sigLines = [];
    let stageCounter = 0;
    textLines.forEach((line, idx) => {
      if (dotLinePattern.test(line.trim()) || /\.{5,}/.test(line) || /_{5,}/.test(line)) {
        stageCounter++;
        sigLines.push({ index: idx, lineText: line.trim(), stage: stageCounter });
      }
    });

    res.json({ totalLines: textLines.length, signatureSlots: sigLines });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "PDF analysis failed: " + err.message });
  }
});

// ── POST /add-signature ───────────────────────────────────────────────────────
// Uses the signature file saved on disk for this user
app.post('/add-signature', async (req, res) => {
  const { userId, pdfX, pdfY, pageIndex } = req.body;

  const user = users.find(u => u.employeeid === userId);
  if (!user) return res.status(404).send("User not found");

  const sigPath = path.join(SIGNATURES_DIR, `${userId}.png`);
  if (!fs.existsSync(sigPath)) {
    return res.status(400).send("No saved signature for this user. Please save your signature first.");
  }

  if (pdfX === undefined || pdfY === undefined || pageIndex === undefined) {
    return res.status(400).send("Missing coordinates (pdfX, pdfY, pageIndex).");
  }

  try {
    const templatePath = path.join(__dirname, 'preview.pdf');
    const existingPdfBytes = fs.readFileSync(templatePath);
    const signatureBytes   = fs.readFileSync(sigPath);

    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages  = pdfDoc.getPages();

    const pageIdx = Math.max(0, Math.min(pageIndex, pages.length - 1));
    const page = pages[pageIdx];
    const { width, height } = page.getSize();

    const sigW = 80;
    const sigH = 30;

    let x = pdfX - sigW / 2;
    let y = pdfY - sigH / 2;
    x = Math.max(0, Math.min(x, width  - sigW));
    y = Math.max(0, Math.min(y, height - sigH));

    const signatureImage = await pdfDoc.embedPng(signatureBytes);
    page.drawImage(signatureImage, { x, y, width: sigW, height: sigH });

    const pdfBytes = await pdfDoc.save();
    res.contentType('application/pdf');
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Error details:", err);
    res.status(500).send("PDF processing error: " + err.message);
  }
});

// ── POST /add-signature-inline ────────────────────────────────────────────────
// Accepts signature as base64 in the request body.
// The signature is used directly and NOT saved to disk as a file.
app.post('/add-signature-inline', async (req, res) => {
  const { signatureData, pdfX, pdfY, pageIndex } = req.body;

  if (!signatureData) {
    return res.status(400).send("Missing signatureData.");
  }
  if (pdfX === undefined || pdfY === undefined || pageIndex === undefined) {
    return res.status(400).send("Missing coordinates (pdfX, pdfY, pageIndex).");
  }

  try {
    // Strip the data URI prefix and decode to a buffer — never written to disk
    const base64 = signatureData.replace(/^data:image\/png;base64,/, '');
    const signatureBytes = Buffer.from(base64, 'base64');

    const templatePath = path.join(__dirname, 'preview.pdf');
    if (!fs.existsSync(templatePath)) {
      return res.status(404).send("preview.pdf not found on server.");
    }

    const existingPdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages  = pdfDoc.getPages();

    const pageIdx = Math.max(0, Math.min(pageIndex, pages.length - 1));
    const page = pages[pageIdx];
    const { width, height } = page.getSize();

    const sigW = 80;
    const sigH = 30;

    let x = pdfX - sigW / 2;
    let y = pdfY - sigH / 2;
    x = Math.max(0, Math.min(x, width  - sigW));
    y = Math.max(0, Math.min(y, height - sigH));

    const signatureImage = await pdfDoc.embedPng(signatureBytes);
    page.drawImage(signatureImage, { x, y, width: sigW, height: sigH });

    const pdfBytes = await pdfDoc.save();
    res.contentType('application/pdf');
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Inline signature error:", err);
    res.status(500).send("PDF processing error: " + err.message);
  }
});

// ── POST /save-signed-pdf ───────────────────────────────────────────────────
app.post('/save-signed-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const previewPath = path.join(__dirname, 'preview.pdf');

  try {
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    const incomingRows = req.body.signatureRows
      ? JSON.parse(req.body.signatureRows)
      : [];
    const existingRows = readSignatureLog();
    const mergedRows = [...existingRows, ...incomingRows];

    // Only replace the previous summary page when one already exists.
    if (existingRows.length > 0 && pdfDoc.getPageCount() > 0) {
      pdfDoc.removePage(pdfDoc.getPageCount() - 1);
    }

    writeSignatureLog(mergedRows);
    await appendSignatureSummaryPage(pdfDoc, mergedRows);

    const finalPdfBytes = await pdfDoc.save();
    fs.writeFileSync(previewPath, Buffer.from(finalPdfBytes));

    res.json({
      success: true,
      message: 'Document saved, signature summary page added, and PDF overwritten successfully.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save signed PDF" });
  }
});

// ── GET /get-signed-pdf ─────────────────────────────────────────────────────
app.get('/get-signed-pdf', (req, res) => {
  try {
    const previewPath = path.join(__dirname, 'preview.pdf');
    if (!fs.existsSync(previewPath)) {
      return res.status(404).json({ error: "No PDF found" });
    }
    res.contentType('application/pdf');
    res.send(fs.readFileSync(previewPath));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to retrieve PDF" });
  }
});

app.listen(port, '0.0.0.0', () => console.log(`Backend running on port ${port}`));