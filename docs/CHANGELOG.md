# Changelog

## [1.0.0-1] — 2026-07-17

### Code Quality

- Removed 11 `console.log` calls from production code
- Removed dead `getBookmarkById` handler from background service worker
- Removed always-hidden `headerTitle` DOM element and its CSS rules
- Removed orphaned `.venv/` Python virtual environment
- Created `.gitignore` for `.venv/`, `.DS_Store`, `node_modules/`
- Fixed unused `isLoading` variable (was assigned but never read)
- Changed `let` to `const` for arrays/objects that aren't reassigned
- Replaced `catch(e){}` with ES2019 optional `catch{}` for ignored errors

### CSS Consolidation

- Consolidated 3 identical sub-drawer CSS blocks (`.vbb-sub-drawer-top`, `.bottom`, `.horizontal`) into single comma-separated rules

### Performance

- Simplified `getFaviconUrls()` to return a single URL string instead of array with dead fallback loop
- Fixed stale `setTimeout` cleanup in `closeSubDrawersFrom()` — pending removals are tracked and cancelled on rapid navigation
- Added accordion state persistence — open section is saved/restored across settings re-renders
- Extracted `toggleAccordion()` shared function to eliminate duplicated toggle logic
- Consolidated `applySettingsPanelPosition()` — replaces duplicate positioning logic in `openSettingsPanel()` and `repositionSettingsPanel()`

### Refactoring

- Refactored `addAccordionSection()` from 8 positional parameters to single config object; all 7 callers updated
- Updated settings callbacks to use template literals for cleaner HTML generation

### Font Awesome Tree-Shaking

- Reduced `all.min.css` from 14 KB to 1.7 KB (only 26 used icons instead of thousands)
- Reduced `fa-solid-900.woff2` from 153 KB to 2.5 KB (only 26 glyphs via fonttools subsetting)
- Total Font Awesome size reduced by **97%** (~167 KB → ~4.2 KB)

### Extension Context Invalidation Fix

- Added `safeSendMessage()` wrapper that catches "Extension context invalidated" errors when extension is reloaded
- All `chrome.runtime.sendMessage` calls now use the wrapper instead of throwing uncaught exceptions

### Build Tooling

- Added `package.json` with lint/format scripts
- Added ESLint 9 flat config (`eslint.config.mjs`) with Chrome MV3 globals
- Added Prettier config (`.prettierrc`) with consistent formatting rules
- Added `.prettierignore` for minified Font Awesome files
- Added GitHub Actions CI workflow (`.github/workflows/ci.yml`)
- Added `node_modules/` with ESLint, Prettier, and globals dependencies
- ESLint: 0 errors, 0 warnings; Prettier: all files formatted consistently
