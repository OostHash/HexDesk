import type { TreeNode } from "../../primitives/data";

/** Foundry recipe tree with all four statuses. */
export const foundryTree: TreeNode[] = [
  {
    key: "excalibur-prime",
    label: "Excalibur Prime",
    status: "partial",
    children: [
      { key: "excalibur-prime-bp", label: "Blueprint", status: "owned" },
      {
        key: "excalibur-prime-chassis",
        label: "Chassis",
        status: "craftable",
        count: 1,
        children: [
          { key: "chassis-bp", label: "Chassis Blueprint", status: "owned" },
          { key: "chassis-ferrite", label: "Ferrite", status: "owned", count: 1000 },
          { key: "chassis-morphics", label: "Morphics", status: "owned", count: 2 },
        ],
      },
      {
        key: "excalibur-prime-neuroptics",
        label: "Neuroptics",
        status: "missing",
        children: [
          { key: "neuroptics-bp", label: "Neuroptics Blueprint", status: "missing" },
          { key: "neuroptics-neurodes", label: "Neurodes", status: "partial", count: 3 },
        ],
      },
      { key: "excalibur-prime-systems", label: "Systems", status: "owned" },
    ],
  },
  {
    key: "braton-prime",
    label: "Braton Prime",
    status: "craftable",
    children: [
      { key: "braton-bp", label: "Blueprint", status: "owned" },
      { key: "braton-barrel", label: "Barrel", status: "owned" },
    ],
  },
];
