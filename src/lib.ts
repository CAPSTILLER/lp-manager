import { createPublicClient, http, encodeAbiParameters, encodeFunctionData, parseAbi, keccak256, type Address, type Hex, maxUint256, maxUint160 } from 'viem'
import { base } from 'viem/chains'

export const PM: Address = '0x7C5f5A4bBd8fD63184577525326123B519429bDc'
export const STATE_VIEW: Address = '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71'
export const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
export const ZERO: Address = '0x0000000000000000000000000000000000000000'
export const SCAN = 'https://basescan.org'

const RPC_URL = (globalThis as any).LP_RPC_URL || '/api/rpc'
export const client = createPublicClient({ chain: base, transport: http(RPC_URL, { batch: { batchSize: 40 }, retryCount: 2 }) })

export const pmAbi = parseAbi([
  'function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey, uint256 info)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function modifyLiquidities(bytes unlockData, uint256 deadline) payable',
  'function safeTransferFrom(address from, address to, uint256 id)',
])
export const svAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
  'function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256, uint256)',
  'function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)',
])
export const ercAbi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
])
export const p2Abi = parseAbi([
  'function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
])

export type Token = { address: Address; name: string; symbol: string; decimals: number; totalSupply: bigint; native: boolean }
export type Position = {
  tokenId: bigint; owner: Address; poolId: Hex
  key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
  tickLower: number; tickUpper: number; liquidity: bigint
  sqrtPriceX96: bigint; tick: number; lpFee: number; protocolFee: number; poolLiquidity: bigint
  t0: Token; t1: Token; amount0: bigint; amount1: bigint; fees0: bigint; fees1: bigint
}

const Q96 = 2n ** 96n, Q128 = 2n ** 128n, M256 = 2n ** 256n

// Uniswap TickMath.getSqrtPriceAtTick
export function sqrtAtTick(tick: number): bigint {
  const a = BigInt(Math.abs(tick))
  let r = (a & 1n) ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n
  const k: [bigint, bigint][] = [[2n,0xfff97272373d413259a46990580e213an],[4n,0xfff2e50f5f656932ef12357cf3c7fdccn],[8n,0xffe5caca7e10e4e61c3624eaa0941cd0n],[16n,0xffcb9843d60f6159c9db58835c926644n],[32n,0xff973b41fa98c081472e6896dfb254c0n],[64n,0xff2ea16466c96a3843ec78b326b52861n],[128n,0xfe5dee046a99a2a811c461f1969c3053n],[256n,0xfcbe86c7900a88aedcffc83b479aa3a4n],[512n,0xf987a7253ac413176f2b074cf7815e54n],[1024n,0xf3392b0822b70005940c7a398e4b70f3n],[2048n,0xe7159475a2c29b7443b29c7fa6e889d9n],[4096n,0xd097f3bdfd2022b8845ad8f792aa5825n],[8192n,0xa9f746462d870fdf8a65dc1f90e061e5n],[16384n,0x70d869a156d2a1b890bb3df62baf32f7n],[32768n,0x31be135f97d08fd981231505542fcfa6n],[65536n,0x9aa508b5b7a84e1c677de54f3e99bc9n],[131072n,0x5d6af8dedb81196699c329225ee604n],[262144n,0x2216e584f5fa1ea926041bedfe98n],[524288n,0x48a170391f7dc42444e8fa2n]]
  for (const [b, m] of k) if (a & b) r = (r * m) >> 128n
  if (tick > 0) r = (M256 - 1n) / r
  return (r >> 32n) + (r % (1n << 32n) === 0n ? 0n : 1n)
}
export function amountsForLiquidity(sp: bigint, sa: bigint, sb: bigint, L: bigint): [bigint, bigint] {
  if (sa > sb) [sa, sb] = [sb, sa]
  if (sp <= sa) return [(L * Q96 * (sb - sa)) / sb / sa, 0n]
  if (sp < sb) return [(L * Q96 * (sb - sp)) / sb / sp, (L * (sp - sa)) / Q96]
  return [0n, (L * (sb - sa)) / Q96]
}
export function liquidityForAmounts(sp: bigint, sa: bigint, sb: bigint, a0: bigint, a1: bigint): bigint {
  if (sa > sb) [sa, sb] = [sb, sa]
  const l0 = (x: bigint, lo: bigint, hi: bigint) => (x * ((lo * hi) / Q96)) / (hi - lo)
  const l1 = (y: bigint, lo: bigint, hi: bigint) => (y * Q96) / (hi - lo)
  if (sp <= sa) return l0(a0, sa, sb)
  if (sp < sb) { const x = l0(a0, sp, sb), y = l1(a1, sa, sp); return x < y ? x : y }
  return l1(a1, sa, sb)
}
// price of token0 in token1 units (human)
export function priceFromSqrt(sp: bigint, d0: number, d1: number): number {
  const p = Number(sp) / 2 ** 96
  return p * p * 10 ** (d0 - d1)
}
export function priceAtTick(t: number, d0: number, d1: number) { return 1.0001 ** t * 10 ** (d0 - d1) }

