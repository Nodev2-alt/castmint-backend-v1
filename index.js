import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Web3Modal from "web3modal";
import WalletConnectProvider from "@walletconnect/web3-provider";

// Put your contract address here
const CONTRACT_ADDRESS = "0x6a0DbB7e447B8f681afbe5ec8b1573e6FaFf7ba2";

// Minimal ABIs with common Thirdweb / drop signatures we might need
const ABI_READ = [
  // ERC721 metadata
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  // common drop functions (read)
  "function claimCondition() view returns (uint256)",
  // price getters (common)
  "function price() view returns (uint256)",
  "function cost() view returns (uint256)",
  "function publicSalePrice() view returns (uint256)"
];

const ABI_WRITE = [
  // claim(uint256) common on Thirdweb drops (or claim(address,uint256) variants)
  "function claim(uint256) payable",
  "function mint(uint256) payable",
  "function mintTo(address,uint256) payable",
  // fallback - ERC721 safeMint
  "function safeMint(address,uint256) payable"
];

export default function Home() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState("");
  const [contract, setContract] = useState(null);
  const [info, setInfo] = useState({ name: "NFT", symbol: "", image: null, supply: null, maxSupply: null, price: null });
  const [status, setStatus] = useState("");
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // try to load public metadata (no wallet)
    fetchPublic();
  }, []);

  async function fetchPublic() {
    try {
      // Try to get metadata from Thirdweb's public metadata url pattern via token 0 (best-effort)
      // But most reliable is to read basic contract fields using a JSON-RPC provider
      const rpcProvider = new ethers.providers.InfuraProvider("mainnet", process.env.NEXT_PUBLIC_INFURA_ID || undefined);
      const readContract = new ethers.Contract(CONTRACT_ADDRESS, ABI_READ, rpcProvider);

      let name = "NFT";
      let symbol = "";
      try { name = await readContract.name(); } catch(e){}
      try { symbol = await readContract.symbol(); } catch(e){}

      let totalSupply = null, maxSupply = null;
      try { totalSupply = (await readContract.totalSupply()).toString(); } catch(e){}
      try { maxSupply = (await readContract.maxSupply()).toString(); } catch(e){}

      // Best-effort to find a price
      let price = null;
      try { price = await readContract.price(); } catch(e){}
      if (!price) {
        try { price = await readContract.cost(); } catch(e){}
      }
      if (!price) {
        try { price = await readContract.publicSalePrice(); } catch(e){}
      }
      if (price && price.toString) {
        price = ethers.formatEther(price.toString ? price : price);
      }

      // Try to fetch token 0 metadata image if hosted standardly on contract URI (best-effort)
      // We'll attempt to fetch tokenURI if the contract implements it
      let image = null;
      try {
        const tokenUriFn = ["function tokenURI(uint256) view returns (string)"];
        const tokenContract = new ethers.Contract(CONTRACT_ADDRESS, tokenUriFn, rpcProvider);
        const tokenURI = await tokenContract.tokenURI(0);
        if (tokenURI) {
          // tokenURI might be IPFS or JSON string
          let url = tokenURI;
          if (url.startsWith("ipfs://")) url = url.replace("ipfs://", "https://ipfs.io/ipfs/");
          const r = await fetch(url);
          if (r.ok) {
            const j = await r.json();
            image = j.image || j.image_url || null;
            if (image && image.startsWith("ipfs://")) image = image.replace("ipfs://", "https://ipfs.io/ipfs/");
          }
        }
      } catch (e) {
        // ignore
      }

      setInfo({
        name,
        symbol,
        image,
        supply: totalSupply,
        maxSupply,
        price
      });
    } catch (e) {
      console.error("Public fetch failed", e);
    }
  }

  async function connectWallet() {
    try {
      const providerOptions = {
        walletconnect: {
          package: WalletConnectProvider,
          options: {
            infuraId: process.env.NEXT_PUBLIC_INFURA_ID || "" // optional, but recommended
          }
        }
      };
      const web3Modal = new Web3Modal({
        cacheProvider: true,
        providerOptions
      });

      const instance = await web3Modal.connect();
      const p = new ethers.BrowserProvider(instance);
      const s = await p.getSigner();
      const addr = await s.getAddress();
      setProvider(p);
      setSigner(s);
      setAddress(addr);

      // attach contract with signer for write actions
      const contractWithSigner = new ethers.Contract(CONTRACT_ADDRESS, [...ABI_READ, ...ABI_WRITE], s);
      setContract(contractWithSigner);

      setStatus("Wallet connected: " + (addr.slice(0,6) + "..." + addr.slice(-4)));
    } catch (e) {
      console.error(e);
      setStatus("Could not connect wallet.");
    }
  }

  async function tryMint() {
    if (!contract || !signer) {
      setStatus("Connect your wallet first.");
      return;
    }
    setLoading(true);
    setStatus("Preparing transaction...");
    const q = Number(qty) || 1;

    // We will attempt common mint methods in order
    const attempts = [
      { name: "claim", args: [q], payable: true },
      { name: "mint", args: [q], payable: true },
      { name: "mintTo", args: [address, q], payable: true },
      { name: "safeMint", args: [address, q], payable: true }
    ];

    // If price known, compute total value
    let value = ethers.parseEther("0");
    if (info.price) {
      try {
        value = ethers.parseEther(String(info.price * q));
      } catch (e) {
        // ignore
      }
    }

    for (const a of attempts) {
      try {
        setStatus(`Trying ${a.name}…`);
        // check function exists by querying the fragment
        if (!contract.interface.getFunction) {
          // fallback: attempt call directly
        }
        // send transaction with value if payable
        const tx = await contract[a.name](...a.args, { value: value });
        setStatus(`Transaction sent - waiting for confirmation (${a.name})`);
        await tx.wait();
        setStatus("Mint successful ✅");
        setLoading(false);
        // refresh supply
        fetchPublic();
        return;
      } catch (err) {
        // if revert or function missing, continue to next attempt
        console.warn(`${a.name} failed`, err?.message || err);
        // if user rejected, stop and show message
        if (err?.code === 4001 || (err?.data && err.data.code === 4001)) {
          setStatus("Transaction rejected by user.");
          setLoading(false);
          return;
        }
        // try next
      }
    }

    setStatus("All common mint methods failed. Paste the exact contract ABI or share the mint function name.");
    setLoading(false);
  }

  return (
    <div className="container">
      <div className="card">
        <div className="row">
          <div>
            <div className="title">{info.name || "JessePunk Legends"}</div>
            <div className="small">{info.symbol}</div>
          </div>
          <div className="right">
            {address ? (
              <div className="small">{address.slice(0,6)}...{address.slice(-4)}</div>
            ) : (
              <button className="btn" onClick={connectWallet}>Connect Wallet</button>
            )}
          </div>
        </div>
      </div>

      <div className="card center">
        {info.image ? (
          <img className="nft-img" src={info.image} alt="nft" />
        ) : (
          <div style={{width:260,height:260, borderRadius:8, background:"#121214"}} className="center">
            <div className="small">No preview available</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
          <div>
            <div className="small">Price</div>
            <div style={{fontWeight:700}}>{info.price ? `${info.price} ETH` : "Unknown"}</div>
          </div>
          <div className="right">
            <div className="small">Supply</div>
            <div>{info.supply ?? "—"} / {info.maxSupply ?? "—"}</div>
          </div>
        </div>

        <div style={{marginTop:12}} className="row">
          <div>
            <input className="inputQty" type="number" min="1" value={qty} onChange={(e)=>setQty(e.target.value)} />
            <span style={{marginLeft:10}} className="small">qty</span>
          </div>
          <div>
            <button className="btn" onClick={tryMint} disabled={loading}>{loading ? "Processing..." : "Mint Now"}</button>
          </div>
        </div>

        <div style={{marginTop:12}}>
          <button className="btn secondary" onClick={fetchPublic}>Refresh Info</button>
        </div>
      </div>

      <div className="card small">
        <strong>Status:</strong> {status || "Ready"}
        <div className="footer">Contract: {CONTRACT_ADDRESS}</div>
      </div>
    </div>
  );
                                        }
