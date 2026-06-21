import { remark } from 'remark';

const md = `# Hello\n\nThis is a paragraph.\n\n- Item 1\n- Item 2`;
const ast = remark().parse(md);
console.log("AST:", JSON.stringify(ast, null, 2));

ast.children.push({
  type: 'paragraph',
  children: [{ type: 'text', value: 'Injected paragraph!' }]
} as any);

const out = remark().stringify(ast);
console.log("OUT:", out);
