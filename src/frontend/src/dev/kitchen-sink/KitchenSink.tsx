import { Copy, Download, EllipsisVertical, Inbox, Pin, RefreshCw, Shield, SlidersHorizontal, Star, Sword, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, IconButton, Menu } from "../../primitives/actions";
import { ResizeHandle } from "../../primitives/behavior";
import { Table, Tree, type TableColumn } from "../../primitives/data";
import { Pagination, SidebarItem, Tab, TabList, TabPanel, Tabs } from "../../primitives/navigation";
import { foundryTree } from "../fixtures/foundryTree";
import { Alert, Badge, Card, Chip, EmptyState, Icon, Skeleton, Spinner, domainTone, type Tone } from "../../primitives/display";
import { Checkbox, FormField, Input, RadioGroup, SearchInput, Select, Slider, Switch, Textarea } from "../../primitives/forms";
import { ConfirmDialog, Modal, Popover, Tooltip, toast } from "../../primitives/overlay";
import { TEXT_SCALE_RANGE, setPreferences, usePreferences } from "../../state/preferences";
import { densities, type DensityName } from "../../theme/tokens";

/** Kitchen sink: every primitive in every variant and state (plan phase 3). */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="border-b border-border pb-1 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
const SIZES = ["sm", "md", "lg"] as const;
const TONES: Tone[] = ["neutral", "accent", "info", "success", "warning", "danger"];

function ActionsSection() {
  const [pinned, setPinned] = useState(true);
  return (
    <Section id="ks-actions" title="Actions">
      {SIZES.map((size) => (
        <Row key={size} label={`Button — ${size}`}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant}
            </Button>
          ))}
        </Row>
      ))}
      <Row label="Button — states">
        <Button leadingIcon={Download}>With icon</Button>
        <Button trailingIcon={RefreshCw} variant="ghost">
          Refresh
        </Button>
        <Button loading variant="primary">
          Save
        </Button>
        <Button disabled>Disabled</Button>
      </Row>
      <Row label="IconButton — ghost / solid / danger, toggle">
        <IconButton icon={Star} label="Favorite" />
        <IconButton icon={Star} label="Favorite (solid)" variant="solid" />
        <IconButton icon={Trash2} label="Delete" variant="danger" />
        <IconButton
          icon={Pin}
          label={pinned ? "Unpin" : "Pin"}
          pressed={pinned}
          onClick={() => {
            setPinned(!pinned);
          }}
        />
        <IconButton icon={Star} label="Small" size="sm" />
        <IconButton icon={Star} label="Large" size="lg" />
        <IconButton icon={Star} label="Disabled" disabled />
      </Row>
    </Section>
  );
}

function FormsSection() {
  const [search, setSearch] = useState("lith");
  const [checked, setChecked] = useState(true);
  const [notify, setNotify] = useState(true);
  const [scale, setScale] = useState(1);
  const [mode, setMode] = useState<"any" | "normal" | "hard" | "storm">("any");
  const [tier, setTier] = useState("Lith");
  return (
    <Section id="ks-forms" title="Forms">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
        <FormField label="Name" description="As shown in Warframe.">
          <Input placeholder="Excalibur Prime" />
        </FormField>
        <FormField label="Email" required error="Enter a valid email address.">
          <Input type="email" defaultValue="tenno@" />
        </FormField>
        <FormField label="Disabled">
          <Input disabled defaultValue="Cannot be changed" />
        </FormField>
        <FormField label="Sort by">
          <Select defaultValue="name">
            <option value="name">Name</option>
            <option value="price">Price</option>
            <option value="ducats">Ducats</option>
          </Select>
        </FormField>
        <FormField label="Note" description="Optional.">
          <Textarea placeholder="Type here…" />
        </FormField>
      </div>

      <Row label="SearchInput — sm / md / lg">
        <SearchInput size="sm" label="Small search" value={search} onValueChange={setSearch} placeholder="Search…" />
        <SearchInput label="Search" value={search} onValueChange={setSearch} placeholder="Search…" />
        <SearchInput size="lg" label="Large search" value="" onValueChange={() => undefined} placeholder="Empty" />
      </Row>

      <Row label="Checkbox / Switch">
        <Checkbox checked={checked} onCheckedChange={setChecked}>
          Owned only
        </Checkbox>
        <Checkbox checked={false} indeterminate onCheckedChange={() => undefined}>
          Indeterminate
        </Checkbox>
        <Checkbox checked={false} disabled onCheckedChange={() => undefined}>
          Disabled
        </Checkbox>
        <Switch checked={notify} onCheckedChange={setNotify}>
          Notifications
        </Switch>
        <Switch checked={false} disabled onCheckedChange={() => undefined}>
          Disabled
        </Switch>
      </Row>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
        <RadioGroup
          legend="Mode (segmented)"
          appearance="segmented"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "any", label: "Any" },
            { value: "normal", label: "Normal" },
            { value: "hard", label: "Steel Path" },
            { value: "storm", label: "Storm" },
          ]}
        />
        <RadioGroup
          legend="Tier (list)"
          value={tier}
          onValueChange={setTier}
          options={[
            { value: "Lith", label: "Lith" },
            { value: "Meso", label: "Meso" },
            { value: "Requiem", label: "Requiem", disabled: true },
          ]}
        />
        <FormField label="Text size">
          <Slider value={scale} onValueChange={setScale} min={0.8} max={2} step={0.1} formatValue={(v) => `${String(Math.round(v * 100))}%`} />
        </FormField>
      </div>
    </Section>
  );
}

