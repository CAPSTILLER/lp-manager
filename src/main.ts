import { createCoinbaseWalletSDK } from '@coinbase/wallet-sdk'
import { formatUnits, parseUnits, isAddress, getAddress, type Address, type Hex } from 'viem'
import * as L from './lib'
import * as AE from './aero'

const $ = (s: string) => document.querySelector(s) as HTMLElement
const app = $('#app'), sheet = $('#sheet'), btn = $('#connect') as HTMLButtonElement
let provider: any = null, account: Address | null = null
let viewAddr: Address | null = null
let slip = Number(localStorage.getItem('slipBps') || 50)
const positions = new Map<string, L.Position>()
type Meta = { name: string | null; symbol: string | null; logo: string | null; logoSource: string | null; priceUsd: number | null; marketCap: number | null }
const meta = new Map<string, Meta>()
const ETH_LOGO = 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png'
async function loadMeta(addrs: string[]) {
  const need = [...new Set(addrs.map(a => a.toLowerCase()))].filter(a => a !== L.ZERO && !meta.has(a))
  for (let i = 0; i < need.length; i += 30) {
    try { const r = await fetch('/api/tokens?addresses=' + need.slice(i, i + 30).join(',')); const j = await r.json(); for (const k in j) meta.set(k, j[k]) } catch { }
  }
}
function avatar(sym: string) {
  const c = ['#2563eb', '#7c3aed', '#db2777', '#059669', '#d97706', '#0891b2'][[...sym].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 6]
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${c}"/><text x="20" y="26" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="#fff" text-anchor="middle">${esc((sym || '?').slice(0, 2).toUpperCase())}</text></svg>`)
}
const tk = (t: L.Token) => { const m = meta.get(t.address.toLowerCase()); return { name: m?.name || t.name, sym: (m?.symbol || t.symbol || '?'), logo: t.native ? ETH_LOGO : m?.logo || null, price: m?.priceUsd ?? null, mcap: m?.marketCap ?? null, src: m?.logoSource } }
const logoImg = (t: L.Token, sz = 28) => { const x = tk(t), av = avatar(x.sym); return `<img class="tlogo" width="${sz}" height="${sz}" src="${esc(x.logo || av)}" data-av="${av}" onerror="this.onerror=null;this.src=this.dataset.av" alt="">` }
const usd = (n: number | null) => n == null ? '—' : n === 0 ? '$0' : '$' + (n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(4))


const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4)
const fmt = (v: bigint, d: number, max = 6) => { const n = Number(formatUnits(v, d)); return n === 0 ? '0' : n < 1e-6 ? n.toExponential(3) : n.toLocaleString(undefined, { maximumFractionDigits: max }) }
const fp = (n: number) => !isFinite(n) ? '∞' : n === 0 ? '0' : (n < 1e-4 || n > 1e12) ? n.toExponential(4) : n.toLocaleString(undefined, { maximumSignificantDigits: 6 })
const addrLink = (a: string, label?: string) => `<a href="${L.SCAN}/address/${a}" target="_blank" rel="noopener">${label || short(a)}</a>`
function toast(m: string, ms = 3500) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout((t as any)._h); (t as any)._h = setTimeout(() => t.style.display = 'none', ms) }

// ---------- wallet ----------
function setBtn() { if (!$('#locks').classList.contains('hidden')) loadLocks(); btn.textContent = account ? short(account) : 'Connect wallet'; btn.classList.toggle('on', !!account) }
async function useProvider(p: any) {
  const accs: string[] = await p.request({ method: 'eth_requestAccounts' })
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }) } catch { }
  provider = p; account = getAddress(accs[0]); setBtn()
  p.on?.('accountsChanged', (a: string[]) => { account = a[0] ? getAddress(a[0]) : null; setBtn(); if (account) load(account) })
  viewAddr = account; (document.getElementById('addr') as HTMLInputElement).value = account; load(account)
}
btn.onclick = () => {
  if (account) { if (confirm('Disconnect wallet?')) { provider?.disconnect?.(); account = null; provider = null; setBtn() } return }
  const inj = (window as any).ethereum
  openSheet('Connect wallet', `
    <button class="b" id="w-cb" style="width:100%;margin:8px 0">Coinbase Smart Wallet</button>
    ${inj ? '<button class="b g" id="w-inj" style="width:100%;margin:8px 0">Browser wallet (injected)</button>' : '<p class="muted">No browser wallet detected. Smart Wallet works in any phone browser with a passkey.</p>'}`)
  $('#w-cb').onclick = async () => {
    try {
      const sdk = createCoinbaseWalletSDK({ appName: 'LP Manager', appChainIds: [8453], preference: { options: 'smartWalletOnly' } })
      closeSheet(); await useProvider(sdk.getProvider())
    } catch (e: any) { toast(e.message || 'connect failed') }
  }
  const wi = document.getElementById('w-inj'); if (wi) wi.onclick = async () => { try { closeSheet(); await useProvider(inj) } catch (e: any) { toast(e.message || 'connect failed') } }
}
async function sendTx(to: Address, data: Hex, value = 0n, label = 'tx') {
  if (!provider || !account) { toast('Connect wallet first'); throw new Error('no wallet') }
  try { await L.simulate(account, to, data, value) } catch (e: any) {
    if (!confirm(`Simulation of ${label} failed:\n${e.shortMessage || e.message}\n\nSend anyway?`)) throw e
  }
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data, value: '0x' + value.toString(16), chainId: '0x2105' }] })
  toast(`${label} sent: ${short(hash)}`, 6000)
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 2000)); const r = await L.client.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null) as any; if (r) { toast(`${label} ${r.status === '0x1' ? 'confirmed' : 'FAILED'}`); return hash } }
  return hash
}

