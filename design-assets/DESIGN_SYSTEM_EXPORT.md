# Card Breakerz Design System Export
**Version 2.0 - Vibrant Sports Market Edition**  
Last Updated: March 26, 2026

---

## 🎨 Design Philosophy

Card Breakerz has evolved from a dark Bloomberg-inspired terminal aesthetic to a vibrant, energetic sports-market design that maintains analytical credibility. The system balances excitement with professionalism, using bold colors, glowing effects, and elevated components while preserving data clarity.

---

## 📦 Color System

### Background Layers
```css
--terminal-bg: #0a0e1a;                    /* Main app background */
--terminal-surface: #131820;               /* Card/panel background */
--terminal-surface-hover: #1a1f2e;         /* Hover state */
--terminal-surface-active: #222838;        /* Active/pressed state */
--terminal-border: #1e2533;                /* Default border */
--terminal-border-hover: #2a3142;          /* Hover border */
```

### Accent Colors
```css
--accent-blue: #3b82f6;                    /* Primary CTA */
--accent-blue-dim: #2563eb;                /* Dimmed blue */
--accent-blue-bright: #60a5fa;             /* Bright blue */
--accent-red: #dc2626;                     /* Error/danger */
--accent-red-dim: #991b1b;                 /* Dimmed red */
--accent-green: #22c55e;                   /* Success */
--accent-orange: #f59e0b;                  /* Warning */
```

### Sport-Specific Colors
```css
--sport-baseball-primary: #3b82f6;
--sport-baseball-secondary: #60a5fa;
--sport-basketball-primary: #f97316;
--sport-basketball-secondary: #fb923c;
--sport-football-primary: #22c55e;
--sport-football-secondary: #4ade80;
```

### Gradients
```css
--gradient-blue: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
--gradient-orange: linear-gradient(135deg, #f97316 0%, #ef4444 100%);
--gradient-green: linear-gradient(135deg, #22c55e 0%, #10b981 100%);
--gradient-hero: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
--gradient-card: linear-gradient(180deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0) 100%);
```

### Glow Effects
```css
--glow-blue: 0 0 20px rgba(59, 130, 246, 0.4);
--glow-orange: 0 0 20px rgba(249, 115, 22, 0.4);
--glow-green: 0 0 20px rgba(34, 197, 94, 0.4);
--glow-purple: 0 0 20px rgba(168, 85, 247, 0.4);
```

### Text Hierarchy
```css
--text-primary: #f5f5f7;                   /* Main text */
--text-secondary: #a8adb8;                 /* Supporting text */
--text-tertiary: #6b7280;                  /* Muted text */
--text-disabled: #4b5563;                  /* Disabled text */
```

### Signal Colors (Deal States)
```css
--signal-buy: #22c55e;                     /* Buy recommendation */
--signal-buy-bg: rgba(34, 197, 94, 0.1);
--signal-buy-border: rgba(34, 197, 94, 0.3);

--signal-watch: #f59e0b;                   /* Watch/neutral */
--signal-watch-bg: rgba(245, 158, 11, 0.1);
--signal-watch-border: rgba(245, 158, 11, 0.3);

--signal-pass: #dc2626;                    /* Pass/avoid */
--signal-pass-bg: rgba(220, 38, 38, 0.1);
--signal-pass-border: rgba(220, 38, 38, 0.3);
```

### Badge Colors
```css
--badge-rookie: #60a5fa;
--badge-veteran: #8b5cf6;
--badge-icon: #f59e0b;
--badge-parallel: #ec4899;
```

### Status Indicators
```css
--status-live: #22c55e;
--status-pre-release: #f59e0b;
--status-error: #dc2626;
```

---

## 🔤 Typography