function DisplaySection() {
  const [activeChip, setActiveChip] = useState(true);
  const [chips, setChips] = useState(["Lith · Capture", "Axi · Steel Path"]);
  return (
    <Section id="ks-display" title="Display">
      {(["soft", "outline", "solid"] as const).map((variant) => (
        <Row key={variant} label={`Badge — ${variant}`}>
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone} variant={variant}>
              {tone}
            </Badge>
          ))}
        </Row>
      ))}
      <Row label="Badge — domain color via --ff-tone">
        <Badge tone="domain" style={domainTone("rarity-gold")}>
          Gold
        </Badge>
        <Badge tone="domain" style={domainTone("tier-axi")} variant="outline">
          Axi
        </Badge>
        <Badge tone="domain" style={domainTone("state-cool")} icon={Star} size="md">
          Night
        </Badge>
      </Row>

      <Row label="Chip — toggle and removable">
        <Chip active={activeChip} onActiveChange={setActiveChip}>
          Vaulted only
        </Chip>
        <Chip active={false} onActiveChange={() => undefined} disabled>
          Disabled
        </Chip>
        {chips.map((chip) => (
          <Chip
            key={chip}
            removeLabel={`Remove ${chip}`}
            onRemove={() => {
              setChips(chips.filter((c) => c !== chip));
            }}
          >
            {chip}
          </Chip>
        ))}
      </Row>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
        <Card header={<span className="font-semibold">Card</span>} footer={<Button size="sm">Action</Button>}>
          <p className="text-sm text-muted">Default, medium padding.</p>
        </Card>
        <Card elevation={1} interactive>
          <p className="text-sm">Elevation 1, interactive.</p>
        </Card>
        <Card elevation={2} padding="lg">
          <p className="text-sm">Elevation 2, padding lg.</p>
        </Card>
        <Card padding="lg">
          <Skeleton lines={3} />
        </Card>
      </div>

      <Row label="Spinner / Icon">
        <Spinner />
        <Spinner size="md" label="Loading worldstate" />
        <Icon icon={Star} label="Favorite" className="text-warning" />
      </Row>

      <div className="flex flex-col gap-2">
        <Alert tone="info" title="New version available">
          Restart to update.
        </Alert>
        <Alert tone="success" title="Saved" onDismiss={() => undefined} />
        <Alert tone="warning" title="Worldstate is stale">
          Last updated 12 minutes ago.
        </Alert>
        <Alert tone="danger" title="Failed to load worldstate" action={<Button size="sm">Retry</Button>}>
          No connection to the backend.
        </Alert>
      </div>

      <Card padding="none">
        <EmptyState
          icon={Inbox}
          title="No active fissures"
          description="There are currently no fissures for this mode."
          action={
            <Button size="sm" leadingIcon={RefreshCw}>
              Refresh
            </Button>
          }
        />
      </Card>
    </Section>
  );
}