// ---------- list ----------
function shell() {
  app.innerHTML = `
  <div class="card"><div class="muted">View positions for any address (read-only) or connect.</div>
   <div class="row" style="margin-top:8px"><input id="addr" placeholder="0x… wallet address"><button class="b" id="go">View</button></div>
   <div class="row" style="margin-top:8px"><input id="tid" placeholder="or position NFT id, e.g. 755630" inputmode="numeric"><button class="b g" id="goid">Open</button></div>
   <div class="row muted" style="margin-top:8px;justify-content:space-between"><span>Slippage</span><span><select id="slip" style="width:auto">${[10, 50, 100, 300, 500].map(b => `<option value="${b}" ${b === slip ? 'selected' : ''}>${b / 100}%</option>`).join('')}</select></span></div>
  </div>
  <div class="tabs" id="maintabs"><button class="b act" data-v="pos">LP positions</button><button class="b g" data-v="locks">Aerodrome locks</button></div>
  <div id="list"></div><div id="locks" class="hidden"></div>`
  document.querySelectorAll('#maintabs button').forEach(b => (b as HTMLElement).onclick = () => {
    document.querySelectorAll('#maintabs button').forEach(x => { x.classList.remove('act'); x.classList.add('g') }); b.classList.add('act'); b.classList.remove('g')
    const v = (b as HTMLElement).dataset.v; $('#list').classList.toggle('hidden', v !== 'pos'); $('#locks').classList.toggle('hidden', v !== 'locks'); if (v === 'locks') loadLocks()
  })
  $('#go').onclick = () => { const v = ($('#addr') as HTMLInputElement).value.trim(); if (!isAddress(v)) return toast('Not a valid address'); viewAddr = getAddress(v); history.replaceState(null, '', '?addr=' + viewAddr); load(viewAddr) }
  $('#goid').onclick = async () => { const v = ($('#tid') as HTMLInputElement).value.trim(); if (!/^\d+$/.test(v)) return toast('Enter a numeric id'); try { const p = await L.loadPosition(BigInt(v)); positions.set(v, p); await loadMeta([p.t0.address, p.t1.address]); openDetail(p) } catch (e: any) { toast('Not found: ' + (e.shortMessage || e.message)) } }
  $('#slip').onchange = e => { slip = Number((e.target as HTMLSelectElement).value); localStorage.setItem('slipBps', String(slip)) }
}
function card(p: L.Position) {
  const inR = p.tick >= p.tickLower && p.tick < p.tickUpper
  const price = L.priceFromSqrt(p.sqrtPriceX96, p.t0.decimals, p.t1.decimals)
  return `<div class="card pcard" data-id="${p.tokenId}">
   <div class="row" style="justify-content:space-between"><span class="row"><span class="logos">${logoImg(p.t0)}${logoImg(p.t1)}</span><span class="pair">${esc(tk(p.t0).sym.toUpperCase())}/${esc(tk(p.t1).sym.toUpperCase())}</span></span><span class="pill ${inR ? '' : 'out'}">${p.liquidity === 0n ? 'closed' : inR ? 'in range' : 'out of range'}</span></div>
   <div class="muted">#${p.tokenId} · v4 · ${(p.key.fee / 10000).toFixed(2)}% · ${p.key.hooks === L.ZERO ? 'no hook' : 'hook ' + short(p.key.hooks)}</div>
   <div class="kv"><span>Amounts</span><span>${fmt(p.amount0, p.t0.decimals, 2)} ${esc(p.t0.symbol)} · ${fmt(p.amount1, p.t1.decimals, 4)} ${esc(p.t1.symbol)}</span></div>
   <div class="kv"><span>Unclaimed fees</span><span>${fmt(p.fees0, p.t0.decimals, 2)} ${esc(p.t0.symbol)} · ${fmt(p.fees1, p.t1.decimals)} ${esc(p.t1.symbol)}</span></div>
   <div class="kv"><span>Price</span><span>1 ${esc(p.t0.symbol)} = ${fp(price)} ${esc(p.t1.symbol)}</span></div></div>`
}
async function load(owner: Address) {
  const list = $('#list'); list.innerHTML = '<p class="muted">Loading positions…</p>'
  let ids: bigint[]
  try { ids = await L.listTokenIds(owner) } catch (e: any) { list.innerHTML = `<p class="muted">Couldn't list NFTs (${esc(e.message)}). Open a position by NFT id above.</p>`; return }
  if (!ids.length) { list.innerHTML = '<p class="muted">No Uniswap v4 positions found for this address on Base.</p>'; return }
  list.innerHTML = `<p class="muted">${ids.length} v4 position${ids.length > 1 ? 's' : ''} for ${addrLink(owner)}</p>`
  const res = await Promise.allSettled(ids.map(id => L.loadPosition(id)))
  const ok = res.flatMap(r => r.status === 'fulfilled' ? [r.value] : []).sort((a, b) => Number(b.liquidity > 0n) - Number(a.liquidity > 0n))
  for (const p of ok) positions.set(String(p.tokenId), p)
  await loadMeta(ok.flatMap(p => [p.t0.address, p.t1.address]))
  const bad = res.length - ok.length
  list.innerHTML += ok.map(card).join('') + (bad ? `<p class="muted">${bad} position(s) failed to load. Pull to refresh or open by id.</p>` : '')
  list.querySelectorAll('.pcard').forEach(el => (el as HTMLElement).onclick = () => openDetail(positions.get((el as HTMLElement).dataset.id!)!))
}

