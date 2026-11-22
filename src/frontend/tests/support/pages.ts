/** Frontend pages served by mock.html, shared by visual and a11y specs. */
export type LabPage = {
  name: string;
  path: string;
  /**
   * Transparent overlay window: in the app it sits over the game, in the test
   * browser over white. Colour contrast cannot be judged there.
   */
  transparent?: boolean;
};

export const PAGES: readonly LabPage[] = [
  { name: "kitchen-sink", path: "/mock.html?view=kitchen-sink" },
  { name: "tokens", path: "/mock.html?view=tokens" },
  { name: "shell-main", path: "/mock.html" },
  { name: "shell-onboarding", path: "/mock.html?scenario=onboarding" },
  { name: "shell-modular", path: "/mock.html?window=modular" },
];
