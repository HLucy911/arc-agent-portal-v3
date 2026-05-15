"use client";
import { useState } from "react";
import { X, Loader2, CheckCircle2, ExternalLink, AlertCircle, Hash } from "lucide-react";
import {
  getBrowserWalletClient,
  createJob,
  setBudget,
  extractJobIdFromTx,
  explorerTx,
  publicClient,
} from "@/lib/arc";
import { AGENTIC_COMMERCE_ABI } from "@/lib/constants";
import { decodeEventLog } from "viem";
import type { Address, Hex } from "viem";

interface Props {
  account: Address;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = "idle" | "creating" | "waiting" | "budget" | "done" | "error" | "timedout";

export default function CreateJobModal({ account, onClose, onSuccess }: Props) {
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("");
  const [evaluator, setEvaluator] = useState(account);
  const [budgetAmount, setBudgetAmount] = useState("5.00");
  const [expiryHours, setExpiryHours] = useState("1");
  const [step, setStep] = useState<Step>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [jobId, setJobId] = useState<bigint | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [manualTxHash, setManualTxHash] = useState("");
  const [retrying, setRetrying] = useState(false);

  const isValid =
    description.trim().length > 0 &&
    provider.startsWith("0x") &&
    provider.length === 42 &&
    parseFloat(budgetAmount) > 0;

  const waitAndExtract = async (hash: Hex): Promise<bigint | null> => {
    setStep("waiting");
    setStatusMsg("Waiting for block confirmation… (Arc Testnet can take 1-2 min)");
    try {
      const id = await extractJobIdFromTx(hash);
      return id;
    } catch {
      setStep("timedout");
      setTxHash(hash);
      return null;
    }
  };

  const handleCreate = async () => {
    if (!isValid) return;
    setStep("creating");
    setErrorMsg("");
    setStatusMsg("Check your wallet — confirm the transaction");

    try {
      const wc = getBrowserWalletClient();
      if (!wc) throw new Error("Wallet not connected");

      const hash = await createJob(
        wc,
        account,
        provider as Address,
        evaluator as Address,
        description.trim(),
        parseInt(expiryHours)
      );
      setTxHash(hash);

      const id = await waitAndExtract(hash);
      if (!id) return; // timedout state shown — user can retry manually

      setJobId(id);
      setStep("budget");
      setStatusMsg("Check your wallet — confirm the budget transaction");
      await setBudget(wc, account, id, budgetAmount);

      setStep("done");
      setTimeout(onSuccess, 1500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      setErrorMsg(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
      setStep("error");
    }
  };

  // After timeout: user can paste tx hash to resume
  const handleResume = async () => {
    const hash = (manualTxHash.trim() || txHash) as Hex | null;
    if (!hash) return;
    setRetrying(true);
    setStatusMsg("Looking up transaction on chain…");
    try {
      // Try to get receipt directly
      const receipt = await publicClient.getTransactionReceipt({ hash });
      let foundId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: AGENTIC_COMMERCE_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === "JobCreated") {
            foundId = (decoded.args as { jobId: bigint }).jobId;
            break;
          }
        } catch { continue; }
      }
      if (!foundId) throw new Error("JobCreated event not found in receipt");

      setJobId(foundId);
      setTxHash(hash);
      setStep("budget");
      setStatusMsg("Job found! Now confirm the budget transaction in your wallet.");

      const wc = getBrowserWalletClient();
      if (!wc) throw new Error("Wallet not connected");
      await setBudget(wc, account, foundId, budgetAmount);
      setStep("done");
      setTimeout(onSuccess, 1500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not find transaction";
      setErrorMsg(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
      setStep("error");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in">
      <div className="glass rounded-2xl border border-dark-400/60 w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-dark-400/40">
          <div>
            <h2 className="font-bold text-white">Create Job</h2>
            <p className="text-xs text-slate-500 mt-0.5">Deploy an ERC-8183 job on Arc Testnet</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Job Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Analyze dataset and return summary report in JSON format"
              rows={3}
              className="arc-input w-full px-3 py-2 text-sm resize-none"
              disabled={step !== "idle" && step !== "error"}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Provider Address</label>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="0x… AI agent or worker wallet"
              className="arc-input w-full px-3 py-2 text-sm mono"
              disabled={step !== "idle" && step !== "error"}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">
              Evaluator Address
              <span className="ml-2 text-arc-400">(defaults to your wallet)</span>
            </label>
            <input
              type="text"
              value={evaluator}
              onChange={(e) => setEvaluator(e.target.value as Address)}
              className="arc-input w-full px-3 py-2 text-sm mono"
              disabled={step !== "idle" && step !== "error"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Budget (USDC)</label>
              <input
                type="number"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                min="0.01" step="0.01"
                className="arc-input w-full px-3 py-2 text-sm"
                disabled={step !== "idle" && step !== "error"}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Expiry (hours)</label>
              <input
                type="number"
                value={expiryHours}
                onChange={(e) => setExpiryHours(e.target.value)}
                min="1" max="168"
                className="arc-input w-full px-3 py-2 text-sm"
                disabled={step !== "idle" && step !== "error"}
              />
            </div>
          </div>

          {/* Progress */}
          {step !== "idle" && step !== "timedout" && (
            <div className="bg-dark-700/60 rounded-xl p-3 text-sm space-y-2 border border-dark-400/40">
              <ProgressRow label="Creating job onchain" done={["budget","done"].includes(step)} loading={["creating","waiting"].includes(step)} />
              <ProgressRow label="Setting budget" done={step === "done"} loading={step === "budget"} />
              {statusMsg && !["done","error"].includes(step) && (
                <div className="text-xs text-arc-300 bg-arc-900/30 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin flex-shrink-0" />
                  {statusMsg}
                </div>
              )}
              {step === "done" && jobId !== null && (
                <div className="text-green-400 text-xs flex items-center gap-1.5">
                  <CheckCircle2 size={13} /> Job #{jobId.toString()} created!
                </div>
              )}
              {txHash && (
                <a href={explorerTx(txHash)} target="_blank" rel="noreferrer"
                  className="mono text-xs text-arc-400 hover:text-arc-300 flex items-center gap-1">
                  View on Arcscan <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}

          {/* Timeout recovery UI */}
          {step === "timedout" && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-amber-300">Timed out waiting for confirmation</div>
                  <p className="text-xs text-amber-400/80 mt-0.5">
                    The transaction may still confirm. Check Arcscan or wait and click <strong>Resume</strong>.
                  </p>
                </div>
              </div>
              {txHash && (
                <a href={explorerTx(txHash)} target="_blank" rel="noreferrer"
                  className="mono text-xs text-arc-400 hover:text-arc-300 flex items-center gap-1.5">
                  <Hash size={11} /> {txHash.slice(0,20)}… <ExternalLink size={10} />
                </a>
              )}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Or paste tx hash manually:</label>
                <input
                  type="text"
                  value={manualTxHash}
                  onChange={(e) => setManualTxHash(e.target.value)}
                  placeholder="0x… (if different from above)"
                  className="arc-input w-full px-3 py-2 text-xs mono"
                />
              </div>
              <button
                onClick={handleResume}
                disabled={retrying}
                className="btn-primary w-full py-2 text-sm flex items-center justify-center gap-2"
              >
                {retrying ? <><Loader2 size={13} className="animate-spin" /> Checking chain…</> : "Resume / Retry"}
              </button>
            </div>
          )}

          {step === "error" && (
            <p className="text-red-400 text-xs bg-red-900/20 rounded-lg p-2 border border-red-800/30">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 pt-0 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm">
            {step === "done" ? "Close" : "Cancel"}
          </button>
          {(step === "idle" || step === "error") && (
            <button
              onClick={handleCreate}
              disabled={!isValid}
              className="btn-primary flex-1 py-2.5 text-sm flex items-center justify-center gap-2"
            >
              Create Job
            </button>
          )}
          {["creating","waiting","budget"].includes(step) && (
            <button disabled className="btn-primary flex-1 py-2.5 text-sm flex items-center justify-center gap-2 opacity-70">
              <Loader2 size={14} className="animate-spin" />
              {step === "budget" ? "Setting budget…" : "Creating…"}
            </button>
          )}
          {step === "done" && (
            <button disabled className="btn-primary flex-1 py-2.5 text-sm flex items-center justify-center gap-2">
              <CheckCircle2 size={14} className="text-green-400" /> Created!
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressRow({ label, done, loading }: { label: string; done: boolean; loading: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {done ? (
        <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
      ) : loading ? (
        <Loader2 size={13} className="text-arc-400 animate-spin flex-shrink-0" />
      ) : (
        <div className="w-3 h-3 rounded-full border border-slate-600 flex-shrink-0" />
      )}
      <span className={done ? "text-green-400" : loading ? "text-white" : "text-slate-500"}>
        {label}
      </span>
    </div>
  );
}