// ---------- detail ----------
function openSheet(title: string, html: string) { sheet.innerHTML = `<div class="top"><h2>${title}</h2><button class="b g" id="close">✕</button></div>${html}`; sheet.classList.remove('hidden'); $('#close').onclick = closeSheet }
function closeSheet() { sheet.classList.add('hidden'); sheet.innerHTML = '' }
function tokenBlock(t: L.Token, label: string, price: string) {
  return `<div class="card"><div class="row">${logoImg(t, 44)}<div><div class="pair">${esc(tk(t).sym.toUpperCase())}</div><div class="muted">${label} · ${esc(tk(t).name)}</div></div></div>
  <div class="kv"><span>Name</span><span>${esc(tk(t).name)}</span></div><div class="kv"><span>Ticker</span><span>${esc(tk(t).sym)}</span></div>
  <div class="kv"><span>Price (USD)</span><span>${usd(tk(t).price)}</span></div><div class="kv"><span>Market cap</span><span>${usd(tk(t).mcap)}</span></div>
  <div class="kv"><span>Address</span><span>${t.native ? 'native ETH' : addrLink(t.address, t.address)}</span></div>
  <div class="kv"><span>Decimals</span><span>${t.decimals}</span></div>
  ${t.native ? '' : `<div class="kv"><span>Total supply</span><span>${fmt(t.totalSupply, t.decimals, 2)}</span></div>`}
  <div class="kv"><span>Pool price</span><span>${price}</span></div>
  ${t.native ? '' : `<div class="kv"><span>Links</span><span>${addrLink(t.address, 'BaseScan')} · <a target="_blank" href="https://dexscreener.com/base/${t.address}">DexScreener</a></span></div>`}</div>`
}
function openDetail(p: L.Position) {
  const price = L.priceFromSqrt(p.sqrtPriceX96, p.t0.decimals, p.t1.decimals)
  const lo = L.priceAtTick(p.tickLower, p.t0.decimals, p.t1.decimals), hi = L.priceAtTick(p.tickUpper, p.t0.decimals, p.t1.decimals)
  const full = p.tickLower <= -887000 && p.tickUpper >= 887000
  const share = p.poolLiquidity ? Number(p.liquidity * 10000n / p.poolLiquidity) / 100 : 0
  const mine = account && account.toLowerCase() === p.owner.toLowerCase()
  openSheet(`<span class="row"><span class="logos">${logoImg(p.t0)}${logoImg(p.t1)}</span>${esc(tk(p.t0).sym.toUpperCase())}/${esc(tk(p.t1).sym.toUpperCase())} <span class="muted">#${p.tokenId}</span></span>`, `
  <div class="card">
   <div class="kv"><span>Owner</span><span>${addrLink(p.owner)}${mine ? ' (you)' : ''}</span></div>
   <div class="kv"><span>Position NFT</span><span><a target="_blank" href="${L.SCAN}/nft/${L.PM}/${p.tokenId}">BaseScan</a> · <a target="_blank" href="https://app.uniswap.org/positions/v4/base/${p.tokenId}">Uniswap</a></span></div>
   <div class="kv"><span>Pool id</span><span><code>${p.poolId}</code></span></div>
   <div class="kv"><span>Fee / tick spacing</span><span>${(p.key.fee / 10000).toFixed(2)}% (live ${(p.lpFee / 10000).toFixed(2)}%) / ${p.key.tickSpacing}</span></div>
   <div class="kv"><span>Hooks</span><span>${p.key.hooks === L.ZERO ? 'none' : addrLink(p.key.hooks)}</span></div>
   <div class="kv"><span>Range</span><span>${full ? 'Full range' : `${fp(lo)} – ${fp(hi)}`} <span class="muted">(ticks ${p.tickLower}…${p.tickUpper})</span></span></div>
   <div class="kv"><span>Current tick</span><span>${p.tick}</span></div>
   <div class="kv"><span>Price</span><span>1 ${esc(p.t0.symbol)} = ${fp(price)} ${esc(p.t1.symbol)}<br>1 ${esc(p.t1.symbol)} = ${fp(1 / price)} ${esc(p.t0.symbol)}</span></div>
   <div class="kv"><span>Liquidity</span><span>${p.liquidity} (${share}% of pool)</span></div>
   <div class="kv"><span>Amounts</span><span>${fmt(p.amount0, p.t0.decimals)} ${esc(p.t0.symbol)}<br>${fmt(p.amount1, p.t1.decimals)} ${esc(p.t1.symbol)}</span></div>
   <div class="kv"><span>Unclaimed fees</span><span>${fmt(p.fees0, p.t0.decimals)} ${esc(p.t0.symbol)}<br>${fmt(p.fees1, p.t1.decimals)} ${esc(p.t1.symbol)}</span></div>
  </div>
  ${tokenBlock(p.t0, 'Token 0', `${fp(price)} ${esc(p.t1.symbol)}`)}
  ${tokenBlock(p.t1, 'Token 1', `${fp(1 / price)} ${esc(p.t0.symbol)}`)}
  <h2>Actions</h2>${mine ? '' : '<p class="muted">Connect the owner wallet to act. Read-only view.</p>'}
  <div class="tabs">${['Claim', 'Remove', 'Add', 'Transfer', 'Send token'].map(t => `<button class="b g" data-t="${t}">${t}</button>`).join('')}</div>
  <div id="act" class="card"><span class="muted">Pick an action. Slippage: ${slip / 100}%</span></div>`)
  sheet.querySelectorAll('.tabs button').forEach(b => (b as HTMLElement).onclick = () => { sheet.querySelectorAll('.tabs button').forEach(x => x.classList.remove('act')); b.classList.add('act'); renderAction(p, (b as HTMLElement).dataset.t!) })
}
async function refresh(p: L.Position) { const n = await L.loadPosition(p.tokenId); positions.set(String(n.tokenId), n); openDetail(n) }
function need(): Address { if (!account) { toast('Connect wallet first'); throw new Error('x') } return account }

