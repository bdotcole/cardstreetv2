const fs = require('fs');
const PDFParser = require("pdf2json");

let pdfParser = new PDFParser(this,1);

pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError) );
pdfParser.on("pdfParser_dataReady", pdfData => {
    let rawText = pdfParser.getRawTextContent();
    console.log("Extracted text successfully! Length:", rawText.length);
    console.log("Snippet:\n", rawText.substring(0, 1000));
});

pdfParser.loadPDF("pdfs/AS6B.pdf");
