import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  parseUnits,
  decodeEventLog,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { arcTestnet } from "viem/chains";
import {
  AGENTIC_COMMERCE_ABI,
  AGENTIC_COMMERCE_CONTRACT,
  ERC20_ABI,
  USDC_CONTRACT,
  JOB_STATUS_NAMES,
} from "./constants";

// Public client (read-only)
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

// Create wallet client from browser injected provider
export function getBrowserWalletClient(): WalletClient | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: unknown }).ethereum;
  if (!eth) return null;
  return createWalletClient({
    chain: arcTestnet,
    transport: custom(eth as Parameters<typeof custom>[0]),
  });
}

// ─── Ensure wallet is on Arc Testnet ────────────────────────────────────────
// Call this before every writeContract to avoid "chain mismatch" errors.
type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export async function ensureArcTestnet(): Promise<void> {
  if (typeof window === "undefined") return;
  const eth = (window as Window & { ethereum?: EthProvider }).ethereum;
  if (!eth) throw new Error("No wallet detected");

  const chainIdHex = "0x" + arcTestnet.id.toString(16); // 0x4CDAE2

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError: unknown) {
    const err = switchError as { code?: number };
    if (err?.code === 4902) {
      // Chain not yet added to wallet — add it first
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: arcTestnet.name,
            nativeCurrency: arcTestnet.nativeCurrency,
            rpcUrls: [arcTestnet.rpcUrls.default.http[0]],
            blockExplorerUrls: arcTestnet.blockExplorers
              ? [arcTestnet.blockExplorers.default.url]
              : [],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatUSDC(amount: bigint): string {
  return parseFloat(formatUnits(amount, 6)).toFixed(2);
}

export function parseUSDC(amount: string): bigint {
  return parseUnits(amount, 6);
}

export function shortenAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function jobStatusName(status: number): string {
  return JOB_STATUS_NAMES[status] ?? "Unknown";
}

export function explorerTx(hash: string): string {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

export function explorerAddress(addr: string): string {
  return `https://testnet.arcscan.app/address/${addr}`;
}

// ─── Contract reads ──────────────────────────────────────────────────────────

export async function getJob(jobId: bigint) {
  return publicClient.readContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "getJob",
    args: [jobId],
  });
}

export async function getUSDCBalance(address: Address): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_CONTRACT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  }) as Promise<bigint>;
}

// ─── Contract writes ─────────────────────────────────────────────────────────

export async function createJob(
  walletClient: WalletClient,
  account: Address,
  provider: Address,
  evaluator: Address,
  description: string,
  budgetHours = 1
): Promise<Hex> {
  await ensureArcTestnet();
  const block = await publicClient.getBlock();
  const expiredAt = block.timestamp + BigInt(3600 * budgetHours);

  return walletClient.writeContract({
    chain: arcTestnet,
    account,
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "createJob",
    args: [
      provider,
      evaluator,
      expiredAt,
      description,
      "0x0000000000000000000000000000000000000000",
    ],
  });
}

export async function setBudget(
  walletClient: WalletClient,
  account: Address,
  jobId: bigint,
  amountUSDC: string
): Promise<Hex> {
  await ensureArcTestnet();
  const amount = parseUSDC(amountUSDC);
  return walletClient.writeContract({
    chain: arcTestnet,
    account,
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "setBudget",
    args: [jobId, amount, "0x"],
  });
}

export async function approveUSDC(
  walletClient: WalletClient,
  account: Address,
  amount: bigint
): Promise<Hex> {
  await ensureArcTestnet();
  return walletClient.writeContract({
    chain: arcTestnet,
    account,
    address: USDC_CONTRACT,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [AGENTIC_COMMERCE_CONTRACT, amount],
  });
}

export async function fundJob(
  walletClient: WalletClient,
  account: Address,
  jobId: bigint
): Promise<Hex> {
  await ensureArcTestnet();
  return walletClient.writeContract({
    chain: arcTestnet,
    account,
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "fund",
    args: [jobId, "0x"],
  });
}

export async function submitDeliverable(
  walletClient: WalletClient,
  account: Address,
  jobId: bigint,
  deliverable: string
): Promise<Hex> {
  await ensureArcTestnet();
  const deliverableHash = keccak256(toHex(deliverable));
  return walletClient.writeContract({
    chain: arcTestnet,
    account,
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "submit",
    args: [jobId, deliverableHash, "0x"],
  });
}

export async function completeJob(
  walletClient: WalletClient,
  account: Address,
  jobId: bigint,
  reason = "deliverable-approved"
): Promise<Hex> {
  await ensureArcTestnet();
  const reasonHash = keccak256(toHex(reason));
  return walletClient.writeContract({
    chain: arcTestnet,
    account,
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "complete",
    args: [jobId, reasonHash, "0x"],
  });
}

// ─── Extract jobId from tx receipt ──────────────────────────────────────────

export async function extractJobIdFromTx(txHash: Hex): Promise<bigint | null> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: AGENTIC_COMMERCE_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "JobCreated") {
        return (decoded.args as { jobId: bigint }).jobId;
      }
    } catch {
      continue;
    }
  }
  return null;
}
