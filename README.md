# LP Manager (lp.gearup.wtf)
Uniswap v4 position manager for Base: list positions (PositionManager NFTs), full pair info, claim fees, add/remove liquidity, transfer the position NFT, send tokens.
- `api/nfts.js` – Alchemy getNFTsForOwner (server-side, `ALCHEMY_API_KEY`).
- `api/rpc.js` – Base RPC proxy (Alchemy, falls back to mainnet.base.org).
- Vite + TS + viem + Coinbase Smart Wallet / injected.
