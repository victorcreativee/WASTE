import { createHash } from "node:crypto";

/** Retain the receipt on the first allocation; give later ledger rows bounded, deterministic references. */
export function purchaseAllocationReference(receipt: string, lineIndex: number): string {
  if (lineIndex === 0) return receipt;
  const suffix = `#${lineIndex + 1}`;
  const characters = Array.from(receipt);
  if (characters.length + suffix.length <= 120) return receipt + suffix;
  const hash = createHash("sha256").update(receipt).digest("hex").slice(0, 12);
  return characters.slice(0, 120 - suffix.length - hash.length - 1).join("") + "~" + hash + suffix;
}
