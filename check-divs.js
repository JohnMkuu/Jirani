const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

const lines = html.split('\n');
const stack = [];
lines.forEach((line, lineIdx) => {
  const lineNum = lineIdx + 1;
  const tagRegex = /<\/?([a-z0-9-]+)[^>]*>/gi;
  let match;
  while ((match = tagRegex.exec(line)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    if (tagName === 'div') {
      if (fullTag.startsWith('</')) {
        if (stack.length > 0) {
          stack.pop();
        } else {
          console.log('Extra closing div at line ' + lineNum);
        }
      } else if (!fullTag.endsWith('/>')) {
        const idMatch = fullTag.match(/id=['"]([^'"]+)['"]/i);
        const classMatch = fullTag.match(/class=['"]([^'"]+)['"]/i);
        stack.push({
          line: lineNum,
          id: idMatch ? idMatch[1] : null,
          class: classMatch ? classMatch[1] : null,
          tag: fullTag
        });
      }
    }
  }
});

console.log('Unclosed divs remaining in stack:', stack.length);
stack.forEach(s => {
  console.log('Line ' + s.line + ' (id=' + s.id + ', class=' + s.class + '): ' + s.tag);
});