function OverlaySection() {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <Section id="ks-overlay" title="Overlays">
      <Row label="Modal / ConfirmDialog">
        <Button
          onClick={() => {
            setModal(true);
          }}
        >
          Open modal
        </Button>
        <Button
          variant="danger"
          leadingIcon={Trash2}
          onClick={() => {
            setConfirm(true);
          }}
        >
          Delete watch
        </Button>
      </Row>
      <Modal
        open={modal}
        onClose={() => {
          setModal(false);
        }}
        title="Recipe: Excalibur Prime"
        description="Parts and requirements."
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setModal(false);
            }}
          >
            Done
          </Button>
        }
      >
        <p className="text-sm text-muted">Modal content. Press Escape, use the close button, or click outside the modal to close it.</p>
      </Modal>
      <ConfirmDialog
        open={confirm}
        destructive
        title="Delete watch?"
        description="Lith · Capture will no longer trigger notifications."
        confirmLabel="Delete"
        onClose={() => {
          setConfirm(false);
        }}
        onConfirm={() => {
          setConfirm(false);
          toast({ title: "Watch deleted", tone: "success" });
        }}
      />

      <Row label="Popover / Tooltip / Menu">
        <Popover
          label="Filters"
          trigger={(props) => (
            <button
              type="button"
              className="inline-flex h-control-md items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-hover"
              {...props}
            >
              <Icon icon={SlidersHorizontal} />
              Filters
            </button>
          )}
        >
          <div className="flex flex-col gap-2">
            <Checkbox checked onCheckedChange={() => undefined}>
              Owned only
            </Checkbox>
            <Checkbox checked={false} onCheckedChange={() => undefined}>
              Hide vaulted
            </Checkbox>
          </div>
        </Popover>
        <Tooltip content="Pin in the modular window">
          {(props) => (
            <button
              type="button"
              className="inline-flex h-control-md items-center rounded-md border border-border px-3 text-sm hover:bg-hover"
              {...props}
            >
              Hover or focus me
            </button>
          )}
        </Tooltip>
        <Menu
          trigger={<Icon icon={EllipsisVertical} />}
          triggerLabel="More actions"
          triggerVariant="ghost"
          items={[
            { id: "copy", label: "Copy", icon: Copy, onAction: () => toast({ title: "Copied" }) },
            { id: "pin", label: "Pin", icon: Pin, onAction: () => toast({ title: "Pinned", tone: "success" }) },
            { id: "sep", separator: true },
            {
              id: "delete",
              label: "Delete",
              icon: Trash2,
              danger: true,
              onAction: () => toast({ title: "Failed", description: "Item is in use.", tone: "danger" }),
            },
            { id: "off", label: "Unavailable", disabled: true, onAction: () => undefined },
          ]}
        />
      </Row>

      <Row label="Toast">
        <Button onClick={() => toast({ title: "Saved", tone: "success" })}>Success</Button>
        <Button onClick={() => toast({ title: "Worldstate is stale", description: "Last updated 12 minutes ago.", tone: "warning" })}>Warning</Button>
        <Button onClick={() => toast({ title: "Loading failed", description: "Stays visible until you close it.", tone: "danger" })}>Error</Button>
      </Row>
    </Section>
  );
}