### Font Families
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', Monaco, 'Cascadia Code', monospace;
```

### Font Sizes
```css
--text-2xs: 0.625rem;    /* 10px - Micro labels */
--text-xs: 0.75rem;      /* 12px - Terminal labels */
--text-sm: 0.875rem;     /* 14px - Body small */
--text-base: 1rem;       /* 16px - Body text */
--text-lg: 1.125rem;     /* 18px - Headings */
--text-xl: 1.25rem;      /* 20px - Section headers */
--text-2xl: 1.5rem;      /* 24px - Page titles */
--text-3xl: 1.875rem;    /* 30px - Hero */
--text-4xl: 2.25rem;     /* 36px - Large hero */
```

### Font Weights
```css
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

### Line Heights
```css
--leading-tight: 1.25;
--leading-snug: 1.375;
--leading-normal: 1.5;
--leading-relaxed: 1.625;
```

### Letter Spacing
```css
--tracking-tight: -0.01em;
--tracking-normal: 0;
--tracking-wide: 0.025em;
--tracking-wider: 0.05em;
```

---

## 📏 Spacing Scale

```css
--space-1: 0.25rem;    /* 4px */
--space-2: 0.5rem;     /* 8px */
--space-3: 0.75rem;    /* 12px */
--space-4: 1rem;       /* 16px */
--space-5: 1.25rem;    /* 20px */
--space-6: 1.5rem;     /* 24px */
--space-8: 2rem;       /* 32px */
--space-10: 2.5rem;    /* 40px */
--space-12: 3rem;      /* 48px */
```

---

## 🔲 Border Radii

```css
--radius-none: 0;
--radius-sm: 0.25rem;   /* 4px */
--radius-md: 0.375rem;  /* 6px */
--radius-lg: 0.5rem;    /* 8px */
--radius-xl: 0.75rem;   /* 12px */
--radius-2xl: 1rem;     /* 16px */
--radius-full: 9999px;
```

---

## 🌑 Shadows

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.2);
--shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.3);
--shadow-elevated: 0 4px 24px rgba(0, 0, 0, 0.4);
```

---

## ⚡ Transitions

```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 📊 Z-Index Scale

```css
--z-base: 0;
--z-dropdown: 1000;
--z-sticky: 1100;
--z-overlay: 1200;
--z-modal: 1300;
--z-toast: 1400;
```

---

## 🧩 Component Library

### 1. ElevatedCard
**Purpose:** High-contrast cards with thick borders and deep shadows for important content sections.

**Props:**
- `children: ReactNode` - Card content
- `className?: string` - Additional CSS classes

**Usage:**
```tsx
import { ElevatedCard } from "./components/ElevatedCard";

<ElevatedCard>
  <form>
    {/* Form content */}
  </form>
</ElevatedCard>
```

**Visual Specs:**
- Border: 2px solid `--terminal-border-hover`
- Border radius: 0.75rem (xl)
- Background: `--terminal-surface`
- Padding: 1.5rem (6)
- Shadow: `0 4px 24px rgba(0, 0, 0, 0.4)`

---

### 2. StepHeader
**Purpose:** Numbered step indicators with glowing gradient boxes for multi-step workflows.

**Props:**
- `stepNumber: number` - Step number to display
- `title: string` - Step title
- `subtitle?: string` - Optional subtitle
- `className?: string` - Additional CSS classes

**Usage:**
```tsx
import { StepHeader } from "./components/StepHeader";

<StepHeader 
  stepNumber={1} 
  title="Configure Your Break"
  subtitle="Set up your break parameters"
/>
```

**Visual Specs:**
- Number box: 40x40px, rounded-lg
- Background: `--gradient-blue`
- Box shadow: `0 0 20px rgba(59, 130, 246, 0.3)`
- Title: text-xl, font-bold
- Subtitle: text-sm, secondary color

---

### 3. FormLabel
**Purpose:** Bold uppercase labels with consistent styling for form fields.

**Props:**
- `children: ReactNode` - Label text
- `htmlFor?: string` - Associated input ID
- `required?: boolean` - Shows red asterisk
- `className?: string` - Additional CSS classes

