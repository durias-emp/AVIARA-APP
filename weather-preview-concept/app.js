(() => {
  const home = document.querySelector(".home-screen");
  const detail = document.querySelector(".detail-view");
  const openWeather = document.querySelector("[data-open-weather]");
  const backHome = document.querySelector("[data-back-home]");
  const frame = document.querySelector(".phone-frame");

  function show(view) {
    const showDetail = view === "detail";
    detail.classList.toggle("closing", !showDetail);
    home.classList.toggle("is-active", !showDetail);
    detail.classList.toggle("is-active", showDetail);
    window.scrollTo({ top: 0, behavior: "auto" });

    if (showDetail) {
      window.requestAnimationFrame(() => {
        window.refreshWeatherSky?.();
      });
      window.setTimeout(() => {
        window.refreshWeatherSky?.();
      }, 680);
    }
  }

  openWeather?.addEventListener("click", () => {
    const cardRect = openWeather.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const originX = cardRect.left + cardRect.width / 2 - frameRect.left;
    const originY = cardRect.top + cardRect.height / 2 - frameRect.top;

    detail.style.setProperty("--open-x", `${originX}px`);
    detail.style.setProperty("--open-y", `${originY}px`);
    show("detail");
  });

  backHome?.addEventListener("click", () => show("home"));
})();
