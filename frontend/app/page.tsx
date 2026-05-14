"use client";
import React, { useRef, useState, useEffect, useCallback } from "react";
import type { PDFDocumentProxy, PageViewport, RenderTask } from "pdfjs-dist";
import SignatureCanvas from "react-signature-canvas";

// ─── Types ───────────────────────────────────────────────────────────────────
interface User {
  employeeid: string;
  name: string;
  position: string;
  stage: number;
}

interface ClickMarker {
  x: number;       // pixel position on canvas overlay
  y: number;
  pdfX: number;    // PDF coordinate (points)
  pdfY: number;
  pageIndex: number;
}

interface SignatureRow {
  stage: number;
  employeeId: string;
  name: string;
  position: string;
  userId: string;
  signatureData?: string;
}

interface PdfHistoryEntry {
  bytes: ArrayBuffer;
  hadSignedPdf: boolean;
}

const API = process.env.NEXT_PUBLIC_API || "http://localhost:5000";

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" strokeLinecap="round" />
    </svg>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Home() {
  // Users
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const selectedUser = users.find((u) => u.employeeid === selectedUserId) ?? null;

  // Signature pad (My Signature tab)
  const sigCanvas = useRef<React.ElementRef<typeof SignatureCanvas> | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [hasSavedSig, setHasSavedSig] = useState(false);

  // Inline signature modal (Sign Now popup)
  const inlineSigCanvas = useRef<React.ElementRef<typeof SignatureCanvas> | null>(null);
  const [showSignModal, setShowSignModal] = useState(false);

  // PDF rendering
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [scale, setScale] = useState(1.5);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const viewportRef = useRef<PageViewport | null>(null);

  // Click-to-sign state
  const [marker, setMarker] = useState<ClickMarker | null>(null);
  const [signing, setSigning] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  const prevPdfBytesRef = useRef<PdfHistoryEntry[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [signatureRows, setSignatureRows] = useState<SignatureRow[]>([]);

  // Tabs
  const [tab, setTab] = useState<"sign" | "review">("sign");

  // ── Load users ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/users`)
      .then((r) => r.json())
      .then((data: User[]) => {
        setUsers(data);
        if (data.length > 0) setSelectedUserId(data[0].employeeid);
      })
      .catch(() => {
        const fallback: User[] = [
          { employeeid: "EMP001", name: "Sandali Sithumani", position: "Full-Stack Developer", stage: 1 },
          { employeeid: "EMP002", name: "Harini Dissanayake", position: "Finance Lead", stage: 2 },
        ];
        setUsers(fallback);
        setSelectedUserId(fallback[0].employeeid);
      });
  }, []);

  // ── Check saved signature ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedUserId) return;
    fetch(`${API}/has-signature/${selectedUserId}`)
      .then((r) => r.json())
      .then(({ exists }) => setHasSavedSig(exists))
      .catch(() => setHasSavedSig(false));
  }, [selectedUserId]);

  // ── Initialize pdf.js worker once ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      } catch (err) {
        console.warn("Could not initialize pdf.js worker", err);
      }
    })();
  }, []);

  // ── Render a PDF page onto the canvas ───────────────────────────────────
  const renderPage = useCallback(async (pageNum: number) => {
    const pdfDoc = pdfDocRef.current;
    if (!pdfDoc || !canvasRef.current) return;

    if (renderTaskRef.current) {
      try { await renderTaskRef.current.cancel(); } catch {}
    }

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    viewportRef.current = viewport;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderTask = page.render({ canvasContext: ctx, canvas, viewport });
    renderTaskRef.current = renderTask;
    try {
      await renderTask.promise;
    } catch (err: unknown) {
      if (!(err instanceof Error) || err.name !== "RenderingCancelledException") console.error(err);
    }
  }, [scale]);

  // ── Load PDF from backend using pdf.js ──────────────────────────────────
  const handleReviewPdf = useCallback(async () => {
    if (signedPdfUrl) URL.revokeObjectURL(signedPdfUrl);
    prevPdfBytesRef.current = [];
    setUndoCount(0);
    setSignatureRows([]);
    setLoadingPdf(true);
    setMarker(null);
    setSignedPdfUrl(null);
    setPdfLoaded(false);
    try {
      const pdfjsLib = await import("pdfjs-dist");
      const res = await fetch(`${API}/preview-pdf`);
      if (!res.ok) throw new Error("PDF not found");
      const arrayBuffer = await res.arrayBuffer();

      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      pdfDocRef.current = pdfDoc;
      setTotalPages(pdfDoc.numPages);
      setCurrentPage(1);
      setPdfLoaded(true);
      setTab("review");

      await renderPage(1);
    } catch (err) {
      alert("Could not load PDF. Make sure the backend is running and preview.pdf exists.");
      console.error(err);
    } finally {
      setLoadingPdf(false);
    }
  }, [renderPage, signedPdfUrl]);

  // Re-render when page or scale changes
  useEffect(() => {
    if (pdfLoaded) renderPage(currentPage);
  }, [currentPage, scale, pdfLoaded, renderPage]);

  // ── Handle click on PDF overlay ─────────────────────────────────────────
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pdfLoaded || !overlayRef.current || !viewportRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();

    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const vp = viewportRef.current;
    const [scaleX, , , scaleY, offX, offY] = vp.transform;
    const pdfX = (px - offX) / scaleX;
    const pdfY = (offY - py) / Math.abs(scaleY);

    setMarker({ x: px, y: py, pdfX, pdfY, pageIndex: currentPage - 1 });
  }, [pdfLoaded, currentPage]);

  const getCurrentPdfBytes = useCallback(async (): Promise<ArrayBuffer> => {
    if (signedPdfUrl) {
      return await fetch(signedPdfUrl).then((r) => r.arrayBuffer());
    }

    const res = await fetch(`${API}/preview-pdf`);
    if (!res.ok) throw new Error("Could not read current PDF state");
    return await res.arrayBuffer();
  }, [signedPdfUrl]);

  // ── Place signature using saved file on server (Add Sign) ───────────────
  const handleAddSign = async () => {
    if (!marker) return;
    if (!hasSavedSig) {
      alert("No saved signature found. Please save your signature in the My Signature tab first.");
      return;
    }

    setSigning(true);
    setMarker(null);
    try {
      const markerSnapshot = marker;
      const previousBytes = await getCurrentPdfBytes();
      const res = await fetch(`${API}/add-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          pdfX: markerSnapshot.pdfX,
          pdfY: markerSnapshot.pdfY,
          pageIndex: markerSnapshot.pageIndex,
        }),
      });
      if (res.ok) {
        prevPdfBytesRef.current.push({ bytes: previousBytes, hadSignedPdf: Boolean(signedPdfUrl) });
        setUndoCount((count) => count + 1);
        if (selectedUser) {
        setSignatureRows((rows) => {
          const exists = rows.some(
            (r) => r.employeeId === selectedUser.employeeid
          );

          if (exists) return rows;

          return [
            ...rows,
            {
              stage: selectedUser.stage,
              employeeId: selectedUser.employeeid,
              name: selectedUser.name,
              position: selectedUser.position,
              userId: selectedUser.employeeid,
            },
          ];
        });
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (signedPdfUrl) URL.revokeObjectURL(signedPdfUrl);
        setSignedPdfUrl(url);

        const pdfjsLib = await import("pdfjs-dist");
        const arrayBuffer = await blob.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        pdfDocRef.current = pdfDoc;
        setTotalPages(pdfDoc.numPages);
        await renderPage(currentPage);
      } else {
        alert("Error: " + await res.text());
      }
    } catch {
      alert("Server not connected.");
    } finally {
      setSigning(false);
    }
  };

  // ── Place inline signature (Sign Now — base64 in memory, no file saved) ─
  const handlePlaceInlineSignature = async (signatureBase64: string, markerToUse: ClickMarker) => {
    setSigning(true);
    setMarker(null);
    try {
      const previousBytes = await getCurrentPdfBytes();
      const res = await fetch(`${API}/add-signature-inline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureData: signatureBase64,
          pdfX: markerToUse.pdfX,
          pdfY: markerToUse.pdfY,
          pageIndex: markerToUse.pageIndex,
        }),
      });
      if (res.ok) {
        prevPdfBytesRef.current.push({ bytes: previousBytes, hadSignedPdf: Boolean(signedPdfUrl) });
        setUndoCount((count) => count + 1);
        if (selectedUser) {
          setSignatureRows((rows) => [
            ...rows,
            {
              stage: selectedUser.stage,
              employeeId: selectedUser.employeeid,
              name: selectedUser.name,
              position: selectedUser.position,
              userId: selectedUser.employeeid,
              signatureData: signatureBase64,
            },
          ]);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (signedPdfUrl) URL.revokeObjectURL(signedPdfUrl);
        setSignedPdfUrl(url);

        const pdfjsLib = await import("pdfjs-dist");
        const arrayBuffer = await blob.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        pdfDocRef.current = pdfDoc;
        setTotalPages(pdfDoc.numPages);
        await renderPage(currentPage);
      } else {
        alert("Error: " + await res.text());
      }
    } catch {
      alert("Server not connected.");
    } finally {
      setSigning(false);
    }
  };

  // ── Sign Now: open modal ─────────────────────────────────────────────────
  const handleSignNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSignModal(true);
  };

  // ── Sign Now modal: save drawn signature and place it ───────────────────
  const handleSaveInlineSignature = async () => {
    const pad = inlineSigCanvas.current;
    if (!pad || pad.isEmpty()) {
      alert("Please draw your signature first.");
      return;
    }
    if (!marker) return;

    const signatureBase64 = pad.getTrimmedCanvas().toDataURL("image/png");
    setShowSignModal(false);

    // Place it immediately at the marker coordinates
    await handlePlaceInlineSignature(signatureBase64, marker);
  };

  // ── Save drawn signature to server (My Signature tab) ───────────────────
  const handleSaveSignature = async () => {
    const pad = sigCanvas.current;
    if (!pad || pad.isEmpty()) return alert("Please draw your signature first.");
    setSaveStatus("saving");
    const signatureData = pad.getTrimmedCanvas().toDataURL("image/png");
    try {
      const res = await fetch(`${API}/save-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, signatureData }),
      });
      if (res.ok) {
        setSaveStatus("saved");
        setHasSavedSig(true);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  };

  const handleDownload = () => {
    if (!signedPdfUrl) return;
    const a = document.createElement("a");
    a.href = signedPdfUrl;
    a.download = `signed_document_${selectedUserId}.pdf`;
    a.click();
  };

  // ── Save signed PDF and overwrite preview on server ────────────────────
  const handleSavePdf = async () => {
    if (!signedPdfUrl) { alert("No signed PDF to save."); return; }
    try {
      setSigning(true);
      const blob = await fetch(signedPdfUrl).then((r) => r.blob());
      const formData = new FormData();
      formData.append("file", blob, "signed_document.pdf");
      formData.append("userId", selectedUserId);
      formData.append("signatureRows", JSON.stringify(signatureRows));

      const res = await fetch(`${API}/save-signed-pdf`, { method: "POST", body: formData });
      if (res.ok) {
        alert("PDF saved successfully. The document was overwritten with your signature.");
        URL.revokeObjectURL(signedPdfUrl);
        setSignedPdfUrl(null);
        setPdfLoaded(false);
        setMarker(null);
        prevPdfBytesRef.current = [];
        setUndoCount(0);
        setSignatureRows([]);
        
        // Auto-reload the updated PDF to show the refreshed summary table
        setTimeout(() => {
          handleReviewPdf();
        }, 300);
      } else {
        alert("Error saving document: " + await res.text());
      }
    } catch (err) {
      alert("Failed to save document: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSigning(false);
    }
  };

  // ── Undo last signature placement (client-side only) ────────────────────
  const handleUndoLastSignature = async () => {
    if (prevPdfBytesRef.current.length === 0) return;

    setSigning(true);
    setMarker(null);
    try {
      const previous = prevPdfBytesRef.current.pop();
      if (!previous) return;

      if (signedPdfUrl) URL.revokeObjectURL(signedPdfUrl);

      const pdfjsLib = await import("pdfjs-dist");
      const restoredPdf = await pdfjsLib.getDocument({ data: previous.bytes }).promise;
      pdfDocRef.current = restoredPdf;
      setTotalPages(restoredPdf.numPages);

      const restoredPage = Math.min(currentPage, restoredPdf.numPages);
      if (restoredPage !== currentPage) setCurrentPage(restoredPage);
      await renderPage(restoredPage);

      if (previous.hadSignedPdf) {
        const restoredUrl = URL.createObjectURL(new Blob([previous.bytes], { type: "application/pdf" }));
        setSignedPdfUrl(restoredUrl);
      } else {
        setSignedPdfUrl(null);
      }
      setSignatureRows((rows) => rows.slice(0, -1));

      setUndoCount((count) => Math.max(0, count - 1));
    } catch (err) {
      alert("Failed to undo signature: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSigning(false);
    }
  };

  // ─── UI ──────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 font-sans">

      {/* ══════════ SIGN NOW MODAL ══════════ */}
      {showSignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Draw Your Signature</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  This signature will be placed directly on the document and will not be saved as a file.
                </p>
              </div>
              {/* ✕ close */}
              <button
                onClick={() => { setShowSignModal(false); setMarker(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Canvas area */}
            <div className="px-6 py-5">
              <div className="border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 overflow-hidden flex items-center justify-center">
                <SignatureCanvas
                  ref={inlineSigCanvas}
                  penColor="#1e293b"
                  canvasProps={{ width: 500, height: 200, className: "sigCanvas" }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-2 text-center">Draw your signature above</p>
            </div>

            {/* Modal footer buttons */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
              {/* Clear */}
              <button
                onClick={() => inlineSigCanvas.current?.clear()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear
              </button>

              <div className="flex gap-2">
                {/* Cancel */}
                <button
                  onClick={() => { setShowSignModal(false); setMarker(null); }}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                {/* Save & Place */}
                <button
                  onClick={handleSaveInlineSignature}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Save &amp; Place
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
            </svg>
          </div>
          <span className="text-lg font-semibold text-slate-800">E-Signature Portal</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(["sign", "review"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { if (t === "review" && !pdfLoaded) handleReviewPdf(); else setTab(t); }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${
                tab === t ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "sign" ? "My Signature" : "Review Document"}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* ── User selector ── */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Active Employee</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={selectedUserId}
              onChange={(e) => {
                if (signedPdfUrl) URL.revokeObjectURL(signedPdfUrl);
                setSelectedUserId(e.target.value);
                setMarker(null);
                setSignedPdfUrl(null);
                prevPdfBytesRef.current = [];
                setUndoCount(0);
                setSignatureRows([]);
              }}
            >
              {users.map((u) => (
                <option key={u.employeeid} value={u.employeeid}>{u.name} — {u.position}</option>
              ))}
            </select>
          </div>
          {hasSavedSig && (
            <span className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Signature saved
            </span>
          )}
          <button
            onClick={handleReviewPdf}
            disabled={loadingPdf}
            className="flex items-center gap-2 bg-slate-800 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {loadingPdf ? <><Spinner />Loading…</> : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Review Document
              </>
            )}
          </button>
        </div>

        {/* ══════════ TAB: MY SIGNATURE ══════════ */}
        {tab === "sign" && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-1">Draw Your Signature</h2>
            <p className="text-sm text-slate-500 mb-5">
              Saved under employee ID <code className="bg-slate-100 px-1 rounded">{selectedUserId}</code>. Used when you click <strong>Add Sign</strong> on the document.
            </p>
            <div className="border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 flex items-center justify-center mb-5 overflow-hidden">
              <SignatureCanvas
                ref={sigCanvas}
                penColor="#1e293b"
                canvasProps={{ width: 580, height: 200, className: "sigCanvas" }}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => { sigCanvas.current?.clear(); setSaveStatus("idle"); }}
                className="px-5 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleSaveSignature}
                disabled={saveStatus === "saving"}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  saveStatus === "saved" ? "bg-emerald-600 text-white"
                  : saveStatus === "error" ? "bg-red-600 text-white"
                  : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {saveStatus === "saving" && <Spinner />}
                {saveStatus === "saved" ? "✓ Signature Saved!" : saveStatus === "error" ? "Error — Retry" : "Save Signature"}
              </button>
              {saveStatus === "saved" && (
                <button
                  onClick={() => { setTab("review"); if (!pdfLoaded) handleReviewPdf(); }}
                  className="px-5 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
                >
                  Go to Review Document →
                </button>
              )}
            </div>
            {saveStatus === "saved" && (
              <p className="mt-4 text-xs text-slate-400">
                Saved as <code className="bg-slate-100 px-1 rounded">signatures/{selectedUserId}.png</code>
              </p>
            )}
          </div>
        )}

        {/* ══════════ TAB: REVIEW DOCUMENT ══════════ */}
        {tab === "review" && (
          <div className="space-y-4">

            {/* Info / toolbar */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="flex-1 text-sm text-blue-800">
                {pdfLoaded
                  ? "Click anywhere on the document to open the signature options."
                  : "Loading document…"}
              </p>
              <div className="flex items-center gap-2">
                {pdfLoaded && (
                  <>
                    <button onClick={() => setScale((s) => Math.max(0.75, s - 0.25))} className="px-2 py-1 rounded border border-blue-300 text-blue-700 text-sm hover:bg-blue-100">−</button>
                    <span className="text-sm text-blue-700 w-12 text-center">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale((s) => Math.min(3, s + 0.25))} className="px-2 py-1 rounded border border-blue-300 text-blue-700 text-sm hover:bg-blue-100">+</button>
                  </>
                )}
                {signedPdfUrl && (
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                )}
                {undoCount > 0 && (
                  <button
                    onClick={handleUndoLastSignature}
                    disabled={signing}
                    className="flex items-center gap-1.5 bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors"
                    title="Undo the last placed signature"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h11a7 7 0 110 14h-1m-10-14l4-4m-4 4l4 4" />
                    </svg>
                    Undo Last Signature
                  </button>
                )}
              </div>
            </div>

            {/* PDF canvas + clickable overlay */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-auto">
              {/* Page navigation */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-2 border-b border-slate-100">
                  <button disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)} className="px-3 py-1 text-sm rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-50">← Prev</button>
                  <span className="text-sm text-slate-600">Page {currentPage} / {totalPages}</span>
                  <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="px-3 py-1 text-sm rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Next →</button>
                </div>
              )}

              {/* Canvas + overlay wrapper */}
              <div className="relative inline-block w-full">
                {/* Rendered PDF page */}
                <canvas ref={canvasRef} className="block mx-auto" />

                {/* Transparent click-capture overlay */}
                <div
                  ref={overlayRef}
                  onClick={handleCanvasClick}
                  className="absolute inset-0"
                  style={{ cursor: pdfLoaded ? "crosshair" : "default" }}
                >
                  {/* ── Floating 3-button popup at click position ── */}
                  {marker && !signing && (
                    <div
                      className="absolute z-20"
                      style={{
                        left: marker.x,
                        top: marker.y,
                        transform: "translate(-50%, -110%)",
                      }}
                    >
                      <div className="flex flex-col items-start gap-2 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 min-w-[160px]">
                        {/* Header label */}
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide px-1">Signature Options</p>

                        {/* Sign Now — draw inline */}
                        <button
                          onClick={handleSignNow}
                          className="w-full flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
                          </svg>
                          Sign Now
                        </button>

                        {/* Add Sign — use saved file */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAddSign(); }}
                          disabled={!hasSavedSig}
                          title={!hasSavedSig ? "No saved signature — go to My Signature tab first" : "Place your saved signature"}
                          className="w-full flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                          Add Sign
                        </button>

                        {/* Divider */}
                        <div className="w-full border-t border-slate-100 my-0.5" />

                        {/* Cancel */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setMarker(null); }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Cancel
                        </button>
                      </div>

                      {/* Arrow pointer */}
                      <div className="flex justify-center">
                        <div className="w-3 h-3 bg-white border-r border-b border-slate-200 rotate-45 -mt-1.5 shadow-sm" />
                      </div>
                    </div>
                  )}

                  {/* Signing spinner overlay */}
                  {signing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-5 py-3 shadow-lg text-sm text-slate-700 font-medium">
                        <Spinner />
                        Placing signature…
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!pdfLoaded && !loadingPdf && (
                <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
                  Click &quot;Review Document&quot; to load the PDF.
                </div>
              )}
              {loadingPdf && (
                <div className="h-64 flex items-center justify-center text-slate-400 text-sm gap-2">
                  <Spinner />Loading document…
                </div>
              )}
            </div>

            {/* Save/undo actions for signed document */}
            {signedPdfUrl && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="text-base font-semibold text-slate-800 mb-4">Document Signed</h3>
                <p className="text-sm text-slate-600 mb-6">Review your signature, undo if needed, then save to overwrite the PDF.</p>
                <div className="flex flex-wrap gap-3">
                  {undoCount > 0 && (
                    <button
                      onClick={handleUndoLastSignature}
                      disabled={signing}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors"
                    >
                      {signing ? <Spinner /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h11a7 7 0 110 14h-1m-10-14l4-4m-4 4l4 4" /></svg>}
                      Undo Last Signature
                    </button>
                  )}
                  <button
                    onClick={handleSavePdf}
                    disabled={signing}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {signing ? <Spinner /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    Save PDF
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}