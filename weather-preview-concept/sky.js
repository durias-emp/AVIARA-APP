(() => {
  const canvas = document.querySelector(".sky-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  let width = 0;
  let height = 0;
  let dpr = 1;

  function mulberry32(seed) {
    return () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(580813);

  function makeCloudCells(count, yMin, yMax, minSize, maxSize) {
    return Array.from({ length: count }, () => {
      const size = minSize + rand() * (maxSize - minSize);
      return {
        x: -0.16 + rand() * 1.32,
        y: yMin + rand() * (yMax - yMin),
        rx: size * (0.86 + rand() * 0.58),
        ry: size * (0.28 + rand() * 0.28),
        alpha: 0.38 + rand() * 0.42,
        warmth: rand(),
        phase: rand() * Math.PI * 2,
      };
    });
  }

  const cloudLayers = [
    {
      cells: makeCloudCells(12, 0.05, 0.31, 0.12, 0.27),
      blur: 14,
      alpha: 0.54,
      speed: 0.0016,
      shadow: 0.22,
    },
    {
      cells: makeCloudCells(16, 0.18, 0.52, 0.15, 0.34),
      blur: 18,
      alpha: 0.72,
      speed: -0.0024,
      shadow: 0.32,
    },
    {
      cells: makeCloudCells(10, 0.34, 0.68, 0.18, 0.42),
      blur: 22,
      alpha: 0.48,
      speed: 0.0034,
      shadow: 0.38,
    },
  ];

  const rain = Array.from({ length: 34 }, () => ({
    x: rand(),
    y: rand(),
    speed: 0.58 + rand() * 0.88,
    length: 28 + rand() * 52,
    alpha: 0.07 + rand() * 0.17,
    drift: -24 - rand() * 24,
  }));

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function softEllipse(x, y, rx, ry, stops) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // eslint-disable-next-line no-unused-vars
  function drawCloudCell(cell, layer, drift, time) {
    const span = width + 360;
    const wobble = Math.sin(cell.phase) * 8;
    const x = ((cell.x * width + drift + 180) % span) - 180;
    const y = cell.y * height + wobble;
    const rx = Math.max(50, cell.rx * width);
    const ry = Math.max(24, cell.ry * height);
    const warm = 232 + Math.round(cell.warmth * 23);
    const alpha = cell.alpha * layer.alpha;

    softEllipse(x + rx * 0.08, y + ry * 0.34, rx * 1.04, ry * 0.88, [
      [0, `rgba(28, 39, 54, ${layer.shadow})`],
      [0.48, `rgba(44, 58, 70, ${layer.shadow * 0.6})`],
      [1, "rgba(44, 58, 70, 0)"],
    ]);

    ctx.globalCompositeOperation = "screen";
    softEllipse(x, y, rx, ry, [
      [0, `rgba(${warm}, ${warm + 6}, 255, ${alpha})`],
      [0.34, `rgba(222, 238, 247, ${alpha * 0.68})`],
      [0.72, `rgba(168, 191, 204, ${alpha * 0.16})`],
      [1, "rgba(168, 191, 204, 0)"],
    ]);
    ctx.globalCompositeOperation = "source-over";
  }

  function drawClouds(time) {
    cloudLayers.forEach((layer) => {
      ctx.save();
      ctx.filter = `blur(${layer.blur}px)`;
      const drift = time * layer.speed * width;
      layer.cells.forEach((cell) => drawCloudCell(cell, layer, drift, time));
      ctx.restore();
    });

    ctx.save();
    ctx.filter = "blur(30px)";
    softEllipse(width * 0.58, height * 0.3, width * 0.72, height * 0.16, [
      [0, "rgba(31, 42, 55, 0.18)"],
      [0.56, "rgba(48, 62, 76, 0.08)"],
      [1, "rgba(48, 62, 76, 0)"],
    ]);
    ctx.globalCompositeOperation = "screen";
    softEllipse(width * 0.36, height * 0.2, width * 0.46, height * 0.12, [
      [0, "rgba(255, 255, 255, 0.16)"],
      [0.58, "rgba(255, 255, 255, 0.05)"],
      [1, "rgba(255, 255, 255, 0)"],
    ]);
    ctx.restore();
  }

  function drawRain() {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 1.25;
    ctx.globalCompositeOperation = "screen";

    rain.forEach((drop) => {
      const progress = drop.y;
      const x = drop.x * width + Math.sin(drop.x * 8) * 12;
      const y = progress * (height + 180) - 90;
      const grad = ctx.createLinearGradient(x, y, x + drop.drift, y + drop.length);
      grad.addColorStop(0, "rgba(230, 244, 255, 0)");
      grad.addColorStop(0.42, `rgba(228, 244, 255, ${drop.alpha})`);
      grad.addColorStop(1, "rgba(228, 244, 255, 0)");
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + drop.drift, y + drop.length);
      ctx.stroke();
    });

    ctx.restore();
  }

  function drawHaze() {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.filter = "blur(20px)";
    const drift = 10;
    softEllipse(width * 0.34 + drift, height * 0.48, width * 0.58, height * 0.18, [
      [0, "rgba(228, 242, 249, 0.12)"],
      [0.66, "rgba(228, 242, 249, 0.05)"],
      [1, "rgba(228, 242, 249, 0)"],
    ]);
    softEllipse(width * 0.74 - drift, height * 0.62, width * 0.7, height * 0.2, [
      [0, "rgba(205, 226, 237, 0.1)"],
      [0.72, "rgba(205, 226, 237, 0.04)"],
      [1, "rgba(205, 226, 237, 0)"],
    ]);
    ctx.restore();
  }

  function drawLight() {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const pulse = 0.09;
    softEllipse(width * 0.04, height * 0.08, width * 0.42, height * 0.25, [
      [0, `rgba(255, 229, 166, ${pulse})`],
      [0.48, "rgba(255, 235, 188, 0.045)"],
      [1, "rgba(255, 235, 188, 0)"],
    ]);
    ctx.restore();
  }

  function render(time = 0) {
    ctx.clearRect(0, 0, width, height);
    drawLight();
    drawClouds(time);
    drawHaze();
    drawRain();
  }

  resize();
  render(0);
  window.refreshWeatherSky = () => {
    resize();
    render(0);
  };

  window.addEventListener("resize", () => {
    resize();
    render(0);
  });
})();
