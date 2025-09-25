import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';
import puppeteer from 'puppeteer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests are allowed.' });
  }

  let browser = null;
  let page = null;
  
  try {
    const { html } = req.body;
    if (!html) {
      return res.status(400).json({ message: 'Missing HTML content.' });
    }

    console.log('Starting PDF generation...');

    // Improved environment detection
    const isVercel = process.env.VERCEL === '1';
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalDev = !isVercel; // Local development (including vercel dev)

    if (isLocalDev) {
      console.log('Launching browser in local development mode...');
      // Use regular puppeteer with more conservative settings
      browser = await puppeteer.launch({
        headless: 'new',
        timeout: 60000, // Increased timeout
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-ipc-flooding-protection',
          '--memory-pressure-off'
        ]
      });
    } else {
      console.log('Launching browser in production mode...');
      // Use serverless Chromium for production (Vercel)
      const executablePath = await chromium.executablePath();
      
      browser = await puppeteerCore.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });
    }

    console.log('Browser launched successfully');
    
    // Set a larger page viewport and add delay
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    console.log('New page created with viewport set');
    
    await page.setContent(html, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    console.log('Content set successfully');
    
    // Add a small delay to ensure page is fully ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('Page ready, generating PDF...');
    
    // Ensure proper page size for resumes
    const pdfBuffer = await page.pdf({ 
      format: 'Letter', 
      printBackground: true,
      timeout: 30000, // Increased timeout
      preferCSSPageSize: false,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in'
      }
    });
    
    console.log('PDF generated successfully, buffer size:', pdfBuffer.length);
    
    // Set proper headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Send the PDF buffer
    return res.end(pdfBuffer);

  } catch (error) {
    console.error('Error generating PDF:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'PDF Generation Error', 
      error: error.message,
      environment: process.env.NODE_ENV,
      vercel: process.env.VERCEL
    });
  } finally {
    try {
      if (page) {
        console.log('Closing page...');
        await page.close();
      }
      if (browser) {
        console.log('Closing browser...');
        await browser.close();
      }
      console.log('Cleanup completed');
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
  }
}