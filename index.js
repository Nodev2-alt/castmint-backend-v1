const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PLATFORM_FEE_USD = 0.15;

// ── Pinata SDK ──────────────────────────────────────────────
const { PinataSDK } = require("pinata");
const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_JWT });

// ── ETH Price Feed ──────────────────────────────────────────
let cachedPrice = null;
let lastFetch = 0;

async function getEthPrice() {
  const now = Date.now();
  if (cachedPrice && now - lastFetch < 60000) return cachedPrice;
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
  const data = await res.json();
  cachedPrice = data.ethereum.usd;
  lastFetch = now;
  return cachedPrice;
}

// ── Routes ──────────────────────────────────────────────────

// GET /health
app.get("/health", (req, res) => res.json({ ok: true, nfts: nfts.length }));

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

// GET /upload-url — generate Pinata presigned URL for frontend image upload
app.get("/upload-url", async (req, res) => {
  try {
    const signedUrl = await pinata.upload.public.createSignedURL({
      expiresIn: 600,
      maxSize: 50 * 1024 * 1024,
      mimeTypes: ["image/*"],
    });
    res.json(signedUrl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /upload-meta — upload NFT metadata JSON to Pinata
app.post("/upload-meta", async (req, res) => {
  try {
    const result = await pinata.upload.public.json(req.body);
    res.json({ url: `https://gateway.pinata.cloud/ipfs/${result.cid}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /nfts — return all NFTs created on CASTMINT
const nfts = [];

app.get("/nfts", (req, res) => {
  res.json({ nfts });
});

// POST /nfts — save new NFT after creation
app.post("/nfts", (req, res) => {
  const { name, description, image, creator, contractAddress, price, token, type, supply } = req.body;
  if (!name || !contractAddress) return res.status(400).json({ error: "Missing fields" });
  const nft = {
    id: Date.now(), name, description, image, creator,
    contractAddress, price, token, type, supply,
    minted: 0, createdAt: new Date().toISOString()
  };
  nfts.push(nft);
  res.json({ success: true, nft });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CASTMINT backend running on ${PORT}`));