**Usage:**
```tsx
import { FormLabel } from "./components/FormLabel";

<FormLabel htmlFor="product" required>
  Product
</FormLabel>
```

**Visual Specs:**
- Font size: text-xs (12px)
- Font weight: bold
- Text transform: uppercase
- Letter spacing: 0.05em
- Color: `--text-secondary`
- Margin bottom: 0.75rem (3)

---

### 4. SegmentedControl
**Purpose:** Button groups for mutually exclusive options with glowing active states.

**Props:**
- `options: Array<{ value: string; label: ReactNode }>` - Available options
- `value: string` - Currently selected value
- `onChange: (value: string) => void` - Change handler
- `className?: string` - Additional CSS classes

**Usage:**
```tsx
import { SegmentedControl } from "./components/SegmentedControl";

<SegmentedControl
  options={[
    { value: "hobby", label: "Hobby" },
    { value: "blaster", label: "Blaster" },
    { value: "retail", label: "Retail" }
  ]}
  value={breakType}
  onChange={setBreakType}
/>
```

**Visual Specs:**
- Container: rounded-lg, border, padding 0.375rem
- Container background: `--terminal-bg`
- Active button: `--accent-blue` background
- Active button shadow: `--glow-blue`
- Inactive button: transparent background, `--text-secondary` color
- Transition: all properties, 200ms

---

### 5. CounterInput
**Purpose:** Numeric stepper with animated +/- buttons for quantities.

**Props:**
- `value: number` - Current value
- `onChange: (value: number) => void` - Change handler
- `min?: number` - Minimum value (default: 1)
- `max?: number` - Maximum value
- `className?: string` - Additional CSS classes

**Usage:**
```tsx
import { CounterInput } from "./components/CounterInput";

<CounterInput
  value={caseCount}
  onChange={setCaseCount}
  min={1}
  max={10}
/>
```

**Visual Specs:**
- Container: rounded-lg, border, padding x-4 y-2.5
- Background: `--terminal-bg`
- Value: font-mono, font-bold, text-2xl
- Buttons: text-xl, `--accent-blue` color
- Button hover: scale(1.25)
- Disabled state: opacity 0.3

---

### 6. LargeCTAButton
**Purpose:** Prominent call-to-action buttons with glowing effects for primary actions.

**Props:**
- `children: ReactNode` - Button content
- `onClick?: () => void` - Click handler
- `disabled?: boolean` - Disabled state
- `loading?: boolean` - Loading state
- `variant?: "primary" | "secondary" | "success" | "danger"` - Button style
- `className?: string` - Additional CSS classes

**Usage:**
```tsx
import { LargeCTAButton } from "./components/LargeCTAButton";
import { Sparkles } from "lucide-react";

<LargeCTAButton
  onClick={handleAnalyze}
  disabled={!canAnalyze}
  loading={isAnalyzing}
  variant="primary"
>
  <Sparkles className="w-5 h-5" />
  Analyze Deal
</LargeCTAButton>
```

**Visual Specs:**
- Height: 3.5rem (14)
- Width: 100% (full)
- Border radius: rounded-lg
- Font size: text-lg
- Font weight: bold
- Transition: scale on hover/active

**Variants:**
- **Primary:** `--accent-blue` background, `--glow-blue` shadow
- **Success:** `--signal-buy` background, `--glow-green` shadow
- **Danger:** `--signal-pass` background, red glow
- **Secondary:** `--terminal-surface` background, 2px border
- **Disabled/Loading:** `--terminal-border` background, no glow

---

## 🎯 Utility Classes

