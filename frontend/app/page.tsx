"use client"
import React, { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';

export default function Home() {
  const sigCanvas = useRef<React.ElementRef<typeof SignatureCanvas> | null>(null);
  const [userId, setUserId] = useState("EMP001");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAddSignAndPreview = async () => {
    const signaturePad = sigCanvas.current;

    if (!signaturePad || signaturePad.isEmpty()) return alert("Please sign before submitting.");

    setIsLoading(true);
    const signatureData = signaturePad.getTrimmedCanvas().toDataURL('image/png');

    try {
      const res = await fetch('/add-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureData, userId })
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        setPdfPreviewUrl(url); 
      } else {
        alert("Backend error !");
      }
    } catch (error) {
      console.error(error);
      alert("Server is not connected!");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (pdfPreviewUrl) {
      const link = document.createElement('a');
      link.href = pdfPreviewUrl;
      link.download = `signed_document_${userId}.pdf`;
      link.click();
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 p-10 flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-8 text-blue-800">E-Signature Portal</h1>
      
      <div className="bg-white p-6 rounded-xl shadow-md w-full max-w-2xl border border-gray-200 text-black">
        {/* User Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-black mb-2">Select Current User:</label>
          <select 
            className="w-full border border-gray-300 p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="EMP001">Sandali Sithumani (Stage 1)</option>
            <option value="EMP002">Harini Dissanayake (Stage 2)</option>
          </select>
        </div>

        {/* Signature Box */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-black mb-2">Sign inside the box:</label>
          <div className="border-2 border-dashed border-gray-400 rounded-lg bg-gray-50 flex justify-center">
            <SignatureCanvas 
              ref={sigCanvas}
              canvasProps={{ width: 550, height: 200, className: 'sigCanvas' }} 
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4 justify-center">
          <button 
              onClick={() => { sigCanvas.current?.clear(); setPdfPreviewUrl(null); }} 
            className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
          >
            Clear
          </button>
          
          <button 
            onClick={handleAddSignAndPreview} 
            disabled={isLoading}
            className={`${isLoading ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'} text-white px-6 py-2 rounded-lg font-semibold transition`}
          >
            {isLoading ? 'Processing...' : 'Add Sign & Preview'}
          </button>

          {pdfPreviewUrl && (
            <button 
              onClick={handleDownload} 
              className="bg-green-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-green-700 transition"
            >
              Download Signed PDF
            </button>
          )}
        </div>
      </div>

      {/* PDF Preview Section */}
      {pdfPreviewUrl && (
        <div className="mt-10 w-full max-w-5xl bg-white p-4 rounded-xl shadow-lg border border-gray-200 text-black">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-black">Document Preview</h2>
            <span className="text-sm text-black italic">Signature added at the end of content</span>
          </div>
          <iframe 
            src={pdfPreviewUrl} 
            className="w-full h-[600px] border rounded" 
            title="PDF Preview"
          ></iframe>
        </div>
      )}
    </main>
  );
}