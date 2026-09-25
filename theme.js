/**
 * Dylen Text Tools — Theme Manager
 * Manages themes (focus, forest, ocean, cliff, library, aurora)
 * and modes (light, dark, system).
 * Synchronizes across iframes and windows via postMessage and localStorage.
 */

(function () {
  'use strict';

  const THEMES = [
    { id: 'focus', name: 'Essential Focus', icon: 'ph-circle', swatchLight: 'rgb(9, 105, 218)', swatchDark: 'rgb(37, 99, 235)' },
    { id: 'forest', name: 'Deep Forest', icon: 'ph-tree', swatchLight: 'rgb(46, 125, 50)', swatchDark: 'rgb(72, 185, 95)' },
    { id: 'ocean', name: 'Oceanic Logic', icon: 'ph-waves', swatchLight: 'rgb(14, 116, 144)', swatchDark: 'rgb(56, 168, 220)' },
    { id: 'cliff', name: 'Cliffside Serenity', icon: 'ph-mountains', swatchLight: 'rgb(196, 62, 40)', swatchDark: 'rgb(246, 90, 68)' },
    { id: 'library', name: 'Scholastic Library', icon: 'ph-books', swatchLight: 'rgb(133, 77, 14)', swatchDark: 'rgb(217, 158, 63)' },
    { id: 'aurora', name: 'Nordic Aurora', icon: 'ph-sparkle', swatchLight: 'rgb(102, 88, 190)', swatchDark: 'rgb(112, 88, 186)' }
  ];

  // Tag iframe context so embedded tools hide redundant theme switcher
  if (window.parent && window.parent !== window) {
    document.documentElement.classList.add('inside-iframe');
  }

  const MODES = [
    { id: 'light', name: 'Light', icon: 'ph-sun' },
    { id: 'dark', name: 'Dark', icon: 'ph-moon' },
    { id: 'system', name: 'System', icon: 'ph-desktop' }
  ];

  const STORAGE_KEY_THEME = 'color-theme';
  const STORAGE_KEY_MODE = 'theme-mode';
  const DEFAULT_THEME = 'focus';
  const DEFAULT_MODE = 'system';

  function getStoredTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_THEME);
      if (stored && THEMES.some(t => t.id === stored)) {
        return stored;
      }
    } catch (e) {}
    return DEFAULT_THEME;
  }

  function getStoredMode() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_MODE);
      if (stored && (stored === 'light' || stored === 'dark' || stored === 'system')) {
        return stored;
      }
    } catch (e) {}
    return DEFAULT_MODE;
  }

  function resolveMode(mode) {
    if (mode === 'system') {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    }
    return mode;
  }

  let currentTheme = getStoredTheme();
  let currentMode = getStoredMode();
  let currentResolvedMode = resolveMode(currentMode);

  function applyTheme(theme, mode, options = {}) {
    if (!THEMES.some(t => t.id === theme)) theme = DEFAULT_THEME;
    if (!['light', 'dark', 'system'].includes(mode)) mode = DEFAULT_MODE;

    currentTheme = theme;
    currentMode = mode;
    currentResolvedMode = resolveMode(mode);

    if (!options.silentStorage) {
      try {
        localStorage.setItem(STORAGE_KEY_THEME, currentTheme);
        localStorage.setItem(STORAGE_KEY_MODE, currentMode);
      } catch (e) {}
    }

    const root = document.documentElement;
    root.setAttribute('data-color-theme', currentTheme);
    root.setAttribute('data-theme', currentTheme);
    root.setAttribute('data-mode', currentResolvedMode);

    updateMetaThemeColor();
    updateAllDropdownUIs();

    if (!options.silentBroadcast) {
      broadcastThemeChange(currentTheme, currentMode, currentResolvedMode);
    }

    window.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme: currentTheme, mode: currentMode, resolvedMode: currentResolvedMode }
    }));
    document.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme: currentTheme, mode: currentMode, resolvedMode: currentResolvedMode }
    }));
  }

  function updateMetaThemeColor() {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    const computedBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-surface').trim() ||
      (currentResolvedMode === 'dark' ? 'rgb(22, 22, 26)' : 'rgb(246, 248, 250)');
    meta.setAttribute('content', computedBg);
  }

  function broadcastThemeChange(theme, mode, resolvedMode) {
    const msg = {
      type: 'theme_change',
      theme,
      mode,
      resolvedMode
    };

    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(msg, '*');
      } catch (e) {}
    }

    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage(msg, '*');
        }
      } catch (e) {}
    });
  }

  function renderDropdownMenu(menuEl) {
    if (!menuEl) return;

    let html = '';

    // 1. Mode Segmented Control
    html += '<div class="theme-mode-segmented" role="radiogroup" aria-label="Color Mode">';
    MODES.forEach(m => {
      const isActive = currentMode === m.id;
      html += `
        <button type="button" class="theme-mode-btn ${isActive ? 'active' : ''}" data-mode-choice="${m.id}" role="radio" aria-checked="${isActive}">
          <i class="ph ${m.icon}"></i>
          <span>${m.name}</span>
        </button>
      `;
    });
    html += '</div>';

    html += '<div class="theme-dropdown-divider"></div>';

    // 2. Palette List
    html += '<div class="theme-palette-grid" role="radiogroup" aria-label="Theme Palette">';
    THEMES.forEach(t => {
      const isActive = currentTheme === t.id;
      html += `
        <button type="button" class="theme-option-item ${isActive ? 'active' : ''}" data-theme-choice="${t.id}" role="radio" aria-checked="${isActive}">
          <span class="theme-swatch theme-swatch-${t.id}"></span>
          <span class="theme-option-name">${t.name}</span>
          ${isActive ? '<i class="ph ph-check theme-check-icon"></i>' : ''}
        </button>
      `;
    });
    html += '</div>';

    menuEl.innerHTML = html;

    // Attach click events
    menuEl.querySelectorAll('[data-mode-choice]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.getAttribute('data-mode-choice');
        applyTheme(currentTheme, mode);
      });
    });

    menuEl.querySelectorAll('[data-theme-choice]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const theme = btn.getAttribute('data-theme-choice');
        applyTheme(theme, currentMode);
      });
    });
  }

  let globalDropdownMenu = null;
  let activeTriggerBtn = null;

  function ensureDropdownMenu() {
    if (!globalDropdownMenu || !document.body.contains(globalDropdownMenu)) {
      globalDropdownMenu = document.getElementById('theme-dropdown-menu-global');
      if (!globalDropdownMenu) {
        globalDropdownMenu = document.createElement('div');
        globalDropdownMenu.id = 'theme-dropdown-menu-global';
        globalDropdownMenu.className = 'theme-dropdown-menu';
        globalDropdownMenu.setAttribute('role', 'menu');
        document.body.appendChild(globalDropdownMenu);
      }
    }
    return globalDropdownMenu;
  }

  function positionDropdown(btn, menu) {
    const rect = btn.getBoundingClientRect();
    const menuWidth = 240;
    const margin = 8;

    let left = rect.right - menuWidth;
    if (left < margin) {
      left = margin;
    }
    if (left + menuWidth > window.innerWidth - margin) {
      left = window.innerWidth - menuWidth - margin;
    }

    let top = rect.bottom + 6;
    const menuHeight = menu.offsetHeight || 280;
    if (top + menuHeight > window.innerHeight - margin && rect.top > menuHeight + margin) {
      top = rect.top - menuHeight - 6;
    }

    menu.style.top = `${Math.max(margin, Math.round(top))}px`;
    menu.style.left = `${Math.max(margin, Math.round(left))}px`;
  }

  function updateAllDropdownUIs() {
    if (globalDropdownMenu && globalDropdownMenu.classList.contains('visible')) {
      renderDropdownMenu(globalDropdownMenu);
    }
    document.querySelectorAll('.theme-dropdown-menu').forEach(menu => {
      renderDropdownMenu(menu);
    });
  }

  function bindDropdownTriggers() {
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = 'true';

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const menu = ensureDropdownMenu();
        const isOpenForThisBtn = menu.classList.contains('visible') && activeTriggerBtn === btn;

        closeAllThemeDropdowns();

        if (!isOpenForThisBtn) {
          activeTriggerBtn = btn;
          btn.setAttribute('aria-expanded', 'true');
          renderDropdownMenu(menu);
          menu.classList.add('visible');
          positionDropdown(btn, menu);
        }
      });
    });
  }

  function closeAllThemeDropdowns() {
    if (globalDropdownMenu) {
      globalDropdownMenu.classList.remove('visible');
    }
    document.querySelectorAll('.theme-dropdown-menu.visible').forEach(m => {
      m.classList.remove('visible');
    });
    if (activeTriggerBtn) {
      activeTriggerBtn.setAttribute('aria-expanded', 'false');
      activeTriggerBtn = null;
    }
    document.querySelectorAll('.theme-toggle-btn[aria-expanded="true"]').forEach(btn => {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.theme-toggle-btn') || e.target.closest('.theme-dropdown-menu')) {
      return;
    }
    closeAllThemeDropdowns();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllThemeDropdowns();
    }
  });

  window.addEventListener('resize', () => {
    if (globalDropdownMenu && globalDropdownMenu.classList.contains('visible') && activeTriggerBtn) {
      positionDropdown(activeTriggerBtn, globalDropdownMenu);
    }
  });

  window.addEventListener('scroll', (e) => {
    if (globalDropdownMenu && globalDropdownMenu.classList.contains('visible')) {
      if (e.target && globalDropdownMenu.contains(e.target)) return;
      closeAllThemeDropdowns();
    }
  }, true);

  // Media query listener for OS mode changes
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (currentMode === 'system') {
        applyTheme(currentTheme, 'system');
      }
    };
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
    } else if (mq.addListener) {
      mq.addListener(onChange);
    }
  }

  // Multi-tab / iframe sync via localStorage
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY_THEME || e.key === STORAGE_KEY_MODE) {
      const theme = getStoredTheme();
      const mode = getStoredMode();
      applyTheme(theme, mode, { silentStorage: true });
    }
  });

  // Iframe sync via postMessage
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'theme_change') {
      const { theme, mode } = e.data;
      if (theme && mode) {
        applyTheme(theme, mode, { silentBroadcast: true });
      }
    }
  });

  // Run immediately on script execution to avoid FOUC
  const initialTheme = getStoredTheme();
  const initialMode = getStoredMode();
  applyTheme(initialTheme, initialMode, { silentStorage: true, silentBroadcast: true });

  // DOM ready hook
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindDropdownTriggers();
      updateAllDropdownUIs();
    });
  } else {
    bindDropdownTriggers();
    updateAllDropdownUIs();
  }

  // Export ThemeManager to window
  window.ThemeManager = {
    getTheme: () => currentTheme,
    getMode: () => currentMode,
    getResolvedMode: () => currentResolvedMode,
    setTheme: (theme) => applyTheme(theme, currentMode),
    setMode: (mode) => applyTheme(currentTheme, mode),
    toggleMode: () => {
      const nextMode = currentResolvedMode === 'dark' ? 'light' : 'dark';
      applyTheme(currentTheme, nextMode);
    },
    applyTheme,
    bindDropdownTriggers,
    renderDropdownMenu,
    THEMES,
    MODES
  };
})();