### Surface Patterns
```css
.terminal-surface {
  background-color: var(--terminal-surface);
  border: 1px solid var(--terminal-border);
}

.terminal-surface-hover {
  background-color: var(--terminal-surface);
  border: 1px solid var(--terminal-border);
  transition: all 200ms;
}
.terminal-surface-hover:hover {
  background-color: var(--terminal-surface-hover);
  border-color: var(--terminal-border-hover);
}

.terminal-clickable {
  cursor: pointer;
  transition: all 200ms;
}
.terminal-clickable:hover {
  background-color: var(--terminal-surface-hover);
}
.terminal-clickable:active {
  background-color: var(--terminal-surface-active);
  transform: scale(0.98);
}
```

### Labels
```css
.terminal-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.terminal-label-muted {
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}
```

### Data Display
```css
.terminal-data {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-primary);
}

.terminal-data-large {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}
```

### Status Indicators
```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot-live {
  background-color: var(--status-live);
}

.status-dot-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

### Dividers
```css
.terminal-divider {
  height: 1px;
  background-color: var(--terminal-border);
  width: 100%;
}

.terminal-divider-vertical {
  width: 1px;
  background-color: var(--terminal-border);
  height: 100%;
}
```

### Signal Colors
```css
.signal-buy { color: var(--signal-buy); }
.signal-watch { color: var(--signal-watch); }
.signal-pass { color: var(--signal-pass); }
```

---

## 📋 Common Patterns

### Pattern: Elevated Form Container
```tsx
<div className="max-w-2xl mx-auto py-8 space-y-8">
  <StepHeader 
    stepNumber={1} 
    title="Configure Break"
  />
  
  <ElevatedCard>
    <div className="space-y-6">
      <div>
        <FormLabel htmlFor="product" required>
          Product
        </FormLabel>
        <input
          id="product"
          className="w-full px-4 py-3 rounded-lg border-2"
          style={{
            backgroundColor: "var(--terminal-bg)",
            borderColor: "var(--terminal-border)",
            color: "var(--text-primary)",
          }}
        />
      </div>
    </div>
  </ElevatedCard>
  
  <LargeCTAButton variant="primary">
    Continue
  </LargeCTAButton>
</div>
```

### Pattern: Data Table with Centered Columns
```tsx
<table className="w-full">
  <thead>
    <tr style={{ backgroundColor: "var(--terminal-surface)" }}>
      <th className="text-left px-4 py-3">Team</th>
      <th className="text-center px-4 py-3">Slot Cost</th>
      <th className="text-center px-4 py-3">Value</th>
      <th className="text-center px-4 py-3">Signal</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td className="text-left px-4 py-3">Lakers</td>
      <td className="text-center px-4 py-3 terminal-data">$380</td>
      <td className="text-center px-4 py-3 terminal-data">$450</td>
      <td className="text-center px-4 py-3">
        <span className="signal-buy">BUY</span>
      </td>
    </tr>
  </tbody>
</table>
```

### Pattern: Segmented Control Group
```tsx
<div className="space-y-3">
  <FormLabel>Break Type</FormLabel>
  <SegmentedControl
    options={[
      { value: "hobby", label: "Hobby" },
      { value: "blaster", label: "Blaster" },
      { value: "retail", label: "Retail" }
    ]}
    value={breakType}
    onChange={setBreakType}
  />
</div>
```

### Pattern: Counter with Label
```tsx
<div className="space-y-3">
  <FormLabel>Number of Cases</FormLabel>
  <CounterInput
    value={caseCount}
    onChange={setCaseCount}
    min={1}
    max={10}
  />
