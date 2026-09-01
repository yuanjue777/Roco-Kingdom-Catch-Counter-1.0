/*
 * build.js —— 把 index.html + src/*.js 打成一个自包含的 HTML 片段。
 * 输出 dist/campus-m0.html，可以直接发布为 Artifact（不含 doctype/html/head/body 标签）。
 * 跑法：node build.js
 */
const fs = require('fs'), path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const grab = (tag) => {
  const m = html.match(new RegExp('<!--' + tag + '-->([\\s\\S]*?)<!--/' + tag + '-->'));
  if (!m) throw new Error('index.html 里找不到 ' + tag + ' 标记');
  return m[1].trim();
};
const style = grab('STYLE');
const content = grab('CONTENT');
const scriptBlock = grab('SCRIPTS');
const files = [...scriptBlock.matchAll(/src="(src\/[^"]+)"/g)].map(m => m[1]);
const code = files.map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

const out = `<title>校园 · M0 潜行原型</title>
${style}
${content}
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script>
${code}
<\/script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'campus-m0.html'), out);
console.log('已生成 dist/campus-m0.html  ' + (out.length / 1024).toFixed(0) + ' KB，内联 ' + files.length + ' 个源文件');