async function ensureApprovals(t: L.Token, amt: bigint) {
  if (t.native || amt === 0n) return
  const me = need()
  const a1 = await L.client.readContract({ address: t.address, abi: L.ercAbi, functionName: 'allowance', args: [me, L.PERMIT2] })
  if (a1 < amt) await sendTx(t.address, L.approveCalldata(L.PERMIT2), 0n, `Approve ${t.symbol} → Permit2`)
  const [a2, exp] = await L.client.readContract({ address: L.PERMIT2, abi: L.p2Abi, functionName: 'allowance', args: [me, t.address, L.PM] })
  if (a2 < amt || exp < Date.now() / 1000 + 60) await sendTx(L.PERMIT2, L.permit2ApproveCalldata(t.address), 0n, `Permit2 ${t.symbol} → PositionManager`)
}
function renderAction(p: L.Position, t: string) {
  const act = $('#act'), s0 = esc(p.t0.symbol), s1 = esc(p.t1.symbol)
  if (t === 'Claim') {
    act.innerHTML = `<div class="kv"><span>Collect</span><span>${fmt(p.fees0, p.t0.decimals)} ${s0} + ${fmt(p.fees1, p.t1.decimals)} ${s1}</span></div><button class="b" id="do" style="width:100%;margin-top:10px">Claim fees</button>`
    $('#do').onclick = async () => { const me = need(); await sendTx(L.PM, L.claimCalldata(p, me), 0n, 'Claim fees'); refresh(p) }
  } else if (t === 'Remove') {
    act.innerHTML = `<div class="row" style="justify-content:space-between"><span>Remove</span><b id="pv">50%</b></div><input type="range" id="pct" min="1" max="100" value="50">
     <div class="row" style="margin:6px 0">${[25, 50, 75, 100].map(v => `<button class="b g q" data-v="${v}" style="flex:1">${v}%</button>`).join('')}</div>
     <div class="kv"><span>You receive ≈</span><span id="rv"></span></div><div class="muted">Includes unclaimed fees. Min with ${slip / 100}% slippage.</div>
     <button class="b" id="do" style="width:100%;margin-top:10px">Remove liquidity</button>`
    const pct = $('#pct') as HTMLInputElement
    const upd = () => { const v = Number(pct.value); $('#pv').textContent = v + '%'; const Lq = p.liquidity * BigInt(v) / 100n; const [a0, a1] = L.amountsForLiquidity(p.sqrtPriceX96, L.sqrtAtTick(p.tickLower), L.sqrtAtTick(p.tickUpper), Lq); $('#rv').innerHTML = `${fmt(a0 + p.fees0, p.t0.decimals)} ${s0}<br>${fmt(a1 + p.fees1, p.t1.decimals)} ${s1}` }
    pct.oninput = upd; act.querySelectorAll('.q').forEach(b => (b as HTMLElement).onclick = () => { pct.value = (b as HTMLElement).dataset.v!; upd() }); upd()
    $('#do').onclick = async () => { const me = need(); await sendTx(L.PM, L.removeCalldata(p, Number(pct.value), slip, me), 0n, 'Remove liquidity'); refresh(p) }
  } else if (t === 'Add') {
    act.innerHTML = `<label class="muted">${s0} amount</label><input id="a0" inputmode="decimal" placeholder="0.0"><label class="muted">${s1} amount</label><input id="a1" inputmode="decimal" placeholder="0.0">
     <div class="muted" id="bal" style="margin-top:6px"></div><div class="muted">Amounts stay in ratio with the position's range (typing one fills the other). Max uses ${slip / 100}% slippage. Approvals (token → Permit2 → PositionManager) are requested first if needed.</div>
     <button class="b" id="do" style="width:100%;margin-top:10px">Add liquidity</button>`
    const i0 = $('#a0') as HTMLInputElement, i1 = $('#a1') as HTMLInputElement
    const sa = L.sqrtAtTick(p.tickLower), sb = L.sqrtAtTick(p.tickUpper)
    const big = 10n ** 40n
    i0.oninput = () => { try { const a = parseUnits(i0.value || '0', p.t0.decimals); const Lq = L.liquidityForAmounts(p.sqrtPriceX96, sa, sb, a, big); i1.value = formatUnits(L.amountsForLiquidity(p.sqrtPriceX96, sa, sb, Lq)[1], p.t1.decimals) } catch { } }
    i1.oninput = () => { try { const a = parseUnits(i1.value || '0', p.t1.decimals); const Lq = L.liquidityForAmounts(p.sqrtPriceX96, sa, sb, big, a); i0.value = formatUnits(L.amountsForLiquidity(p.sqrtPriceX96, sa, sb, Lq)[0], p.t0.decimals) } catch { } }
    if (account) Promise.all([p.t0, p.t1].map(t => t.native ? L.client.getBalance({ address: account! }) : L.client.readContract({ address: t.address, abi: L.ercAbi, functionName: 'balanceOf', args: [account!] }))).then(([b0, b1]) => $('#bal').textContent = `Balance: ${fmt(b0, p.t0.decimals)} ${p.t0.symbol} · ${fmt(b1, p.t1.decimals)} ${p.t1.symbol}`)
    $('#do').onclick = async () => {
      const me = need(); const plan = L.addPlan(p, parseUnits(i0.value || '0', p.t0.decimals), parseUnits(i1.value || '0', p.t1.decimals), slip, me)
      if (plan.L === 0n) return toast('Enter an amount')
      await ensureApprovals(p.t0, plan.max0); await ensureApprovals(p.t1, plan.max1)
      await sendTx(L.PM, plan.data, plan.value, 'Add liquidity'); refresh(p)
    }
  } else if (t === 'Transfer') {
    act.innerHTML = `<label class="muted">Send position NFT #${p.tokenId} to</label><input id="to" placeholder="0x…"><div class="muted">Moves ownership of the whole position (liquidity + fees). Double-check the address.</div><button class="b" id="do" style="width:100%;margin-top:10px">Transfer position</button>`
    $('#do').onclick = async () => { const me = need(); const to = ($('#to') as HTMLInputElement).value.trim(); if (!isAddress(to)) return toast('Bad address'); if (!confirm(`Transfer #${p.tokenId} to ${to}?`)) return; await sendTx(L.PM, L.transferNftCalldata(me, getAddress(to), p.tokenId), 0n, 'Transfer NFT') }
  } else {
    const opts = [p.t0, p.t1].filter(x => !x.native)
    act.innerHTML = `<label class="muted">Token</label><select id="tk">${opts.map((x, i) => `<option value="${i}">${esc(x.symbol)}</option>`).join('')}</select>
     <label class="muted">To</label><input id="to" placeholder="0x…"><label class="muted">Amount</label><input id="amt" inputmode="decimal" placeholder="0.0"><button class="b" id="do" style="width:100%;margin-top:10px">Send token</button>`
    $('#do').onclick = async () => { need(); const tk = opts[Number(($('#tk') as HTMLSelectElement).value)]; const to = ($('#to') as HTMLInputElement).value.trim(); if (!isAddress(to)) return toast('Bad address'); const amt = parseUnits(($('#amt') as HTMLInputElement).value || '0', tk.decimals); if (amt === 0n) return toast('Enter amount'); if (!confirm(`Send ${formatUnits(amt, tk.decimals)} ${tk.symbol} to ${to}?`)) return; await sendTx(tk.address, L.erc20TransferCalldata(getAddress(to), amt), 0n, `Send ${tk.symbol}`) }
  }
}

