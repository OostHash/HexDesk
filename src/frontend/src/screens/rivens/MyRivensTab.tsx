import { Gem } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDispositions, useOwnedRivens, usePostAuction, usePostVeiled, useWeaponNames } from "../../api/rivens";
import { useSession } from "../../api/trading";
import {
  auctionAttributes,
  auctionPrices,
  challengeText,
  groupRivens,
  polarityName,
  rivenCategory,
  rivenModName,
  statContext,
  statLabel,
  titleCase,
  toWfmSlug,
  veiledSlug,
  wfmPolarity,
  type AuctionForm,
  type OwnedRiven,
} from "../../domain/rivens";
import { Button } from "../../primitives/actions";
import { Alert, Badge, Card, EmptyState, Skeleton } from "../../primitives/display";
import { FormField, Input, RadioGroup, Switch, Textarea } from "../../primitives/forms";
import { Modal, toast } from "../../primitives/overlay";

type Named = { riven: OwnedRiven; weapon: string; disposition: number };

function Stats({ item }: { item: Named }) {
  const ctx = statContext(item.riven, item.disposition);
  return (
    <ul aria-label="Stats" className="flex flex-wrap gap-1">
      {item.riven.buffs.map((b) => (
        <li key={`b-${b.tag}`}>
          <Badge tone="success">{statLabel(b, true, ctx)}</Badge>
        </li>
      ))}
      {item.riven.curses.map((c) => (
        <li key={`c-${c.tag}`}>
          <Badge tone="danger">{statLabel(c, false, ctx)}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Meta({ item }: { item: Named }) {
  const r = item.riven;
  const polarity = polarityName(r.polarity);
  const parts = [
    rivenCategory(r.item_type),
    `MR ${r.lvl_req === null ? "?" : String(r.lvl_req)}`,
    `Rank ${String(r.mod_rank)}`,
    `${item.disposition.toFixed(2)}x disposition`,
    `${String(r.rerolls)} roll${r.rerolls === 1 ? "" : "s"}`,
    ...(polarity ? [`${polarity} polarity`] : []),
  ];
  return <p className="text-xs text-muted">{parts.join(" · ")}</p>;
}

const RivenTitle = ({ item }: { item: Named }) => {
  const mod = rivenModName(item.riven);
  return (
    <>
      {item.weapon} {mod && <em className="font-normal text-muted">{titleCase(mod)}</em>}
    </>
  );
};

function AuctionModal({ item, onClose }: { item: Named; onClose: () => void }) {
  const [form, setForm] = useState<AuctionForm>({ type: "auction", start: "100", buyout: "", direct: "100", minRep: "0" });
  const [note, setNote] = useState("");
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const post = usePostAuction();
  const { attributes, unmapped } = auctionAttributes(item.riven, item.disposition);
  const set = (patch: Partial<AuctionForm>) => {
    setForm({ ...form, ...patch });
  };

  return (
    <Modal open onClose={onClose} title="Post riven auction" description={<RivenTitle item={item} />} size="md">
      <form
        aria-label="Post riven auction"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const prices = auctionPrices(form);
          if ("error" in prices) {
            setError(prices.error);
            return;
          }
          setError(null);
          const r = item.riven;
          post.mutate(
            {
              weaponUrlName: toWfmSlug(item.weapon),
              rivenName: rivenModName(r),
              masteryLevel: r.lvl_req ?? 0,
              modRank: r.mod_rank,
              reRolls: r.rerolls,
              polarity: wfmPolarity(r.polarity),
              attributes,
              startingPrice: prices.start,
              buyoutPrice: prices.buyout,
              minimalReputation: prices.minRep,
              note,
              visible,
              isDirectSell: form.type === "direct",
            },
            {
              onSuccess: () => {
                toast({ title: form.type === "direct" ? "Direct sale posted" : "Auction posted", tone: "success" });
                onClose();
              },
            },
          );
        }}
      >
        <Meta item={item} />
        <Stats item={item} />
        {unmapped > 0 && (
          <Alert tone="warning">
            {unmapped} stat{unmapped > 1 ? "s have" : " has"} no warframe.market attribute and will be left out of the listing.
          </Alert>
        )}
        <RadioGroup
          legend="Listing type"
          appearance="segmented"
          value={form.type}
          onValueChange={(type) => {
            set({ type });
          }}
          options={[
            { value: "auction", label: "Auction" },
            { value: "direct", label: "Direct sale" },
          ]}
        />
        {form.type === "direct" ? (
          <FormField label="Selling price (platinum)" className="w-40">
            <Input
              type="number"
              size="sm"
              min={1}
              value={form.direct}
              onChange={(e) => {
                set({ direct: e.target.value });
              }}
            />
          </FormField>
        ) : (
          <div className="flex flex-wrap gap-3">
            <FormField label="Starting price (platinum)" className="w-40">
              <Input
                type="number"
                size="sm"
                min={1}
                value={form.start}
                onChange={(e) => {
                  set({ start: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Buyout (platinum)" description="Optional." className="w-36">
              <Input
                type="number"
                size="sm"
                min={1}
                value={form.buyout}
                onChange={(e) => {
                  set({ buyout: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Minimum reputation" className="w-36">
              <Input
                type="number"
                size="sm"
                min={0}
                max={5}
                value={form.minRep}
                onChange={(e) => {
                  set({ minRep: e.target.value });
                }}
              />
            </FormField>
          </div>
        )}
        <FormField label="Note" description="Optional.">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FormField>
        <Switch checked={visible} onCheckedChange={setVisible}>
          Visible on warframe.market
        </Switch>
        {(error ?? post.error) && (
          <Alert tone="danger" title="The listing was not posted.">
            {error ?? post.error?.message}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={post.isPending}>
            {form.type === "direct" ? "Post direct sale" : "Post auction"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function VeiledModal({ riven, onClose }: { riven: OwnedRiven; onClose: () => void }) {
  const category = rivenCategory(riven.item_type);
  const slug = veiledSlug(category);
  const [price, setPrice] = useState("20");
  const [quantity, setQuantity] = useState("1");
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const post = usePostVeiled();

  return (
    <Modal
      open
      onClose={onClose}
      title="Sell unrevealed riven"
      description={`${category} Riven Mod (unrevealed) · ${String(riven.count)} in inventory`}
      size="sm"
    >
      <form
        aria-label="Sell unrevealed riven"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const platinum = Number.parseInt(price, 10);
          const qty = Number.parseInt(quantity, 10);
          const problem =
            !platinum || platinum < 1
              ? "Price must be at least 1 platinum."
              : !qty || qty < 1
                ? "Quantity must be at least 1."
                : !slug
                  ? `No warframe.market listing exists for ${category} Riven Mod.`
                  : null;
          setError(problem);
          if (problem || !slug) return;
          post.mutate(
            { slug, platinum, quantity: qty, visible },
            {
              onSuccess: () => {
                toast({ title: "Sell order created", tone: "success" });
                onClose();
              },
            },
          );
        }}
      >
        <div className="flex flex-wrap gap-3">
          <FormField label="Price per riven (platinum)" className="w-44">
            <Input
              type="number"
              size="sm"
              min={1}
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Quantity" className="w-24">
            <Input
              type="number"
              size="sm"
              min={1}
              max={riven.count}
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
              }}
            />
          </FormField>
        </div>
        <Switch checked={visible} onCheckedChange={setVisible}>
          Visible on warframe.market
        </Switch>
        {!slug && <Alert tone="warning">This riven type may not be listable on warframe.market.</Alert>}
        {(error ?? post.error) && (
          <Alert tone="danger" title="The order was not created.">
            {error ?? post.error?.message}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={post.isPending} disabled={!slug}>
            Create sell order
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const id = `rivens-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-sm font-semibold">
        {title} <span className="font-normal text-muted tabular-nums">({count})</span>
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

/** Rivens in the inventory, with selling on warframe.market. */
/** The rivens you own. `focusId` is the item id of a riven to scroll to and mark. */
export function MyRivensTab({ focusId = null }: { focusId?: string | null }) {
  const owned = useOwnedRivens();
  const dispositions = useDispositions();
  const names = useWeaponNames();
  const session = useSession();
  const loggedIn = Boolean(session.data);
  const [auction, setAuction] = useState<Named | null>(null);
  const [veiled, setVeiled] = useState<OwnedRiven | null>(null);
  const focusRef = useRef<HTMLLIElement>(null);
  const hasFocus = focusId !== null && (owned.data ?? []).some((r) => r.item_id === focusId);
  useEffect(() => {
    if (hasFocus) focusRef.current?.scrollIntoView({ block: "center" });
  }, [hasFocus, focusId]);
  const focusProps = (r: OwnedRiven) =>
    hasFocus && r.item_id === focusId ? { ref: focusRef, "aria-current": true as const, className: "rounded-md ring-2 ring-accent" } : {};

  if (owned.isPending) return <Skeleton lines={6} />;
  const { unlocked, revealed, unrevealed } = groupRivens(owned.data ?? []);
  if (unlocked.length + revealed.length + unrevealed.length === 0) {
    return <EmptyState icon={Gem} title="No rivens found." description="The inventory has to be captured once while Warframe is running." />;
  }
  const named = (r: OwnedRiven): Named => ({
    riven: r,
    weapon: r.compat ? (names.get(r.compat) ?? r.compat.split("/").pop() ?? r.compat) : "Unknown weapon",
    disposition: r.compat ? (dispositions[r.compat] ?? 1) : 1,
  });
  const notLoggedIn = () => toast({ title: "Log in to warframe.market first", description: "Market → Trading.", tone: "info" });

  return (
    <div className="flex flex-col gap-6">
      {!loggedIn && <Alert tone="info">Log in to warframe.market (Market → Trading) to sell rivens.</Alert>}
      {unlocked.length > 0 && (
        <Section title="Rivens" count={unlocked.length}>
          {unlocked.map((r) => {
            const item = named(r);
            return (
              <li key={r.item_id || item.weapon} {...focusProps(r)}>
                <Card as="article" padding="sm" className="flex flex-col gap-1.5">
                  <header className="flex items-center gap-2">
                    <h4 className="flex-1 text-sm font-semibold">
                      <RivenTitle item={item} />
                    </h4>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (loggedIn) setAuction(item);
                        else notLoggedIn();
                      }}
                      aria-label={`Sell ${item.weapon} riven`}
                    >
                      Sell
                    </Button>
                  </header>
                  <Meta item={item} />
                  <Stats item={item} />
                </Card>
              </li>
            );
          })}
        </Section>
      )}
      {revealed.length > 0 && (
        <Section title="Revealed rivens" count={revealed.length}>
          {revealed.map((r, i) => (
            <li key={r.item_id || String(i)} {...focusProps(r)}>
              <Card as="article" padding="sm">
                <h4 className="text-sm font-semibold">{rivenCategory(r.item_type)} Riven Mod</h4>
                <p className="text-xs text-muted italic">Challenge: {challengeText(r.challenge_type, r.challenge_complication)}</p>
              </Card>
            </li>
          ))}
        </Section>
      )}
      {unrevealed.length > 0 && (
        <Section title="Unrevealed rivens" count={unrevealed.reduce((s, r) => s + r.count, 0)}>
          {unrevealed.map((r, i) => (
            <li key={`${r.item_type}-${String(i)}`}>
              <Card as="article" padding="sm">
                <div className="flex items-center gap-2">
                  <h4 className="flex-1 text-sm font-semibold">
                    {rivenCategory(r.item_type)} Riven Mod {r.count > 1 && <span className="font-normal text-muted">×{r.count}</span>}
                  </h4>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (loggedIn) setVeiled(r);
                      else notLoggedIn();
                    }}
                    aria-label={`Sell unrevealed ${rivenCategory(r.item_type)} riven`}
                  >
                    Sell
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </Section>
      )}
      {auction && (
        <AuctionModal
          item={auction}
          onClose={() => {
            setAuction(null);
          }}
        />
      )}
      {veiled && (
        <VeiledModal
          riven={veiled}
          onClose={() => {
            setVeiled(null);
          }}
        />
      )}
    </div>
  );
}
