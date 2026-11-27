// Ninerr Native Component Library: 41 editable, token-bound, WCAG-AA accessible
// component blueprints across 8 categories. Zero external dependencies, Apache-2.0,
// instantiable into any Ninerr document as reusable component definitions or editable layers.

export const NINERR_COMPONENT_CATEGORIES = Object.freeze([
  "basic",
  "forms",
  "navigation",
  "data-display",
  "interactive",
  "product-compositions",
  "marketing-compositions",
  "advanced",
]);

const BASE_TOKENS = Object.freeze([
  "--bg-canvas",
  "--bg-surface",
  "--bg-subtle",
  "--text-primary",
  "--text-muted",
  "--border-subtle",
  "--accent-primary",
  "--accent-contrast",
  "--status-success",
  "--status-warning",
  "--status-danger",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--shadow-sm",
  "--shadow-md",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-6",
  "--font-heading",
  "--font-body",
  "--font-mono",
  "--duration-fast",
  "--ease-out",
]);

function el(tag, name, { text, attributes, style, stylesheet, children } = {}) {
  return Object.freeze({
    type: "element",
    tag,
    name,
    ...(text !== undefined ? { text } : {}),
    ...(attributes ? { attributes: Object.freeze({ ...attributes }) } : {}),
    ...(style ? { style: Object.freeze({ ...style }) } : {}),
    ...(stylesheet ? { stylesheet } : {}),
    children: Object.freeze(children ?? []),
  });
}

const INTERACTIVE_STYLESHEET = [
  ".ninerr-interactive:focus-visible { outline: 2px solid var(--accent-primary, #0f766e); outline-offset: 2px; }",
  ".ninerr-interactive { transition: opacity var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)), transform var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)), background-color var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)); }",
  ".ninerr-interactive:active { transform: scale(0.98); }",
  "@media (prefers-reduced-motion: reduce) { .ninerr-interactive { transition-duration: 0.01ms !important; transform: none !important; } }",
].join("\n");

const CARD_STYLE = {
  display: "flex",
  "flex-direction": "column",
  gap: "var(--space-3, 12px)",
  padding: "var(--space-4, 20px)",
  "background-color": "var(--bg-surface, #ffffff)",
  color: "var(--text-primary, #0f172a)",
  border: "1px solid var(--border-subtle, #e2e8f0)",
  "border-radius": "var(--radius-md, 10px)",
  "box-shadow": "var(--shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06))",
  "font-family": "var(--font-body, Inter, system-ui, sans-serif)",
};

const INPUT_STYLE = {
  height: "40px",
  padding: "0 12px",
  "background-color": "var(--bg-surface, #ffffff)",
  color: "var(--text-primary, #0f172a)",
  border: "1px solid var(--border-subtle, #cbd5e1)",
  "border-radius": "var(--radius-sm, 6px)",
  "font-size": "14px",
  "font-family": "var(--font-body, Inter, system-ui, sans-serif)",
};

const PRIMARY_BTN_STYLE = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  gap: "8px",
  "min-height": "40px",
  padding: "0 16px",
  "background-color": "var(--accent-primary, #0f766e)",
  color: "var(--accent-contrast, #ffffff)",
  border: "1px solid transparent",
  "border-radius": "var(--radius-sm, 6px)",
  "font-size": "14px",
  "font-weight": "600",
  cursor: "pointer",
  "font-family": "var(--font-body, Inter, system-ui, sans-serif)",
};

const SECONDARY_BTN_STYLE = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  gap: "8px",
  "min-height": "40px",
  padding: "0 16px",
  "background-color": "var(--bg-surface, #ffffff)",
  color: "var(--text-primary, #0f172a)",
  border: "1px solid var(--border-subtle, #cbd5e1)",
  "border-radius": "var(--radius-sm, 6px)",
  "font-size": "14px",
  "font-weight": "500",
  cursor: "pointer",
  "font-family": "var(--font-body, Inter, system-ui, sans-serif)",
};

function def(id, name, category, summary, { variants = ["default"], tokens = BASE_TOKENS.slice(0, 8), accessibility, build }) {
  return Object.freeze({
    id,
    name,
    category,
    source: "ninerr",
    license: "Apache-2.0",
    summary,
    variants: Object.freeze([...variants]),
    tokens: Object.freeze([...tokens]),
    accessibility: Object.freeze({ ...accessibility }),
    build,
  });
}