export function poolIdOf(k: Position['key']): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]))
}
function int24(x: bigint) { x &= 0xffffffn; return Number(x >= 0x800000n ? x - 0x1000000n : x) }

const tokenCache = new Map<string, Token>()
export async function getToken(a: Address): Promise<Token> {
  const k = a.toLowerCase(); if (tokenCache.has(k)) return tokenCache.get(k)!
  let t: Token
  if (a === ZERO) t = { address: a, name: 'Ether', symbol: 'ETH', decimals: 18, totalSupply: 0n, native: true }
  else {
    const [name, symbol, decimals, totalSupply] = await Promise.all(['name', 'symbol', 'decimals', 'totalSupply'].map(fn => client.readContract({ address: a, abi: ercAbi, functionName: fn as any }).catch(() => undefined)))
    t = { address: a, name: (name as string) ?? '?', symbol: (symbol as string) ?? '?', decimals: Number(decimals ?? 18), totalSupply: (totalSupply as bigint) ?? 0n, native: false }
  }
  tokenCache.set(k, t); return t
}

export async function loadPosition(tokenId: bigint): Promise<Position> {
  const [[key, info], owner, liquidity] = await Promise.all([
    client.readContract({ address: PM, abi: pmAbi, functionName: 'getPoolAndPositionInfo', args: [tokenId] }),
    client.readContract({ address: PM, abi: pmAbi, functionName: 'ownerOf', args: [tokenId] }),
    client.readContract({ address: PM, abi: pmAbi, functionName: 'getPositionLiquidity', args: [tokenId] }),
  ])
  // PositionInfo packing: poolId(200) | tickUpper(24) | tickLower(24) | hasSubscriber(8)
  const tickLower = int24(info >> 8n), tickUpper = int24(info >> 32n)
  const k = { currency0: key.currency0, currency1: key.currency1, fee: Number(key.fee), tickSpacing: Number(key.tickSpacing), hooks: key.hooks }
  const poolId = poolIdOf(k)
  const salt = ('0x' + tokenId.toString(16).padStart(64, '0')) as Hex
  const [slot0, poolL, inside, pinfo, t0, t1] = await Promise.all([
    client.readContract({ address: STATE_VIEW, abi: svAbi, functionName: 'getSlot0', args: [poolId] }),
    client.readContract({ address: STATE_VIEW, abi: svAbi, functionName: 'getLiquidity', args: [poolId] }),
    client.readContract({ address: STATE_VIEW, abi: svAbi, functionName: 'getFeeGrowthInside', args: [poolId, tickLower, tickUpper] }),
    client.readContract({ address: STATE_VIEW, abi: svAbi, functionName: 'getPositionInfo', args: [poolId, PM, tickLower, tickUpper, salt] }),
    getToken(k.currency0), getToken(k.currency1),
  ])
  const [sp, tick, protocolFee, lpFee] = slot0
  const [a0, a1] = amountsForLiquidity(sp, sqrtAtTick(tickLower), sqrtAtTick(tickUpper), liquidity)
  const fees0 = ((((inside[0] - pinfo[1]) % M256) + M256) % M256) * liquidity / Q128
  const fees1 = ((((inside[1] - pinfo[2]) % M256) + M256) % M256) * liquidity / Q128
  return { tokenId, owner, poolId, key: k, tickLower, tickUpper, liquidity, sqrtPriceX96: sp, tick, lpFee, protocolFee, poolLiquidity: poolL, t0, t1, amount0: a0, amount1: a1, fees0, fees1 }
}

