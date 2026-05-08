// Vercel API Route — 네이버 쇼핑 배치 검색
// 호출 경로: /api/batch-search

const PRICE_FLOOR = {
  hat: 8000, top: 12000, bottom: 15000, shoes: 25000, default: 10000,
};

const FASHION_MALLS = [
  '무신사', 'MUSINSA', '29CM', '29cm',
  'W컨셉', 'WCONCEPT', 'wconcept',
  '스타일쉐어', 'ABLY', '에이블리',
  'ZIGZAG', '지그재그', 'BRANDI', '브랜디',
  'OCO', 'EQL', 'LOOKPIN', '룩핀', '하이버',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다' });

  const { queries } = req.body;
  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: 'queries 배열이 필요합니다' });
  }

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const slotType = (q.slot || '').split('-').pop() || 'default';
        const items = await searchNaver(q.keyword, 20, q.sort || 'sim', slotType);
        return { slot: q.slot, keyword: q.keyword, items: items.slice(0, q.display || 5) };
      } catch (e) {
        return { slot: q.slot, keyword: q.keyword, items: [], error: e.message };
      }
    })
  );

  return res.status(200).json({ ok: true, results });
}

async function searchNaver(query, display, sort, slot = 'default') {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('네이버 API 키가 설정되지 않았습니다');
  }

  const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;

  const response = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  });

  if (!response.ok) {
    throw new Error(`네이버 API 오류 ${response.status}`);
  }

  const data = await response.json();

  let items = (data.items || []).map((item) => {
    const cleanUrl = cleanProductUrl(item.link);
    const linkType = classifyUrl(cleanUrl);
    const mall = item.mallName || '';
    const isFashionMall = FASHION_MALLS.some((m) => mall.toUpperCase().includes(m.toUpperCase()));

    return {
      name: stripHtml(item.title),
      image_url: item.image,
      product_url: cleanUrl,
      price: item.lprice ? `${Number(item.lprice).toLocaleString()}원` : null,
      price_num: Number(item.lprice) || 0,
      mall: mall || null,
      brand: item.brand || null,
      category: [item.category1, item.category2, item.category3, item.category4].filter(Boolean).join(' > '),
      is_direct_product: true,
      _link_type: linkType,
      _is_fashion_mall: isFashionMall,
    };
  });

  const floor = PRICE_FLOOR[slot] || PRICE_FLOOR.default;
  const filtered = items.filter((item) => item.price_num >= floor);
  const final = filtered.length >= 3 ? filtered : items;

  const linkPriority = { smartstore: 1, external: 2, brand: 3, shopping: 4, unknown: 5 };

  final.sort((a, b) => {
    // 0순위: 이미지 URL 있는 항목 우선 (없으면 화면에서 깨짐)
    const aHasImg = !!(a.image_url && a.image_url.startsWith('http'));
    const bHasImg = !!(b.image_url && b.image_url.startsWith('http'));
    if (aHasImg !== bHasImg) return aHasImg ? -1 : 1;
    // 1순위: 패션몰 우선
    if (a._is_fashion_mall !== b._is_fashion_mall) return a._is_fashion_mall ? -1 : 1;
    // 2순위: 직링 종류
    const lp = (linkPriority[a._link_type] || 99) - (linkPriority[b._link_type] || 99);
    if (lp !== 0) return lp;
    // 3순위: 가격 낮은 순
    return (a.price_num || 0) - (b.price_num || 0);
  });

  return final.map(({ _link_type, _is_fashion_mall, ...rest }) => rest);
}

function cleanProductUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    ['NaPm', 'frm', 'cat_id', 'ctxt', 'origQuery', 'searchAdSeq'].forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

function classifyUrl(url) {
  if (!url) return 'unknown';
  if (url.includes('smartstore.naver.com')) return 'smartstore';
  if (url.includes('brand.naver.com')) return 'brand';
  if (url.includes('search.shopping.naver.com') || url.includes('cr.shopping.naver.com')) return 'shopping';
  if (!url.includes('naver.com')) return 'external';
  return 'unknown';
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();
}