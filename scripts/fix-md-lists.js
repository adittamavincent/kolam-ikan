#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

function walk(dir, filelist = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const res = path.resolve(dir, e.name);
    if (e.isDirectory()) walk(res, filelist);
    else if (res.endsWith('.md')) filelist.push(res);
  }
  return filelist;
}

function normalize(content) {
  const lines = content.split(/\r?\n/);
  // Step 1: normalize bullets '*' or '+' to '-'
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(/^(\s*)([\*\+])\s+/g, '$1- ');
  }

  // Step 2: remove blank lines between adjacent list items of same indent
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    if (/^\s*-\s+/.test(line)) {
      // look ahead and consume blank lines between this list item and next list item
      let j = i + 1;
      let blankCount = 0;
      while (j < lines.length && lines[j].trim() === '') {
        blankCount++; j++;
      }
      if (j < lines.length && new RegExp('^\\s*\\-\\s+').test(lines[j])) {
        // remove the blank lines we just pushed
        for (let k = 0; k < blankCount; k++) out.pop();
        i = j - 1; // continue from the line before the next list item
      }
    }
  }
  return out.join('\n');
}

function processFile(file) {
  try {
    const orig = fs.readFileSync(file, 'utf8');
    const next = normalize(orig);
    if (next !== orig) {
      fs.writeFileSync(file, next, 'utf8');
      console.log('fixed', file);
    }
  } catch (err) {
    console.error('error', file, err.message);
  }
}

const args = process.argv.slice(2);
let files = [];
if (args.length > 0) {
  for (const a of args) {
    const p = path.resolve(process.cwd(), a);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) files.push(p);
  }
} else {
  files = walk(process.cwd());
}

for (const f of files) processFile(f);
