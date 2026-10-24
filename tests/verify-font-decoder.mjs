import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'xuexitong-deepseek.user.js'), 'utf8');
const block = source.match(/\/\* __XT_FONT_BEGIN__ \*\/([\s\S]*?)\/\* __XT_FONT_END__ \*\//);
if (!block) throw new Error('缺少字体解码区块');

const sandbox = {
    DecompressionStream,
    Blob,
    Response,
    Uint8Array,
    Map,
};
vm.createContext(sandbox);
const api = vm.runInContext(
    `${block[1]}\n;({ parseSfntTables: readSfntTables, parseCmapTable, parsePostTable, nameCode, buildFontDecoder });`,
    sandbox,
    { filename: 'xuexitong-deepseek-font.js' },
);

const syntheticPost = new Uint8Array(48);
const postView = new DataView(syntheticPost.buffer);
postView.setUint32(0, 0x00020000);
postView.setUint16(32, 2);
postView.setUint16(34, 258);
postView.setUint16(36, 259);
syntheticPost[38] = 7;
for (let index = 0; index < 7; index++) syntheticPost[39 + index] = 'uni4E2D'.charCodeAt(index);
syntheticPost[46] = 1;
syntheticPost[47] = 65;
const syntheticNames = api.parsePostTable(syntheticPost);
assert.equal(syntheticNames[0], 'uni4E2D');
assert.equal(syntheticNames[1], 'A');
assert.equal(api.nameCode('uni4E2D'), 0x4e2d);
assert.equal(api.nameCode('u1F600'), 0x1f600);

const fontPath = join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf');
if (!existsSync(fontPath)) {
    console.log('未找到系统 Arial 字体，跳过字体表解析测试。');
    process.exit(0);
}

const data = readFileSync(fontPath);
const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const tables = api.parseSfntTables(new Uint8Array(buffer));
assert.ok(tables.has('cmap'), '缺少 cmap 表');
assert.ok(tables.has('post'), '缺少 post 表');

const cmap = api.parseCmapTable(tables.get('cmap'));
assert.ok(cmap && cmap.size > 0, 'cmap 解析为空');
assert.ok(cmap.get(0x41) > 0, 'ASCII A 未映射到字形');

const post = api.parsePostTable(tables.get('post'));
assert.ok(Array.isArray(post), 'post 解析结果格式错误');

const decoder = await api.buildFontDecoder(buffer);
assert.ok(decoder, '字体解码器构建失败');
assert.equal(decoder.decode('ABC abc 123'), 'ABC abc 123');
assert.equal(decoder.decode('System'), 'System');
console.log(`字体表解析通过：cmap ${cmap.size} 项，post ${post.length} 项。`);