// ---------- Aerodrome locks ----------
const locks = new Map<string, AE.Lock>()
const md = (a: string) => meta.get(a.toLowerCase())
const dec = (a: string) => (md(a) as any)?.decimals ?? 18
const symOf = (a: string) => md(a)?.symbol || short(a)
const amtStr = (x: AE.Amt[]) => x.length ? x.map(a => `${fmt(a.amount, dec(a.token))} ${esc(symOf(a.token))}`).join('<br>') : '0'
const usdOf = (x: AE.Amt[]) => x.reduce((s, a) => s + Number(formatUnits(a.amount, dec(a.token))) * (md(a.token)?.priceUsd || 0), 0)
const dt = (t: number) => new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const lockTokens = (l: AE.Lock) => [AE.AERO, ...(l.relay ? [l.relay.token] : []), ...l.compoundedEarned.map(a => a.token), ...l.freeEarned.map(a => a.token), ...l.votes.flatMap(v => [...v.feeEarned, ...v.bribeEarned, ...v.estNext].map(a => a.token))]
function lockAero(l: AE.Lock) { return l.managedId > 0n ? l.managedWeight : l.amount }
function lockCard(l: AE.Lock) {
  const st = l.managedId > 0n ? `Relay: ${esc(l.relay?.name || 'managed #' + l.managedId)}` : l.permanent ? 'Permanent lock' : l.end ? 'Unlocks ' + new Date(l.end * 1000).toLocaleDateString() : 'Expired'
  return `<div class="card pcard lcard" data-id="${l.id}"><div class="row" style="justify-content:space-between"><span class="row"><span class="logos">${logoImg({ address: AE.AERO, symbol: 'AERO', name: 'Aerodrome', decimals: 18, totalSupply: 0n, native: false })}</span><span class="pair">veAERO #${l.id}</span></span><span class="pill">${l.escrowType === 2 ? 'managed' : l.managedId > 0n ? 'in relay' : 'normal'}</span></div>
  <div class="muted">${st} · owner ${short(l.owner)}</div>
  <div class="kv"><span>Locked</span><span>${fmt(lockAero(l), 18, 2)} AERO</span></div>
  <div class="kv"><span>Voting power</span><span>${l.managedId > 0n ? 'via relay' : fmt(l.votingPower, 18, 2)}</span></div>
  <div class="kv"><span>Claimable rebase</span><span>${fmt(l.rebase, 18, 4)} AERO</span></div></div>`
}
let locksBusy = false
async function loadLocks() {
  const box = $('#locks'); if (locksBusy) return; locksBusy = true
  const wallets = [...new Set([...AE.DEFAULT_WALLETS, ...(account ? [account] : []), ...(viewAddr ? [viewAddr] : [])].map(a => getAddress(a)))]
  box.innerHTML = `<div class="card"><div class="row"><input id="lid" placeholder="veAERO lock id" inputmode="numeric"><button class="b g" id="golid">Open</button></div>
   <div class="muted" style="margin-top:6px">Checking ${wallets.map(w => addrLink(w)).join(', ')}</div></div><div id="lockl"><p class="muted">Loading locks…</p></div>`
  $('#golid').onclick = async () => { const v = ($('#lid') as HTMLInputElement).value.trim(); if (!/^\d+$/.test(v)) return toast('Enter a lock id'); try { toast('Loading lock…'); await openLock(BigInt(v)) } catch (e: any) { toast('Lock not found') } }
  try {
    const ids = (await Promise.all(wallets.map(w => AE.lockIdsFor(w).catch(() => [])))).flat()
    const ls = (await Promise.allSettled(ids.map(id => AE.loadLock(id)))).flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
    await loadMeta(ls.flatMap(lockTokens).concat(AE.AERO))
    ls.forEach(l => locks.set(String(l.id), l))
    $('#lockl').innerHTML = ls.length ? ls.map(lockCard).join('') : `<p class="muted">No veAERO locks held by these wallets. Open any lock by id above.</p>`
    document.querySelectorAll('.lcard').forEach(el => (el as HTMLElement).onclick = () => openLock(BigInt((el as HTMLElement).dataset.id!)))
  } finally { locksBusy = false }
}
async function openLock(id: bigint) {
  let l = locks.get(String(id)); if (!l) { l = await AE.loadLock(id); locks.set(String(id), l) }
  await loadMeta(lockTokens(l).concat(AE.AERO))
  const aeroP = md(AE.AERO)?.priceUsd || 0, now = Date.now() / 1000
  const claimFB = l.votes.reduce((s, v) => s + usdOf(v.feeEarned) + usdOf(v.bribeEarned), 0)
  const estW = l.votes.reduce((s, v) => s + usdOf(v.estNext), 0) * (l.managedId > 0n ? l.managedShare / 100 : 1)
  const lockedUsd = Number(formatUnits(lockAero(l), 18)) * aeroP
  const apr = lockedUsd > 0 && estW > 0 ? (estW * 52 / lockedUsd * 100) : null
  const mine = account && account.toLowerCase() === l.owner.toLowerCase()
  const r = l.relay, nextComp = r ? (r.keeperLastRun % AE.WEEK) + l.epochEnd : 0
  openSheet(`veAERO #${l.id}`, `
  <div class="card">
   <div class="kv"><span>Owner</span><span>${addrLink(l.owner)}${mine ? ' (you)' : ''}</span></div>
   <div class="kv"><span>NFT</span><span><a target="_blank" href="${L.SCAN}/nft/${AE.VE}/${l.id}">BaseScan</a> · <a target="_blank" href="https://aerodrome.finance/lock/${l.id}">Aerodrome</a></span></div>
   <div class="kv"><span>Type</span><span>${['Normal', 'Deposited in managed veNFT', 'Managed veNFT (relay)'][l.escrowType] || l.escrowType}</span></div>
   <div class="kv"><span>Locked AERO</span><span>${fmt(lockAero(l), 18)} AERO${aeroP ? ` (${usd(lockedUsd)})` : ''}</span></div>
   <div class="kv"><span>Unlock</span><span>${l.managedId > 0n ? 'Managed by relay' : l.permanent ? 'Permanent lock' : l.end ? dt(l.end) : '—'}</span></div>
   <div class="kv"><span>Voting power</span><span>${l.managedId > 0n ? `via relay (${l.managedShare}% of relay)` : fmt(l.votingPower, 18)}</span></div>
   <div class="kv"><span>Epoch</span><span>${dt(l.epochStart)} → ${dt(l.epochEnd)}<br><span class="muted">ends in ${((l.epochEnd - now) / 86400).toFixed(1)} days · voting closes 1h before</span></span></div>
   <div class="kv"><span>Last voted</span><span>${l.lastVoted ? dt(l.lastVoted) : 'never'}</span></div>
  </div>
  ${l.managedId > 0n ? `<div class="card"><div class="pair">Relay / autoCompounder</div>
   <div class="kv"><span>Relay</span><span>${r ? `${esc(r.name)}<br>${addrLink(r.address)}` : 'unknown'} · mNFT #${l.managedId}</span></div>
   <div class="kv"><span>Compounds to</span><span>${r ? esc(symOf(r.token)) + (r.token.toLowerCase() === AE.AERO.toLowerCase() ? ' (auto-relocked into veAERO)' : ' (claimable, not relocked)') : '—'}</span></div>
   <div class="kv"><span>Your deposit weight</span><span>${fmt(l.managedWeight, 18)} AERO</span></div>
   <div class="kv"><span>Compounded so far</span><span>${amtStr(l.compoundedEarned)}</span></div>
   ${l.freeEarned.length ? `<div class="kv"><span>Claimable (free rewards)</span><span>${amtStr(l.freeEarned)}</span></div>` : ''}
   <div class="kv"><span>Last compounding</span><span>${r?.keeperLastRun ? dt(r.keeperLastRun) : '—'}</span></div>
   <div class="kv"><span>Next compounding (estimate)</span><span>~${nextComp ? dt(nextComp) : '—'}</span></div></div>` : ''}
  <div class="card"><div class="pair">Rewards</div>
   <div class="kv"><span>Claimable rebase</span><span>${fmt(l.rebase, 18)} AERO</span></div>
   <div class="kv"><span>Claimable fees + bribes</span><span>${usd(claimFB)}</span></div>
   <div class="kv"><span>Next-epoch reward (ESTIMATE)</span><span>≈ ${usd(estW)}</span></div>
   <div class="kv"><span>APR (ESTIMATE)</span><span>${apr == null ? '—' : '≈ ' + apr.toFixed(1) + '%'}</span></div>
   <div class="muted">Estimates use this epoch's deposited fees/bribes (or last epoch's if none yet) × your share of each pool's votes, priced via DexScreener/GeckoTerminal. Excludes rebase. Not guaranteed.</div></div>
  <h2>Votes ${l.managedId > 0n ? '(cast by the relay)' : ''}</h2>
  ${l.votes.length ? l.votes.map(v => `<div class="card"><div class="pair">${esc(v.name)}</div>
   <div class="kv"><span>Pool</span><span>${addrLink(v.pool)}</span></div>
   <div class="kv"><span>Weight</span><span>${v.weightPct}% · ${fmt(v.votes, 18, 2)} votes (${v.poolSharePct}% of pool)</span></div>
   <div class="kv"><span>Claimable fees</span><span>${amtStr(v.feeEarned)}</span></div>
   <div class="kv"><span>Claimable bribes</span><span>${amtStr(v.bribeEarned)}</span></div>
   <div class="kv"><span>Next epoch (ESTIMATE)</span><span>${amtStr(v.estNext)}</span></div></div>`).join('') : '<p class="muted">No active votes.</p>'}
  <h2>Actions</h2><div class="muted">Simulate checks the claim against the current chain state and sends nothing.${mine ? ' Claim sends from your wallet.' : ''}</div>
  <div class="tabs"><button class="b g" id="sim-reb" ${l.rebase ? '' : 'disabled'}>Simulate claim rebase</button><button class="b g" id="sim-fb" ${claimFB || l.votes.some(v => v.feeEarned.length || v.bribeEarned.length) ? '' : 'disabled'}>Simulate claim fees + bribes</button></div>
  <div id="simout" class="muted"></div>`)
  const out = (m: string) => { $('#simout').innerHTML += esc(m) + '<br>' }
  $('#sim-reb').onclick = async () => { try { await L.simulate(l!.owner, AE.DIST, AE.claimRebaseCalldata(l!.id)); out('Rebase claim: simulation OK') } catch (e: any) { out('Rebase claim reverted: ' + (e.shortMessage || e.message)) } }
  $('#sim-fb').onclick = async () => { const c = AE.claimFeesBribesCalldata(l!); for (const [k, d] of [['Fees', c.fees], ['Bribes', c.bribes]] as const) if (d) { try { await L.simulate(l!.owner, AE.VOTER, d); out(`${k} claim: simulation OK`) } catch (e: any) { out(`${k} claim reverted: ` + (e.shortMessage || e.message)) } } }
}

shell(); setBtn()
const q = new URLSearchParams(location.search).get('addr')
if (q && isAddress(q)) { viewAddr = getAddress(q); (document.getElementById('addr') as HTMLInputElement).value = viewAddr; load(viewAddr) }
const qlock = new URLSearchParams(location.search).get('lock')
if (qlock && /^\d+$/.test(qlock)) openLock(BigInt(qlock)).catch((e: any) => { console.error(e); toast('Lock not found: ' + (e.shortMessage || e.message)) })
const qid = new URLSearchParams(location.search).get('id')
if (qid && /^\d+$/.test(qid)) L.loadPosition(BigInt(qid)).then(async p => { positions.set(qid, p); await loadMeta([p.t0.address, p.t1.address]); openDetail(p) }).catch(() => toast('Position not found'))

