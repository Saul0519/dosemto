/**
 * What the ledger's two halves are called, in one vocabulary.
 *
 * Import-free on purpose. The table in the browser needs these words and the
 * query on the server needs them too, and anything the browser reaches must not
 * drag `cloudflare:workers` into its bundle along the way.
 */

export type LedgerKind = "shop" | "store";

export type LedgerRow = {
  /** Unique across both halves, since the two id spaces are separate. */
  key: string;
  kind: LedgerKind;
  /** The row's own id within its half, for writing a change back. */
  id: string;
  /** ISO, as stored. */
  at: string;
  orderNo: string;
  /** Shop name, or product name. What the money came through. */
  source: string;
  sourceId: string;
  /** Who it was for. */
  customer: string;
  /**
   * True only when `customer` really is a Minecraft account name.
   *
   * Store purchases ask for one and check it. Drawing orders never have —
   * their columns are named for a Minecraft sign-in the site no longer uses,
   * and now hold a Discord display name. Putting a head next to one of those
   * would show a stranger's face.
   */
  customerIsNick: boolean;
  /** Discord snowflake where known, so a name change does not lose the person. */
  customerId: string;
  /** The stored value, not the word for it. */
  status: string;
  price: number;
  /** True when this row is money actually taken. */
  counted: boolean;
};

export const SHOP_STATUS_LABEL: Record<string, string> = {
  new: "대기",
  working: "작업 중",
  completed: "완성",
  cancelled: "거절",
  notification_failed: "알림 실패",
};

export const STORE_STATUS_LABEL: Record<string, string> = {
  new: "대기",
  handled: "전달 완료",
  rejected: "거절",
};

export function statusLabel(kind: LedgerKind, status: string) {
  const table = kind === "store" ? STORE_STATUS_LABEL : SHOP_STATUS_LABEL;
  return table[status] ?? status;
}

/**
 * What the owner may set from the ledger.
 *
 * `notification_failed` is missing on purpose: it describes something that
 * happened to us, not a decision anyone gets to make.
 */
export const SETTABLE: Record<LedgerKind, string[]> = {
  shop: ["new", "working", "completed", "cancelled"],
  store: ["new", "handled", "rejected"],
};

/** Which statuses mean the money was actually taken. */
export const COUNTS_AS_REVENUE: Record<LedgerKind, string> = {
  shop: "completed",
  store: "handled",
};

/** Where a status change for this row has to be sent. */
export function statusEndpoint(kind: LedgerKind, id: string) {
  return kind === "store"
    ? `/api/control/store/purchases/${id}`
    : `/api/admin/orders/${id}`;
}
