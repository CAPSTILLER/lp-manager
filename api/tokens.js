// Token metadata: name, symbol, decimals, logo, priceUsd, marketCap. Cached in memory + CDN.
// Order: Alchemy alchemy_getTokenMetadata -> onchain name/symbol -> DexScreener/GeckoTerminal/Zora image.
const cache = new Map(); const TTL = 10 * 60 * 1000
const j = async (u, o) => { try { const r = await fetch(u, { ...o, signal: AbortSignal.timeout(6000) }); return r.ok ? await r.json() : null } catch { return null } }
const PUB = 'https://mainnet.base.org'
function decStr(hex) { try { const h = hex.slice(2); if (h.length >= 128) { const len = parseInt(h.slice(64, 128), 16); return Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8') } return Buffer.from(h, 'hex').toString('utf8').replace(/\0/g, '') } catch { return '' } }
async function onchain(rpc, a) {
  const call = (data, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: a, data }, 'latest'] })
  const r = await j(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([call('0x06fdde03', 1), call('0x95d89b41', 2), call('0x313ce567', 3)]) })
  if (!Array.isArray(r)) return {}
  const g = id => r.find(x => x.id === id)?.result
  return { name: g(1) ? decStr(g(1)) : null, symbol: g(2) ? decStr(g(2)) : null, decimals: g(3) && g(3) !== '0x' ? parseInt(g(3), 16) : null }
}
export default async function handler(req, res) {
  const list = String(req.query.addresses || '').split(',').map(s => s.trim().toLowerCase()).filter(a => /^0x[0-9a-f]{40}$/.test(a)).slice(0, 30)
  if (!list.length) return res.status(400).json({ error: 'addresses required' })
  const key = process.env.ALCHEMY_API_KEY, rpc = key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : PUB
  const out = {}, todo = []
  for (const a of list) { const c = cache.get(a); if (c && Date.now() - c.t < TTL) out[a] = c.v; else todo.push(a) }
  if (todo.length) {
    const [alc, ds, gt] = await Promise.all([
      key ? j(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(todo.map((a, i) => ({ jsonrpc: '2.0', id: i, method: 'alchemy_getTokenMetadata', params: [a] }))) }) : null,
      j(`https://api.dexscreener.com/tokens/v1/base/${todo.join(',')}`),
      j(`https://api.geckoterminal.com/api/v2/networks/base/tokens/multi/${todo.join(',')}`, { headers: { accept: 'application/json' } }),
    ])
    await Promise.all(todo.map(async (a, i) => {
      const am = Array.isArray(alc) ? alc.find(x => x.id === i)?.result : null
      // best DexScreener pair for this token (highest liquidity, token as base)
      const pairs = (Array.isArray(ds) ? ds : []).filter(p => p.baseToken?.address?.toLowerCase() === a).sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0))
      const dp = pairs[0]
      const ga = gt?.data?.find(d => d.attributes?.address?.toLowerCase() === a)?.attributes
      let v = { address: a, name: am?.name || null, symbol: am?.symbol || null, decimals: am?.decimals ?? null, logo: am?.logo || null, logoSource: am?.logo ? 'alchemy' : null }
      if (!v.name || !v.symbol || v.decimals == null) { const o = await onchain(rpc, a); v.name ||= o.name; v.symbol ||= o.symbol; v.decimals ??= o.decimals }
      if (!v.logo && dp?.info?.imageUrl) { v.logo = dp.info.imageUrl; v.logoSource = 'dexscreener' }
      if (!v.logo && ga?.image_url && !/missing/.test(ga.image_url)) { v.logo = ga.image_url; v.logoSource = 'geckoterminal' }
      if (!v.logo) { const z = await j(`https://api-sdk.zora.engineering/coin?address=${a}&chain=8453`); const m = z?.zora20Token?.mediaContent?.previewImage; const u = m?.medium || m?.small; if (u) { v.logo = u; v.logoSource = 'zora' } }
      v.priceUsd = dp?.priceUsd ? Number(dp.priceUsd) : ga?.price_usd ? Number(ga.price_usd) : null
      v.marketCap = dp?.marketCap ?? dp?.fdv ?? (ga?.market_cap_usd ? Number(ga.market_cap_usd) : ga?.fdv_usd ? Number(ga.fdv_usd) : null)
      v.priceSource = dp?.priceUsd ? 'dexscreener' : ga?.price_usd ? 'geckoterminal' : null
      cache.set(a, { t: Date.now(), v }); out[a] = v
    }))
  }
  res.setHeader('cache-control', 'public, s-maxage=600, stale-while-revalidate=3600')
  return res.status(200).json(out)
}
