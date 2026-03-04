import { jsPDF } from 'jspdf';

/**
 * Generate a PDF from a DOM element using jsPDF's html method
 * which has better support for page breaks than html2pdf.js
 * @param {HTMLElement} element - The DOM element to convert to PDF
 * @param {string} filename - The filename for the downloaded PDF
 * @returns {Promise<void>}
 */
export async function generatePDF(element, filename = 'council-answer.pdf') {
  // Wait for fonts to load
  await document.fonts.ready;

  // Small delay to ensure rendering is complete
  await new Promise(resolve => setTimeout(resolve, 300));

  // Clone the element to apply print styles without affecting the page
  const clone = element.cloneNode(true);
  clone.style.width = '170mm'; // A4 width minus margins
  clone.style.padding = '0';
  clone.style.margin = '0';
  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  clone.style.backgroundColor = '#ffffff';

  // Add page-break-inside: avoid to elements
  const avoidBreakElements = clone.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6, tr, blockquote, pre');
  avoidBreakElements.forEach(el => {
    el.style.pageBreakInside = 'avoid';
    el.style.breakInside = 'avoid';
  });

  // Add page-break-before to headings for better layout
  const headings = clone.querySelectorAll('h2');
  headings.forEach((el, i) => {
    if (i > 0) { // Don't break before first h2
      el.style.pageBreakBefore = 'auto';
    }
  });

  document.body.appendChild(clone);

  const pdf = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait'
  });

  try {
    await pdf.html(clone, {
      callback: function(doc) {
        doc.save(filename);
      },
      x: 15,
      y: 15,
      width: 170, // A4 width (210mm) minus margins (2x20mm)
      windowWidth: 650, // Approximate pixel width for rendering
      margin: [15, 15, 15, 15],
      autoPaging: 'text',
      html2canvas: {
        scale: 0.26, // Adjust for proper sizing
        useCORS: true,
        logging: false
      }
    });
  } finally {
    document.body.removeChild(clone);
  }
}
