import { Clipboard } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { imageSources, useImageBaseUrl } from "../../api/catalog";
import { useCreateOrder, useItemInfo, useItemOrders, useItemStats, useWfmUser } from "../../api/market";
import { updateOrder, useTradingAction } from "../../api/trading";
import { median48h, prefillPrice, sparkline, statusLabel, whisper, type WfmItemOrders, type WfmPublicOrder } from "../../domain/market";
import { ItemImage } from "../../patterns/ItemImage";
import { Button, IconButton } from "../../primitives/actions";
import { Table, type TableColumn } from "../../primitives/data";
import { Alert } from "../../primitives/display";
import { FormField, Input, RadioGroup } from "../../primitives/forms";
import { Modal, toast } from "../../primitives/overlay";
import { closeItemWindow, useItemWindowTarget } from "../../state/itemWindow";
import { fmt, type MarketTarget } from "./shared";

type Side = "sell" | "buy";

function PriceChart({ slug }: { slug: string }) {
  const stats = useItemStats(slug);
  const gradient = useId();
  const line = sparkline(stats.data ?? []);
  if (!line) return null;
  return (
    <figure className="flex flex-col gap-1">
      <svg
        role="img"
        aria-label={`Price over the last three weeks: low ${fmt(line.low)}, now ${fmt(line.last)}, high ${fmt(line.high)} platinum`}
        viewBox="0 0 320 56"
        preserveAspectRatio="none"
        className="block h-14 w-full"
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--hex-accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--hex-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={line.area} fill={`url(#${gradient})`} />
        <polyline
          points={line.points}
          fill="none"
          stroke="var(--hex-accent)"
          strokeWidth="1.8"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="flex justify-between text-xs text-muted tabular-nums" aria-hidden="true">
        <span>{fmt(line.low)}p low</span>
        <span className="font-semibold text-text">{fmt(line.last)}p now</span>
        <span>{fmt(line.high)}p high</span>
      </figcaption>
    </figure>
  );
}

const STATUS_CLASS: Record<string, string> = { ingame: "text-success", online: "text-info", offline: "text-muted" };

function OrderTable({
  side,
  itemName,
  orders,
  loading,
  error,
  showRank,
  onMatch,
}: {
  side: Side;
  itemName: string;
  orders: readonly WfmPublicOrder[];
  loading: boolean;
  error: boolean;
  showRank: boolean;
  onMatch: ((price: number) => void) | null;
}) {
  const title = side === "sell" ? "Sellers" : "Buyers";
  const best = orders[0]?.platinum;
  const copy = (o: WfmPublicOrder) => {
    navigator.clipboard
      .writeText(whisper(o, side, itemName))
      .then(() => toast({ title: `Whisper to ${o.user.ingameName} copied`, tone: "success" }))
      .catch(() => toast({ title: "Could not copy the whisper", tone: "danger" }));
  };
  const columns: Array<TableColumn<WfmPublicOrder>> = [
    { id: "price", header: "Price", align: "end", cell: (o) => <span className="font-semibold tabular-nums">{fmt(o.platinum)}p</span> },
    { id: "qty", header: "Qty", align: "end", cell: (o) => <span className="tabular-nums">{o.quantity}</span> },
    {
      id: "status",
      header: "Status",
      cell: (o) => <span className={STATUS_CLASS[o.user.status] ?? "text-muted"}>{statusLabel(o.user.status)}</span>,
    },
    { id: "player", header: "Player", cell: (o) => <span className="block max-w-32 truncate">{o.user.ingameName}</span> },
    ...(showRank
      ? [
          {
            id: "rank",
            header: "Rank",
            align: "end" as const,
            cell: (o: WfmPublicOrder) => <span className="tabular-nums">{o.mod_rank ?? "—"}</span>,
          },
        ]
      : []),
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      cell: (o) => (
        <span className="flex justify-end gap-1">
          <IconButton
            icon={Clipboard}
            size="sm"
            label={`Copy whisper to ${o.user.ingameName}`}
            onClick={() => {
              copy(o);
            }}
          />
          {onMatch && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onMatch(o.platinum);
              }}
              aria-label={`Match ${fmt(o.platinum)} platinum`}
            >
              Match
            </Button>
          )}
        </span>
      ),
    },
  ];
  return (
    <section aria-labelledby={`${side}-title`} className="flex min-w-0 flex-col gap-1">
      <header className="flex items-baseline justify-between gap-2">
        <h3 id={`${side}-title`} className="text-sm font-semibold">
          {title} <span className="text-xs font-normal text-muted">{side === "sell" ? "you buy from" : "you sell to"}</span>
        </h3>
        {best !== undefined && (
          <span className="text-xs text-muted">
            {side === "sell" ? "Cheapest" : "Best offer"} <span className="font-semibold text-text tabular-nums">{fmt(best)}p</span>
          </span>
        )}
      </header>
      {error ? (
        <p className="text-xs text-danger">Could not load the orders.</p>
      ) : (
        <Table
          label={`${title} of ${itemName}`}
          columns={columns}
          data={orders}
          getRowId={(o) => `${o.user.ingameName}-${String(o.platinum)}-${String(o.mod_rank ?? "")}`}
          loading={loading}
          empty={side === "sell" ? "No sellers found." : "No buyers found."}
        />
      )}
    </section>
  );
}

