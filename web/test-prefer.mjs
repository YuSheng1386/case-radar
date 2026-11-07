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
process.exit(ok ? 0 : 1);
