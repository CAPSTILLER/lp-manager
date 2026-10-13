// NOTE: no spamConfidenceLevel / excludeFilters — Alchemy flags v4 positions as spam; never filter them.
// Lists Uniswap v4 position NFTs (PositionManager on Base) for an owner via Alchemy NFT API.
const PM = '0x7C5f5A4bBd8fD63184577525326123B519429bDc';
export default async function handler(req, res) {
  const owner = String(req.query.owner || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return res.status(400).json({ error: 'bad owner' });
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return res.status(503).json({ error: 'ALCHEMY_API_KEY not set' });
  const ids = []; let pageKey = '';
  try {
    for (let i = 0; i < 10; i++) {
      const u = `https://base-mainnet.g.alchemy.com/nft/v3/${key}/getNFTsForOwner?owner=${owner}&contractAddresses[]=${PM}&withMetadata=false&pageSize=100` + (pageKey ? `&pageKey=${pageKey}` : '');
      const r = await fetch(u); const txt = await r.text(); let j; try { j = JSON.parse(txt) } catch { j = null }
      if (!r.ok || !j) return res.status(502).json({ error: 'Alchemy: ' + (j?.error?.message || j?.message || txt.split('Visit')[0].trim().slice(0, 120) || r.status) });
      for (const n of j.ownedNfts || []) ids.push(n.tokenId);
      if (!j.pageKey) break; pageKey = j.pageKey;
    }
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({ owner, tokenIds: ids });
  } catch (e) { return res.status(502).json({ error: 'upstream failed' }); }
}
