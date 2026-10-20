// 實價登錄行情比對模組
// 資料來源: 內政部不動產交易實價查詢服務網
// 每天凌晨自動更新，快取統計結果（不佔空間）

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = process.env.RADAR_STATE || path.join(__dirname, '..', 'state');
const MARKET_CACHE = path.join(DATA_DIR, 'market-prices.json');

// 城市代碼（實價登錄 CSV 檔名前綴）
const CITY_FILE_PREFIX = {
  '台北市': 'a', '台中市': 'b', '基隆市': 'c', '台南市': 'd',
  '高雄市': 'e', '新北市': 'f', '宜蘭縣': 'g', '桃園市': 'h',
  '嘉義市': 'i', '新竹縣': 'j', '苗栗縣': 'k', '南投縣': 'm',
  '彰化縣': 'n', '新竹市': 'o', '雲林縣': 'p', '嘉義縣': 'q',
  '屏東縣': 't', '花蓮縣': 'u', '台東縣': 'v'
};

// 取得最近幾季代碼（最近一年 = 4季）
function getRecentSeasons(count = 4) {
  const seasons = [];
  const now = new Date();
  let year = now.getFullYear() - 1911;
  let season = Math.ceil((now.getMonth() + 1) / 3) - 1;
  if (season <= 0) { season = 4; year--; }
  for (let i = 0; i < count; i++) {
    seasons.push(`${year}S${season}`);
    season--;
    if (season <= 0) { season = 4; year--; }
  }
  return seasons;
}

// 下載 ZIP 到暫存
function downloadZip(season) {
  return new Promise((resolve, reject) => {
    const url = `https://plvr.land.moi.gov.tw/DownloadSeason?season=${season}&type=season&fileName=lvr_landcsv.zip`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const tmpZip = require('path').join(require('os').tmpdir(), `lvr_${season}.zip`);
        fs.writeFileSync(tmpZip, Buffer.concat(chunks));
        resolve(tmpZip);
      });
    }).on('error', reject);
  });
}

// 從 ZIP 提取指定城市的買賣 CSV 並解析
function extractAndParse(zipPath, filePrefix) {
  const csvFile = `${filePrefix}_lvr_land_a.csv`;
  try {
    const result = execSync(`python3 -c "
import zipfile, json, sys
z = zipfile.ZipFile('${zipPath}')
if '${csvFile}' not in z.namelist():
    print('[]')
    sys.exit(0)
import csv, io
data = z.read('${csvFile}').decode('utf-8')
reader = csv.reader(io.StringIO(data))
rows = list(reader)
# 跳過標題（2行）
out = []
for row in rows[2:]:
    if len(row) < 30: continue
    out.append({
        'd': row[0],
        'addr': row[2],
        'date': row[7],
        'type': row[11],
        'age_str': row[14],
        'area': row[15],
        'room': row[16],
        'hall': row[17],
        'bath': row[18],
        'price': row[21],
        'unit_price': row[22],
        'park_area': row[24],
        'park_price': row[25],
        'main_area': row[28]
    })
print(json.dumps(out, ensure_ascii=False))
"`, { maxBuffer: 100 * 1024 * 1024, encoding: 'utf8' });
    return JSON.parse(result);
  } catch (e) {
    console.error(`[實價] 解析失敗:`, e.message?.slice(0, 100));
    return [];
  }
}

// 從地址提取社區名
function extractCommunity(addr) {
  // 常見格式：「XX社區」「XX大廈」「XX名宅」等
  const m = addr.match(/([\u4e00-\u9fa5]{2,8}(?:社區|大廈|花園|名宅|大樓|城堡|莊園|公園|廣場|世界|別墅|山莊))/);
  return m ? m[1] : '';
}

// 計算屋齡（建築完成年月 → 年數）
function calcAge(ageStr) {
  if (!ageStr || ageStr.length < 4) return null;
  const year = parseInt(ageStr.substring(0, 3)); // 民國年
  if (isNaN(year) || year <= 0) return null;
  const now = new Date();
  const currentROC = now.getFullYear() - 1911;
  return currentROC - year;
}

// 簡化建物型態
function simplifyType(buildType) {
  if (!buildType) return null;
  if (buildType.includes('住宅大樓') || buildType.includes('華廈')) return '大樓';
  if (buildType.includes('透天')) return '透天';
  if (buildType.includes('公寓')) return '公寓';
  return null;
}

