# UI Design System - Project-2 File Manager

## Design Philosophy

- **Desktop-first productivity tool**: Optimized for keyboard workflows and large screens
- **Clean, professional, efficient**: Minimalist design with purposeful elements
- **Keyboard-centric workflows**: All features accessible via keyboard
- **No unnecessary animations**: Fast, snappy interactions prioritizing performance

---

## Color Palette

### Primary Colors (Blue - Action Colors)
```
primary-50:  #EFF6FF (lightest)
primary-100: #DBEAFE
primary-500: #3B82F6 (main brand color)
primary-600: #2563EB (hover states)
primary-700: #1D4ED8 (active states)
```

### Neutral Colors (Gray - UI Structure)
```
gray-50:  #F9FAFB (backgrounds)
gray-100: #F3F4F6 (hover states)
gray-200: #E5E7EB (borders)
gray-400: #9CA3AF (muted text)
gray-600: #4B5563 (body text)
gray-800: #1F2937 (headings)
gray-900: #111827 (primary text)
```

### Semantic Colors
```
success-500: #10B981 (green - successful operations)
warning-500: #F59E0B (amber - warnings)
error-500:   #EF4444 (red - errors, destructive actions)
info-500:    #06B6D4 (cyan - informational messages)
```

---

## Typography Scale

**Font Family**: Inter (system fallback)

```
xs:   0.75rem / 1rem     (12px / 16px line-height)
sm:   0.875rem / 1.25rem (14px / 20px)
base: 1rem / 1.5rem      (16px / 24px)
lg:   1.125rem / 1.75rem (18px / 28px)
xl:   1.25rem / 1.75rem  (20px / 28px)
2xl:  1.5rem / 2rem      (24px / 32px)
```

---

## Spacing System (8pt Grid)

```
xs:  4px  (0.5 rem)
sm:  8px  (1 rem)
md:  16px (2 rem)
lg:  24px (3 rem)
xl:  32px (4 rem)
2xl: 48px (6 rem)
```

**Usage**: Use spacing tokens consistently for margins, paddings, and gaps.

---

## Border Radius

```
sm:   4px  (subtle rounding)
md:   8px  (standard UI elements)
lg:   12px (cards, panels)
xl:   16px (prominent containers)
2xl:  20px (large cards)
full: 9999px (pills, avatars)
```

---

## Shadows

```
sm: 0 1px 2px 0 rgb(0 0 0 / 0.05)
md: 0 4px 6px -1px rgb(0 0 0 / 0.1)
lg: 0 10px 15px -3px rgb(0 0 0 / 0.1)
xl: 0 20px 25px -5px rgb(0 0 0 / 0.1)
```

---

## Animation Timing

```
fast: 150ms
base: 200ms
slow: 300ms
easing: cubic-bezier(0.4, 0, 0.2, 1)
```

---

## Component Library

### Atomic Components

#### Button
**Variants**: primary, secondary, ghost, danger
**Sizes**: sm, md, lg
**States**: default, hover, active, disabled, loading

**Usage**:
```tsx
<Button variant="primary" size="md" onClick={handleClick}>
  Click Me
</Button>
```

#### Input
**Features**: Validation states, icons, error messages
**Types**: text, search, number, password, email

**Usage**:
```tsx
<Input 
  value={value} 
  onChange={setValue} 
  error={errorMessage}
  icon={<SearchIcon />}
/>
```

#### Tooltip
**Positions**: top, bottom, left, right
**Features**: Hover/focus tooltips with configurable delay

**Usage**:
```tsx
<Tooltip content="Delete file" position="top">
  <Button icon={<Trash />} />
</Tooltip>
```

#### Spinner
**Sizes**: sm, md, lg
**Colors**: primary, white, gray

#### Toast
**Types**: success, error, warning, info
**Features**: Auto-dismiss, manual close, stacking

---

## Component Composition Patterns

### File Explorer
```
FileGrid (virtualized container)
  └─ FileListItem (individual rows)
       ├─ Icon (from fileIcons utility)
       ├─ Name (truncated)
       ├─ Size (formatted)
       └─ Date (relative)
```

### Search System
```
SearchBar (container)
  ├─ SearchInput (with icon)
  └─ SearchSuggestions (dropdown)
```

### Chat Interface
```
ChatInterface (container)
  ├─ IndexingStatus (header)
  ├─ MessageBubble[] (messages)
  └─ ChatInput (input + send)
```

---

## Accessibility Standards (WCAG 2.1 AA)

### Keyboard Navigation
- All interactive elements: Tab accessible
- Buttons: Enter/Space activation
- Lists: Arrow key navigation
- Shortcuts: Documented and consistent

### Focus Indicators
- Visible: ring-2 ring-primary-500
- High contrast: Always visible on focus
- Never disabled: Focus management critical

### ARIA Labels
- Descriptive labels: aria-label for icon buttons
- Dynamic content: aria-live for updates
- Roles: Semantic HTML + ARIA roles

### Color Contrast
- Normal text: 4.5:1 minimum
- Large text (18px+): 3:1 minimum
- UI components: 3:1 minimum

---

## Performance Optimization

### React Optimizations
- **React.memo**: Prevent unnecessary re-renders on large lists
- **useMemo**: Cache expensive computations (sorting, filtering)
- **useCallback**: Stable function references

### Virtualization
- **react-window**: For lists >100 items
- **FixedSizeList**: Consistent item heights (50px)
- **Performance target**: 60 FPS with 10,000+ files

### Debouncing
- **Search**: 300ms delay
- **Auto-save**: 500ms delay
- **Resize events**: 100ms delay

---

## Common UI Patterns

### File Selection
- Single click: Select
- Double click: Open
- Ctrl+Click: Multi-select
- Shift+Click: Range select
- Right-click: Context menu

### Navigation
- Back/Forward: Browser-style history
- Breadcrumb: Click any segment to navigate
- Tree: Lazy-load children on expand

### Feedback
- Loading: Spinner overlay
- Success: Green toast notification
- Error: Red toast with retry option
- Progress: IndexingStatus component

---

**Last Updated**: December 18, 2025  
**Maintained By**: Project-2 Team
