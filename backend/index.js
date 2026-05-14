const express = require('express');
const { PDFDocument } = require('pdf-lib');
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
app.post('/save-signed-pdf', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const previewPath = path.join(__dirname, 'preview.pdf');

  try {
    fs.writeFileSync(previewPath, req.file.buffer);
    res.json({
      success: true,
      message: 'Document saved and overwritten successfully.'
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