// 更新實價登錄資料（下載最近4季，統計後只存結果）
async function updateMarketPrices(city = '台中市') {
  const prefix = CITY_FILE_PREFIX[city];
  if (!prefix) { console.log(`[實價] ${city} 無對應代碼`); return null; }

  const seasons = getRecentSeasons(4);
  console.log(`[實價] 下載 ${city} 最近4季: ${seasons.join(', ')}`);

  const allTxns = []; // 所有交易紀錄

  for (const season of seasons) {
    console.log(`[實價] 下載 ${season}...`);
    let zipPath;
    try {
      zipPath = await downloadZip(season);
      const rows = extractAndParse(zipPath, prefix);
      allTxns.push(...rows);
      console.log(`[實價] ${season}: ${rows.length} 筆`);
    } catch (e) {
      console.error(`[實價] ${season} 失敗:`, e.message);
    } finally {
      // 刪除暫存 ZIP，不佔空間
      if (zipPath && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    }
  }

  if (allTxns.length === 0) { console.log('[實價] 無資料'); return null; }

  // 整理每筆交易
  const transactions = [];
  for (const t of allTxns) {
    const simpleType = simplifyType(t.type);
    if (!simpleType) continue;

    const areaM2 = parseFloat(t.area) || 0;
    const totalPrice = parseInt(t.price) || 0;
    const mainAreaM2 = parseFloat(t.main_area) || 0;
    if (areaM2 === 0 || totalPrice === 0) continue;

    // 扣除車位
    let adjPrice = totalPrice;
    let adjArea = areaM2;
    const parkPrice = parseInt(t.park_price) || 0;
    if (parkPrice > 0) {
      adjPrice -= parkPrice;
      adjArea -= (parseFloat(t.park_area) || 0);
    }
    if (adjArea <= 0 || adjPrice <= 0) continue;

    const areaPing = adjArea / 3.30579;
    const unitPricePing = adjPrice / adjArea * 3.30579 / 10000;
    if (unitPricePing < 3 || unitPricePing > 200) continue;

    const age = calcAge(t.age_str);
    const community = extractCommunity(t.addr);

    transactions.push({
      district: t.d,
      type: simpleType,
      areaPing: Math.round(areaPing * 10) / 10,
      unitPrice: Math.round(unitPricePing * 10) / 10,
      age,
      community,
      room: parseInt(t.room) || 0,
      date: t.date
    });
  }

  // 建立區域×型態的索引（不存每筆明細，只存必要的比對資料）
  const index = {};
  for (const txn of transactions) {
    const key = `${txn.district}_${txn.type}`;
    if (!index[key]) index[key] = { txns: [], district: txn.district, type: txn.type };
    index[key].txns.push({
      up: txn.unitPrice,
      a: txn.areaPing,
      age: txn.age,
      c: txn.community,
      r: txn.room
    });
  }

  // 每個區域×型態計算整體統計
  const stats = {};
  for (const [key, data] of Object.entries(index)) {
    const prices = data.txns.map(t => t.up).sort((a, b) => a - b);
    if (prices.length < 3) continue;
    const trim = Math.max(1, Math.floor(prices.length * 0.1));
    const trimmed = prices.slice(trim, prices.length - trim);
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    const median = trimmed[Math.floor(trimmed.length / 2)];

    stats[key] = {
      district: data.district,
      type: data.type,
      count: prices.length,
      avg: Math.round(avg * 10) / 10,
      median: Math.round(median * 10) / 10,
      txns: data.txns // 保留明細供精準比對
    };
  }

  const cacheData = {
    city,
    seasons,
    updatedAt: new Date().toISOString(),
    totalTransactions: transactions.length,
    stats
  };

  fs.writeFileSync(MARKET_CACHE, JSON.stringify(cacheData), 'utf8');
  console.log(`[實價] ${city} 完成: ${Object.keys(stats).length} 區域×型態, ${transactions.length} 筆交易`);
  return cacheData;
}

// 取得快取
function getMarketPrices() {
  try { return JSON.parse(fs.readFileSync(MARKET_CACHE, 'utf8')); }
  catch { return null; }
}

// 精準比對：找同社區/相近坪數/相近屋齡的交易
function compareWithMarket(listing, marketData) {
  if (!marketData || !marketData.stats || !listing.unitPrice) return null;

  const district = listing.district || '';
  let simpleType = '大樓';
  const type = (listing.type || '').toLowerCase();
  const title = (listing.title || '').toLowerCase();
  if (type.includes('透天') || type.includes('別墅') || title.includes('透天') || title.includes('別墅')) simpleType = '透天';
  else if (type.includes('公寓') || title.includes('公寓')) simpleType = '公寓';

  const key = `${district}_${simpleType}`;
  const stat = marketData.stats[key];
  if (!stat || !stat.txns) return null;

  const listingArea = listing.area || 0;
  const listingAge = listing.age ? (typeof listing.age === 'number' ? listing.age : parseInt(listing.age)) : null;
  const listingCommunity = listing.community || '';

  // 找相似交易（優先順序：同社區 > 相近坪數+屋齡 > 同區域同型態）
  let comparables = stat.txns;
  let matchLevel = 'district'; // 比對層級

  // 1. 嘗試同社區比對
  if (listingCommunity && listingCommunity.length >= 2) {
    const communityMatch = stat.txns.filter(t => t.c && t.c.includes(listingCommunity));
    if (communityMatch.length >= 3) {
      comparables = communityMatch;
      matchLevel = 'community';
    }
  }

  // 2. 如果沒同社區，用相近條件
  if (matchLevel !== 'community' && listingArea > 0) {
    const similar = stat.txns.filter(t => {
      // 坪數 ±20%
      if (t.a > 0 && Math.abs(t.a - listingArea) / listingArea > 0.2) return false;
      // 屋齡 ±2.5年
      if (listingAge && t.age !== null && Math.abs(t.age - listingAge) > 2.5) return false;
      return true;
    });
    if (similar.length >= 5) {
      comparables = similar;
      matchLevel = 'similar';
    }
  }

  // 計算比對結果
  const prices = comparables.map(t => t.up).sort((a, b) => a - b);
  const trim = Math.max(1, Math.floor(prices.length * 0.1));
  const trimmed = prices.length > 5 ? prices.slice(trim, prices.length - trim) : prices;
  const median = trimmed[Math.floor(trimmed.length / 2)];
  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;

  const diff = (listing.unitPrice - median) / median * 100;

  return {
    median: Math.round(median * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    count: comparables.length,
    matchLevel, // community / similar / district
    diff: Math.round(diff * 10) / 10,
    rating: diff <= -15 ? 'excellent' : diff <= -5 ? 'good' : diff <= 5 ? 'fair' : 'high'
  };
}

module.exports = { updateMarketPrices, getMarketPrices, compareWithMarket };
