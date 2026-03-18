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

        // normalize nested list indentation: prefer 4-space indent relative to parent
        const parentIndent = (line.match(/^\s*/)[0] || '').length;
        const nextLine = lines[j];
        const nextIndentMatch = nextLine.match(/^(\s*)/);
        const nextIndent = (nextIndentMatch && nextIndentMatch[1].length) || 0;
        if (nextIndent > parentIndent) {
          const desiredIndent = parentIndent + 4;
          const rest = nextLine.trimStart();
          lines[j] = ' '.repeat(desiredIndent) + rest;
        }

        i = j - 1; // continue from the line before the next list item
      }
    }
  }
  // Second pass: remove blank lines that appear between a paragraph/heading and a list
  // (e.g., Prettier may insert a blank line before a list after a paragraph).
  const cleaned = [];
  for (let i = 0; i < out.length; i++) {
    // If this is a blank line, look ahead to see if the next non-blank is a list
    if (out[i].trim() === '') {
      let j = i + 1;
      while (j < out.length && out[j].trim() === '') j++;
      const nextIsList = j < out.length && /^\s*-\s+/.test(out[j]);
      // find previous non-blank in cleaned
      let p = cleaned.length - 1;
      while (p >= 0 && cleaned[p].trim() === '') p--;
      const prevLine = p >= 0 ? cleaned[p] : null;
      const prevIsList = !!prevLine && /^\s*-\s+/.test(prevLine);
      // If the blank line is adjacent to a list (either before or after), skip it
      if (nextIsList || prevIsList) {
        continue; // skip pushing this blank line
      }
    }
    cleaned.push(out[i]);
  }
  return cleaned.join('\n');
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
