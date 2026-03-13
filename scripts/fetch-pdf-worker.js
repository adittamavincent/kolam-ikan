#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '..', 'public', 'js');
const OUT_FILE = path.join(OUT_DIR, 'pdf.worker.min.mjs');

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function tryCopyFromNodeModules() {
  try {
    const nmPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
    if (fs.existsSync(nmPath)) {
      fs.copyFileSync(nmPath, OUT_FILE);
      console.log('Copied pdf.worker.min.mjs from node_modules to', OUT_FILE);
      return true;
    }
  } catch (err) {
    // ignore
  }
  return false;
}

function fetchFromUnpkg(version = '2.16.105') {
  const url = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
      }
      ensureOutDir();
      const fileStream = fs.createWriteStream(OUT_FILE);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        console.log('Fetched pdf.worker.min.mjs from unpkg to', OUT_FILE);
        resolve(true);
      });
    }).on('error', (err) => reject(err));
  });
}

async function main() {
  ensureOutDir();
  if (tryCopyFromNodeModules()) return;

  try {
    await fetchFromUnpkg();
  } catch (err) {
    console.error('Failed to obtain pdf.worker.min.mjs:', err.message || err);
    process.exitCode = 1;
  }
}

main();
