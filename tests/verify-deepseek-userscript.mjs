import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(root, 'xuexitong-deepseek.user.js');
const source = readFileSync(scriptPath, 'utf8');

execFileSync(process.execPath, ['--check', scriptPath], { stdio: 'inherit' });

const metadata = source.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
if (!metadata) throw new Error('缺少油猴元数据块');

const required = [
    '@name',
    '@version',
    '@match        *://*.chaoxing.com/mycourse/studentstudy*',
    '@run-at       document-idle',
    '@grant        GM_getValue',
    '@grant        GM_setValue',
    '@grant        GM_xmlhttpRequest',
    '@grant        GM_registerMenuCommand',
    '@connect      api.deepseek.com',
    '@noframes',
];
for (const line of required) {
    if (!metadata[1].includes(line)) throw new Error(`元数据缺少：${line}`);
}

for (const forbidden of ['127.0.0.1:37841', 'LOCAL_TOKEN', 'LOCAL_URL']) {
    if (source.includes(forbidden)) throw new Error(`脚本仍依赖本地服务：${forbidden}`);
}

if (!/GM_xmlhttpRequest\s*\(/.test(source)) throw new Error('缺少 GM_xmlhttpRequest 调用');
if (!/attachShadow\(\s*\{\s*mode:\s*'open'\s*\}\s*\)/.test(source)) throw new Error('缺少可拖拽面板的 Shadow DOM 隔离');
if (!/api\.deepseek\.com\/chat\/completions/.test(source)) throw new Error('缺少 DeepSeek 接口地址');
if (!/playbackRate/.test(source)) throw new Error('缺少播放倍速控制');
if (!/id="rate"/.test(source)) throw new Error('缺少面板倍速选择器');
if (!/isTransientPlayError/.test(source)) throw new Error('缺少媒体加载中的瞬时错误识别');
if (!/waitForMediaReady/.test(source)) throw new Error('缺少视频就绪等待');
if (!/confirmNextStepDialog/.test(source)) throw new Error('缺少下一节确认弹窗处理');
if (!/installRateLock/.test(source)) throw new Error('缺少倍速属性锁定');
if (!/id="lock-rate"/.test(source)) throw new Error('缺少面板倍速锁定开关');
if (!/diagnoseFont/.test(source)) throw new Error('缺少字体/伪元素诊断');
if (!/__XT_FONT_BEGIN__/.test(source)) throw new Error('缺少字体解码区块');
if (!/buildFontDecoder/.test(source)) throw new Error('缺少字体表解析器');

const pureBlock = source.match(/\/\* __XT_PURE_BEGIN__ \*\/([\s\S]*?)\/\* __XT_PURE_END__ \*\//);
if (!pureBlock) throw new Error('缺少可测试的纯逻辑区块标记');

const context = vm.createContext({});
const api = vm.runInContext(
    `${pureBlock[1]}\n;({ clean, commonOptionSuffix, buildRequestBody, parseAnswerPayload, validateAnswers, findThemeMismatches });`,
    context,
    { filename: 'xuexitong-deepseek-pure.js' },
);

const questions = [
    { kind: '单选题', title: '第一题', options: [{ letter: 'A', text: '甲' }, { letter: 'B', text: '乙' }] },
    { kind: '多选题', title: '第二题', options: [{ letter: 'A', text: '甲' }, { letter: 'B', text: '乙' }, { letter: 'C', text: '丙' }] },
];

const body = api.buildRequestBody(questions);
assert.equal(body.model, 'deepseek-flash');
assert.equal(body.response_format.type, 'json_object');
assert.equal(body.messages.length, 2);
assert.equal(body.messages[0].role, 'system');
const payload = JSON.parse(body.messages[1].content);
assert.deepEqual(payload.map((item) => item.id), [1, 2]);
assert.equal(payload[0].question, '第一题');
assert.equal(payload[1].options.length, 3);

const railwayQuestions = [{
    kind: '单选题',
    title: '我国第一条电气化铁路是（）。',
    options: [
        { letter: 'A', text: '京九铁路' },
        { letter: 'B', text: '川藏铁路' },
        { letter: 'C', text: '宝成铁路' },
        { letter: 'D', text: '兰新铁路' },
    ],
}];
assert.equal(api.commonOptionSuffix(railwayQuestions[0].options), '铁路');
const railwayBody = api.buildRequestBody(railwayQuestions);
assert.equal(JSON.parse(railwayBody.messages[1].content)[0].theme, '铁路');
assert.equal(api.findThemeMismatches(railwayQuestions, [{ id: 1, letters: ['A'], restored: '世界上第一台电子计算机是（）' }]).length, 1);
assert.equal(api.findThemeMismatches(railwayQuestions, [{ id: 1, letters: ['C'], restored: '我国第一条电气化铁路是（）' }]).length, 0);
assert.equal(api.commonOptionSuffix([{ letter: 'A', text: '甲' }, { letter: 'B', text: '乙' }]), '');

const parsed = api.parseAnswerPayload(JSON.stringify({ answers: [{ id: 1, letters: ['A'] }, { id: 2, letters: ['B', 'C'] }] }), 2);
assert.equal(parsed.length, 2);

assert.throws(() => api.parseAnswerPayload('not json', 2), /不是有效 JSON/);
assert.throws(() => api.parseAnswerPayload('{"answers":[]}', 2), /题目数量/);
assert.throws(() => api.parseAnswerPayload('{"foo":1}', 2), /缺少 answers/);

const answers = api.validateAnswers(questions, [
    { id: 1, letters: ['a'] },
    { id: 2, letters: ['b', 'C'] },
]);
assert.deepEqual(Array.from(answers.get(1)), ['A']);
assert.deepEqual(Array.from(answers.get(2)), ['B', 'C']);

const answersWithRestored = api.validateAnswers(questions, [
    { id: 1, letters: ['A'], restored: '还原后的第一题' },
    { id: 2, letters: ['B'], restored: '还原后的第二题' },
]);
assert.deepEqual(Array.from(answersWithRestored.get(2)), ['B']);

assert.throws(() => api.validateAnswers(questions, [{ id: 1, letters: ['A'] }]), /数量不匹配/);
assert.throws(() => api.validateAnswers(questions, [{ id: 1, letters: ['A', 'B'] }, { id: 2, letters: ['A'] }]), /单选题/);
assert.throws(() => api.validateAnswers(questions, [{ id: 1, letters: ['D'] }, { id: 2, letters: ['A'] }]), /不存在的选项/);
assert.throws(() => api.validateAnswers(questions, [{ id: 1, letters: ['A'] }, { id: 2, letters: ['B', 'B'] }]), /重复选项/);
assert.throws(() => api.validateAnswers(questions, [{ id: 1, letters: [] }, { id: 2, letters: ['B'] }]), /未给出选项/);

assert.equal(api.clean('  a \n b  '), 'a b');

console.log('DeepSeek 油猴脚本元数据、依赖与作答逻辑校验通过。');
