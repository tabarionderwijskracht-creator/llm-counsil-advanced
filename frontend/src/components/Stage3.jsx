import { useState, useRef, memo } from 'react';
import html2pdf from 'html2pdf.js';
import Markdown from './Markdown';
import './Stage3.css';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      className={`copy-button ${copied ? 'copied' : ''}`}
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function PDFButton({ finalResponse, contentRef }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'generating' | 'done' | 'error'

  const handleDownload = async () => {
    if (!contentRef.current) return;

    setStatus('generating');
    try {
      const generatedDate = new Date().toLocaleDateString('nl-NL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Create an iframe for rendering
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;border:none;opacity:1;z-index:99999;background:white;';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

      // Write content to iframe - Clean professional report with INLINE styles
      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
        <head></head>
        <body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.6;background:white;min-height:100vh;display:flex;flex-direction:column;">
          <div style="background:#2e7d32;color:white;padding:15px 30px;display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:12px;">
              <img src="/oklogo.png" style="width:32px;height:32px;object-fit:contain;" />
              <span style="font-size:18px;font-weight:bold;">Rapport</span>
            </div>
            <span style="font-size:12px;opacity:0.9;">${generatedDate}</span>
          </div>

          <div style="padding:30px 40px;flex:1;max-width:800px;margin:0 auto;">
            <div style="font-size:13px;line-height:1.7;word-wrap:break-word;overflow-wrap:break-word;">
              ${contentRef.current.innerHTML}
            </div>
          </div>

          <div style="padding:12px 30px;font-size:10px;color:#888;text-align:center;border-top:1px solid #ddd;">
            De Onderwijskracht - ${generatedDate}
          </div>
        </body>
        </html>
      `);
      iframeDoc.close();

      // Wait for content and fonts to render
      await new Promise(resolve => setTimeout(resolve, 800));

      // Generate PDF from iframe body
      const options = {
        margin: 0,
        filename: 'analysis-report.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          allowTaint: true
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait'
        }
      };

      await html2pdf().set(options).from(iframeDoc.body).save();

      // Clean up
      document.body.removeChild(iframe);

      setStatus('done');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  return (
    <button
      className={`pdf-button ${status}`}
      onClick={handleDownload}
      disabled={status === 'generating'}
      title="Download as PDF"
    >
      {status === 'generating' ? (
        <>
          <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
          </svg>
          Generating...
        </>
      ) : status === 'done' ? (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Done!
        </>
      ) : status === 'error' ? (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          Error
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <polyline points="9 15 12 18 15 15" />
          </svg>
          PDF
        </>
      )}
    </button>
  );
}

export default memo(function Stage3({ finalResponse }) {
  const contentRef = useRef(null);

  if (!finalResponse) {
    return null;
  }

  return (
    <div className="stage stage3">
      <div className="stage-header">
        <h3 className="stage-title">Stage 3: Final Council Answer</h3>
        <div className="stage-header-buttons">
          <CopyButton text={finalResponse.response} />
          <PDFButton finalResponse={finalResponse} contentRef={contentRef} />
        </div>
      </div>
      <div className="final-response">
        <div className="chairman-label">
          Chairman: {typeof finalResponse.model === 'string'
            ? (finalResponse.model.split('/')[1] || finalResponse.model)
            : String(finalResponse.model)}
        </div>
        <div className="final-text" ref={contentRef}>
          <Markdown>{finalResponse.response}</Markdown>
        </div>
      </div>
    </div>
  );
});