function OrderForm({
  slug,
  itemId,
  side,
  price,
  rank,
  maxRank,
  onRankChange,
  onDone,
}: {
  slug: string;
  itemId: string | null;
  side: Side;
  price: number;
  rank: number;
  maxRank: number | null;
  onRankChange: (rank: number) => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<Side>(side);
  const [platinum, setPlatinum] = useState(price);
  const [quantity, setQuantity] = useState(1);
  const [visible, setVisible] = useState<"visible" | "hidden">("visible");
  const create = useCreateOrder(slug);

  return (
    <form
      aria-label="New order"
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          { itemId, orderType: type, platinum, quantity, visible: visible === "visible", modRank: maxRank !== null ? rank : null },
          {
            onSuccess: () => {
              toast({ title: `Order posted${visible === "hidden" ? " as hidden" : ""}`, tone: "success" });
              onDone();
            },
          },
        );
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <RadioGroup
          legend="Order type"
          appearance="segmented"
          value={type}
          onValueChange={setType}
          options={[
            { value: "sell", label: "Sell" },
            { value: "buy", label: "Buy" },
          ]}
        />
        <FormField label="Price (platinum)" className="w-28">
          <Input
            type="number"
            size="sm"
            min={1}
            step={1}
            value={platinum}
            onChange={(e) => {
              setPlatinum(Math.round(Number(e.target.value)));
            }}
          />
        </FormField>
        <FormField label="Quantity" className="w-20">
          <Input
            type="number"
            size="sm"
            min={1}
            max={99}
            value={quantity}
            onChange={(e) => {
              setQuantity(Math.max(1, Math.min(99, Math.round(Number(e.target.value)))));
            }}
          />
        </FormField>
        {maxRank !== null && (
          <FormField label={`Rank (0–${String(maxRank)})`} className="w-24">
            <Input
              type="number"
              size="sm"
              min={0}
              max={maxRank}
              value={rank}
              onChange={(e) => {
                onRankChange(Math.max(0, Math.min(maxRank, Math.round(Number(e.target.value)))));
              }}
            />
          </FormField>
        )}
        <RadioGroup
          legend="Visibility"
          appearance="segmented"
          value={visible}
          onValueChange={setVisible}
          options={[
            { value: "visible", label: "Visible" },
            { value: "hidden", label: "Hidden" },
          ]}
        />
      </div>
      {create.isError && (
        <Alert tone="danger" title="The order was not posted.">
          {create.error.message || String(create.error)}
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending} disabled={platinum < 1}>
          Post order
        </Button>
      </div>
    </form>
  );
}

/** Edit one of my listings (from Trading → Listings). */
function EditListingForm({ edit, onDone }: { edit: NonNullable<MarketTarget["edit"]>; onDone: () => void }) {
  const [platinum, setPlatinum] = useState(edit.platinum);
  const [quantity, setQuantity] = useState(edit.quantity);
  const [visible, setVisible] = useState<"visible" | "hidden">(edit.visible ? "visible" : "hidden");
  const action = useTradingAction();
  return (
    <form
      aria-label="Edit listing"
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate(() => updateOrder({ orderId: edit.orderId, platinum, quantity, visible: visible === "visible" }), {
          onSuccess: () => {
            toast({ title: "Listing saved", tone: "success" });
            onDone();
          },
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Price (platinum)" className="w-28">
          <Input
            type="number"
            size="sm"
            min={1}
            value={platinum}
            onChange={(e) => {
              setPlatinum(Math.max(1, Math.round(Number(e.target.value))));
            }}
          />
        </FormField>
        <FormField label="Quantity" className="w-20">
          <Input
            type="number"
            size="sm"
            min={1}
            value={quantity}
            onChange={(e) => {
              setQuantity(Math.max(1, Math.round(Number(e.target.value))));
            }}
          />
        </FormField>
        <RadioGroup
          legend="Visibility"
          appearance="segmented"
          value={visible}
          onValueChange={setVisible}
          options={[
            { value: "visible", label: "Visible" },
            { value: "hidden", label: "Hidden" },
          ]}
        />
      </div>
      {action.isError && (
        <Alert tone="danger" title="The listing was not saved.">
          {action.error.message || String(action.error)}
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={action.isPending}>
          Save listing
        </Button>
      </div>
    </form>
  );
}

const NO_ORDERS: WfmItemOrders = { sell: [], buy: [] };

function ItemBody({ target, onClose }: { target: MarketTarget; onClose: () => void }) {
  const user = useWfmUser();
  const info = useItemInfo(target.slug);
  const stats = useItemStats(target.slug);
  const maxRank = info.data?.modMaxRank !== undefined && info.data.modMaxRank > 0 ? info.data.modMaxRank : null;
  const [rankInput, setRankInput] = useState(target.rank ?? 0);
  const [rank, setRank] = useState(target.rank ?? 0);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setRank(rankInput);
    }, 350);
    return () => {
      window.clearTimeout(id);
    };
  }, [rankInput]);
  const orders = useItemOrders(target.slug, maxRank !== null ? rank : null, !info.isPending);
  const [form, setForm] = useState<{ side: Side; price: number } | null>(null);
  const median = median48h(stats.data ?? []);
  const book = orders.data ?? NO_ORDERS;
  const openForm = (side: Side, price?: number) => {
    setForm({ side, price: Math.round(price ?? prefillPrice(side, orders.data, median)) });
  };
  const loading = info.isPending || orders.isPending;

  return (
    <div className="flex flex-col gap-4">
      {median !== null && (
        <p className="text-sm text-muted">
          48h median <span className="font-semibold text-text tabular-nums">{fmt(median)}p</span>
        </p>
      )}
      <PriceChart slug={target.slug} />
      {maxRank !== null && (
        <div className="flex items-end gap-2">
          <FormField label="Showing rank" className="w-28">
            <Input
              type="number"
              size="sm"
              min={0}
              max={maxRank}
              value={rankInput}
              onChange={(e) => {
                setRankInput(Math.max(0, Math.min(maxRank, Math.round(Number(e.target.value)))));
              }}
            />
          </FormField>
          <span className="pb-1.5 text-sm text-muted">of {maxRank}</span>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <OrderTable
          side="sell"
          itemName={target.name}
          orders={book.sell}
          loading={loading}
          error={orders.isError}
          showRank={maxRank !== null}
          onMatch={
            user && !target.edit
              ? (p) => {
                  openForm("sell", p);
                }
              : null
          }
        />
        <OrderTable
          side="buy"
          itemName={target.name}
          orders={book.buy}
          loading={loading}
          error={orders.isError}
          showRank={maxRank !== null}
          onMatch={
            user && !target.edit
              ? (p) => {
                  openForm("buy", p);
                }
              : null
          }
        />
      </div>
      {target.edit ? (
        <EditListingForm edit={target.edit} onDone={onClose} />
      ) : !user ? (
        <p className="text-sm text-muted">Log in to warframe.market in the Trading tab to place orders.</p>
      ) : form ? (
        <OrderForm
          key={`${form.side}-${String(form.price)}`}
          slug={target.slug}
          itemId={info.data?.id ?? null}
          side={form.side}
          price={form.price}
          rank={rankInput}
          maxRank={maxRank}
          onRankChange={setRankInput}
          onDone={() => {
            setForm(null);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              openForm("sell");
            }}
          >
            Sell{book.sell[0] ? ` at ${fmt(book.sell[0].platinum)}p` : ""}
          </Button>
          <Button
            onClick={() => {
              openForm("buy");
            }}
          >
            Buy{book.buy[0] ? ` at ${fmt(book.buy[0].platinum)}p` : ""}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Orders, price history and posting an order for one item. */
export function ItemWindow({ target, onClose }: { target: MarketTarget | null; onClose: () => void }) {
  const baseUrl = useImageBaseUrl();
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      size="xl"
      title={
        target && (
          <span className="flex items-center gap-2">
            <ItemImage size="sm" sources={imageSources(target.imageName ?? undefined, baseUrl)} name={target.name} />
            {target.name}
          </span>
        )
      }
    >
      {target && <ItemBody key={`${target.slug}-${String(target.rank)}`} target={target} onClose={onClose} />}
    </Modal>
  );
}

/** The one item window of the app, opened with `openItemWindow` (state/itemWindow). */
export function ItemWindowHost() {
  const target = useItemWindowTarget();
  return <ItemWindow target={target} onClose={closeItemWindow} />;
}