</div>
```

---

## 🎨 Design Guidelines

### When to Use Each Component

**ElevatedCard:**
- Forms and configuration panels
- Important content sections that need emphasis
- Grouped related information
- Modal-like content within the page

**StepHeader:**
- Multi-step forms and workflows
- Onboarding flows
- Configuration wizards
- Process indicators

**FormLabel:**
- All form inputs
- Consistent field labeling
- Required field indicators

**SegmentedControl:**
- 2-5 mutually exclusive options
- Filter/sort controls
- View mode toggles
- Category selection

**CounterInput:**
- Numeric quantities (cases, boxes, slots)
- Bounded numeric inputs
- Counts with min/max constraints

**LargeCTAButton:**
- Primary page actions
- Form submissions
- "Analyze", "Submit", "Continue" actions
- High-impact user decisions

### Color Usage Guidelines

**Primary Actions:** Use `--accent-blue` with `--glow-blue`
**Success States:** Use `--signal-buy` (green) with `--glow-green`
**Warnings:** Use `--signal-watch` (orange)
**Errors/Danger:** Use `--signal-pass` (red)
**Neutral/Secondary:** Use `--terminal-surface` with borders

### Typography Guidelines

**Page Titles:** text-3xl (30px), font-bold
**Section Headers:** text-xl (20px), font-bold
**Body Text:** text-base (16px), font-normal
**Labels:** text-xs (12px), font-bold, uppercase
**Data/Numbers:** Use `font-mono` for consistency

### Spacing Guidelines

**Page Margins:** py-8 (2rem)
**Section Gaps:** space-y-8 (2rem)
**Card Padding:** p-6 (1.5rem)
**Form Field Gaps:** space-y-6 (1.5rem)
**Inline Elements:** gap-3 (0.75rem)

---

## 🚀 Implementation Notes

### Required Dependencies
- React
- Tailwind CSS v4
- lucide-react (for icons)

### File Structure
```
/src
  /app
    /components
      ElevatedCard.tsx
      StepHeader.tsx
      FormLabel.tsx
      SegmentedControl.tsx
      CounterInput.tsx
      LargeCTAButton.tsx
      DesignTokens.tsx
  /styles
    terminal.css
    theme.css
    tailwind.css
```

### CSS Import Order
```tsx
import '/src/styles/tailwind.css';
import '/src/styles/terminal.css';
import '/src/styles/theme.css';
```

### Integration Checklist
- [ ] Import terminal.css in main app
- [ ] Verify Inter and JetBrains Mono fonts are loaded
- [ ] Install lucide-react for icons
- [ ] Copy all component files to project
- [ ] Update color tokens if needed for brand
- [ ] Test responsive behavior on mobile
- [ ] Verify accessibility (keyboard nav, focus states)

---

## 📱 Responsive Considerations

All components are mobile-friendly by default:
- ElevatedCard: Adjusts padding on mobile (p-4 instead of p-6)
- StepHeader: Stacks vertically on narrow screens
- SegmentedControl: Maintains flex layout, text may need adjustment
- CounterInput: Maintains compact horizontal layout
- LargeCTAButton: Full width by default
- Typography: Consider reducing font sizes on mobile

Recommended mobile breakpoint adjustments:
```css
@media (max-width: 768px) {
  .elevated-card { padding: 1rem; }
  .step-header h2 { font-size: 1.125rem; }
  .large-cta-button { height: 3rem; font-size: 1rem; }
}
```

---

## 🎯 Future Enhancements

Potential additions to consider:
- Toast notification component
- Modal/dialog component with elevated styling
- Loading skeleton states
- Empty state illustrations
- Data visualization components (charts, graphs)
- Player card components
- Break room lobby components
- Chat/comment components

---

## 📄 Version History

**v2.0 (March 26, 2026)** - Vibrant Sports Market Edition
- Transformed from dark terminal to energetic sports aesthetic
- Added elevated component patterns
- Introduced gradient and glow effects
- Created comprehensive component library
- Added step headers and segmented controls

**v1.0** - Bloomberg Terminal Edition
- Initial dark analytical theme
- Basic utility classes
- Foundation color and typography system

---

## 📞 Support & Questions

This design system was created for Card Breakerz using Figma Make.

For questions about implementation or extending the system, refer to:
- Component files in `/src/app/components/`
- Design tokens in `/src/app/components/DesignTokens.tsx`
- CSS variables in `/src/styles/terminal.css`

---

**End of Design System Export**
