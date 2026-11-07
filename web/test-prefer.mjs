// 平台偏好測試（11/07）：同一案多平台時，永慶、信義 → 住商、東森 → 5168 → 591；同級照原順序
//   用法：node web/test-prefer.mjs
import { prefer } from './src/linkcheck.mjs';
const got = prefer([
  'https://sale.591.com.tw/home/house/detail/2/1.html',
  'https://www.5168.com.tw/x',
  'https://www.hbhousing.com.tw/buyhouse/detail/A1',
  'https://buy.yungching.com.tw/house/1',
  'https://www.sinyi.com.tw/buy/house/2'
]).map(u => new URL(u).hostname.split('.').slice(-3)[0]);
const want = ['yungching', 'sinyi', 'hbhousing', '5168', '591'];
const ok = JSON.stringify(got) === JSON.stringify(want);
console.log(ok ? `  ✓ 平台偏好：${got.join(' → ')}` : `  ✗ 平台偏好：得到 ${got.join(',')}，應該 ${want.join(',')}`);
if (!ok) process.exit(1);

// 使用規則關鍵字（11/07）：選單按鈕送的字都要回規則，一般查詢不能被吃掉
import { rulesFor, MENU } from './src/rules.mjs';
let bad = 0;
for (const c of MENU.cells.filter(c => c.type === 'message' && c.text !== '今天的案件'))
  if (!rulesFor(c.text) || Array.from(rulesFor(c.text)).length > 4900) { bad++; console.log(`  ✗ 選單「${c.text}」沒有回規則或太長`); }
for (const t of ['規則', '東區優質透天', '配對 南屯 3房', '同公司 南屯']) if ((t === '規則') !== !!rulesFor(t)) { bad++; console.log(`  ✗ 「${t}」判斷錯`); }
console.log(bad ? '  ✗ 規則關鍵字有錯' : '  ✓ 規則關鍵字：選單按鈕都會回規則、一般查詢不受影響');
if (bad) process.exit(1);
