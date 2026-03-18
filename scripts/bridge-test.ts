import bridge from "../src/lib/blocknote-markdown-bridge";

const md = `test

- location
  - unknown
  - known
- known`;

console.log('Original markdown:\n', md);

const blocks = bridge.bridgeMarkdownToBlocks(md);
console.log('\nParsed blocks:', JSON.stringify(blocks, null, 2));

const out = bridge.blocksToBridgeMarkdown(blocks);
console.log('\nRound-tripped markdown:\n', out);

// show whether nested structure preserved
console.log('\nNested preserved check:', out.includes('  - unknown') && out.includes('  - known'));