type PriceRow = { id: string; name: string; ducats: number; platinum: number };
const PRICE_ROWS: PriceRow[] = Array.from({ length: 5000 }, (_, i) => ({
  id: String(i),
  name: `Part ${String(i + 1).padStart(4, "0")}`,
  ducats: (i * 37) % 101,
  platinum: (i * 13) % 250,
}));
const PRICE_COLUMNS: Array<TableColumn<PriceRow>> = [
  { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { id: "ducats", header: "Ducats", cell: (r) => r.ducats, sortValue: (r) => r.ducats, align: "end" },
  { id: "platinum", header: "Platinum", cell: (r) => r.platinum, sortValue: (r) => r.platinum, align: "end" },
];

function NavigationDataSection() {
  const [tab, setTab] = useState<"overview" | "recipe" | "prices">("overview");
  const [fissures, setFissures] = useState<"normal" | "hard" | "storm">("normal");
  const [category, setCategory] = useState("warframes");
  const [page, setPage] = useState(0);
  return (
    <Section id="ks-navdata" title="Navigation and data">
      <Tabs selectedKey={tab} onSelectionChange={setTab}>
        <TabList label="Example tabs">
          <Tab id="overview">Overview</Tab>
          <Tab id="recipe">Recipe</Tab>
          <Tab id="prices">Prices</Tab>
        </TabList>
        <TabPanel id="overview">
          <div className="flex gap-6">
            <nav aria-label="Categories" className="w-56">
              <ul className="flex flex-col gap-0.5">
                {[
                  { id: "warframes", label: "Warframes", icon: Shield, count: 54 },
                  { id: "weapons", label: "Weapons", icon: Sword, count: 312 },
                ].map((c) => (
                  <li key={c.id}>
                    <SidebarItem
                      active={category === c.id}
                      label={c.label}
                      icon={c.icon}
                      count={c.count}
                      onClick={() => {
                        setCategory(c.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex flex-1 flex-col gap-3">
              <Tabs selectedKey={fissures} onSelectionChange={setFissures}>
                <TabList label="Fissures" appearance="pills">
                  <Tab id="normal">Normal</Tab>
                  <Tab id="hard">Steel Path</Tab>
                  <Tab id="storm">Storms</Tab>
                </TabList>
                <TabPanel id="normal" className="text-sm text-muted">
                  Normal fissures
                </TabPanel>
                <TabPanel id="hard" className="text-sm text-muted">
                  Steel Path fissures
                </TabPanel>
                <TabPanel id="storm" className="text-sm text-muted">
                  Void storms
                </TabPanel>
              </Tabs>
              <Pagination page={page} pageCount={6} itemCount={128} itemLabel="relics" onPageChange={setPage} />
            </div>
          </div>
        </TabPanel>
        <TabPanel id="recipe">
          <Tree label="Recipes" nodes={foundryTree} defaultExpandedKeys={["excalibur-prime"]} className="max-w-lg" />
        </TabPanel>
        <TabPanel id="prices">
          <Table label="Prices (5000 rows)" columns={PRICE_COLUMNS} data={PRICE_ROWS} getRowId={(r) => r.id} className="h-80" />
        </TabPanel>
      </Tabs>
    </Section>
  );
}

function BehaviorSection() {
  const [width, setWidth] = useState(200);
  return (
    <Section id="ks-behavior" title="Behavior">
      <div className="flex h-32 overflow-hidden rounded-lg border border-border">
        <div className="flex shrink-0 items-center justify-center bg-surface text-sm text-muted" style={{ width }}>
          {width}px
        </div>
        <ResizeHandle label="Sidebar width" axis="x" value={width} min={120} max={360} onValueChange={setWidth} />
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Content</div>
      </div>
    </Section>
  );
}

/** Dev-only controls for the preference store. */
function PreferenceControls() {
  const { textScale, density } = usePreferences();
  return (
    <Card padding="md">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
        <FormField label="Text scale (webview zoom)">
          <Slider
            value={textScale}
            onValueChange={(value) => {
              setPreferences({ textScale: value });
            }}
            min={TEXT_SCALE_RANGE.min}
            max={TEXT_SCALE_RANGE.max}
            step={TEXT_SCALE_RANGE.step}
            formatValue={(v) => `${String(Math.round(v * 100))}%`}
          />
        </FormField>
        <FormField label="Density">
          <Select
            value={density}
            onChange={(event) => {
              setPreferences({ density: event.target.value as DensityName });
            }}
          >
            {Object.keys(densities).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </Card>
  );
}

export function KitchenSink() {
  return (
    <main className="flex flex-col gap-10 p-6 text-text">
      <h1 className="text-xl font-semibold">Kitchen sink</h1>
      <PreferenceControls />
      <ActionsSection />
      <FormsSection />
      <DisplaySection />
      <OverlaySection />
      <NavigationDataSection />
      <BehaviorSection />
    </main>
  );
}