const RAW_COMPONENTS = [
  // ---- 1. BASIC (6) ---------------------------------------------------------
  def("button", "Button", "basic", "Accessible action button with primary, secondary, and ghost variants plus focus-visible and tactile press feedback.", {
    variants: ["primary", "secondary", "ghost", "danger"],
    accessibility: { role: "button", keyboard: "Enter and Space activate", focusVisible: true },
    build: ({ label = "Continue", variant = "primary" } = {}) => {
      const style = variant === "secondary"
        ? SECONDARY_BTN_STYLE
        : variant === "ghost"
          ? { ...SECONDARY_BTN_STYLE, "background-color": "transparent", border: "1px solid transparent" }
          : variant === "danger"
            ? { ...PRIMARY_BTN_STYLE, "background-color": "var(--status-danger, #b91c1c)", color: "#ffffff" }
            : PRIMARY_BTN_STYLE;
      return el("button", "Button", {
        text: label,
        attributes: { type: "button", class: "ninerr-interactive" },
        style,
        stylesheet: INTERACTIVE_STYLESHEET,
      });
    },
  }),
  def("badge", "Badge", "basic", "Compact semantic status label with readable AA contrast.", {
    variants: ["neutral", "accent", "success", "warning", "danger"],
    accessibility: { role: "status", nonColorCue: "Always includes explicit status text" },
    build: ({ label = "Active", variant = "neutral" } = {}) => {
      const tones = {
        neutral: { bg: "var(--bg-subtle, #f1f5f9)", fg: "var(--text-primary, #0f172a)" },
        accent: { bg: "var(--accent-primary, #0f766e)", fg: "var(--accent-contrast, #ffffff)" },
        success: { bg: "#dcfce7", fg: "#166534" },
        warning: { bg: "#fef3c7", fg: "#92400e" },
        danger: { bg: "#fee2e2", fg: "#991b1b" },
      };
      const tone = tones[variant] ?? tones.neutral;
      return el("span", "Badge", {
        text: label,
        style: {
          display: "inline-flex",
          "align-items": "center",
          padding: "2px 10px",
          "border-radius": "9999px",
          "background-color": tone.bg,
          color: tone.fg,
          "font-size": "12px",
          "font-weight": "600",
          "line-height": "1.5",
        },
      });
    },
  }),
  def("avatar", "Avatar", "basic", "Accessible initials or profile identity avatar circle.", {
    variants: ["sm", "md", "lg"],
    accessibility: { role: "img", label: "aria-label names the represented person or entity" },
    build: ({ initials = "NR", label = "Team member", variant = "md" } = {}) => {
      const size = variant === "sm" ? "32px" : variant === "lg" ? "52px" : "40px";
      return el("div", "Avatar", {
        text: initials,
        attributes: { role: "img", "aria-label": label },
        style: {
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          width: size,
          height: size,
          "border-radius": "9999px",
          "background-color": "var(--bg-subtle, #e2e8f0)",
          color: "var(--text-primary, #0f172a)",
          border: "1px solid var(--border-subtle, #cbd5e1)",
          "font-size": variant === "sm" ? "12px" : "14px",
          "font-weight": "600",
        },
      });
    },
  }),
  def("card", "Card", "basic", "Structured content container with subtle hairline border and calm elevation.", {
    variants: ["default", "subtle"],
    accessibility: { landmark: "article", heading: "h3 title hierarchy" },
    build: ({ title = "Workspace Overview", body = "Monitor active systems, inspect token coverage, and review updates in one place.", variant = "default" } = {}) => el("article", "Card", {
      style: variant === "subtle" ? { ...CARD_STYLE, "background-color": "var(--bg-subtle, #f8fafc)", "box-shadow": "none" } : CARD_STYLE,
      children: [
        el("h3", "Card Title", { text: title, style: { margin: "0", "font-size": "18px", "font-weight": "600", "line-height": "1.3", "font-family": "var(--font-heading, Inter, system-ui, sans-serif)" } }),
        el("p", "Card Body", { text: body, style: { margin: "0", "font-size": "14px", "line-height": "1.6", color: "var(--text-muted, #475569)" } }),
      ],
    }),
  }),
  def("divider", "Divider", "basic", "Subtle 1px structural separator between content sections.", {
    variants: ["horizontal"],
    accessibility: { role: "separator" },
    build: () => el("hr", "Divider", {
      attributes: { role: "separator" },
      style: { width: "100%", border: "0", "border-top": "1px solid var(--border-subtle, #e2e8f0)", margin: "var(--space-4, 16px) 0" },
    }),
  }),
  def("skeleton", "Skeleton Loader", "basic", "Reduced-motion-safe content loading placeholder.", {
    variants: ["text", "card"],
    accessibility: { ariaBusy: "true", ariaLive: "polite", reducedMotion: true },
    build: ({ label = "Loading content" } = {}) => el("div", "Skeleton", {
      attributes: { role: "status", "aria-busy": "true", "aria-label": label, class: "ninerr-skeleton" },
      style: { display: "flex", "flex-direction": "column", gap: "10px", padding: "16px", "border-radius": "var(--radius-md, 10px)", border: "1px solid var(--border-subtle, #e2e8f0)" },
      stylesheet: "@keyframes ninerr-skel { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.85; } }\n.ninerr-skeleton > div { animation: ninerr-skel 1400ms ease-in-out infinite; }\n@media (prefers-reduced-motion: reduce) { .ninerr-skeleton > div { animation: none !important; opacity: 0.7; } }",
      children: [
        el("div", "Skeleton Title", { style: { height: "18px", width: "45%", "border-radius": "4px", "background-color": "var(--bg-subtle, #e2e8f0)" } }),
        el("div", "Skeleton Line 1", { style: { height: "14px", width: "92%", "border-radius": "4px", "background-color": "var(--bg-subtle, #e2e8f0)" } }),
        el("div", "Skeleton Line 2", { style: { height: "14px", width: "74%", "border-radius": "4px", "background-color": "var(--bg-subtle, #e2e8f0)" } }),
      ],
    }),
  }),

  // ---- 2. FORMS (7) ---------------------------------------------------------
  def("input-field", "Input Field", "forms", "Labeled text input with visible label, helper text, and accessible focus ring.", {
    variants: ["text", "email", "search"],
    accessibility: { labelAssociation: "explicit label for/id", targetHeight: "40px" },
    build: ({ label = "Work email", placeholder = "name@company.com", helper = "We only use this for workspace alerts.", variant = "email" } = {}) => el("div", "Input Field", {
      style: { display: "flex", "flex-direction": "column", gap: "6px", "font-family": "var(--font-body, Inter, system-ui, sans-serif)" },
      children: [
        el("label", "Field Label", { text: label, attributes: { for: "field-input" }, style: { "font-size": "13px", "font-weight": "600", color: "var(--text-primary, #0f172a)" } }),
        el("input", "Text Input", { attributes: { id: "field-input", type: variant, placeholder, class: "ninerr-interactive" }, style: INPUT_STYLE, stylesheet: INTERACTIVE_STYLESHEET }),
        el("span", "Helper Text", { text: helper, style: { "font-size": "12px", color: "var(--text-muted, #475569)" } }),
      ],
    }),
  }),
  def("textarea-field", "Textarea Field", "forms", "Multi-line labeled text area for structured descriptions and notes.", {
    variants: ["default"],
    accessibility: { labelAssociation: "explicit label for/id" },
    build: ({ label = "Project notes", placeholder = "Describe goals, audience, and constraints..." } = {}) => el("div", "Textarea Field", {
      style: { display: "flex", "flex-direction": "column", gap: "6px" },
      children: [
        el("label", "Textarea Label", { text: label, attributes: { for: "field-textarea" }, style: { "font-size": "13px", "font-weight": "600", color: "var(--text-primary, #0f172a)" } }),
        el("textarea", "Textarea", { attributes: { id: "field-textarea", rows: "4", placeholder, class: "ninerr-interactive" }, style: { ...INPUT_STYLE, height: "auto", padding: "10px 12px", "line-height": "1.5" }, stylesheet: INTERACTIVE_STYLESHEET }),
      ],
    }),
  }),
  def("select-field", "Select Field", "forms", "Native accessible dropdown selector bound to form tokens.", {
    variants: ["default"],
    accessibility: { labelAssociation: "explicit label for/id", keyboard: "Native select keyboard support" },
    build: ({ label = "Environment" } = {}) => el("div", "Select Field", {
      style: { display: "flex", "flex-direction": "column", gap: "6px" },
      children: [
        el("label", "Select Label", { text: label, attributes: { for: "field-select" }, style: { "font-size": "13px", "font-weight": "600", color: "var(--text-primary, #0f172a)" } }),
        el("select", "Select Control", {
          attributes: { id: "field-select", class: "ninerr-interactive" },
          style: INPUT_STYLE,
          stylesheet: INTERACTIVE_STYLESHEET,
          children: [
            el("option", "Option Production", { text: "Production", attributes: { value: "production" } }),
            el("option", "Option Staging", { text: "Staging", attributes: { value: "staging" } }),
            el("option", "Option Local", { text: "Local Development", attributes: { value: "local" } }),
          ],
        }),
      ],
    }),
  }),
  def("checkbox-field", "Checkbox Field", "forms", "Accessible labeled checkbox with generous click area.", {
    variants: ["default"],
    accessibility: { labelAssociation: "wrapping label", targetHeight: "32px" },
    build: ({ label = "Enable weekly design-system drift summaries" } = {}) => el("label", "Checkbox Field", {
      style: { display: "inline-flex", "align-items": "center", gap: "10px", "min-height": "32px", cursor: "pointer", "font-size": "14px", color: "var(--text-primary, #0f172a)" },
      children: [
        el("input", "Checkbox Input", { attributes: { type: "checkbox", class: "ninerr-interactive" }, style: { width: "18px", height: "18px" }, stylesheet: INTERACTIVE_STYLESHEET }),
        el("span", "Checkbox Label", { text: label }),
      ],
    }),
  }),
  def("switch-control", "Switch Control", "forms", "Accessible role=switch boolean toggle control.", {
    variants: ["off", "on"],
    accessibility: { role: "switch", ariaChecked: "explicit true or false", keyboard: "Space toggles" },
    build: ({ label = "Automatic dark mode", variant = "on" } = {}) => {
      const checked = variant === "on";
      return el("div", "Switch Row", {
        style: { display: "flex", "align-items": "center", "justify-content": "space-between", gap: "16px", padding: "8px 0" },
        children: [
          el("span", "Switch Label", { text: label, style: { "font-size": "14px", "font-weight": "500", color: "var(--text-primary, #0f172a)" } }),
          el("button", "Switch Toggle", {
            attributes: { type: "button", role: "switch", "aria-checked": checked ? "true" : "false", "aria-label": label, class: "ninerr-interactive" },
            style: {
              display: "inline-flex",
              "align-items": "center",
              "justify-content": checked ? "flex-end" : "flex-start",
              width: "44px",
              height: "24px",
              padding: "2px",
              "border-radius": "9999px",
              border: "1px solid transparent",
              "background-color": checked ? "var(--accent-primary, #0f766e)" : "var(--border-subtle, #cbd5e1)",
              cursor: "pointer",
            },
            stylesheet: INTERACTIVE_STYLESHEET,
            children: [
              el("span", "Switch Thumb", { style: { width: "18px", height: "18px", "border-radius": "9999px", "background-color": "#ffffff" } }),
            ],
          }),
        ],
      });
    },
  }),
  def("radio-group", "Radio Group", "forms", "Semantic fieldset and legend radio choice group.", {
    variants: ["default"],
    accessibility: { landmark: "fieldset + legend", keyboard: "Arrow keys move selection" },
    build: ({ legend = "Interface density" } = {}) => el("fieldset", "Radio Group", {
      style: { display: "flex", "flex-direction": "column", gap: "8px", border: "1px solid var(--border-subtle, #e2e8f0)", "border-radius": "var(--radius-md, 10px)", padding: "16px" },
      children: [
        el("legend", "Radio Legend", { text: legend, style: { padding: "0 6px", "font-size": "13px", "font-weight": "600", color: "var(--text-primary, #0f172a)" } }),
        ...["Compact", "Balanced", "Spacious"].map((opt, idx) => el("label", `Radio ${opt}`, {
          style: { display: "inline-flex", "align-items": "center", gap: "8px", "min-height": "32px", "font-size": "14px", color: "var(--text-primary, #0f172a)" },
          children: [
            el("input", `Radio Input ${opt}`, { attributes: { type: "radio", name: "density", value: opt.toLowerCase(), ...(idx === 1 ? { checked: "checked" } : {}) }, style: { width: "16px", height: "16px" } }),
            el("span", `Radio Text ${opt}`, { text: opt }),
          ],
        })),
      ],
    }),
  }),
  def("form-section", "Form Section", "forms", "Complete structured form card with fields and clear primary/secondary action footer.", {
    variants: ["default"],
    accessibility: { landmark: "section role=form", actionHierarchy: "Single primary submit button" },
    build: ({ title = "Workspace Profile" } = {}) => el("section", "Form Section", {
      attributes: { role: "form", "aria-label": title },
      style: CARD_STYLE,
      children: [
        el("h3", "Form Heading", { text: title, style: { margin: "0", "font-size": "18px", "font-weight": "600" } }),
        el("label", "Name Label", { text: "Workspace name", attributes: { for: "ws-name" }, style: { "font-size": "13px", "font-weight": "600" } }),
        el("input", "Name Input", { attributes: { id: "ws-name", type: "text", value: "Acme Design System" }, style: INPUT_STYLE }),
        el("div", "Form Actions", {
          style: { display: "flex", "justify-content": "flex-end", gap: "12px", "margin-top": "8px" },
          children: [
            el("button", "Cancel", { text: "Cancel", attributes: { type: "button", class: "ninerr-interactive" }, style: SECONDARY_BTN_STYLE }),
            el("button", "Save", { text: "Save changes", attributes: { type: "submit", class: "ninerr-interactive" }, style: PRIMARY_BTN_STYLE }),
          ],
        }),
      ],
    }),
  }),

  // ---- 3. NAVIGATION (5) ----------------------------------------------------
  def("navbar", "Navigation Bar", "navigation", "Responsive semantic top header with brand anchor, navigation links, and single primary CTA.", {
    variants: ["default"],
    accessibility: { landmark: "header + nav", ariaLabel: "Primary navigation" },
    build: ({ brand = "Ninerr" } = {}) => el("header", "Navbar", {
      style: {
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        gap: "24px",
        padding: "14px 24px",
        "background-color": "var(--bg-surface, #ffffff)",
        "border-bottom": "1px solid var(--border-subtle, #e2e8f0)",
        "font-family": "var(--font-body, Inter, system-ui, sans-serif)",
      },
      children: [
        el("a", "Brand Link", { text: brand, attributes: { href: "#top" }, style: { "font-size": "16px", "font-weight": "700", color: "var(--text-primary, #0f172a)", "text-decoration": "none" } }),
        el("nav", "Primary Links", {
          attributes: { "aria-label": "Primary" },
          style: { display: "flex", "align-items": "center", gap: "20px" },
          children: [
            el("a", "Nav Overview", { text: "Overview", attributes: { href: "#overview" }, style: { "font-size": "14px", color: "var(--text-primary, #0f172a)", "text-decoration": "none", "font-weight": "500" } }),
            el("a", "Nav Systems", { text: "Systems", attributes: { href: "#systems" }, style: { "font-size": "14px", color: "var(--text-muted, #475569)", "text-decoration": "none" } }),
            el("a", "Nav Docs", { text: "Docs", attributes: { href: "#docs" }, style: { "font-size": "14px", color: "var(--text-muted, #475569)", "text-decoration": "none" } }),
          ],
        }),
        el("button", "Nav CTA", { text: "Get started", attributes: { type: "button", class: "ninerr-interactive" }, style: PRIMARY_BTN_STYLE, stylesheet: INTERACTIVE_STYLESHEET }),
      ],
    }),
  }),
  def("sidebar-nav", "Sidebar Navigation", "navigation", "Structured vertical application rail with clear active state.", {
    variants: ["default"],
    accessibility: { landmark: "aside + nav", currentPage: "aria-current=page" },
    build: () => el("aside", "Sidebar", {
      style: {
        display: "flex",
        "flex-direction": "column",
        gap: "4px",
        width: "240px",
        padding: "16px",
        "background-color": "var(--bg-subtle, #f8fafc)",
        "border-right": "1px solid var(--border-subtle, #e2e8f0)",
      },
      children: [
        el("nav", "Sidebar Links", {
          attributes: { "aria-label": "Workspace navigation" },
          style: { display: "flex", "flex-direction": "column", gap: "4px" },
          children: [
            el("a", "Nav Dashboard", { text: "Dashboard", attributes: { href: "#dashboard", "aria-current": "page" }, style: { padding: "8px 12px", "border-radius": "6px", "background-color": "var(--bg-surface, #ffffff)", color: "var(--text-primary, #0f172a)", "font-size": "14px", "font-weight": "600", "text-decoration": "none", border: "1px solid var(--border-subtle, #e2e8f0)" } }),
            el("a", "Nav Components", { text: "Components", attributes: { href: "#components" }, style: { padding: "8px 12px", "border-radius": "6px", color: "var(--text-muted, #475569)", "font-size": "14px", "text-decoration": "none" } }),
            el("a", "Nav Tokens", { text: "Tokens", attributes: { href: "#tokens" }, style: { padding: "8px 12px", "border-radius": "6px", color: "var(--text-muted, #475569)", "font-size": "14px", "text-decoration": "none" } }),
            el("a", "Nav Settings", { text: "Settings", attributes: { href: "#settings" }, style: { padding: "8px 12px", "border-radius": "6px", color: "var(--text-muted, #475569)", "font-size": "14px", "text-decoration": "none" } }),
          ],
        }),
      ],
    }),
  }),
  def("tabs", "Tabs", "navigation", "Accessible ARIA tablist and tabpanel switcher.", {
    variants: ["underline", "segmented"],
    accessibility: { role: "tablist + tab + tabpanel", ariaSelected: true },
    build: () => el("div", "Tabs", {
      style: { display: "flex", "flex-direction": "column", gap: "16px" },
      children: [
        el("div", "Tablist", {
          attributes: { role: "tablist", "aria-label": "View sections" },
          style: { display: "flex", gap: "4px", "border-bottom": "1px solid var(--border-subtle, #e2e8f0)" },
          children: [
            el("button", "Tab Overview", { text: "Overview", attributes: { type: "button", role: "tab", "aria-selected": "true" }, style: { padding: "10px 14px", "background-color": "transparent", border: "0", "border-bottom": "2px solid var(--accent-primary, #0f766e)", color: "var(--text-primary, #0f172a)", "font-size": "14px", "font-weight": "600", cursor: "pointer" } }),
            el("button", "Tab Tokens", { text: "Tokens", attributes: { type: "button", role: "tab", "aria-selected": "false" }, style: { padding: "10px 14px", "background-color": "transparent", border: "0", color: "var(--text-muted, #475569)", "font-size": "14px", cursor: "pointer" } }),
            el("button", "Tab Audit", { text: "Audit", attributes: { type: "button", role: "tab", "aria-selected": "false" }, style: { padding: "10px 14px", "background-color": "transparent", border: "0", color: "var(--text-muted, #475569)", "font-size": "14px", cursor: "pointer" } }),
          ],
        }),
        el("div", "Tab Panel", { attributes: { role: "tabpanel" }, text: "Overview metrics and current release status.", style: { "font-size": "14px", color: "var(--text-muted, #475569)" } }),
      ],
    }),
  }),
  def("breadcrumbs", "Breadcrumbs", "navigation", "Accessible hierarchical breadcrumb trail.", {
    variants: ["default"],
    accessibility: { landmark: "nav aria-label=Breadcrumb", currentPage: "aria-current=page" },
    build: () => el("nav", "Breadcrumbs", {
      attributes: { "aria-label": "Breadcrumb" },
      children: [
        el("ol", "Breadcrumb List", {
          style: { display: "flex", "align-items": "center", gap: "8px", margin: "0", padding: "0", "list-style": "none", "font-size": "13px" },
          children: [
            el("li", "Crumb 1", { children: [el("a", "Home Link", { text: "Workspace", attributes: { href: "#workspace" }, style: { color: "var(--text-muted, #475569)", "text-decoration": "none" } })] }),
            el("li", "Sep 1", { text: ">", attributes: { "aria-hidden": "true" }, style: { color: "var(--text-muted, #94a3b8)" } }),
            el("li", "Crumb 2", { text: "Design Tokens", attributes: { "aria-current": "page" }, style: { color: "var(--text-primary, #0f172a)", "font-weight": "600" } }),
          ],
        }),
      ],
    }),
  }),
  def("pagination", "Pagination", "navigation", "Compact accessible page switcher with previous and next controls.", {
    variants: ["default"],
    accessibility: { landmark: "nav aria-label=Pagination", currentPage: "aria-current=page" },
    build: () => el("nav", "Pagination", {
      attributes: { "aria-label": "Pagination" },
      style: { display: "flex", "align-items": "center", gap: "8px" },
      children: [
        el("button", "Prev Page", { text: "Previous", attributes: { type: "button" }, style: SECONDARY_BTN_STYLE }),
        el("button", "Page 1", { text: "1", attributes: { type: "button", "aria-current": "page" }, style: PRIMARY_BTN_STYLE }),
        el("button", "Page 2", { text: "2", attributes: { type: "button" }, style: SECONDARY_BTN_STYLE }),
        el("button", "Next Page", { text: "Next", attributes: { type: "button" }, style: SECONDARY_BTN_STYLE }),
      ],
    }),
  }),

  // ---- 4. DATA DISPLAY (5) --------------------------------------------------
  def("kpi-card", "KPI Metric Card", "data-display", "High-signal metric card with tabular numerals and explicit directional delta.", {
    variants: ["default"],
    accessibility: { tabularNums: true, nonColorDelta: "Explicit + or - sign paired with label" },
    build: ({ label = "Monthly Active Teams", value = "14,280", delta = "+12.4% vs last 30d" } = {}) => el("article", "KPI Card", {
      style: CARD_STYLE,
      children: [
        el("span", "KPI Label", { text: label, style: { "font-size": "13px", "font-weight": "500", color: "var(--text-muted, #475569)" } }),
        el("strong", "KPI Value", { text: value, style: { "font-size": "28px", "font-weight": "700", "line-height": "1.1", "font-variant-numeric": "tabular-nums", color: "var(--text-primary, #0f172a)" } }),
        el("span", "KPI Delta", { text: delta, style: { "font-size": "12px", "font-weight": "600", color: "var(--status-success, #15803d)" } }),
      ],
    }),
  }),
  def("data-table", "Data Table", "data-display", "Semantic HTML table with header scope, tabular figures, and crisp row dividers.", {
    variants: ["default"],
    accessibility: { tableHeaders: "th scope=col", tabularNums: true },
    build: () => el("div", "Table Wrapper", {
      style: { "overflow-x": "auto", border: "1px solid var(--border-subtle, #e2e8f0)", "border-radius": "var(--radius-md, 10px)", "background-color": "var(--bg-surface, #ffffff)" },
      children: [
        el("table", "Data Table", {
          style: { width: "100%", "border-collapse": "collapse", "font-size": "14px", "text-align": "left" },
          children: [
            el("thead", "Table Head", {
              style: { "background-color": "var(--bg-subtle, #f8fafc)", "border-bottom": "1px solid var(--border-subtle, #e2e8f0)" },
              children: [
                el("tr", "Head Row", {
                  children: [
                    el("th", "Col Service", { text: "Service", attributes: { scope: "col" }, style: { padding: "12px 16px", "font-weight": "600", color: "var(--text-muted, #475569)" } }),
                    el("th", "Col Status", { text: "Status", attributes: { scope: "col" }, style: { padding: "12px 16px", "font-weight": "600", color: "var(--text-muted, #475569)" } }),
                    el("th", "Col Latency", { text: "P95 Latency", attributes: { scope: "col" }, style: { padding: "12px 16px", "font-weight": "600", "text-align": "right", color: "var(--text-muted, #475569)" } }),
                  ],
                }),
              ],
            }),
            el("tbody", "Table Body", {
              children: [
                el("tr", "Row 1", {
                  style: { "border-bottom": "1px solid var(--border-subtle, #e2e8f0)" },
                  children: [
                    el("td", "Cell 1A", { text: "Design Engine", style: { padding: "12px 16px", "font-weight": "500" } }),
                    el("td", "Cell 1B", { text: "Healthy", style: { padding: "12px 16px", color: "var(--status-success, #15803d)", "font-weight": "600" } }),
                    el("td", "Cell 1C", { text: "18 ms", style: { padding: "12px 16px", "text-align": "right", "font-variant-numeric": "tabular-nums" } }),
                  ],
                }),
                el("tr", "Row 2", {
                  children: [
                    el("td", "Cell 2A", { text: "Token Compiler", style: { padding: "12px 16px", "font-weight": "500" } }),
                    el("td", "Cell 2B", { text: "Healthy", style: { padding: "12px 16px", color: "var(--status-success, #15803d)", "font-weight": "600" } }),
                    el("td", "Cell 2C", { text: "6 ms", style: { padding: "12px 16px", "text-align": "right", "font-variant-numeric": "tabular-nums" } }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  }),
  def("metric-strip", "Metric Strip", "data-display", "Horizontal multi-metric summary row separated by clean hairlines.", {
    variants: ["default"],
    accessibility: { tabularNums: true },
    build: () => el("section", "Metric Strip", {
      attributes: { "aria-label": "Key metrics" },
      style: { display: "grid", "grid-template-columns": "repeat(3, minmax(0, 1fr))", gap: "16px", padding: "20px", "background-color": "var(--bg-surface, #ffffff)", border: "1px solid var(--border-subtle, #e2e8f0)", "border-radius": "var(--radius-md, 10px)" },
      children: [
        el("div", "Stat 1", { children: [el("div", "Label 1", { text: "Contrast Pass", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } }), el("div", "Val 1", { text: "100%", style: { "font-size": "24px", "font-weight": "700", "font-variant-numeric": "tabular-nums" } })] }),
        el("div", "Stat 2", { children: [el("div", "Label 2", { text: "Token Coverage", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } }), el("div", "Val 2", { text: "96%", style: { "font-size": "24px", "font-weight": "700", "font-variant-numeric": "tabular-nums" } })] }),
        el("div", "Stat 3", { children: [el("div", "Label 3", { text: "Components", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } }), el("div", "Val 3", { text: "41", style: { "font-size": "24px", "font-weight": "700", "font-variant-numeric": "tabular-nums" } })] }),
      ],
    }),
  }),
  def("timeline-list", "Timeline List", "data-display", "Chronological audit or activity feed using semantic ordered lists.", {
    variants: ["default"],
    accessibility: { landmark: "ol semantic list" },
    build: () => el("ol", "Timeline", {
      style: { display: "flex", "flex-direction": "column", gap: "16px", margin: "0", padding: "0 0 0 16px", "border-left": "2px solid var(--border-subtle, #e2e8f0)", "list-style": "none" },
      children: [
        el("li", "Event 1", { children: [el("strong", "E1 Title", { text: "Design brief updated", style: { display: "block", "font-size": "14px" } }), el("span", "E1 Meta", { text: "2 minutes ago - Architecture team", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } })] }),
        el("li", "Event 2", { children: [el("strong", "E2 Title", { text: "Dark mode tokens verified", style: { display: "block", "font-size": "14px" } }), el("span", "E2 Meta", { text: "14 minutes ago - WCAG AA passed", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } })] }),
      ],
    }),
  }),
  def("empty-state", "Empty State", "data-display", "Helpful, calm empty state guiding users directly to the next meaningful action.", {
    variants: ["default"],
    accessibility: { heading: "h3 heading + clear action button" },
    build: ({ title = "No projects yet", description = "Create your first design system or import an existing frontend component to get started.", cta = "Create project" } = {}) => el("section", "Empty State", {
      style: { ...CARD_STYLE, "align-items": "center", "text-align": "center", padding: "40px 24px" },
      children: [
        el("h3", "Empty Title", { text: title, style: { margin: "0", "font-size": "18px", "font-weight": "600" } }),
        el("p", "Empty Copy", { text: description, style: { margin: "0", "max-width": "420px", "font-size": "14px", "line-height": "1.6", color: "var(--text-muted, #475569)" } }),
        el("button", "Empty Action", { text: cta, attributes: { type: "button", class: "ninerr-interactive" }, style: PRIMARY_BTN_STYLE, stylesheet: INTERACTIVE_STYLESHEET }),
      ],
    }),
  }),

  // ---- 5. INTERACTIVE (5) ---------------------------------------------------
  def("dialog-modal", "Dialog Modal", "interactive", "Accessible modal dialog with aria-modal, clear title, and explicit confirm/cancel actions.", {
    variants: ["default", "destructive"],
    accessibility: { role: "dialog", ariaModal: "true", ariaLabelledby: "dialog-title" },
    build: ({ title = "Publish token updates", body = "Apply 12 semantic token changes across light and dark modes?", variant = "default" } = {}) => el("section", "Dialog Modal", {
      attributes: { role: "dialog", "aria-modal": "true", "aria-labelledby": "dialog-title" },
      style: { ...CARD_STYLE, "max-width": "460px", "box-shadow": "var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.12))", "border-radius": "var(--radius-lg, 14px)" },
      children: [
        el("h2", "Dialog Title", { text: title, attributes: { id: "dialog-title" }, style: { margin: "0", "font-size": "18px", "font-weight": "600" } }),
        el("p", "Dialog Body", { text: body, style: { margin: "0", "font-size": "14px", "line-height": "1.6", color: "var(--text-muted, #475569)" } }),
        el("div", "Dialog Actions", {
          style: { display: "flex", "justify-content": "flex-end", gap: "10px", "margin-top": "8px" },
          children: [
            el("button", "Dialog Cancel", { text: "Cancel", attributes: { type: "button" }, style: SECONDARY_BTN_STYLE }),
            el("button", "Dialog Confirm", {
              text: variant === "destructive" ? "Delete" : "Confirm",
              attributes: { type: "button", class: "ninerr-interactive" },
              style: variant === "destructive" ? { ...PRIMARY_BTN_STYLE, "background-color": "var(--status-danger, #b91c1c)", color: "#ffffff" } : PRIMARY_BTN_STYLE,
            }),
          ],
        }),
      ],
    }),
  }),
  def("drawer-sheet", "Drawer Sheet", "interactive", "Slide-over inspection drawer with header, scrollable body, and close control.", {
    variants: ["right"],
    accessibility: { role: "dialog", ariaModal: "true", closeLabel: "aria-label=Close drawer" },
    build: ({ title = "Layer Inspector" } = {}) => el("aside", "Drawer Sheet", {
      attributes: { role: "dialog", "aria-modal": "true", "aria-label": title },
      style: { display: "flex", "flex-direction": "column", gap: "16px", width: "360px", padding: "20px", "background-color": "var(--bg-surface, #ffffff)", "border-left": "1px solid var(--border-subtle, #e2e8f0)", "box-shadow": "var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.12))" },
      children: [
        el("div", "Drawer Header", {
          style: { display: "flex", "align-items": "center", "justify-content": "space-between" },
          children: [
            el("h3", "Drawer Title", { text: title, style: { margin: "0", "font-size": "16px", "font-weight": "600" } }),
            el("button", "Drawer Close", { text: "Close", attributes: { type: "button", "aria-label": "Close drawer" }, style: SECONDARY_BTN_STYLE }),
          ],
        }),
        el("p", "Drawer Content", { text: "Inspect tokens, spacing, and accessibility attributes for the selected node.", style: { margin: "0", "font-size": "14px", color: "var(--text-muted, #475569)" } }),
      ],
    }),
  }),
  def("dropdown-menu", "Dropdown Menu", "interactive", "Accessible menu panel with explicit menuitem roles.", {
    variants: ["default"],
    accessibility: { role: "menu + menuitem", keyboard: "Arrow keys navigate items" },
    build: () => el("div", "Dropdown Menu", {
      attributes: { role: "menu", "aria-label": "Layer actions" },
      style: { display: "flex", "flex-direction": "column", gap: "2px", width: "220px", padding: "6px", "background-color": "var(--bg-surface, #ffffff)", border: "1px solid var(--border-subtle, #e2e8f0)", "border-radius": "var(--radius-md, 10px)", "box-shadow": "var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.1))" },
      children: [
        el("button", "Item Duplicate", { text: "Duplicate layer", attributes: { type: "button", role: "menuitem" }, style: { "text-align": "left", padding: "8px 10px", border: "0", "border-radius": "6px", "background-color": "transparent", color: "var(--text-primary, #0f172a)", "font-size": "13px", cursor: "pointer" } }),
        el("button", "Item Export", { text: "Export TSX", attributes: { type: "button", role: "menuitem" }, style: { "text-align": "left", padding: "8px 10px", border: "0", "border-radius": "6px", "background-color": "transparent", color: "var(--text-primary, #0f172a)", "font-size": "13px", cursor: "pointer" } }),
        el("button", "Item Delete", { text: "Delete layer", attributes: { type: "button", role: "menuitem" }, style: { "text-align": "left", padding: "8px 10px", border: "0", "border-radius": "6px", "background-color": "transparent", color: "var(--status-danger, #b91c1c)", "font-size": "13px", cursor: "pointer" } }),
      ],
    }),
  }),
  def("toast-alert", "Toast Notification", "interactive", "Non-blocking status notification banner using polite live region semantics.", {
    variants: ["info", "success", "danger"],
    accessibility: { role: "status", ariaLive: "polite" },
    build: ({ title = "Changes saved", message = "All 41 tokens compiled cleanly across light and dark modes." } = {}) => el("div", "Toast Alert", {
      attributes: { role: "status", "aria-live": "polite" },
      style: { ...CARD_STYLE, "flex-direction": "row", "align-items": "center", "justify-content": "space-between", padding: "12px 16px", "max-width": "420px", "box-shadow": "var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.1))" },
      children: [
        el("div", "Toast Body", {
          style: { display: "flex", "flex-direction": "column", gap: "2px" },
          children: [
            el("strong", "Toast Title", { text: title, style: { "font-size": "14px" } }),
            el("span", "Toast Message", { text: message, style: { "font-size": "13px", color: "var(--text-muted, #475569)" } }),
          ],
        }),
        el("button", "Toast Dismiss", { text: "Dismiss", attributes: { type: "button" }, style: SECONDARY_BTN_STYLE }),
      ],
    }),
  }),
  def("command-bar", "Command Palette", "interactive", "Keyboard-first command palette with instant zero-latency search and action list.", {
    variants: ["default"],
    accessibility: { role: "dialog", keyboard: "Instant filter with zero opening lag" },
    build: () => el("section", "Command Bar", {
      attributes: { role: "dialog", "aria-label": "Command palette" },
      style: { ...CARD_STYLE, padding: "0", overflow: "hidden", "max-width": "520px", "box-shadow": "var(--shadow-md, 0 10px 30px rgba(15, 23, 42, 0.14))" },
      children: [
        el("input", "Command Input", { attributes: { type: "search", placeholder: "Search commands, tokens, or components...", "aria-label": "Search commands" }, style: { width: "100%", height: "46px", padding: "0 16px", border: "0", "border-bottom": "1px solid var(--border-subtle, #e2e8f0)", "background-color": "var(--bg-surface, #ffffff)", color: "var(--text-primary, #0f172a)", "font-size": "14px" } }),
        el("div", "Command Results", {
          attributes: { role: "listbox", "aria-label": "Commands" },
          style: { display: "flex", "flex-direction": "column", padding: "8px" },
          children: [
            el("div", "Cmd 1", { text: "Audit accessibility and contrast", attributes: { role: "option", "aria-selected": "true" }, style: { padding: "10px 12px", "border-radius": "6px", "background-color": "var(--bg-subtle, #f1f5f9)", "font-size": "14px", "font-weight": "500" } }),
            el("div", "Cmd 2", { text: "Switch theme mode to Dark", attributes: { role: "option", "aria-selected": "false" }, style: { padding: "10px 12px", "border-radius": "6px", "font-size": "14px" } }),
          ],
        }),
      ],
    }),
  }),

  // ---- 6. PRODUCT COMPOSITIONS (4) ------------------------------------------
  def("auth-card", "Authentication Card", "product-compositions", "Clean, trustworthy sign-in form with accessible labels and single decisive submit.", {
    variants: ["sign-in"],
    accessibility: { landmark: "form", labels: "Explicit email and password labels" },
    build: ({ product = "Ninerr Workspace" } = {}) => el("section", "Auth Card", {
      style: { ...CARD_STYLE, "max-width": "400px", padding: "28px" },
      children: [
        el("h1", "Auth Title", { text: `Sign in to ${product}`, style: { margin: "0", "font-size": "24px", "font-weight": "700", "line-height": "1.2" } }),
        el("p", "Auth Subtitle", { text: "Enter your work email and password to continue.", style: { margin: "0", "font-size": "14px", color: "var(--text-muted, #475569)" } }),
        el("label", "Email Label", { text: "Email", attributes: { for: "auth-email" }, style: { "font-size": "13px", "font-weight": "600" } }),
        el("input", "Email Input", { attributes: { id: "auth-email", type: "email", placeholder: "you@company.com" }, style: INPUT_STYLE }),
        el("label", "Password Label", { text: "Password", attributes: { for: "auth-password" }, style: { "font-size": "13px", "font-weight": "600" } }),
        el("input", "Password Input", { attributes: { id: "auth-password", type: "password" }, style: INPUT_STYLE }),
        el("button", "Auth Submit", { text: "Sign in", attributes: { type: "submit", class: "ninerr-interactive" }, style: { ...PRIMARY_BTN_STYLE, width: "100%", "margin-top": "6px" } }),
      ],
    }),
  }),
  def("settings-panel", "Settings Panel", "product-compositions", "Structured preferences panel grouping toggles and clear save confirmation.", {
    variants: ["default"],
    accessibility: { heading: "h2 + descriptive helper copy" },
    build: () => el("section", "Settings Panel", {
      style: CARD_STYLE,
      children: [
        el("h2", "Settings Heading", { text: "Design Assurance Preferences", style: { margin: "0", "font-size": "20px", "font-weight": "600" } }),
        el("p", "Settings Intro", { text: "Configure local accessibility gates and motion preferences for this project.", style: { margin: "0", "font-size": "14px", color: "var(--text-muted, #475569)" } }),
        el("div", "Pref Row 1", {
          style: { display: "flex", "align-items": "center", "justify-content": "space-between", padding: "12px 0", "border-top": "1px solid var(--border-subtle, #e2e8f0)" },
          children: [
            el("span", "Pref 1 Label", { text: "Enforce WCAG AA contrast checks", style: { "font-size": "14px", "font-weight": "500" } }),
            el("button", "Pref 1 Toggle", { text: "Enabled", attributes: { type: "button", role: "switch", "aria-checked": "true" }, style: PRIMARY_BTN_STYLE }),
          ],
        }),
      ],
    }),
  }),
  def("dashboard-shell", "Dashboard Shell", "product-compositions", "Complete application workspace frame with rail, top bar, KPI strip, and main data region.", {
    variants: ["default"],
    accessibility: { landmarks: "aside + header + main" },
    build: ({ title = "Operations Overview" } = {}) => el("div", "Dashboard Shell", {
      style: { display: "grid", "grid-template-columns": "220px minmax(0, 1fr)", "min-height": "540px", "background-color": "var(--bg-canvas, #f8fafc)", color: "var(--text-primary, #0f172a)", "font-family": "var(--font-body, Inter, system-ui, sans-serif)" },
      children: [
        el("aside", "Shell Rail", {
          style: { padding: "20px 16px", "background-color": "var(--bg-surface, #ffffff)", "border-right": "1px solid var(--border-subtle, #e2e8f0)", display: "flex", "flex-direction": "column", gap: "8px" },
          children: [
            el("strong", "Workspace Title", { text: "Ninerr Studio", style: { "font-size": "15px", "margin-bottom": "12px" } }),
            el("a", "Rail Overview", { text: "Overview", attributes: { href: "#overview", "aria-current": "page" }, style: { padding: "8px 10px", "border-radius": "6px", "background-color": "var(--bg-subtle, #f1f5f9)", color: "var(--text-primary, #0f172a)", "font-size": "14px", "font-weight": "600", "text-decoration": "none" } }),
            el("a", "Rail Systems", { text: "Design Systems", attributes: { href: "#systems" }, style: { padding: "8px 10px", color: "var(--text-muted, #475569)", "font-size": "14px", "text-decoration": "none" } }),
          ],
        }),
        el("main", "Shell Main", {
          style: { display: "flex", "flex-direction": "column", gap: "20px", padding: "24px" },
          children: [
            el("header", "Shell Header", {
              style: { display: "flex", "align-items": "center", "justify-content": "space-between" },
              children: [
                el("h1", "Page Title", { text: title, style: { margin: "0", "font-size": "24px", "font-weight": "700" } }),
                el("button", "New Action", { text: "New release", attributes: { type: "button" }, style: PRIMARY_BTN_STYLE }),
              ],
            }),
            el("section", "KPI Row", {
              style: { display: "grid", "grid-template-columns": "repeat(3, minmax(0, 1fr))", gap: "16px" },
              children: [
                el("article", "Shell KPI 1", { style: CARD_STYLE, children: [el("span", "K1 Label", { text: "Active Projects", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } }), el("strong", "K1 Val", { text: "24", style: { "font-size": "24px", "font-variant-numeric": "tabular-nums" } })] }),
                el("article", "Shell KPI 2", { style: CARD_STYLE, children: [el("span", "K2 Label", { text: "WCAG Pass Rate", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } }), el("strong", "K2 Val", { text: "99.4%", style: { "font-size": "24px", "font-variant-numeric": "tabular-nums" } })] }),
                el("article", "Shell KPI 3", { style: CARD_STYLE, children: [el("span", "K3 Label", { text: "Token Drift", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } }), el("strong", "K3 Val", { text: "0", style: { "font-size": "24px", "font-variant-numeric": "tabular-nums" } })] }),
              ],
            }),
          ],
        }),
      ],
    }),
  }),
  def("billing-plan-row", "Billing Plan Row", "product-compositions", "Horizontal subscription summary row with tabular price and manage action.", {
    variants: ["default"],
    accessibility: { tabularNums: true },
    build: () => el("div", "Billing Row", {
      style: { ...CARD_STYLE, "flex-direction": "row", "align-items": "center", "justify-content": "space-between" },
      children: [
        el("div", "Plan Info", {
          style: { display: "flex", "flex-direction": "column", gap: "4px" },
          children: [
            el("strong", "Plan Name", { text: "Open Source Local Core", style: { "font-size": "16px" } }),
            el("span", "Plan Desc", { text: "Unlimited local projects, MCP tools, and offline design audits.", style: { "font-size": "13px", color: "var(--text-muted, #475569)" } }),
          ],
        }),
        el("div", "Plan Right", {
          style: { display: "flex", "align-items": "center", gap: "16px" },
          children: [
            el("strong", "Plan Price", { text: "$0 / mo", style: { "font-size": "18px", "font-variant-numeric": "tabular-nums" } }),
            el("button", "Manage Plan", { text: "View license", attributes: { type: "button" }, style: SECONDARY_BTN_STYLE }),
          ],
        }),
      ],
    }),
  }),

  // ---- 7. MARKETING COMPOSITIONS (5) ----------------------------------------
  def("hero-section", "Hero Section", "marketing-compositions", "High-conviction product hero with crisp typography hierarchy, restrained subcopy, and clear CTA pair.", {
    variants: ["centered", "split"],
    accessibility: { heading: "Single h1 display headline", contrast: "WCAG AA+" },
    build: ({ headline = "Design everything AI builds.", subcopy = "The local-first design intelligence layer that gives every coding agent real design systems, craft critique, and visual verification." } = {}) => el("section", "Hero Section", {
      style: { display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "20px", padding: "64px 32px", "max-width": "960px", "background-color": "var(--bg-canvas, #f8fafc)", color: "var(--text-primary, #0f172a)" },
      children: [
        el("span", "Hero Eyebrow", { text: "LOCAL-FIRST DESIGN INTELLIGENCE", style: { "font-size": "12px", "font-weight": "700", "letter-spacing": "0.08em", color: "var(--accent-primary, #0f766e)" } }),
        el("h1", "Hero Headline", { text: headline, style: { margin: "0", "font-size": "48px", "font-weight": "700", "line-height": "1.08", "letter-spacing": "-0.03em", "font-family": "var(--font-heading, Inter, system-ui, sans-serif)" } }),
        el("p", "Hero Subcopy", { text: subcopy, style: { margin: "0", "max-width": "620px", "font-size": "18px", "line-height": "1.6", color: "var(--text-muted, #475569)" } }),
        el("div", "Hero Actions", {
          style: { display: "flex", gap: "12px", "margin-top": "8px" },
          children: [
            el("button", "Hero Primary CTA", { text: "Install Ninerr", attributes: { type: "button", class: "ninerr-interactive" }, style: PRIMARY_BTN_STYLE, stylesheet: INTERACTIVE_STYLESHEET }),
            el("button", "Hero Secondary CTA", { text: "Read documentation", attributes: { type: "button", class: "ninerr-interactive" }, style: SECONDARY_BTN_STYLE, stylesheet: INTERACTIVE_STYLESHEET }),
          ],
        }),
      ],
    }),
  }),
  def("feature-grid", "Asymmetric Feature Showcase", "marketing-compositions", "Editorial lead-plus-supporting feature composition avoiding monotonous identical card grids.", {
    variants: ["asymmetric"],
    accessibility: { heading: "h2 section + h3 items" },
    build: () => el("section", "Feature Showcase", {
      style: { display: "grid", "grid-template-columns": "1.4fr 1fr", gap: "20px", padding: "32px" },
      children: [
        el("article", "Lead Feature", {
          style: { ...CARD_STYLE, padding: "28px" },
          children: [
            el("h2", "Lead Feature Title", { text: "Real Browser Visual Verification", style: { margin: "0", "font-size": "24px", "font-weight": "700" } }),
            el("p", "Lead Feature Copy", { text: "Capture deterministic multi-viewport screenshots, computed WCAG contrast, overflow, and clipping telemetry locally with zero network egress.", style: { margin: "0", "font-size": "15px", "line-height": "1.6", color: "var(--text-muted, #475569)" } }),
          ],
        }),
        el("div", "Supporting Stack", {
          style: { display: "flex", "flex-direction": "column", gap: "16px" },
          children: [
            el("article", "Sub Feature 1", { style: CARD_STYLE, children: [el("h3", "Sub 1 Title", { text: "Atomic Design Tokens", style: { margin: "0", "font-size": "16px", "font-weight": "600" } }), el("p", "Sub 1 Copy", { text: "Light, dark, and high-contrast modes compiled cleanly with W3C DTCG import and export.", style: { margin: "0", "font-size": "14px", color: "var(--text-muted, #475569)" } })] }),
            el("article", "Sub Feature 2", { style: CARD_STYLE, children: [el("h3", "Sub 2 Title", { text: "Safe Existing-App Redesign", style: { margin: "0", "font-size": "16px", "font-weight": "600" } }), el("p", "Sub 2 Copy", { text: "Upgrade visual craft while AST invariance gates protect every handler and business rule.", style: { margin: "0", "font-size": "14px", color: "var(--text-muted, #475569)" } })] }),
          ],
        }),
      ],
    }),
  }),
  def("pricing-tiers", "Pricing Tiers", "marketing-compositions", "Clear two-tier comparison with tabular pricing and one highlighted recommended plan.", {
    variants: ["two-tier"],
    accessibility: { tabularNums: true, heading: "h3 tier names" },
    build: () => el("section", "Pricing Tiers", {
      style: { display: "grid", "grid-template-columns": "repeat(2, minmax(0, 1fr))", gap: "20px", padding: "32px" },
      children: [
        el("article", "Tier Open Source", {
          style: CARD_STYLE,
          children: [
            el("h3", "Tier 1 Name", { text: "Local Core", style: { margin: "0", "font-size": "18px", "font-weight": "600" } }),
            el("strong", "Tier 1 Price", { text: "$0", style: { "font-size": "36px", "font-weight": "700", "font-variant-numeric": "tabular-nums" } }),
            el("p", "Tier 1 Copy", { text: "Full Apache-2.0 engine, CLI, MCP server, and local design checks forever.", style: { margin: "0", "font-size": "14px", color: "var(--text-muted, #475569)" } }),
            el("button", "Tier 1 CTA", { text: "Install locally", attributes: { type: "button" }, style: SECONDARY_BTN_STYLE }),
          ],
        }),
        el("article", "Tier Team", {
          style: { ...CARD_STYLE, border: "2px solid var(--accent-primary, #0f766e)" },
          children: [
            el("h3", "Tier 2 Name", { text: "Team System", style: { margin: "0", "font-size": "18px", "font-weight": "600" } }),
            el("strong", "Tier 2 Price", { text: "BYO Models", style: { "font-size": "32px", "font-weight": "700" } }),
            el("p", "Tier 2 Copy", { text: "Connect any coding agent or model provider while keeping every design artifact inside Git.", style: { margin: "0", "font-size": "14px", color: "var(--text-muted, #475569)" } }),
            el("button", "Tier 2 CTA", { text: "Connect agent", attributes: { type: "button" }, style: PRIMARY_BTN_STYLE }),
          ],
        }),
      ],
    }),
  }),
  def("testimonial-strip", "Testimonial Quote", "marketing-compositions", "Editorial blockquote with attributed author and role.", {
    variants: ["editorial"],
    accessibility: { landmark: "figure + blockquote + figcaption" },
    build: () => el("figure", "Testimonial", {
      style: { ...CARD_STYLE, margin: "0", padding: "28px", "border-left": "3px solid var(--accent-primary, #0f766e)" },
      children: [
        el("blockquote", "Quote Text", { text: "Ninerr turned our coding agents from guessing CSS values into shipping accessible, token-consistent interfaces on the first pass.", style: { margin: "0", "font-size": "18px", "line-height": "1.55", "font-weight": "500" } }),
        el("figcaption", "Quote Author", { text: "Maya Chen - Staff Design Engineer", style: { "font-size": "13px", color: "var(--text-muted, #475569)" } }),
      ],
    }),
  }),
  def("cta-banner", "CTA Banner", "marketing-compositions", "Focused high-contrast call-to-action closing band.", {
    variants: ["default"],
    accessibility: { heading: "h2 + single decisive action" },
    build: () => el("section", "CTA Banner", {
      style: { display: "flex", "align-items": "center", "justify-content": "space-between", gap: "24px", padding: "32px", "background-color": "var(--bg-subtle, #f1f5f9)", border: "1px solid var(--border-subtle, #e2e8f0)", "border-radius": "var(--radius-lg, 14px)" },
      children: [
        el("div", "CTA Copy", {
          style: { display: "flex", "flex-direction": "column", gap: "6px" },
          children: [
            el("h2", "CTA Heading", { text: "Give your coding agent real design judgment.", style: { margin: "0", "font-size": "24px", "font-weight": "700" } }),
            el("p", "CTA Text", { text: "Works locally with Codex, Claude Code, OpenCode, Cursor, and Gemini CLI.", style: { margin: "0", "font-size": "14px", color: "var(--text-muted, #475569)" } }),
          ],
        }),
        el("button", "CTA Button", { text: "Run ninerr doctor", attributes: { type: "button" }, style: PRIMARY_BTN_STYLE }),
      ],
    }),
  }),

  // ---- 8. ADVANCED (4) ------------------------------------------------------
  def("kanban-column", "Kanban Column", "advanced", "Structured workflow column with count header and scannable task items.", {
    variants: ["default"],
    accessibility: { landmark: "section + h3 + ul" },
    build: ({ title = "In Review", count = "2" } = {}) => el("section", "Kanban Column", {
      style: { display: "flex", "flex-direction": "column", gap: "12px", width: "300px", padding: "14px", "background-color": "var(--bg-subtle, #f8fafc)", border: "1px solid var(--border-subtle, #e2e8f0)", "border-radius": "var(--radius-md, 10px)" },
      children: [
        el("header", "Column Header", {
          style: { display: "flex", "align-items": "center", "justify-content": "space-between" },
          children: [
            el("h3", "Column Title", { text: title, style: { margin: "0", "font-size": "14px", "font-weight": "600" } }),
            el("span", "Column Count", { text: count, style: { "font-size": "12px", "font-weight": "600", color: "var(--text-muted, #475569)", "font-variant-numeric": "tabular-nums" } }),
          ],
        }),
        el("article", "Task Card 1", { style: { ...CARD_STYLE, padding: "14px", gap: "6px" }, children: [el("strong", "T1 Title", { text: "Verify mobile 375px header", style: { "font-size": "14px" } }), el("span", "T1 Meta", { text: "Accessibility - Priority High", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } })] }),
        el("article", "Task Card 2", { style: { ...CARD_STYLE, padding: "14px", gap: "6px" }, children: [el("strong", "T2 Title", { text: "Export W3C DTCG dark tokens", style: { "font-size": "14px" } }), el("span", "T2 Meta", { text: "Design System - Ready", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } })] }),
      ],
    }),
  }),
  def("filter-toolbar", "Filter Toolbar", "advanced", "Compact operational search and filter toolbar for data views.", {
    variants: ["default"],
    accessibility: { role: "search", labels: "Accessible search and sort controls" },
    build: () => el("div", "Filter Toolbar", {
      attributes: { role: "search", "aria-label": "Filter items" },
      style: { display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px", padding: "12px 16px", "background-color": "var(--bg-surface, #ffffff)", border: "1px solid var(--border-subtle, #e2e8f0)", "border-radius": "var(--radius-md, 10px)" },
      children: [
        el("input", "Filter Input", { attributes: { type: "search", placeholder: "Filter by name or token...", "aria-label": "Filter by name or token" }, style: { ...INPUT_STYLE, flex: "1" } }),
        el("button", "Sort Button", { text: "Sort: Recent", attributes: { type: "button" }, style: SECONDARY_BTN_STYLE }),
        el("button", "Export Button", { text: "Export", attributes: { type: "button" }, style: PRIMARY_BTN_STYLE }),
      ],
    }),
  }),
  def("split-detail-pane", "Master-Detail Split Pane", "advanced", "Two-pane master-detail workspace avoiding repetitive card grids for operational lists.", {
    variants: ["default"],
    accessibility: { landmarks: "nav list + article detail" },
    build: () => el("div", "Split Detail Pane", {
      style: { display: "grid", "grid-template-columns": "260px minmax(0, 1fr)", border: "1px solid var(--border-subtle, #e2e8f0)", "border-radius": "var(--radius-md, 10px)", overflow: "hidden", "background-color": "var(--bg-surface, #ffffff)" },
      children: [
        el("nav", "Master List", {
          attributes: { "aria-label": "Items" },
          style: { display: "flex", "flex-direction": "column", "border-right": "1px solid var(--border-subtle, #e2e8f0)", "background-color": "var(--bg-subtle, #f8fafc)" },
          children: [
            el("button", "Master Item 1", { text: "Primary Surface Palette", attributes: { type: "button", "aria-current": "true" }, style: { "text-align": "left", padding: "14px 16px", border: "0", "border-bottom": "1px solid var(--border-subtle, #e2e8f0)", "background-color": "var(--bg-surface, #ffffff)", "font-weight": "600", "font-size": "14px", cursor: "pointer" } }),
            el("button", "Master Item 2", { text: "Typography Scale", attributes: { type: "button" }, style: { "text-align": "left", padding: "14px 16px", border: "0", "border-bottom": "1px solid var(--border-subtle, #e2e8f0)", "background-color": "transparent", color: "var(--text-muted, #475569)", "font-size": "14px", cursor: "pointer" } }),
          ],
        }),
        el("article", "Detail Body", {
          style: { padding: "24px", display: "flex", "flex-direction": "column", gap: "10px" },
          children: [
            el("h3", "Detail Heading", { text: "Primary Surface Palette", style: { margin: "0", "font-size": "18px", "font-weight": "600" } }),
            el("p", "Detail Summary", { text: "All canvas, surface, and muted tokens meet WCAG AA contrast across light, dark, and high-contrast modes.", style: { margin: "0", "font-size": "14px", "line-height": "1.6", color: "var(--text-muted, #475569)" } }),
          ],
        }),
      ],
    }),
  }),
  def("chart-card", "Chart Card", "advanced", "Accessible data visualization card pairing SVG bar graphic with readable legend and summary.", {
    variants: ["bar"],
    accessibility: { svgRole: "img with aria-label", legend: "Textual metric summary alongside graphic" },
    build: ({ title = "Weekly Throughput" } = {}) => el("article", "Chart Card", {
      style: CARD_STYLE,
      children: [
        el("header", "Chart Header", {
          style: { display: "flex", "align-items": "baseline", "justify-content": "space-between" },
          children: [
            el("h3", "Chart Title", { text: title, style: { margin: "0", "font-size": "16px", "font-weight": "600" } }),
            el("span", "Chart Period", { text: "Last 5 weeks", style: { "font-size": "12px", color: "var(--text-muted, #475569)" } }),
          ],
        }),
        el("svg", "Bar Chart SVG", {
          attributes: { viewBox: "0 0 320 120", "aria-label": "Weekly throughput rising from 42 to 94 across 5 weeks" },
          style: { width: "100%", height: "120px" },
          children: [
            el("rect", "Bar 1", { attributes: { x: "16", y: "68", width: "40", height: "44", rx: "4", fill: "#94a3b8" } }),
            el("rect", "Bar 2", { attributes: { x: "76", y: "52", width: "40", height: "60", rx: "4", fill: "#94a3b8" } }),
            el("rect", "Bar 3", { attributes: { x: "136", y: "44", width: "40", height: "68", rx: "4", fill: "#94a3b8" } }),
            el("rect", "Bar 4", { attributes: { x: "196", y: "28", width: "40", height: "84", rx: "4", fill: "#94a3b8" } }),
            el("rect", "Bar 5", { attributes: { x: "256", y: "14", width: "40", height: "98", rx: "4", fill: "#0f766e" } }),
          ],
        }),
      ],
    }),
  }),
];

export const NINERR_COMPONENTS = Object.freeze(RAW_COMPONENTS);
const COMPONENT_MAP = new Map(NINERR_COMPONENTS.map((entry) => [entry.id, entry]));

/** Search Ninerr's 41 native editable components by keyword and/or category. */
export function searchNinerrComponents({ query = "", category = "" } = {}) {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  const cat = typeof category === "string" ? category.trim().toLowerCase() : "";
  return NINERR_COMPONENTS.filter((entry) => {
    if (cat && entry.category !== cat) return false;
    if (!q) return true;
    return entry.id.includes(q)
      || entry.name.toLowerCase().includes(q)
      || entry.category.includes(q)
      || entry.summary.toLowerCase().includes(q);
  }).map(({ build: _build, ...meta }) => meta);
}

/** Retrieve metadata for one native Ninerr component by id, or null. */
export function getNinerrComponent(id) {
  if (typeof id !== "string") return null;
  const entry = COMPONENT_MAP.get(id.trim().toLowerCase());
  if (!entry) return null;
  const { build: _build, ...meta } = entry;
  return meta;
}

/**
 * Flatten a native Ninerr component blueprint into document-model `insert-node` operations
 * (either as detached editable layers under `parentId` or wrapped inside a `component-definition`).
 */
export function buildComponentOperations(id, {
  parentId = null,
  insertIndex = 0,
  idPrefix = "cmp",
  asDefinition = false,
  options = {},
} = {}) {
  const entry = typeof id === "string" ? COMPONENT_MAP.get(id.trim().toLowerCase()) : null;
  if (!entry) throw new Error(`unknown Ninerr component: ${String(id)}`);
  const rootSpec = entry.build(options);
  const operations = [];
  let seq = 0;
  const nextId = () => {
    seq += 1;
    return `${idPrefix}-${seq}`;
  };

  let containerParentId = parentId;
  let containerIndex = insertIndex;
  let definitionId = null;

  if (asDefinition) {
    definitionId = `${idPrefix}-def`;
    operations.push({
      type: "insert-node",
      parentId: null,
      index: insertIndex,
      node: {
        id: definitionId,
        type: "component-definition",
        props: {
          name: entry.name,
          description: entry.summary,
          properties: [],
          variants: [],
        },
      },
    });
    containerParentId = definitionId;
    containerIndex = 0;
  }

  let rootNodeId = null;
  const emit = (spec, pid, idx) => {
    const nodeId = nextId();
    if (rootNodeId === null) rootNodeId = nodeId;
    const props = {
      name: spec.name,
      tag: spec.tag,
      ...(spec.text !== undefined ? { text: spec.text } : {}),
      ...(spec.attributes ? { attributes: { ...spec.attributes } } : {}),
      ...(spec.style ? { style: { ...spec.style } } : {}),
      ...(spec.stylesheet ? { stylesheet: spec.stylesheet } : {}),
    };
    operations.push({
      type: "insert-node",
      parentId: pid,
      index: idx,
      node: { id: nodeId, type: spec.type, props },
    });
    for (let i = 0; i < (spec.children?.length ?? 0); i += 1) {
      emit(spec.children[i], nodeId, i);
    }
  };

  emit(rootSpec, containerParentId, containerIndex);
  return {
    componentId: entry.id,
    componentName: entry.name,
    category: entry.category,
    definitionId,
    rootNodeId,
    nodeCount: seq,
    operations,
  };
}
