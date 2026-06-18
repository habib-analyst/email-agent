---
name: css-var-verification-and-live-clocks
description: Verify custom CSS variables exist in index.css before use (e.g., --surface-base is undefined, use --surface-page). For live clocks, use a 1-second tick state to force re-renders.
source: auto-skill
extracted_at: '2026-06-17T05:00:48.442Z'
---

### CSS Variable Verification
When UI elements appear transparent or fail to style, verify the custom CSS variable actually exists in `frontend/src/index.css`.
- **Gotcha:** `--surface-base` does **not** exist in this project. Using `rgb(var(--surface-base))` resolves to nothing, causing silent transparency.
- **Solution:** Use the defined variables: `--surface-page`, `--surface-card`, or `--surface-muted`. Always grep `index.css` to confirm a variable is defined before relying on it for backgrounds.

### Live Clocks in React
To display a live-updating local time (e.g., per US state or country) without complex date object state or full component remounts:
1. Add a simple `tick` state: `const [tick, setTick] = useState(0);`
2. Use a `useEffect` with a 1-second interval to increment it when the component is active: 
   ```js
   useEffect(() => {
     const id = setInterval(() => setTick(t => t + 1), 1000);
     return () => clearInterval(id);
   }, [isOpenOrActive]);
   ```
3. Call `new Date().toLocaleTimeString('en-US', { timeZone: tz })` in the render. The component re-renders every second due to the `tick` state change, keeping the displayed time live and accurate to the target IANA timezone.