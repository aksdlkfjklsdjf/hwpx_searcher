(() => {
      const storageKey = "hwp-search-theme";
      const isTheme = (value) => value === "system" || value === "light" || value === "dark";
      let preference = "system";
      try {
        const urlTheme = new URLSearchParams(window.location.search).get("theme");
        const storedTheme = window.localStorage.getItem(storageKey);
        preference = isTheme(urlTheme) ? urlTheme : isTheme(storedTheme) ? storedTheme : "system";
      } catch {
        preference = "system";
      }
      const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      const resolvedTheme = preference === "system" ? systemTheme : preference;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themePreference = preference;
      document.documentElement.style.colorScheme = resolvedTheme;
    })();