export async function listTokenIds(owner: Address): Promise<bigint[]> {
  const r = await fetch(`/api/nfts?owner=${owner}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'list failed')
  return (j.tokenIds as string[]).map(x => BigInt(x))
}

// ---- calldata (v4-periphery Actions) ----
const A = { INCREASE: 0x00, DECREASE: 0x01, SETTLE_PAIR: 0x0d, TAKE_PAIR: 0x11, SWEEP: 0x14 }
const decP = (id: bigint, L: bigint, m0: bigint, m1: bigint) => encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }], [id, L, m0, m1, '0x'])
const pairP = (c0: Address, c1: Address) => encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [c0, c1])
const takeP = (c0: Address, c1: Address, to: Address) => encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [c0, c1, to])
function unlock(actions: number[], params: Hex[]): Hex {
  const a = ('0x' + actions.map(x => x.toString(16).padStart(2, '0')).join('')) as Hex
  return encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [a, params])
}
const dl = () => BigInt(Math.floor(Date.now() / 1000) + 1200)
const mod = (d: Hex) => encodeFunctionData({ abi: pmAbi, functionName: 'modifyLiquidities', args: [d, dl()] })

export function claimCalldata(p: Position, to: Address): Hex {
  return mod(unlock([A.DECREASE, A.TAKE_PAIR], [decP(p.tokenId, 0n, 0n, 0n), takeP(p.key.currency0, p.key.currency1, to)]))
}
export function removeCalldata(p: Position, pct: number, slipBps: number, to: Address): Hex {
  const L = (p.liquidity * BigInt(Math.round(pct * 100))) / 10000n
  const [a0, a1] = amountsForLiquidity(p.sqrtPriceX96, sqrtAtTick(p.tickLower), sqrtAtTick(p.tickUpper), L)
  const k = BigInt(10000 - slipBps)
  return mod(unlock([A.DECREASE, A.TAKE_PAIR], [decP(p.tokenId, L, (a0 * k) / 10000n, (a1 * k) / 10000n), takeP(p.key.currency0, p.key.currency1, to)]))
}
export function addPlan(p: Position, amt0: bigint, amt1: bigint, slipBps: number, to: Address) {
  const L = liquidityForAmounts(p.sqrtPriceX96, sqrtAtTick(p.tickLower), sqrtAtTick(p.tickUpper), amt0, amt1)
  const [n0, n1] = amountsForLiquidity(p.sqrtPriceX96, sqrtAtTick(p.tickLower), sqrtAtTick(p.tickUpper), L)
  const k = BigInt(10000 + slipBps)
  const m0 = (n0 * k) / 10000n + 1n, m1 = (n1 * k) / 10000n + 1n
  const actions = [A.INCREASE, A.SETTLE_PAIR], params = [decP(p.tokenId, L, m0, m1), pairP(p.key.currency0, p.key.currency1)]
  const native = p.key.currency0 === ZERO
  if (native) { actions.push(A.SWEEP); params.push(pairP(ZERO, to)) }
  return { L, need0: n0, need1: n1, max0: m0, max1: m1, value: native ? m0 : 0n, data: mod(unlock(actions, params)) }
}
export function transferNftCalldata(from: Address, to: Address, id: bigint): Hex {
  return encodeFunctionData({ abi: pmAbi, functionName: 'safeTransferFrom', args: [from, to, id] })
}
export function erc20TransferCalldata(to: Address, amt: bigint): Hex { return encodeFunctionData({ abi: ercAbi, functionName: 'transfer', args: [to, amt] }) }
export function approveCalldata(spender: Address): Hex { return encodeFunctionData({ abi: ercAbi, functionName: 'approve', args: [spender, maxUint256] }) }
export function permit2ApproveCalldata(token: Address): Hex {
  return encodeFunctionData({ abi: p2Abi, functionName: 'approve', args: [token, PM, maxUint160, Number(Math.floor(Date.now() / 1000) + 30 * 86400)] })
}
export async function simulate(from: Address, to: Address, data: Hex, value = 0n) {
  return client.call({ account: from, to, data, value })
}
