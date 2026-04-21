import { Request, Response } from "express";
import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import SolanaTransaction from "../models/SolanaTransaction.js";

type SolanaNetwork = "devnet" | "testnet" | "mainnet-beta";

interface VerifyPaymentBody {
  signature?: string;
  recipient?: string;
  amountSol?: number;
  reference?: string;
  label?: string;
  message?: string;
}

const DEFAULT_NETWORK: SolanaNetwork = "devnet";
const rawNetwork = String(process.env.SOLANA_NETWORK || DEFAULT_NETWORK).trim() as SolanaNetwork;
const SOLANA_NETWORK: SolanaNetwork =
  rawNetwork === "devnet" || rawNetwork === "testnet" || rawNetwork === "mainnet-beta"
    ? rawNetwork
    : DEFAULT_NETWORK;

const SOLANA_RPC_URL =
  String(process.env.SOLANA_RPC_URL || "").trim() || clusterApiUrl(SOLANA_NETWORK);

const connection = new Connection(SOLANA_RPC_URL, "confirmed");

const toStringValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseAmountSol = (value: unknown): number | null => {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
};

const isValidPublicKey = (value: string): boolean => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
};

const readAccountKeyBase58 = (key: any): string => {
  if (!key) return "";

  if (typeof key === "string") {
    return key;
  }

  if (key.pubkey) {
    if (typeof key.pubkey === "string") return key.pubkey;
    if (typeof key.pubkey.toBase58 === "function") return key.pubkey.toBase58();
  }

  if (typeof key.toBase58 === "function") {
    return key.toBase58();
  }

  return "";
};

const collectSystemTransferLamportsToRecipient = (
  parsedTx: any,
  expectedRecipient: string,
): number => {
  const lamportValues: number[] = [];

  const recordIfRecipientTransfer = (instruction: any) => {
    if (!instruction || typeof instruction !== "object") return;

    const program = String(instruction.program || "");
    const parsed = instruction.parsed;

    if (program !== "system" || !parsed || typeof parsed !== "object") {
      return;
    }

    const parsedType = String(parsed.type || "");
    if (parsedType !== "transfer" && parsedType !== "transferWithSeed") {
      return;
    }

    const info = parsed.info;
    const destination = String(info?.destination || "");
    const lamports = Number(info?.lamports);

    if (destination === expectedRecipient && Number.isFinite(lamports) && lamports > 0) {
      lamportValues.push(lamports);
    }
  };

  const topLevelInstructions = parsedTx?.transaction?.message?.instructions || [];
  for (const instruction of topLevelInstructions) {
    recordIfRecipientTransfer(instruction);
  }

  const innerInstructions = parsedTx?.meta?.innerInstructions || [];
  for (const group of innerInstructions) {
    for (const instruction of group?.instructions || []) {
      recordIfRecipientTransfer(instruction);
    }
  }

  return lamportValues.reduce((sum, value) => sum + value, 0);
};

export const verifySolanaPayment = async (
  req: Request<{}, {}, VerifyPaymentBody>,
  res: Response,
) => {
  try {
    const signature = toStringValue(req.body.signature);
    const recipient = toStringValue(req.body.recipient);
    const amountSol = parseAmountSol(req.body.amountSol);
    const reference = toStringValue(req.body.reference);
    const label = toStringValue(req.body.label);
    const message = toStringValue(req.body.message);

    if (!signature || !recipient || amountSol === null) {
      return res.status(400).json({
        success: false,
        message: "signature, recipient and amountSol are required",
      });
    }

    if (!isValidPublicKey(recipient)) {
      return res.status(400).json({
        success: false,
        message: "Invalid recipient wallet address",
      });
    }

    if (reference && !isValidPublicKey(reference)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reference public key",
      });
    }

    const existing = await SolanaTransaction.findOne({ signature }).lean();
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Transaction already verified",
        data: existing,
      });
    }

    const parsedTx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!parsedTx) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found on Devnet",
      });
    }

    if (parsedTx.meta?.err) {
      return res.status(400).json({
        success: false,
        message: "Transaction failed on chain",
      });
    }

    const expectedLamports = Math.round(amountSol * LAMPORTS_PER_SOL);
    const transferredLamports = collectSystemTransferLamportsToRecipient(parsedTx, recipient);

    if (transferredLamports < expectedLamports) {
      return res.status(400).json({
        success: false,
        message: "Transferred amount does not match expected amount",
        details: {
          expectedLamports,
          transferredLamports,
        },
      });
    }

    const accountKeys = (parsedTx.transaction.message.accountKeys || []).map((key: any) =>
      readAccountKeyBase58(key),
    );

    if (reference && !accountKeys.includes(reference)) {
      return res.status(400).json({
        success: false,
        message: "Reference key was not found in this transaction",
      });
    }

    const payer = accountKeys[0] || undefined;

    const saved = await SolanaTransaction.create({
      signature,
      recipient,
      payer,
      amountSol,
      amountLamports: expectedLamports,
      network: SOLANA_NETWORK,
      reference: reference || undefined,
      label: label || undefined,
      message: message || undefined,
      slot: parsedTx.slot,
      blockTime: parsedTx.blockTime || undefined,
      status: "verified",
    });

    return res.status(200).json({
      success: true,
      message: "Solana transaction verified successfully",
      data: saved,
    });
  } catch (error) {
    console.error("Solana verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify Solana transaction",
    });
  }
};
