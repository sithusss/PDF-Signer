const express = require('express');
const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const pdf = require('pdf-parse'); 

const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Hardcoded User Details
const users = [
    { employeeid: "EMP001", name: "Sandali Sithumani", position: "Full-Stack Developer", stage: 1 },
    { employeeid: "EMP002", name: "Harini Dissanayake", position: "Finance Lead", stage: 2 }
];

app.post('/add-signature', async (req, res) => {
    const { signatureData, userId } = req.body;
    const user = users.find(u => u.employeeid === userId);

    if (!user) return res.status(404).send("User not found");

    try {
        const templatePath = path.join(__dirname, 'template.pdf');
        const existingPdfBytes = fs.readFileSync(templatePath);
        
        //analyze pdf content
        const data = await pdf(existingPdfBytes);
        
        // take line count of content to estimate where the signature should be placed
        const lines = data.text.split('\n').filter(line => line.trim().length > 0).length;
        
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const pages = pdfDoc.getPages();
        const lastPage = pages[pages.length - 1];
        const { height } = lastPage.getSize();

        //keep margin with line count and stage to estimate signature position
        const contentGapMargin = 100; 
        const estimatedTextBottom = height - (lines * 18) - contentGapMargin; 
        
        // keep gap between signatures based on stage (1st signature -> 90px, 2nd signature -> 180px, etc.)
        const stageGap = user.stage * 100; 
        
        //estimate y position for signature based on text content and stage
        let yPosition = estimatedTextBottom - stageGap;

        // Safety checks
        if (yPosition < 80) yPosition = 80;
        if (yPosition > height - 180) yPosition = height - 200;

        const signatureImage = await pdfDoc.embedPng(signatureData);
        
        const signatureX = 70;
        const signatureWidth = 110;
        const signatureHeight = 40;

        // Signature Drawing 
        lastPage.drawImage(signatureImage, {
            x: signatureX,
            y: yPosition,
            width: signatureWidth,
            height: signatureHeight,
        });

        // --- Name Drawing --- 
        const nameY = yPosition - 18; 
        lastPage.drawText(user.name, {
            x: signatureX,
            y: nameY,
            size: 11,
            color: rgb(0, 0, 0),
        });

        // --- Position Drawing  --- 
        const positionY = nameY - 15;
        lastPage.drawText(user.position, {
            x: signatureX,
            y: positionY,
            size: 11,
            color: rgb(0, 0, 0),
        });

        const pdfBytes = await pdfDoc.save();
        res.contentType("application/pdf");
        res.send(Buffer.from(pdfBytes));
        
    } catch (err) {
        console.error("Error details:", err);
        res.status(500).send("PDF processing error: " + err.message);
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Backend running on port ${port}`));