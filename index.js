const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PLATFORM_FEE_USD = 0.15;

// ── ETH Price Feed ──────────────────────────────────────────
let cachedPrice = null;
let lastFetch = 0;

async function getEthPrice() {
  const now = Date.now();
  if (cachedPrice && now - lastFetch < 60000) return cachedPrice; // cache 1 min
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
  const data = await res.json();
  cachedPrice = data.ethereum.usd;
  lastFetch = now;
  return cachedPrice;
}

// GET /fee — returns exact ETH amount for $0.15
app.get("/fee", async (req, res) => {
  try {
    const ethPrice = await getEthPrice();
    const feeInEth = (PLATFORM_FEE_USD / ethPrice).toFixed(8);
    res.json({ usd: PLATFORM_FEE_USD, eth: feeInEth, ethPrice });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch ETH price" });
  }
});

// GET /nfts — return all NFTs created on CASTMINT
const nfts = []; // in-memory for now, we'll add DB later

app.get("/nfts", (req, res) => {
  res.json({ nfts });
});

// POST /nfts — save new NFT after creation
app.post("/nfts", (req, res) => {
  const { name, description, image, creator, contractAddress, price, token, type, supply } = req.body;
  if (!name || !contractAddress) return res.status(400).json({ error: "Missing fields" });
  const nft = { id: Date.now(), name, description, image, creator, contractAddress, price, token, type, supply, minted: 0, createdAt: new Date().toISOString() };
  nfts.push(nft);
  res.json({ success: true, nft });
});

// GET /health
app.get("/health", (req, res) => res.json({ ok: true, nfts: nfts.length }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CASTMINT backend running on ${PORT}`));
